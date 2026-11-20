//go:build linux

// Derived from Claude Cage (MIT, Copyright (c) 2026 Sylvain Zimmer and Claude
// Cage contributors), internal/containerenv/tap_linux.go.

package netstack

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// RunTAP is an internal guest-only helper. Its stdout is exclusively framed
// Ethernet data. The caller connects it to the host-owned network stack.
func RunTAP(ctx context.Context, input io.Reader, output io.Writer, macs ...string) error {
	if err := requirePrivateGuestNetwork(); err != nil {
		return err
	}
	guestMAC := GuestMAC
	if len(macs) > 1 {
		return errors.New("expected at most one guest MAC")
	}
	if len(macs) == 1 {
		mac, err := net.ParseMAC(macs[0])
		if err != nil || len(mac) != 6 || mac[0]&3 != 2 {
			return errors.New("invalid guest MAC")
		}
		guestMAC = mac.String()
	}
	// A disconnected engine exec can take a moment to deliver EOF to its old
	// helper. Wait for that non-persistent TAP to vanish; never delete an
	// interface or take over another process's file descriptor.
	waitCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for {
		interfaces, err := net.Interfaces()
		if err != nil {
			return err
		}
		oldTap := false
		for _, iface := range interfaces {
			if iface.Name == TapName {
				oldTap = true
			} else if iface.Name != "lo" {
				return errors.New("the container has another network interface; refusing to start")
			}
		}
		if !oldTap {
			break
		}
		select {
		case <-waitCtx.Done():
			return errors.New("the previous network interface is still present (the host's network process clears it at its next start)")
		case <-time.After(100 * time.Millisecond):
		}
	}
	// An unattached TUN fd reports POLLERR. Registering it with Go's poller
	// before TUNSETIFF races with an irreversible "not pollable" error.
	// Attach the device first, then wrap the nonblocking descriptor.
	fd, err := unix.Open("/dev/net/tun", unix.O_RDWR|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		if errors.Is(err, unix.ENODEV) || errors.Is(err, unix.ENXIO) {
			// The device file exists but nothing is registered behind it: the
			// tun module is not loaded (neither is it kept across boots).
			return fmt.Errorf("cannot open /dev/net/tun: %w\n"+
				"the tun module is not loaded on the host:\n"+
				"  sudo modprobe tun\n"+
				"  echo tun | sudo tee /etc/modules-load.d/happy-sandbox.conf   (load it at boot too)", err)
		}
		if errors.Is(err, unix.EACCES) || errors.Is(err, unix.EPERM) {
			// CentOS / RHEL / Fedora confine the container's init domain and
			// deny it the TAP device by default.
			return fmt.Errorf("cannot open /dev/net/tun: %w\n"+
				"On a host with SELinux (CentOS, RHEL, Fedora) the container's domain needs it:\n"+
				"  happy-sandbox selinux-policy   (prints the two commands; run them with sudo once)", err)
		}
		return err
	}
	request, err := unix.NewIfreq(TapName)
	if err != nil {
		_ = unix.Close(fd)
		return err
	}
	request.SetUint16(unix.IFF_TAP | unix.IFF_NO_PI)
	if err := unix.IoctlIfreq(fd, unix.TUNSETIFF, request); err != nil {
		_ = unix.Close(fd)
		return err
	}
	file := os.NewFile(uintptr(fd), "/dev/net/tun")
	if file == nil {
		_ = unix.Close(fd)
		return errors.New("cannot manage the TAP file descriptor")
	}
	defer file.Close()
	for _, arguments := range [][]string{
		{"link", "set", "dev", TapName, "address", guestMAC, "mtu", fmt.Sprint(NetworkMTU)},
		{"link", "set", "dev", "lo", "up"},
		{"address", "add", GuestIP + "/24", "dev", TapName},
		{"link", "set", "dev", TapName, "up"},
		{"route", "add", "default", "via", GatewayIP, "dev", TapName},
	} {
		if result, err := exec.CommandContext(ctx, "ip", arguments...).CombinedOutput(); err != nil {
			return fmt.Errorf("configure container TAP: %w: %.1024s", err, result)
		}
	}
	// The host resolver must never be inherited by the workload. Write through
	// the engine's resolv.conf mount; do not replace the mount or a symlink.
	info, err := os.Lstat("/etc/resolv.conf")
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("/etc/resolv.conf must be a regular file")
	}
	if err = os.WriteFile("/etc/resolv.conf", []byte("nameserver "+GatewayIP+"\noptions timeout:2 attempts:2\n"), 0644); err != nil {
		return err
	}
	stop := context.AfterFunc(ctx, func() { _ = file.Close() })
	defer stop()
	ended := make(chan error, 1)
	go func() {
		buffer := make([]byte, maxFrameSize)
		for {
			frame, err := readFrame(input, buffer)
			if err == nil {
				var n int
				n, err = file.Write(frame)
				if err == nil && n != len(frame) {
					err = io.ErrShortWrite
				}
			}
			if err != nil {
				_ = file.Close()
				ended <- err
				return
			}
		}
	}()
	buffer := make([]byte, maxFrameSize)
	for {
		n, err := file.Read(buffer)
		if err == nil {
			err = writeFrame(output, buffer[:n])
		}
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			select {
			case inputErr := <-ended:
				return inputErr
			default:
				return err
			}
		}
	}
}

func requirePrivateGuestNetwork() error {
	if os.Geteuid() != 0 {
		return errors.New("the TAP helper must run as root inside the container")
	}
	uidMap, err := os.ReadFile("/proc/self/uid_map")
	if err != nil {
		return err
	}
	fields := strings.Fields(string(uidMap))
	if len(fields) == 3 && fields[0] == "0" && fields[1] == "0" && fields[2] == "4294967295" {
		return errors.New("the TAP helper refuses to run in the host user namespace")
	}
	if _, first := os.Stat("/run/.containerenv"); first != nil {
		if _, second := os.Stat("/.dockerenv"); second != nil {
			return errors.New("the TAP helper runs only inside the sandbox container")
		}
	}
	return nil
}

// RunLink is the guest side of the network link (the hsb-link unit, run by
// the container's systemd): connect to the host network process's socket,
// run the TAP over it, and connect again whenever the link ends — the host
// process restarted, or the host side dropped it. Only ctx ends it.
func RunLink(ctx context.Context, socket string, macs ...string) error {
	for ctx.Err() == nil {
		var d net.Dialer
		conn, err := d.DialContext(ctx, "unix", socket)
		if err == nil {
			err = RunTAP(ctx, conn, conn, macs...)
			conn.Close()
			if ctx.Err() == nil {
				fmt.Fprintf(os.Stderr, "happy-sandbox: link ended (%v); reconnecting\n", err)
			}
		}
		select {
		case <-ctx.Done():
		case <-time.After(time.Second):
		}
	}
	return nil
}
