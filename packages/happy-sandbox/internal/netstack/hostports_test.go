package netstack

import (
	"context"
	"io"
	"net"
	"net/netip"
	"strconv"
	"testing"
	"time"

	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/gate"
)

func TestHostPortsOffByDefault(t *testing.T) {
	g, err := gate.NewEgressGate(testConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close("test")
	for _, id := range []*Identity{nil, {MACAddress: GuestMAC, GatewayMACAddress: GatewayMAC}} {
		c := networkConfiguration(g, id)
		if len(c.GatewayVirtualIPs) != 0 {
			t.Fatalf("host address answered without host_ports: %v", c.GatewayVirtualIPs)
		}
		if c.Outbound("tcp", netip.MustParseAddrPort(HostIP+":22")) {
			t.Fatal("host port reachable without host_ports")
		}
	}
}

func TestHostPortsReachOnlyTheOpenedLoopbackPorts(t *testing.T) {
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			_, _ = c.Write([]byte("host"))
			c.Close()
		}
	}()
	port := uint16(ln.Addr().(*net.TCPAddr).Port)
	g, err := gate.NewEgressGate(testConfig()) // starts closed
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close("test")
	c := networkConfiguration(g, &Identity{MACAddress: GuestMAC, GatewayMACAddress: GatewayMAC, HostPorts: []uint16{port}})
	if len(c.GatewayVirtualIPs) != 1 || c.GatewayVirtualIPs[0] != HostIP {
		t.Fatalf("host address not answered: %v", c.GatewayVirtualIPs)
	}
	open := netip.MustParseAddrPort(HostIP + ":" + strconv.Itoa(int(port)))
	if !c.Outbound("tcp", open) {
		t.Fatal("opened host port refused while the gate is closed")
	}
	for _, d := range []struct {
		network string
		dst     string
	}{
		{"udp", open.String()},
		{"tcp", HostIP + ":" + strconv.Itoa(int(port)+1)},
		{"tcp", "127.0.0.1:" + strconv.Itoa(int(port))},
		{"tcp", GatewayIP + ":" + strconv.Itoa(int(port))},
		{"tcp", "93.184.215.14:443"}, // the internet: still the closed gate's
	} {
		if c.Outbound(d.network, netip.MustParseAddrPort(d.dst)) {
			t.Errorf("%s %s allowed", d.network, d.dst)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, err := c.DialContext(ctx, "tcp", open.String())
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(conn)
	conn.Close()
	if string(got) != "host" {
		t.Fatalf("reached %q, want the host listener", got)
	}
	if conn, err := c.DialContext(ctx, "tcp", HostIP+":"+strconv.Itoa(int(port)+1)); err == nil {
		conn.Close()
		t.Fatal("a port not in host_ports was dialled")
	}
}
