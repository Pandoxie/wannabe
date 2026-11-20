package proxycore

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"gopkg.in/yaml.v3"
)

const group = "SANDBOX"

// Core is a running mihomo owned by this process: started as a child that
// the kernel kills when this process dies (Pdeathsig), so no proxy outlives
// the sandbox network.
type Core struct {
	Port     int
	Password string
	cmd      *exec.Cmd
	done     chan struct{} // closed when the process has exited
	err      error         // its exit status, valid once done is closed
}

// ProxyURL is the gate's upstream (socks5 with auth, numeric loopback).
func (c *Core) ProxyURL() string {
	return fmt.Sprintf("socks5://sandbox:%s@127.0.0.1:%d", c.Password, c.Port)
}

// Done is closed when the core exits; Err then holds its status. Any number of
// waiters may use it (a single-value channel once hung the shutdown path).
func (c *Core) Done() <-chan struct{} { return c.done }

func (c *Core) Err() error { <-c.done; return c.err }

// Pid of the core process (tests suspend it to simulate a stalled proxy).
func (c *Core) Pid() int { return c.cmd.Process.Pid }

func (c *Core) Stop() {
	if c.cmd.Process != nil {
		_ = c.cmd.Process.Signal(syscall.SIGTERM)
		select {
		case <-c.done:
		case <-time.After(3 * time.Second):
			_ = c.cmd.Process.Kill()
			<-c.done
		}
	}
}

// Config is mihomo's configuration: Cage's shape for one node. The SOCKS port
// listens on 127.0.0.1 only, with a password; the one rule sends everything
// through the node; TUN, LAN and IPv6 are off; mihomo's own DNS bootstraps
// only the node's server name, over DoH (no host resolver).
func Config(n Node, port int, password string, workDir string) ([]byte, error) {
	bootstrap := []string{"https://1.1.1.1/dns-query", "https://223.5.5.5/dns-query"}
	dns := map[string]any{"enable": true, "ipv6": false, "use-hosts": false, "use-system-hosts": false,
		"default-nameserver": bootstrap, "proxy-server-nameserver": bootstrap,
		"nameserver": []string{"https://1.1.1.1/dns-query#" + group}}
	node := map[string]any(n)
	cfg := map[string]any{
		"mixed-port": port, "bind-address": "127.0.0.1", "allow-lan": false,
		"authentication": []string{"sandbox:" + password}, "skip-auth-prefixes": []string{},
		"mode": "rule", "ipv6": false, "log-level": "warning", "find-process-mode": "off",
		"tun": map[string]any{"enable": false}, "dns": dns, "geo-auto-update": false,
		"profile":       map[string]any{"store-selected": false},
		"proxies":       []map[string]any{node},
		"proxy-groups":  []any{map[string]any{"name": group, "type": "select", "proxies": []string{n.Name()}}},
		"rules":         []string{"MATCH," + group},
		"unified-delay": true,
	}
	return yaml.Marshal(cfg)
}

func freePort() (int, error) {
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// Start writes the configuration into workDir (private) and starts mihomo.
func Start(ctx context.Context, binary string, n Node, workDir string, log *os.File) (*Core, error) {
	if err := os.MkdirAll(workDir, 0o700); err != nil {
		return nil, err
	}
	port, err := freePort()
	if err != nil {
		return nil, err
	}
	var secret [16]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return nil, err
	}
	password := hex.EncodeToString(secret[:])
	data, err := Config(n, port, password, workDir)
	if err != nil {
		return nil, err
	}
	configPath := filepath.Join(workDir, "config.yaml")
	if err := os.WriteFile(configPath, data, 0o600); err != nil {
		return nil, err
	}
	cmd := exec.Command(binary, "-d", workDir, "-f", configPath)
	cmd.Stdout, cmd.Stderr = log, log
	cmd.SysProcAttr = &syscall.SysProcAttr{Pdeathsig: syscall.SIGKILL, Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	core := &Core{Port: port, Password: password, cmd: cmd, done: make(chan struct{})}
	go func() { core.err = cmd.Wait(); close(core.done) }()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-core.done:
			return nil, fmt.Errorf("mihomo exited at start: %v", core.err)
		case <-ctx.Done():
			core.Stop()
			return nil, ctx.Err()
		default:
		}
		if c, err := net.DialTimeout("tcp4", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond); err == nil {
			c.Close()
			return core, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	core.Stop()
	return nil, errors.New("mihomo did not open its port")
}
