package sandbox

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

// Check is one prerequisite: what is needed, whether this host has it, and
// if not, why the sandbox needs it and what to do.
type Check struct {
	Name string
	OK   bool
	// Warn: the sandbox works without it, with a limitation.
	Warn   bool
	Detail string
	Fix    string
}

type podmanInfo struct {
	Host struct {
		Arch              string   `json:"arch"`
		CgroupManager     string   `json:"cgroupManager"`
		CgroupVersion     string   `json:"cgroupVersion"`
		CgroupControllers []string `json:"cgroupControllers"`
		Security          struct {
			Rootless bool `json:"rootless"`
		} `json:"security"`
	} `json:"host"`
	Store struct {
		GraphRoot string `json:"graphRoot"`
	} `json:"store"`
	Version struct {
		Version string `json:"Version"`
	} `json:"version"`
}

func freeBytes(path string) (uint64, error) {
	for p := path; ; p = filepath.Dir(p) {
		var st syscall.Statfs_t
		if err := syscall.Statfs(p, &st); err == nil {
			return st.Bavail * uint64(st.Bsize), nil
		}
		if p == "/" {
			return 0, fmt.Errorf("cannot stat %s", path)
		}
	}
}

func subIDs(file, name string, uid int) int {
	f, err := os.Open(file)
	if err != nil {
		return 0
	}
	defer f.Close()
	total := 0
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		parts := strings.Split(strings.TrimSpace(sc.Text()), ":")
		if len(parts) == 3 && (parts[0] == name || parts[0] == strconv.Itoa(uid)) {
			n, _ := strconv.Atoi(parts[2])
			total += n
		}
	}
	return total
}

func versionAtLeast(v string, major, minor int) bool {
	parts := strings.SplitN(v, ".", 3)
	if len(parts) < 2 {
		return false
	}
	a, _ := strconv.Atoi(parts[0])
	b, _ := strconv.Atoi(parts[1])
	return a > major || (a == major && b >= minor)
}

const (
	needFreeHome  = 4 << 30 // the home grows with node_modules, caches
	needFreeStore = 6 << 30 // the image (~2.5 GB) and its layers while loading
)

