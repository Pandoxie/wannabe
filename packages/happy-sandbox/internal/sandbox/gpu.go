package sandbox

// NVIDIA GPUs from the host's CDI spec (Container Device Interface, written
// by the NVIDIA Container Toolkit: `nvidia-ctk cdi generate`). Podman 3.4
// cannot read CDI itself (4.1 can), so the spec is applied here: its device
// nodes become --device, its driver files read-only bind mounts, its env -e;
// its hooks (library links, the linker cache) run inside after start.
// The host's driver is what the sandbox uses: CUDA programs (PyTorch's
// wheels bring their own CUDA runtime) need nothing else in the image.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// CDISpecPaths are where the toolkit writes the spec (static first).
var CDISpecPaths = []string{"/etc/cdi/nvidia.yaml", "/var/run/cdi/nvidia.yaml"}

type cdiSpec struct {
	Kind           string      `yaml:"kind"`
	Devices        []cdiDevice `yaml:"devices"`
	ContainerEdits cdiEdits    `yaml:"containerEdits"`
}

type cdiDevice struct {
	Name           string   `yaml:"name"`
	ContainerEdits cdiEdits `yaml:"containerEdits"`
}

type cdiEdits struct {
	Env         []string `yaml:"env"`
	DeviceNodes []struct {
		Path     string `yaml:"path"`
		HostPath string `yaml:"hostPath"`
	} `yaml:"deviceNodes"`
	Mounts []struct {
		HostPath      string   `yaml:"hostPath"`
		ContainerPath string   `yaml:"containerPath"`
		Options       []string `yaml:"options"`
	} `yaml:"mounts"`
	Hooks []struct {
		HookName string   `yaml:"hookName"`
		Args     []string `yaml:"args"`
	} `yaml:"hooks"`
}

// GPU is what a sandbox gets of the host's GPUs.
type GPU struct {
	Spec    string      // the spec file used
	Device  string      // its device name ("all", an index or a UUID)
	Devices [][2]string // host path, container path
	Mounts  [][2]string // host path, container path (read-only)
	Env     []string
	Links   [][2]string // target, link (create-symlinks)
	LdDirs  []string    // update-ldcache folders
	Key     string      // changes with the spec and the choice: recreates the container
}

// FindGPU resolves config.json's "gpu": "" (absent) is automatic — all GPUs
// when the host has a spec, none otherwise; "none" turns it off; any other
// value names a device of the spec ("all", "0", a GPU UUID) and is an error
// when there is no such device.
func FindGPU(want string) (*GPU, error) {
	if want == "none" {
		return nil, nil
	}
	for _, p := range CDISpecPaths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		device := want
		if device == "" {
			device = "all"
		}
		g, err := parseGPU(p, data, device)
		if err != nil && want == "" {
			fmt.Fprintf(os.Stderr, "happy-sandbox: GPU spec %s not used: %v\n", p, err)
			return nil, nil
		}
		return g, err
	}
	if want != "" {
		return nil, fmt.Errorf("gpu %q: no NVIDIA CDI spec on this host (%s); install the NVIDIA Container Toolkit and run: sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml", want, strings.Join(CDISpecPaths, ", "))
	}
	return nil, nil
}

