package sandbox

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/gate"
	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/netstack"
	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/proxycore"
)

// Status is what the network process reports in run/state.json.
type Status struct {
	Pid       int       `json:"pid"`
	Gate      string    `json:"gate"`
	Reason    string    `json:"reason,omitempty"`
	ExitIP    string    `json:"exit_ip,omitempty"`
	Country   string    `json:"country,omitempty"`
	CheckedAt time.Time `json:"checked_at,omitempty"`
	Since     time.Time `json:"since"`
}

func (i *Instance) statePath() string { return filepath.Join(i.RunDir(), "state.json") }
func (i *Instance) PidPath() string   { return filepath.Join(i.RunDir(), "net.pid") }

func (i *Instance) ReadStatus() (*Status, bool) {
	data, err := os.ReadFile(i.statePath())
	if err != nil {
		return nil, false
	}
	var s Status
	if json.Unmarshal(data, &s) != nil {
		return nil, false
	}
	alive := s.Pid > 0 && processAlive(s.Pid)
	return &s, alive
}

func (i *Instance) writeStatus(s Status) {
	data, _ := json.Marshal(s)
	tmp := i.statePath() + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, i.statePath())
	}
}

func mihomoPath() string {
	if p := os.Getenv("HSB_MIHOMO"); p != "" {
		return p
	}
	self, _ := os.Executable()
	return filepath.Join(filepath.Dir(self), "mihomo")
}

// LinkDirInContainer is where the host's link directory is mounted: the
// guest's hsb-link unit connects to the network process's socket there.
const LinkDirInContainer = "/var/lib/happy-sandbox/link"

// LinkDir holds the network process's socket on the host (mounted into the container).
func (i *Instance) LinkDir() string { return filepath.Join(i.RunDir(), "link") }

func (i *Instance) linkSocket() string { return filepath.Join(i.LinkDir(), "net.sock") }

// ServeNetwork is the network of the running container: the managed mihomo,
// the gate, and the user-space stack joined to the container's TAP.
//
// The frames travel over a unix socket in a directory mounted into the
// container, not over a `podman exec` pipe: Podman 3.4 sometimes declares a
// long-lived exec dead (its exit file "timed out") while the process is
// fine, which cut the network every hour or so on a busy host. Inside, the
// systemd unit hsb-link (guest-link) connects, runs the TAP, and reconnects
// whenever the link ends; here, a lost link closes the gate and the next
// connection gets a new stack and a new gate, opened again only on a good
// exit. Only the end of mihomo or of this process ends it all.
func (i *Instance) ServeNetwork(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	if err := os.MkdirAll(i.LinkDir(), 0o700); err != nil {
		return err
	}
	node, err := proxycore.LoadNode(i.NodeFile())
	if err != nil {
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(i.RunDir(), "mihomo.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer logFile.Close()
	core, err := proxycore.Start(ctx, mihomoPath(), node, filepath.Join(i.RunDir(), "mihomo"), logFile)
	if err != nil {
		return err
	}
	defer core.Stop()
	_ = os.WriteFile(filepath.Join(i.RunDir(), "core.pid"), []byte(fmt.Sprintln(core.Pid())), 0o600)
	cfg := gate.Config{ProxyURL: core.ProxyURL(), DNSURL: gate.DefaultDNSURL(), ExitIP: i.Config.ExitIP}
	var nid *netstack.Identity
	hostPorts, err := CheckHostPorts(i.Config.HostPorts)
	if err != nil {
		return err
	}
	if i.Identity != nil {
		nid = &netstack.Identity{MACAddress: i.Identity.MAC, GatewayMACAddress: i.Identity.GatewayMAC, HostPorts: hostPorts}
	} else if len(hostPorts) > 0 {
		nid = &netstack.Identity{MACAddress: netstack.GuestMAC, GatewayMACAddress: netstack.GatewayMAC, HostPorts: hostPorts}
	}

	_ = os.Remove(i.linkSocket())
	listener, err := net.Listen("unix", i.linkSocket())
	if err != nil {
		return fmt.Errorf("network link socket: %v", err)
	}
	defer func() { listener.Close(); _ = os.Remove(i.linkSocket()) }()
	if err := os.Chmod(i.linkSocket(), 0o600); err != nil {
		return err
	}
	stopAccept := context.AfterFunc(ctx, func() { listener.Close() })
	defer stopAccept()
	accepted := make(chan net.Conn)
	acceptErr := make(chan error, 1)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				acceptErr <- err
				return
			}
			select {
			case accepted <- conn:
			case <-ctx.Done():
				conn.Close()
				return
			}
		}
	}()

	st := Status{Pid: os.Getpid(), Gate: gate.GateClosed, Reason: "waiting for the sandbox to connect", Since: time.Now()}
	i.writeStatus(st)
	defer func() { st.Gate, st.Reason = gate.GateClosed, "stopped"; i.writeStatus(st) }()

	for links := 0; ; links++ {
		var conn net.Conn
		select {
		case <-ctx.Done():
			return nil
		case <-core.Done():
			return fmt.Errorf("mihomo exited: %v", core.Err())
		case err := <-acceptErr:
			if ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("network link socket: %v", err)
		case conn = <-accepted:
		}
		if links > 0 {
			i.logf("the sandbox reconnected")
		}
		network, err := netstack.NewNetworkFor(cfg, nid)
		if err != nil {
			conn.Close()
			return err
		}
		linkCtx, linkCancel := context.WithCancel(ctx)
		netDone := make(chan error, 1)
		go func() { netDone <- network.Run(linkCtx, conn) }()
		monitorDone := make(chan error, 1)
		go func() { monitorDone <- i.monitor(linkCtx, network.Gate, cfg, &st) }()

		var fatal error
		monitorEnded := false
		select {
		case <-ctx.Done():
		case err := <-netDone:
			i.logf("the sandbox link ended (%v); waiting for it to reconnect", err)
		case <-core.Done():
			fatal = fmt.Errorf("mihomo exited: %v", core.Err())
		case err := <-monitorDone:
			fatal, monitorEnded = err, true
		}
		linkCancel()
		network.Gate.Close("the sandbox link ended")
		conn.Close()
		if !monitorEnded {
			<-monitorDone
		}
		st.Gate, st.Reason = gate.GateClosed, "waiting for the sandbox to reconnect"
		i.writeStatus(st)
		if fatal != nil || ctx.Err() != nil {
			return fatal
		}
	}
}