// Prerequisites checks this host for everything the sandbox relies on. Run
// before init and by `happy-sandbox check`.
func Prerequisites(ctx context.Context) []Check {
	var cs []Check
	add := func(c Check) { cs = append(cs, c) }
	u, _ := user.Current()
	uid := os.Getuid()

	add(Check{Name: "Linux on amd64", OK: runtime.GOOS == "linux" && runtime.GOARCH == "amd64",
		Detail: runtime.GOOS + "/" + runtime.GOARCH,
		Fix:    "the image and its tools are built for amd64 Linux; arm64 (e.g. DGX Spark) is not supported yet"})
	if uid == 0 {
		add(Check{Name: "not root", Detail: "running as root",
			Fix: "run happy-sandbox as your own user: it relies on rootless podman (a root container would break the isolation)"})
	}

	bin, err := exec.LookPath(Podman())
	if err != nil {
		add(Check{Name: "podman", Detail: "not found",
			Fix: "install podman (Ubuntu: sudo apt install podman uidmap); the sandbox is a rootless podman container"})
		return cs
	}
	out, err := exec.CommandContext(ctx, bin, "info", "--format", "json").Output()
	var info podmanInfo
	if err == nil {
		err = json.Unmarshal(out, &info)
	}
	if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
		// podman's own reason, its last line
		lines := strings.Split(strings.TrimSpace(string(ee.Stderr)), "\n")
		err = fmt.Errorf("%s", lines[len(lines)-1])
	}
	if err != nil {
		add(Check{Name: "podman works", Detail: fmt.Sprint(err),
			Fix: "`podman info` must work for your user (often missing subuid/subgid entries, see below)"})
	} else {
		add(Check{Name: "podman 3.4 or newer", OK: versionAtLeast(info.Version.Version, 3, 4), Detail: info.Version.Version,
			Fix: "upgrade podman (Ubuntu 22.04 ships 3.4)"})
		add(Check{Name: "podman is rootless", OK: info.Host.Security.Rootless, Detail: fmt.Sprintf("rootless=%v", info.Host.Security.Rootless),
			Fix: "never use sudo podman or Docker: container root must be an unprivileged user on the host"})
		add(Check{Name: "cgroup v2 with the systemd manager", OK: info.Host.CgroupVersion == "v2" && info.Host.CgroupManager == "systemd",
			Detail: info.Host.CgroupVersion + ", " + info.Host.CgroupManager,
			Fix:    "systemd runs inside the sandbox and needs cgroup v2 (Ubuntu 22.04+ default) and podman's systemd cgroup manager"})
		ctl := strings.Join(info.Host.CgroupControllers, " ")
		// GPUs are optional: shown, never a failure.
		if g, err := FindGPU(""); g != nil {
			add(Check{Name: "NVIDIA GPU (optional)", OK: true, Detail: fmt.Sprintf("%s: %d device nodes, %d driver files; sandboxes get it unless \"gpu\": \"none\"", g.Spec, len(g.Devices), len(g.Mounts))})
		} else {
			detail := "no NVIDIA CDI spec (" + strings.Join(CDISpecPaths, ", ") + "): sandboxes have no GPU"
			if err != nil {
				detail = err.Error()
			}
			add(Check{Name: "NVIDIA GPU (optional)", OK: true, Detail: detail,
				Fix: "for GPUs: the NVIDIA driver and Container Toolkit, then sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml"})
		}
		// No limits unless config.json sets them; each one needs its controller.
		add(Check{Name: "limits (only those config.json sets)", OK: true,
			Detail: "controllers: " + ctl + " (memory_bytes needs memory, cpus needs cpu, pids_limit needs pids)",
			Fix:    limitsFix})
		if info.Store.GraphRoot != "" {
			free, _ := freeBytes(info.Store.GraphRoot)
			add(Check{Name: "disk space for the image", OK: free >= needFreeStore, Detail: fmt.Sprintf("%.1f GB free in %s", float64(free)/(1<<30), info.Store.GraphRoot),
				Fix: fmt.Sprintf("free at least %d GB there", needFreeStore>>30)})
		}
	}

	name := ""
	if u != nil {
		name = u.Username
	}
	su, sg := subIDs("/etc/subuid", name, uid), subIDs("/etc/subgid", name, uid)
	add(Check{Name: "subordinate uids/gids", OK: su >= 65536 && sg >= 65536, Detail: fmt.Sprintf("%d uids, %d gids", su, sg),
		Fix: fmt.Sprintf("the sandbox's system users map to these: sudo usermod --add-subuids 165536-231071 --add-subgids 165536-231071 %s", name)})
	_, e1 := exec.LookPath("newuidmap")
	_, e2 := exec.LookPath("newgidmap")
	add(Check{Name: "newuidmap / newgidmap", OK: e1 == nil && e2 == nil,
		Fix: "install them (Ubuntu: sudo apt install uidmap)"})

	// The device file exists even when the tun module is not loaded, and then
	// opening it fails with ENODEV ("no such device"). /sys/class/misc/tun
	// appears only once the device is registered.
	_, err = os.Stat("/dev/net/tun")
	tunDev, tunErr := os.Stat("/sys/class/misc/tun")
	add(Check{Name: "/dev/net/tun", OK: err == nil && tunErr == nil,
		Detail: map[bool]string{true: "present", false: "the tun module is not loaded"}[err == nil && tunErr == nil],
		Fix:    "the sandbox's only network interface is a TAP device: sudo modprobe tun, and keep it across boots with `echo tun | sudo tee /etc/modules-load.d/happy-sandbox.conf`"})
	_ = tunDev
	_, err = os.Stat("/usr/share/containers/seccomp.json")
	add(Check{Name: "podman's seccomp profile", OK: err == nil, Detail: "/usr/share/containers/seccomp.json",
		Fix: "comes with podman's containers-common package; the sandbox adds one rule to it"})
	_, err = os.Stat(mihomoPath())
	add(Check{Name: "mihomo next to happy-sandbox", OK: err == nil, Detail: mihomoPath(),
		Fix: "reinstall happy-sandbox: the exit's client ships with it"})

	// SELinux: the container's init domain may not open the TAP device until
	// the one rule of `happy-sandbox selinux-policy` is installed.
	if SELinux(ctx) {
		switch selinuxRule(ctx) {
		case "yes":
			add(Check{Name: "SELinux: the TAP device rule", OK: true, Detail: "installed"})
		case "no":
			add(Check{Name: "SELinux: the TAP device rule", Detail: "container domains cannot open /dev/net/tun",
				Fix: "run: happy-sandbox selinux-policy --install (once, uses sudo). Without it the sandbox's network cannot start"})
		default:
			// Listing the policy needs root here: do not block on a guess; `up`
			// says it plainly if the rule is missing.
			add(Check{Name: "SELinux: the TAP device rule", Warn: true, Detail: "cannot tell without root",
				Fix: "if not done yet: happy-sandbox selinux-policy --install (once, uses sudo)"})
		}
	}
	free, _ := freeBytes(Home())
	add(Check{Name: "disk space for the homes", OK: free >= needFreeHome, Detail: fmt.Sprintf("%.1f GB free for %s", float64(free)/(1<<30), Home()),
		Fix: fmt.Sprintf("free at least %d GB there", needFreeHome>>30)})

	state, fix := "", "without them happy-sandbox enable (start with the host) is not available; up / down still work"
	if cmd, err := systemctlCommand(ctx, "is-system-running"); err != nil {
		state, fix = "not running", err.Error()
	} else {
		st, _ := cmd.Output()
		state = strings.TrimSpace(string(st))
	}
	add(Check{Name: "systemd user services", Warn: true, OK: state == "running" || state == "degraded", Detail: orNone(state), Fix: fix})
	add(Check{Name: "lingering (start without a login)", Warn: true, OK: Lingering(),
		Fix: "only for happy-sandbox enable: sudo loginctl enable-linger " + name})
	return cs
}