func parseGPU(path string, data []byte, device string) (*GPU, error) {
	var s cdiSpec
	if err := yaml.Unmarshal(data, &s); err != nil {
		return nil, fmt.Errorf("%s: %v", path, err)
	}
	if s.Kind != "nvidia.com/gpu" {
		return nil, fmt.Errorf("%s: kind %q, not nvidia.com/gpu", path, s.Kind)
	}
	var dev *cdiDevice
	var names []string
	for k := range s.Devices {
		names = append(names, s.Devices[k].Name)
		if s.Devices[k].Name == device {
			dev = &s.Devices[k]
		}
	}
	if dev == nil {
		return nil, fmt.Errorf("%s: no GPU %q (has: %s)", path, device, strings.Join(names, ", "))
	}
	g := &GPU{Spec: path, Device: device}
	seen := map[string]bool{}
	for _, e := range []cdiEdits{s.ContainerEdits, dev.ContainerEdits} {
		g.Env = append(g.Env, e.Env...)
		for _, n := range e.DeviceNodes {
			host := n.HostPath
			if host == "" {
				host = n.Path
			}
			if !seen["d"+n.Path] {
				seen["d"+n.Path] = true
				g.Devices = append(g.Devices, [2]string{host, n.Path})
			}
		}
		for _, m := range e.Mounts {
			if !seen["m"+m.ContainerPath] {
				seen["m"+m.ContainerPath] = true
				g.Mounts = append(g.Mounts, [2]string{m.HostPath, m.ContainerPath})
			}
		}
		for _, h := range e.Hooks {
			if h.HookName != "createContainer" || len(h.Args) < 2 {
				continue
			}
			switch h.Args[1] {
			case "create-symlinks":
				for k := 2; k+1 < len(h.Args); k++ {
					if h.Args[k] == "--link" {
						if t, l, ok := strings.Cut(h.Args[k+1], "::"); ok {
							g.Links = append(g.Links, [2]string{t, l})
						}
						k++
					}
				}
			case "update-ldcache":
				for k := 2; k+1 < len(h.Args); k++ {
					if h.Args[k] == "--folder" {
						g.LdDirs = append(g.LdDirs, h.Args[k+1])
						k++
					}
				}
			}
		}
	}
	sum := sha256.Sum256(append(data, []byte("\x00"+device)...))
	g.Key = hex.EncodeToString(sum[:6])
	return g, nil
}

// args are the podman create flags: devices, read-only driver files, env.
// Paths the host no longer has (a spec older than a driver update) are
// skipped rather than failing the start.
func (g *GPU) args() []string {
	var a []string
	for _, d := range g.Devices {
		if _, err := os.Stat(d[0]); err == nil {
			a = append(a, "--device", d[0]+":"+d[1])
		}
	}
	for _, m := range g.Mounts {
		if _, err := os.Stat(m[0]); err == nil {
			a = append(a, "-v", m[0]+":"+m[1]+":ro")
		}
	}
	for _, e := range g.Env {
		// NVIDIA_VISIBLE_DEVICES=void tells the toolkit's runtime hook (not
		// used here) to do nothing; it does not hide the devices.
		a = append(a, "-e", e)
	}
	return a
}

// setupScript runs the spec's hooks inside, as root, after start: the
// library links, then the linker cache (so libcuda.so.1 resolves).
func (g *GPU) setupScript() string {
	var b strings.Builder
	b.WriteString("set -e\n")
	for _, l := range g.Links {
		fmt.Fprintf(&b, "mkdir -p %s && ln -sfn %s %s\n", shq(dirOf(l[1])), shq(l[0]), shq(l[1]))
	}
	dirs := append([]string{}, g.LdDirs...)
	sort.Strings(dirs)
	if len(dirs) > 0 {
		b.WriteString("printf '%s\\n' " + strings.Join(quoteAll(dirs), " ") + " > /etc/ld.so.conf.d/00-happy-sandbox-gpu.conf\n")
	}
	b.WriteString("ldconfig\n")
	return b.String()
}

// SetupGPU applies the hooks in a running container (after every start: the
// links and cache live in the container layer, which a recreation resets).
func (i *Instance) SetupGPU(ctx context.Context) (*GPU, error) {
	g, err := i.FindGPU()
	if err != nil || g == nil {
		return nil, err
	}
	if _, err := podman(ctx, "exec", "--user", "0", i.Container(), "sh", "-c", g.setupScript()); err != nil {
		return g, fmt.Errorf("GPU setup inside: %v", err)
	}
	return g, nil
}

func dirOf(p string) string {
	if k := strings.LastIndex(p, "/"); k > 0 {
		return p[:k]
	}
	return "/"
}

func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func quoteAll(ss []string) []string {
	out := make([]string, len(ss))
	for k, s := range ss {
		out[k] = shq(s)
	}
	return out
}
