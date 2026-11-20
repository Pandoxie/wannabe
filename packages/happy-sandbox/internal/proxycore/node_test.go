package proxycore

import (
	"strings"
	"testing"
	"time"

	"gopkg.in/yaml.v3"
)

const sample = `proxies:
  - name: test-node
    type: vless
    server: 203.0.113.10
    port: 443
    uuid: 00000000-0000-0000-0000-000000000000
    network: tcp
    tls: true
`

func TestOneNodeOnly(t *testing.T) {
	if _, err := ParseNode([]byte(sample)); err != nil {
		t.Fatal(err)
	}
	two := sample + `  - name: other
    type: vless
    server: 203.0.113.11
`
	if _, err := ParseNode([]byte(two)); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatal("two nodes accepted", err)
	}
	if _, err := ParseNode([]byte("proxies: []\n")); err == nil {
		t.Fatal("no node accepted")
	}
}

func TestUnsafeNodeOptionsRejected(t *testing.T) {
	for name, extra := range map[string]string{
		"local file":      "    ca: /etc/ssl/private/x.pem\n",
		"interface":       "    interface-name: eth0\n",
		"routing mark":    "    routing-mark: 7\n",
		"nested path key": "    ws-opts:\n      headers-path: /tmp/x\n",
		"chain":           "    dialer-proxy: other\n",
		"unsupported":     "",
	} {
		doc := sample + extra
		if name == "unsupported" {
			doc = strings.Replace(sample, "type: vless", "type: socks5", 1)
		}
		if _, err := ParseNode([]byte(doc)); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestConfigListensOnLoopbackOnlyWithOneRoute(t *testing.T) {
	n, _ := ParseNode([]byte(sample))
	data, err := Config(n, 17000, "secret", "/tmp/x")
	if err != nil {
		t.Fatal(err)
	}
	var cfg map[string]any
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg["bind-address"] != "127.0.0.1" || cfg["allow-lan"] != false || cfg["ipv6"] != false {
		t.Fatal("listener not loopback-only", cfg)
	}
	if tun := cfg["tun"].(map[string]any); tun["enable"] != false {
		t.Fatal("tun enabled")
	}
	rules := cfg["rules"].([]any)
	if len(rules) != 1 || rules[0] != "MATCH,SANDBOX" {
		t.Fatal("extra routes", rules)
	}
	if auth := cfg["authentication"].([]any); len(auth) != 1 || auth[0] != "sandbox:secret" {
		t.Fatal("no auth", auth)
	}
	if len(cfg["proxies"].([]any)) != 1 {
		t.Fatal("not exactly one proxy")
	}
}

func TestStopAfterExitDoesNotHang(t *testing.T) {
	// A core whose process has already exited (and whose exit was observed)
	// must still stop at once.
	c := &Core{done: make(chan struct{})}
	close(c.done)
	stopped := make(chan struct{})
	go func() { _ = c.Err(); _ = c.Err(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("waiting on an exited core hung")
	}
}