func orNone(s string) string {
	if s == "" {
		return "not available"
	}
	return s
}

// PrerequisitesFailed: the checks that make the sandbox impossible here.
func PrerequisitesFailed(cs []Check) []Check {
	var bad []Check
	for _, c := range cs {
		if !c.OK && !c.Warn {
			bad = append(bad, c)
		}
	}
	return bad
}

// selinuxRule says whether the loaded policy lets container domains open the
// TAP device: "yes", "no", or "unknown" when this user cannot tell. Listing
// modules (`semodule -l`) needs root on CentOS/RHEL, so a plain user asks the
// loaded policy itself through sesearch (setools-console) when available.
func selinuxRule(ctx context.Context) string {
	if out, err := exec.CommandContext(ctx, "semodule", "-l").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if f := strings.Fields(line); len(f) > 0 && f[0] == "happy-sandbox" {
				return "yes"
			}
		}
		return "no"
	}
	if _, err := exec.LookPath("sesearch"); err == nil {
		out, err := exec.CommandContext(ctx, "sesearch", "-A", "-s", "container_init_t", "-t", "tun_tap_device_t", "-c", "chr_file", "-p", "open").Output()
		if err == nil {
			if strings.Contains(string(out), "allow") {
				return "yes"
			}
			return "no"
		}
	}
	return "unknown"
}

const limitsFix = "delegate the controllers to user services: systemd drop-in /etc/systemd/system/user@.service.d/delegate.conf with [Service] Delegate=cpu cpuset io memory pids, then systemctl daemon-reload and log in again"
