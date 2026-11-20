// Package netstack is the sandbox's only network path.
// Derived from Claude Cage (MIT, Copyright (c) 2026 Sylvain Zimmer and Claude
// Cage contributors), internal/containerenv/network.go.
// The host owns the network stack and its policy; a container only exchanges
// Ethernet frames over a process pipe and receives no host network interface.
package netstack

import (
	"context"
	"errors"
	"io"
	"net"
	"net/netip"
	"os/exec"
	"strconv"
	"sync"
	"time"

	"github.com/containers/gvisor-tap-vsock/pkg/types"
	"github.com/containers/gvisor-tap-vsock/pkg/virtualnetwork"
	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/gate"
)

const (
	GuestIP    = "192.168.64.2"
	GatewayIP  = "192.168.64.1"
	GuestMAC   = "5a:94:ef:e4:0c:02"
	GatewayMAC = "5a:94:ef:e4:0c:01"
	// HostIP is the host's loopback as the guest sees it, for the ports an
	// instance opens with host_ports only (nothing else answers there).
	HostIP     = "192.168.64.254"
	TapName    = "hsbtap0"
	NetworkMTU = 1500
)

// Network owns the only path between the container and the outside network.
// The caller must close the process endpoint when Run returns. A gate starts
// closed; connecting SSH does not authorize any guest outbound traffic.
type Network struct {
	Gate     *gate.EgressGate
	stack    *virtualnetwork.VirtualNetwork
	guestMAC net.HardwareAddr
}

func networkConfiguration(g *gate.EgressGate, identity *Identity) types.Configuration {
	guestMAC, gatewayMAC := GuestMAC, GatewayMAC
	var hostPorts []uint16
	if identity != nil {
		guestMAC, gatewayMAC = identity.MACAddress, identity.GatewayMACAddress
		hostPorts = identity.HostPorts
	}
	c := types.Configuration{
		MTU:    NetworkMTU,
		Subnet: "192.168.64.0/24", GatewayIP: GatewayIP,
		GatewayMacAddress: gatewayMAC,
		DHCPStaticLeases:  map[string]string{GuestIP: guestMAC},
		// No NAT-to-host entries and no automatically published ports.
		NAT: map[string]string{}, Forwards: map[string]string{},
		Ec2MetadataAccess: false,
		Outbound:          g.Allows, DialContext: g.DialContext,
		DNSExchange: g.ExchangeDNS,
	}
	if len(hostPorts) > 0 {
		// The opted-in host ports: HostIP:<port> reaches the host's
		// 127.0.0.1:<port> directly, whatever the gate's state (it is not the
		// internet). Every other destination still goes through the gate.
		open := map[uint16]bool{}
		for _, p := range hostPorts {
			open[p] = true
		}
		host := netip.MustParseAddr(HostIP)
		toHost := func(network string, dst netip.AddrPort) bool {
			return (network == "tcp" || network == "tcp4") && dst.Addr() == host && open[dst.Port()]
		}
		c.GatewayVirtualIPs = []string{HostIP}
		c.Outbound = func(network string, dst netip.AddrPort) bool {
			return toHost(network, dst) || g.Allows(network, dst)
		}
		c.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			if dst, err := netip.ParseAddrPort(addr); err == nil && toHost(network, dst) {
				var d net.Dialer
				return d.DialContext(ctx, "tcp4", net.JoinHostPort("127.0.0.1", strconv.Itoa(int(dst.Port()))))
			}
			return g.DialContext(ctx, network, addr)
		}
	}
	return c
}

func NewNetwork(cfg gate.Config) (*Network, error) { return newNetwork(cfg, nil) }

func newNetwork(cfg gate.Config, identity *Identity) (*Network, error) {
	g, err := gate.NewEgressGate(cfg)
	if err != nil {
		return nil, err
	}
	configuration := networkConfiguration(g, identity)
	stack, err := virtualnetwork.New(&configuration)
	if err != nil {
		g.Close("network setup failed")
		return nil, err
	}
	guestMAC, _ := net.ParseMAC(configuration.DHCPStaticLeases[GuestIP])
	return &Network{Gate: g, stack: stack, guestMAC: guestMAC}, nil
}

