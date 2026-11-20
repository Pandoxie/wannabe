package gate

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

const testExitIP = "203.0.113.7"

// DefaultConfig is the tests' starting point: a placeholder upstream and the
// expected exit; each test points ProxyURL at its own fixture.
func DefaultConfig() Config {
	return Config{ProxyURL: "socks5://127.0.0.1:17896", DNSURL: DefaultDNSURL(), ExitIP: testExitIP}
}

func fixtureVerdict(g *EgressGate) Verdict {
	s := g.Status()
	return Verdict{ID: "fixture-only", CheckID: s.CheckID, ExitIP: testExitIP, Country: "US", CreatedAt: time.Now()}
}

func fixtureGate(t *testing.T) *EgressGate {
	t.Helper()
	cfg := DefaultConfig()
	cfg.ProxyURL = "http://127.0.0.1:9"
	g, err := NewEgressGate(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { g.Close("test complete") })
	return g
}

func fixtureGrant(t *testing.T, g *EgressGate) Verdict {
	t.Helper()
	if err := g.BeginCheck(); err != nil {
		t.Fatal(err)
	}
	r := fixtureVerdict(g)
	if err := g.Grant(r); err != nil {
		t.Fatal(err)
	}
	return r
}

func TestVerdictRequiresTheConfiguredExit(t *testing.T) {
	g := fixtureGate(t)
	if err := g.BeginCheck(); err != nil {
		t.Fatal(err)
	}
	valid := fixtureVerdict(g)
	for name, change := range map[string]func(*Verdict){
		"wrong exit":      func(v *Verdict) { v.ExitIP = "1.2.3.4" },
		"other check":     func(v *Verdict) { v.CheckID = "replayed" },
		"before check":    func(v *Verdict) { v.CreatedAt = time.Now().Add(-time.Hour) },
		"expired verdict": func(v *Verdict) { v.CreatedAt = time.Now().Add(-VerdictLifetime - time.Second) },
	} {
		v := valid
		change(&v)
		if g.Grant(v) == nil {
			t.Fatalf("%s opened the gate", name)
		}
		if g.Status().Mode == GateOpen {
			t.Fatalf("%s left the gate open", name)
		}
	}
	if err := g.Grant(valid); err != nil {
		t.Fatal(err)
	}
	wrong := fixtureVerdict(g)
	wrong.ExitIP = "1.2.3.4"
	if g.Renew(wrong) == nil {
		t.Fatal("a wrong exit renewed the open gate")
	}
}

func TestGateStartsClosedAndOldReportCannotReopen(t *testing.T) {
	g := fixtureGate(t)
	public := netip.MustParseAddrPort("8.8.8.8:443")
	if g.Allows("tcp", public) {
		t.Fatal("new VM started online")
	}
	if _, err := g.DialContext(context.Background(), "tcp", public.String()); err == nil {
		t.Fatal("direct dial bypassed closed gate")
	}
	r := fixtureGrant(t, g)
	if !g.Allows("tcp", public) {
		t.Fatal("valid report did not enable proxy TCP")
	}
	if g.Allows("udp", public) || g.Allows("tcp", netip.MustParseAddrPort("127.0.0.1:17777")) {
		t.Fatal("grant weakened isolation policy")
	}
	if g.Allows("tcp", netip.MustParseAddrPort("[2606:4700:4700::1111]:443")) {
		t.Fatal("IPv6 bypassed the measured IPv4 policy")
	}
	g.Close("failure")
	if g.Renew(r) == nil || g.Grant(r) == nil {
		t.Fatal("revoked report reopened networking")
	}
	if err := g.BeginCheck(); err != nil {
		t.Fatal(err)
	}
	if g.Grant(r) == nil {
		t.Fatal("report from previous check session replayed")
	}
}

func TestRenewCannotOutliveItsVerdict(t *testing.T) {
	g := fixtureGate(t)
	r := fixtureGrant(t, g)
	expiry := time.Now().Add(time.Second)
	r.CreatedAt = expiry.Add(-VerdictLifetime)
	if err := g.Renew(r); err != nil {
		t.Fatal(err)
	}
	if g.Status().Until.After(expiry) {
		t.Fatal("renewal exceeded the verdict lifetime")
	}
}

func TestGateRevokesEstablishedTunnelAndLease(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "CONNECT" || r.Host != "8.8.8.8:443" {
			w.WriteHeader(400)
			return
		}
		conn, reader, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = reader.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		_ = reader.Flush()
		_, _ = io.Copy(conn, reader)
	}))
	defer proxy.Close()
	cfg := DefaultConfig()
	cfg.ProxyURL = proxy.URL
	g, err := NewEgressGate(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close("test complete")
	fixtureGrant(t, g)
	conn, err := g.DialContext(context.Background(), "tcp", "8.8.8.8:443")
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(time.Second))
	_, _ = conn.Write([]byte("ping"))
	var b [4]byte
	if _, err = io.ReadFull(conn, b[:]); err != nil || string(b[:]) != "ping" {
		t.Fatal("proxy tunnel did not transport bytes", err)
	}
	g.mu.Lock()
	g.armLocked(20 * time.Millisecond)
	g.mu.Unlock()
	deadline := time.Now().Add(time.Second)
	for g.Status().Mode != GateClosed && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if _, err = conn.Write([]byte("must not send")); err == nil {
		t.Fatal("expired lease retained established connection")
	}
	if g.Status().Mode != GateClosed {
		t.Fatal("expired gate stayed open")
	}
}

func TestGateCancelsStalledProxyHandshake(t *testing.T) {
	entered := make(chan struct{})
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		close(entered)
		_, _ = io.Copy(io.Discard, conn)
	}))
	defer proxy.Close()
	cfg := DefaultConfig()
	cfg.ProxyURL = proxy.URL
	g, err := NewEgressGate(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer g.Close("test complete")
	fixtureGrant(t, g)
	done := make(chan error, 1)
	go func() {
		c, e := g.DialContext(context.Background(), "tcp", "8.8.8.8:443")
		if c != nil {
			c.Close()
		}
		done <- e
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("CONNECT did not reach fixture")
	}
	g.Close("revoke while dialing")
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("revoked dial succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("revoke did not interrupt CONNECT handshake")
	}
}

func TestDiagnosticAddressStaysClosed(t *testing.T) {
	g := fixtureGate(t)
	if err := g.BeginCheck(); err != nil {
		t.Fatal(err)
	}
	if c, err := g.DialContext(context.Background(), "tcp", DiagnosticAddress); err == nil {
		c.Close()
		t.Fatal("the guest reached the diagnostic address")
	}
}

func TestTraceParsing(t *testing.T) {
	ip, country := parseTrace("fl=1\nh=x\nip=203.0.113.7\nloc=US\n")
	if ip != "203.0.113.7" || country != "US" {
		t.Fatal(ip, country)
	}
}
