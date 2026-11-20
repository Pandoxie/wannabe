// Derived from Claude Cage (MIT, Copyright (c) 2026 Sylvain Zimmer and Claude
// Cage contributors), internal/cage/config.go. happy-sandbox keeps only what
// the gate and egress need: the one upstream proxy, the DoH resolver, and the
// exit IP the gate requires.
package gate

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
)

type Config struct {
	// The only upstream: the managed mihomo's local SOCKS5 listener.
	ProxyURL string `json:"proxy_url"`
	// DNS-over-HTTPS through the same upstream; never the host resolver.
	DNSURL string `json:"dns_url"`
	// The public IPv4 the providers must see; the gate opens only on it.
	ExitIP string `json:"exit_ip"`
}

func DefaultDNSURL() string { return "https://1.1.1.1/dns-query" }

func (c Config) Validate() error {
	u, err := url.Parse(c.ProxyURL)
	if err != nil || u == nil {
		return errors.New("invalid proxy URL")
	}
	if u.Scheme != "socks5" && u.Scheme != "socks5h" && u.Scheme != "http" {
		return errors.New("proxy must use socks5 or http")
	}
	// The proxy endpoint itself must not need the host DNS resolver.
	if net.ParseIP(u.Hostname()) == nil {
		return errors.New("proxy endpoint must be a numeric IP address")
	}
	if p, err := strconv.Atoi(u.Port()); err != nil || p < 1 || p > 65535 {
		return errors.New("proxy requires a valid explicit port")
	}
	if u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("proxy URL must not contain a path, query or fragment")
	}
	d, err := url.Parse(c.DNSURL)
	if err != nil || d.Scheme != "https" || d.Hostname() == "" || d.User != nil || d.Fragment != "" {
		return errors.New("DNS URL must be an HTTPS DNS-over-HTTPS endpoint")
	}
	ip, err := netip.ParseAddr(c.ExitIP)
	if err != nil || !ip.Is4() || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() {
		return errors.New("exit_ip must be a public IPv4 address")
	}
	return nil
}

// Fingerprint names a configuration without its credentials.
func (c Config) Fingerprint() string {
	u, _ := url.Parse(c.ProxyURL)
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s", u.Host, c.DNSURL, c.ExitIP)))
	return hex.EncodeToString(sum[:8])
}

// userError keeps Cage's "say what failed and what to do" wording without its
// localized error package.
func userError(action string, cause error, next string) error {
	if cause == nil {
		return nil
	}
	return fmt.Errorf("%s: %w (%s)", action, cause, next)
}