// Run consumes the documented four-byte big-endian frame length followed by
// an Ethernet frame. AcceptQemu names the wire format, not a VM dependency.
func (n *Network) Run(ctx context.Context, endpoint net.Conn) error {
	stop := context.AfterFunc(ctx, func() { _ = endpoint.Close() })
	defer stop()
	defer n.Gate.Close("the sandbox network link is down")
	defer endpoint.Close()
	return n.stack.AcceptQemu(ctx, &boundedFrameConnection{Conn: endpoint, sourceMAC: n.guestMAC})
}

// ServeSSH only accepts the listener supplied by the host. It never listens
// inside the virtual gateway, so a guest cannot use this as a reverse proxy.
func (n *Network) ServeSSH(ctx context.Context, listener net.Listener) error {
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok || !address.IP.IsLoopback() {
		return errors.New("the SSH entry must listen on loopback")
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(ctx, func() { _ = listener.Close() })
	defer stop()
	var active sync.WaitGroup
	defer func() { cancel(); _ = listener.Close(); active.Wait() }()
	for {
		local, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
		active.Add(1)
		go func() {
			defer active.Done()
			defer local.Close()
			cancelLocal := context.AfterFunc(ctx, func() { _ = local.Close() })
			defer cancelLocal()
			dialCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			remote, err := n.stack.DialContextTCP(dialCtx, GuestIP+":22")
			cancel()
			if err != nil {
				return
			}
			defer remote.Close()
			cancelRemote := context.AfterFunc(ctx, func() { _ = remote.Close() })
			defer cancelRemote()
			done := make(chan struct{})
			go func() { _, _ = io.Copy(remote, local); _ = remote.Close(); _ = local.Close(); close(done) }()
			_, _ = io.Copy(local, remote)
			_ = local.Close()
			_ = remote.Close()
			<-done
		}()
	}
}

// ProcessEndpoint connects an exec -i process to the frame protocol. The
// process must emit only frames on stdout; diagnostics belong to stderr.
// Closing the endpoint terminates this process and releases both pipes.
func ProcessEndpoint(command *exec.Cmd) (net.Conn, func() error, error) {
	input, err := command.StdinPipe()
	if err != nil {
		return nil, nil, err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		input.Close()
		return nil, nil, err
	}
	if err = command.Start(); err != nil {
		input.Close()
		output.Close()
		return nil, nil, err
	}
	endpoint, bridge := net.Pipe()
	var closeOnce sync.Once
	closeProcess := func() {
		closeOnce.Do(func() { _ = input.Close(); _ = output.Close(); _ = bridge.Close(); _ = command.Process.Kill() })
	}
	var copies sync.WaitGroup
	copies.Add(2)
	go func() { defer copies.Done(); defer closeProcess(); _, _ = io.Copy(input, bridge) }()
	go func() { defer copies.Done(); defer closeProcess(); _, _ = io.Copy(bridge, output) }()
	var waitOnce sync.Once
	var waitErr error
	wait := func() error {
		waitOnce.Do(func() { _ = endpoint.Close(); closeProcess(); copies.Wait(); waitErr = command.Wait() })
		return waitErr
	}
	return &processConnection{Conn: endpoint, closeProcess: closeProcess}, wait, nil
}

type processConnection struct {
	net.Conn
	closeProcess func()
}

func (c *processConnection) Close() error { err := c.Conn.Close(); c.closeProcess(); return err }

// Identity fixes the guest's and gateway's MAC addresses per instance, and
// the host ports it may reach (HostIP; none by default).
type Identity struct {
	MACAddress        string
	GatewayMACAddress string
	HostPorts         []uint16
}

// NewNetworkFor builds the stack for an instance identity (nil: defaults).
func NewNetworkFor(cfg gate.Config, identity *Identity) (*Network, error) {
	return newNetwork(cfg, identity)
}

// Stack exposes the user-space stack (for dialing into the guest).
func (n *Network) Stack() interface {
	DialContextTCP(ctx context.Context, addr string) (net.Conn, error)
} {
	return n.stack
}