const linkUnit = "hsb-link"

// StopGuestLink stops the guest side (before the helper binary is replaced)
// and any guest-tap left from a pre-0.3.0 exec link.
func (i *Instance) StopGuestLink(ctx context.Context) error {
	_, _ = podman(ctx, "exec", "--user", "0", i.Container(), "sh", "-c",
		"systemctl stop "+linkUnit+" 2>/dev/null; systemctl reset-failed "+linkUnit+" 2>/dev/null; true")
	return i.clearGuestTap(ctx)
}

// StartGuestLink starts the guest side as a transient systemd unit in the
// container: systemd restarts it if it ever exits, and it reconnects by
// itself whenever the link ends. The exec here returns at once.
func (i *Instance) StartGuestLink(ctx context.Context) error {
	args := []string{"exec", "--user", "0", i.Container(), "systemd-run", "--unit", linkUnit, "--collect",
		"--property", "Restart=always", "--property", "RestartSec=1",
		"/usr/local/lib/happy-sandbox/happy-sandbox", "guest-link", LinkDirInContainer + "/net.sock"}
	if i.Identity != nil {
		args = append(args, i.Identity.MAC)
	}
	if _, err := podman(ctx, args...); err != nil {
		return fmt.Errorf("starting the network link in the container: %v", err)
	}
	return nil
}

// guestTapPattern matches only our helper's command line (anchored, so the
// shell running the cleanup, whose own command line contains it, is spared).
const guestTapPattern = "^/usr/local/lib/happy-sandbox/happy-sandbox guest-tap"

// clearGuestTapScript stops any guest-tap in the container and waits for its
// TAP to go (TERM, then KILL after 5 s). Exit 0 when the TAP is gone.
func clearGuestTapScript() string {
	return `p='` + guestTapPattern + `'
pkill -TERM -f "$p" 2>/dev/null
for _ in $(seq 50); do ip link show ` + netstack.TapName + ` >/dev/null 2>&1 || exit 0; sleep 0.1; done
pkill -KILL -f "$p" 2>/dev/null
for _ in $(seq 50); do ip link show ` + netstack.TapName + ` >/dev/null 2>&1 || exit 0; sleep 0.1; done
exit 1`
}

