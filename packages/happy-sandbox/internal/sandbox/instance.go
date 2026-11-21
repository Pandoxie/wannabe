// Package sandbox is one sandbox instance: its configuration and files under
// ~/.happy-sandbox/<name>, its container, and its network process.
package sandbox

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/netip"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/proxycore"
)

const DefaultImage = "localhost/happy-sandbox:latest"

type Share struct {
	Source   string `json:"source"`
	Target   string `json:"target"`
	ReadOnly bool   `json:"read_only"`
}

type Config struct {
	Name   string `json:"name"`
	Image  string `json:"image"`
	ExitIP string `json:"exit_ip"`
	// Resource limits, none unless written here: memory_bytes (bytes), cpus
	// (cores, may be fractional), pids_limit (processes and threads). A change
	// recreates the container at the next up (home kept).
	MemoryBytes int64   `json:"memory_bytes,omitempty"`
	CPUs        float64 `json:"cpus,omitempty"`
	PidsLimit   int64   `json:"pids_limit,omitempty"`
	Shares      []Share `json:"shares"`
	// HostPorts opens the host's 127.0.0.1:<port> to the guest at
	// 192.168.64.254:<port> (development, e.g. [22] for ssh to the host).
	// Off by default; read when the network starts, no recreation needed.
	HostPorts []int `json:"host_ports,omitempty"`
	// GPU: absent = all NVIDIA GPUs when the host has a CDI spec (automatic),
	// "none" = off, or one device of the spec ("0", a GPU UUID, "all").
	GPU string `json:"gpu,omitempty"`
	// FromHost lends paths of the host user's home to dev's home at the same
	// place, read-only unless PATH:rw (".ssh", ".gitconfig", ".config/gh:rw").
	// A change recreates the container at the next up (home kept). fromhost.go.
	FromHost []string `json:"from_host,omitempty"`
}

// CheckLimits validates the resource limits (0 or absent: no limit).
func (c Config) CheckLimits() error {
	if c.MemoryBytes < 0 || (c.MemoryBytes > 0 && c.MemoryBytes < 256<<20) {
		return fmt.Errorf("memory_bytes %d: 0 (no limit) or at least 268435456 (256 MiB)", c.MemoryBytes)
	}
	if c.CPUs < 0 {
		return fmt.Errorf("cpus %v: 0 (no limit) or a positive number of cores", c.CPUs)
	}
	if c.PidsLimit < 0 || (c.PidsLimit > 0 && c.PidsLimit < 256) {
		return fmt.Errorf("pids_limit %d: 0 (no limit) or at least 256", c.PidsLimit)
	}
	return nil
}

// limitArgs are the podman create flags for the limits. Podman applies its
// own pids default (2048) when none is given, so "no limit" is explicit.
func (c Config) limitArgs() []string {
	var a []string
	if c.MemoryBytes > 0 {
		a = append(a, "--memory", strconv.FormatInt(c.MemoryBytes, 10))
	}
	if c.CPUs > 0 {
		a = append(a, "--cpus", strconv.FormatFloat(c.CPUs, 'f', -1, 64))
	}
	if c.PidsLimit > 0 {
		a = append(a, "--pids-limit", strconv.FormatInt(c.PidsLimit, 10))
	} else {
		a = append(a, "--pids-limit", "-1")
	}
	return a
}

// CheckHostPorts validates host_ports.
func CheckHostPorts(ports []int) ([]uint16, error) {
	var out []uint16
	seen := map[int]bool{}
	for _, p := range ports {
		if p < 1 || p > 65535 {
			return nil, fmt.Errorf("host_ports: %d is not a TCP port", p)
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, uint16(p))
		}
	}
	return out, nil
}

var nameRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,30}$`)

// Home is where instances live: $HSB_HOME, else ~/.happy-sandbox.
func Home() string {
	if h := os.Getenv("HSB_HOME"); h != "" {
		return h
	}
	return filepath.Join(os.Getenv("HOME"), ".happy-sandbox")
}

type Instance struct {
	Config Config
	// Identity is identity.json (nil only for the image build's container).
	Identity *Identity
	Dir      string
	// container overrides the container name (the image build's sandbox).
	container string
	imageID   string // set by Ensure
	selinux   bool   // set by Ensure: the host confines containers with SELinux
}

// ForContainer is a transient instance for an existing container (the image
// build): its network files live in dir, with a copy of the node file.
func ForContainer(container, nodeFile, exitIP, dir string) (*Instance, error) {
	data, err := os.ReadFile(nodeFile)
	if err != nil {
		return nil, err
	}
	inst := &Instance{Config: Config{Name: container, ExitIP: exitIP}, Dir: dir, container: container}
	if err := os.MkdirAll(inst.RunDir(), 0o700); err != nil {
		return nil, err
	}
	return inst, os.WriteFile(inst.NodeFile(), data, 0o600)
}

func Dir(name string) string { return filepath.Join(Home(), name) }

func (i *Instance) path(p ...string) string { return filepath.Join(append([]string{i.Dir}, p...)...) }
func (i *Instance) NodeFile() string        { return i.path("node.yaml") }
func (i *Instance) RunDir() string          { return i.path("run") }
func (i *Instance) Container() string {
	if i.container != "" {
		return i.container
	}
	return "happy-sandbox-" + i.Config.Name
}

// HomeDir is dev's home, bind-mounted at /home/dev: everything of a sandbox
// stays in its directory.
func (i *Instance) HomeDir() string { return i.path("home") }

// Hostname is the identity's; the image build's container goes by its name.
func (i *Instance) Hostname() string {
	if i.Identity != nil {
		return i.Identity.Hostname
	}
	return i.Container()
}

func ValidName(name string) error {
	if name == "bin" { // ~/.happy-sandbox/bin holds the installed tool
		return fmt.Errorf("instance name %q is reserved", name)
	}
	if !nameRe.MatchString(name) {
		return fmt.Errorf("instance name %q: use lowercase letters, digits and dashes", name)
	}
	return nil
}

func Load(name string) (*Instance, error) {
	if err := ValidName(name); err != nil {
		return nil, err
	}
	dir := Dir(name)
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("no sandbox %q yet: happy-sandbox init", name)
	}
	if err != nil {
		return nil, err
	}
	var c Config
	if err := json.Unmarshal(data, &c); err != nil {
		return nil, fmt.Errorf("%s/config.json: %v", dir, err)
	}
	if err := c.CheckLimits(); err != nil {
		return nil, fmt.Errorf("%s/config.json: %v", dir, err)
	}
	if _, err := CheckFromHost(c.FromHost); err != nil {
		return nil, fmt.Errorf("%s/config.json: %v", dir, err)
	}
	inst := &Instance{Config: c, Dir: dir}
	id, err := inst.LoadIdentity()
	if err != nil {
		return nil, fmt.Errorf("sandbox %q: identity: %v", name, err)
	}
	inst.Identity = &id
	return inst, nil
}

func (i *Instance) Save() error {
	if err := os.MkdirAll(i.Dir, 0o700); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(i.Config, "", "  ")
	tmp := i.path("config.json.tmp")
	if err := os.WriteFile(tmp, append(data, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, i.path("config.json"))
}

// Create makes a new instance: checks the node file, copies it in (0600),
// stores the configuration and a new identity. It never overwrites an
// existing instance.
func Create(c Config, nodeFile string, id Identity) (*Instance, error) {
	if err := id.Validate(); err != nil {
		return nil, err
	}
	if err := ValidName(c.Name); err != nil {
		return nil, err
	}
	dir := Dir(c.Name)
	if _, err := os.Stat(filepath.Join(dir, "config.json")); err == nil {
		return nil, fmt.Errorf("sandbox %q already exists (%s)", c.Name, dir)
	}
	ip, err := netip.ParseAddr(c.ExitIP)
	if err != nil || !ip.Is4() || ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() {
		return nil, fmt.Errorf("exit IP %q must be a public IPv4 address", c.ExitIP)
	}
	if _, err := proxycore.LoadNode(nodeFile); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(nodeFile)
	if err != nil {
		return nil, err
	}
	if c.Image == "" {
		c.Image = DefaultImage
	}
	if err := c.CheckLimits(); err != nil {
		return nil, err
	}
	for k := range c.Shares {
		s, err := CheckShare(c.Shares[k], c.Shares[:k])
		if err != nil {
			return nil, err
		}
		c.Shares[k] = s
	}
	if _, err := CheckFromHost(c.FromHost); err != nil {
		return nil, err
	}
	inst := &Instance{Config: c, Identity: &id, Dir: dir}
	if err := os.MkdirAll(inst.RunDir(), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(inst.NodeFile(), data, 0o600); err != nil {
		return nil, err
	}
	if err := inst.SaveIdentity(id); err != nil {
		return nil, err
	}
	return inst, inst.Save()
}

// CheckShare resolves and validates a share against those already present.
func CheckShare(s Share, existing []Share) (Share, error) {
	src, err := filepath.EvalSymlinks(s.Source)
	if err != nil {
		return s, fmt.Errorf("share source %s: %v", s.Source, err)
	}
	src, _ = filepath.Abs(src)
	if st, err := os.Stat(src); err != nil || !st.IsDir() {
		return s, fmt.Errorf("share source %s must be an existing directory", s.Source)
	}
	home := os.Getenv("HOME")
	if src == "/" || src == home {
		return s, fmt.Errorf("share source %s is too broad (it contains your home or the sandbox files)", s.Source)
	}
	for _, private := range privateHostDirs() {
		if strings.HasPrefix(private+"/", src+"/") || strings.HasPrefix(src+"/", private+"/") {
			return s, fmt.Errorf("share source %s would show the sandboxes' own files (%s), node credentials included", s.Source, private)
		}
	}
	t := filepath.Clean(s.Target)
	if t != s.Target || !(strings.HasPrefix(t, "/workspace/") || strings.HasPrefix(t, "/reference/") || (t == src && hostPathTarget(t))) {
		return s, fmt.Errorf("share target %q must be a clean path under /workspace/ or /reference/, or the source's own path (outside the system directories)", s.Target)
	}
	for _, e := range existing {
		if e.Target == t || strings.HasPrefix(t+"/", e.Target+"/") || strings.HasPrefix(e.Target+"/", t+"/") {
			return s, fmt.Errorf("share target %s overlaps %s", t, e.Target)
		}
	}
	return Share{Source: src, Target: t, ReadOnly: s.ReadOnly}, nil
}

// systemDirs are the guest system's own: a share at the host path cannot
// land in them (or replace dev's home).
var systemDirs = []string{"/bin", "/boot", "/dev", "/etc", "/home/dev", "/lib", "/lib32", "/lib64", "/libx32",
	"/opt", "/proc", "/root", "/run", "/sbin", "/snap", "/srv", "/sys", "/tmp", "/usr", "/var"}

// hostPathTarget: a share may also appear at its own host path (/home/me/proj,
// /mnt/data), so absolute paths in files and environments keep working, as
// long as that path is not one of the guest system's.
func hostPathTarget(t string) bool {
	if t == "/" || t == "/home" || t == "/mnt" || t == "/media" || t == "/workspace" || t == "/reference" {
		return false
	}
	for _, d := range systemDirs {
		if t == d || strings.HasPrefix(t, d+"/") {
			return false
		}
	}
	return true
}

func List() ([]string, error) {
	entries, err := os.ReadDir(Home())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	var names []string
	for _, e := range entries {
		if _, err := os.Stat(filepath.Join(Home(), e.Name(), "config.json")); err == nil {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}
