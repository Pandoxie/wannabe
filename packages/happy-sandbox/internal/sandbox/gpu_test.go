package sandbox

import (
	"strings"
	"testing"
)

// The shape of `nvidia-ctk cdi generate` 1.20 (trimmed).
const testSpec = `---
cdiVersion: 0.7.0
kind: nvidia.com/gpu
devices:
- name: "0"
  containerEdits:
    deviceNodes:
    - path: /dev/nvidia0
    - path: /dev/dri/card0
- name: all
  containerEdits:
    deviceNodes:
    - path: /dev/nvidia0
    - path: /dev/dri/card0
containerEdits:
  env:
  - NVIDIA_VISIBLE_DEVICES=void
  deviceNodes:
  - path: /dev/nvidiactl
  - path: /dev/nvidia-uvm
  hooks:
  - hookName: createContainer
    path: /usr/bin/nvidia-cdi-hook
    args: [nvidia-cdi-hook, create-symlinks, --link, libcuda.so.1::/usr/lib/x86_64-linux-gnu/libcuda.so]
  - hookName: createContainer
    path: /usr/bin/nvidia-cdi-hook
    args: [nvidia-cdi-hook, update-ldcache, --folder, /usr/lib/x86_64-linux-gnu]
  - hookName: createContainer
    path: /usr/bin/nvidia-cdi-hook
    args: [nvidia-cdi-hook, enable-cuda-compat, --host-driver-version=580.178.04]
  mounts:
  - hostPath: /usr/bin/nvidia-smi
    containerPath: /usr/bin/nvidia-smi
    options: [ro, nosuid, nodev, rbind, rprivate]
  - hostPath: /usr/lib/x86_64-linux-gnu/libcuda.so.580.178.04
    containerPath: /usr/lib/x86_64-linux-gnu/libcuda.so.580.178.04
    options: [ro, nosuid, nodev, rbind, rprivate]
`

func TestParseGPUFromCDISpec(t *testing.T) {
	g, err := parseGPU("/var/run/cdi/nvidia.yaml", []byte(testSpec), "all")
	if err != nil {
		t.Fatal(err)
	}
	var devs []string
	for _, d := range g.Devices {
		devs = append(devs, d[1])
	}
	if got := strings.Join(devs, " "); got != "/dev/nvidiactl /dev/nvidia-uvm /dev/nvidia0 /dev/dri/card0" {
		t.Fatalf("devices %q", got)
	}
	if len(g.Mounts) != 2 || g.Mounts[0][1] != "/usr/bin/nvidia-smi" {
		t.Fatalf("mounts %v", g.Mounts)
	}
	if len(g.Links) != 1 || g.Links[0] != [2]string{"libcuda.so.1", "/usr/lib/x86_64-linux-gnu/libcuda.so"} {
		t.Fatalf("links %v", g.Links)
	}
	if len(g.LdDirs) != 1 || g.Env[0] != "NVIDIA_VISIBLE_DEVICES=void" {
		t.Fatalf("ld %v env %v", g.LdDirs, g.Env)
	}
	script := g.setupScript()
	for _, want := range []string{"ln -sfn 'libcuda.so.1' '/usr/lib/x86_64-linux-gnu/libcuda.so'", "00-happy-sandbox-gpu.conf", "ldconfig"} {
		if !strings.Contains(script, want) {
			t.Errorf("setup script lacks %q:\n%s", want, script)
		}
	}
	other, _ := parseGPU("/var/run/cdi/nvidia.yaml", []byte(testSpec), "0")
	if other.Key == g.Key {
		t.Fatal("the key does not follow the chosen device")
	}
	changed, _ := parseGPU("/var/run/cdi/nvidia.yaml", []byte(strings.ReplaceAll(testSpec, "580.178.04", "580.200.01")), "all")
	if changed.Key == g.Key {
		t.Fatal("the key does not follow a driver update")
	}
}

func TestParseGPURejects(t *testing.T) {
	if _, err := parseGPU("x", []byte(testSpec), "7"); err == nil || !strings.Contains(err.Error(), "has: 0, all") {
		t.Fatalf("unknown device: %v", err)
	}
	if _, err := parseGPU("x", []byte(strings.Replace(testSpec, "nvidia.com/gpu", "amd.com/gpu", 1)), "all"); err == nil {
		t.Fatal("another vendor's spec accepted")
	}
	if g, err := FindGPU("none"); g != nil || err != nil {
		t.Fatalf("none: %v %v", g, err)
	}
}