func (i *Instance) clearGuestTap(ctx context.Context) error {
	if _, err := podman(ctx, "exec", "--user", "0", i.Container(), "sh", "-c", clearGuestTapScript()); err != nil {
		return fmt.Errorf("could not clear the previous network link in the container: %v", err)
	}
	return nil
}

func (i *Instance) logf(format string, a ...any) {
	line := time.Now().Format(time.RFC3339) + " " + fmt.Sprintf(format, a...) + "\n"
	if f, err := os.OpenFile(filepath.Join(i.RunDir(), "gate.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600); err == nil {
		_, _ = f.WriteString(line)
		f.Close()
	}
	fmt.Fprint(os.Stderr, line)
}

// monitor opens the gate on a good exit and keeps it open only while the exit
// stays good: a check every 15 s renews it (the gate itself lapses after 90 s
// without renewal). A wrong exit closes the gate at once; failures to reach
// the providers close it after three in a row, retried at once (~15 s). The
// owner gets a push when an open gate closes and when it reopens.
func (i *Instance) monitor(ctx context.Context, g *gate.EgressGate, cfg gate.Config, st *Status) error {
	failures := 0
	wasOpen, faulted := false, false
	host := i.Hostname()
	push := func(title, body string) {
		go func() {
			pctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := i.Notify(pctx, title, body); err != nil {
				i.logf("push failed: %v", err)
			}
		}()
	}
	closeWith := func(reason, why string) {
		if g.Status().Mode != gate.GateClosed {
			g.Close(reason)
		}
		st.Gate, st.Reason = gate.GateClosed, reason
		i.writeStatus(*st)
		if wasOpen && !faulted {
			push("⚠️ "+host+": 沙箱网络已断开", why)
		}
		faulted = true
	}
	for {
		probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		exit, err := gate.ProbeExit(probeCtx, cfg)
		cancel()
		st.CheckedAt = time.Now()
		switch {
		case err != nil:
			failures++
			i.logf("probe failed (%d in a row): %v", failures, err)
			if failures >= 3 {
				if st.Gate != gate.GateClosed {
					i.logf("gate closed: unreachable")
				}
				closeWith("the providers cannot be reached", "连不上出口（VLESS 节点或线路故障），已停止所有对外连接")
			}
		case exit.IP != cfg.ExitIP:
			failures = 0
			st.ExitIP, st.Country = exit.IP, exit.Country
			if st.Gate != gate.GateClosed {
				i.logf("WRONG EXIT %s (%s), expected %s: gate closed", exit.IP, exit.Country, cfg.ExitIP)
			}
			closeWith("wrong exit "+exit.IP, fmt.Sprintf("出口变成了 %s（%s），应为 %s，已停止所有对外连接", exit.IP, exit.Country, cfg.ExitIP))
		default:
			failures = 0
			st.ExitIP, st.Country = exit.IP, exit.Country
			v := gate.Verdict{ID: fmt.Sprint(time.Now().UnixNano()), ExitIP: exit.IP, Country: exit.Country, CreatedAt: time.Now()}
			if g.Status().Mode == gate.GateOpen {
				if err := g.Renew(v); err != nil {
					i.logf("renew failed: %v", err)
				}
			} else if err := g.BeginCheck(); err == nil {
				v.CheckID = g.Status().CheckID
				v.CreatedAt = time.Now()
				if err := g.Grant(v); err != nil {
					i.logf("grant failed: %v", err)
				} else {
					i.logf("gate open: exit %s (%s)", exit.IP, exit.Country)
					if faulted {
						push("✅ "+host+": 沙箱网络已恢复", "出口 "+exit.IP+"（"+exit.Country+"），可以继续了")
					}
					wasOpen, faulted = true, false
				}
			}
			if g.Status().Mode == gate.GateOpen {
				st.Gate, st.Reason = gate.GateOpen, ""
			}
		}
		i.writeStatus(*st)
		wait := 15 * time.Second
		if failures > 0 && failures < 3 {
			wait = 0
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}
	}
}
