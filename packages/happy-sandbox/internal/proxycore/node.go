// Package proxycore runs the sandbox's one upstream: mihomo with exactly one
// node, listening only on a loopback SOCKS5 port with a random password, and
// no route but that node.
//
// The node checks and the configuration shape follow Claude Cage (MIT,
// Copyright (c) 2026 Sylvain Zimmer and Claude Cage contributors),
// internal/managedproxy/{import,store}.go.
package proxycore

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// Protocols mihomo supports that a sandbox node may use.
var allowedTypes = map[string]bool{"vless": true, "vmess": true, "trojan": true, "ss": true, "hysteria2": true, "tuic": true, "anytls": true}

// Node is the one proxy, as written in the node file (mihomo syntax).
type Node map[string]any

func (n Node) Name() string   { s, _ := n["name"].(string); return s }
func (n Node) Type() string   { s, _ := n["type"].(string); return s }
func (n Node) Server() string { s, _ := n["server"].(string); return s }

// LoadNode reads a node file holding exactly one proxy. It must be private
// (0600): it carries credentials.
func LoadNode(path string) (Node, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%s must be readable by you only (chmod 600)", path)
	}
	if info.Size() > 64<<10 {
		return nil, errors.New("the node file is too large; it must hold one node")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseNode(data)
}

func ParseNode(data []byte) (Node, error) {
	var input struct {
		Proxies []map[string]any `yaml:"proxies"`
	}
	if err := yaml.Unmarshal(data, &input); err != nil {
		return nil, errors.New("cannot read the node file (mihomo YAML with a `proxies:` list)")
	}
	if len(input.Proxies) != 1 {
		return nil, fmt.Errorf("the node file must hold exactly one proxy, it has %d", len(input.Proxies))
	}
	n := Node(input.Proxies[0])
	switch {
	case strings.TrimSpace(n.Name()) == "" || len(n.Name()) > 240:
		return nil, errors.New("the node needs a name")
	case !allowedTypes[n.Type()]:
		return nil, fmt.Errorf("node type %q is not supported", n.Type())
	case n.Server() == "" || len(n.Server()) > 253:
		return nil, errors.New("the node needs a server")
	case unsafeOption(map[string]any(n)):
		return nil, errors.New("the node must not reference local files, network interfaces or extra routes")
	}
	if _, chained := n["dialer-proxy"]; chained {
		return nil, errors.New("the node must not chain through another proxy")
	}
	return n, nil
}

// From Cage: options that would let a node file reach local files, choose a
// host interface or add routes.
func unsafeOption(v any) bool {
	switch x := v.(type) {
	case map[string]any:
		for k, v := range x {
			if unsafeField(k, v) {
				return true
			}
		}
	case map[any]any:
		for k, v := range x {
			key, _ := k.(string)
			if unsafeField(key, v) {
				return true
			}
		}
	case []any:
		for _, v := range x {
			if unsafeOption(v) {
				return true
			}
		}
	}
	return false
}

func unsafeField(key string, value any) bool {
	key = strings.ToLower(strings.ReplaceAll(key, "_", "-"))
	if strings.Contains(key, "path") && key != "path" {
		return true
	}
	switch key {
	case "ca", "certificate", "private-key", "interface-name", "routing-mark":
		return true
	}
	return unsafeOption(value)
}
