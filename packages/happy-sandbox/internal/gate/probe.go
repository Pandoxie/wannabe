package gate

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// The providers' own domains, behind Cloudflare: /cdn-cgi/trace shows the
// address and country the providers see, through the same proxy route as the
// agents' traffic (happy-cli src/egress/egressProbe.ts uses the same four).
var traceEndpoints = []string{
	"https://api.anthropic.com/cdn-cgi/trace",
	"https://api.openai.com/cdn-cgi/trace",
	"https://claude.ai/cdn-cgi/trace",
	"https://chatgpt.com/cdn-cgi/trace",
}

var nextEndpoint atomic.Uint32

type Exit struct {
	IP       string
	Country  string
	Endpoint string
}

func parseTrace(body string) (ip, country string) {
	for _, line := range strings.Split(body, "\n") {
		k, v, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok {
			continue
		}
		switch k {
		case "ip":
			ip = v
		case "loc":
			country = v
		}
	}
	return ip, country
}

// ProbeExit asks one trace endpoint (rotating) through the upstream only. It
// sends a fixed request: no user data, headers or credentials.
func ProbeExit(ctx context.Context, cfg Config) (Exit, error) {
	e, err := NewEgress(cfg)
	if err != nil {
		return Exit{}, err
	}
	return probeExit(ctx, e)
}

func probeExit(ctx context.Context, e *Egress) (Exit, error) {
	endpoint := traceEndpoints[int(nextEndpoint.Add(1)-1)%len(traceEndpoints)]
	transport := &http.Transport{Proxy: nil, DialContext: e.DialContext, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 8 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("probe redirect refused") }}
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return Exit{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return Exit{Endpoint: endpoint}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return Exit{Endpoint: endpoint}, errors.New("trace answered HTTP " + resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(bufio.NewReader(resp.Body), 4096))
	if err != nil {
		return Exit{Endpoint: endpoint}, err
	}
	ip, country := parseTrace(string(body))
	if net.ParseIP(ip) == nil {
		return Exit{Endpoint: endpoint}, errors.New("trace answer has no address")
	}
	return Exit{IP: ip, Country: country, Endpoint: endpoint}, nil
}

// The guest-side diagnostic address stays closed: the exit is checked from
// the host (the controller), not through the guest.
func (g *EgressGate) dialDiagnostic(ctx context.Context) (net.Conn, error) {
	return nil, ErrGateClosed
}
