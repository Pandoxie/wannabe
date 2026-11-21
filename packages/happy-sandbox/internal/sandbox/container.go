package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Podman is the engine: $HSB_PODMAN (development: tools/podman-dev), else
// the user's rootless podman.
func Podman() string {
	if p := os.Getenv("HSB_PODMAN"); p != "" {
		return p
	}
	return "podman"
}

func podman(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, Podman(), args...)
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	err := cmd.Run()
	if err != nil {
		msg := strings.TrimSpace(errb.String())
		// Podman 3.4 prints harmless errors about removed storage; keep the last real line.
		lines := strings.Split(msg, "\n")
		return out.String(), fmt.Errorf("podman %s: %v: %s", args[0], err, lines[len(lines)-1])
	}
	return out.String(), nil
}

// SELinux reports whether this host confines containers with SELinux (CentOS,
// RHEL, Fedora). Then every host directory a container may write needs a
// container label: the sandbox's own files get a private one (:Z), shares a
// shared one (:z, so several sandboxes can use the same directory).
func SELinux(ctx context.Context) bool {
	out, err := podman(ctx, "info", "--format", "{{.Host.Security.SELinuxEnabled}}")
	return err == nil && strings.TrimSpace(out) == "true"
}

type ContainerState struct {
	Exists  bool
	Running bool
	// Status is podman's word for it: running, exited, stopping, ...
	Status string
}

func (i *Instance) State(ctx context.Context) ContainerState {
	out, err := podman(ctx, "container", "inspect", "--format", "{{.State.Running}} {{.State.Status}}", i.Container())
	if err != nil {
		return ContainerState{}
	}
	running, status, _ := strings.Cut(strings.TrimSpace(out), " ")
	return ContainerState{Exists: true, Running: running == "true", Status: status}
}

// settleStopped gets a container out of "stopping": Podman 3.4 sometimes
// times out waiting for conmon's exit file (busy host) and leaves the
// container there, where it can be neither started nor stopped normally.
func (i *Instance) settleStopped(ctx context.Context) ContainerState {
	for attempt := 0; attempt < 3; attempt++ {
		st := i.State(ctx)
		if !st.Exists || (!st.Running && st.Status != "stopping") {
			return st
		}
		if attempt == 0 {
			_, _ = podman(ctx, "stop", "--time", "5", i.Container())
		} else {
			_, _ = podman(ctx, "kill", i.Container())
		}
		time.Sleep(2 * time.Second)
	}
	return i.State(ctx)
}

// Rootless reports whether podman runs rootless; the sandbox refuses otherwise.
func Rootless(ctx context.Context) error {
	out, err := podman(ctx, "info", "--format", "{{.Host.Security.Rootless}}")
	if err != nil {
		return err
	}
	if strings.TrimSpace(out) != "true" {
		return errors.New("podman is not rootless; happy-sandbox runs only on rootless podman")
	}
	return nil
}

// seccompProfile writes the host's default profile plus fchmodat2 -> ENOSYS
// (tools/seccomp-profile explains why).
func (i *Instance) seccompProfile() (string, error) {
	var profile map[string]any
	data, err := os.ReadFile("/usr/share/containers/seccomp.json")
	if err != nil {
		return "", fmt.Errorf("cannot read the host's seccomp profile: %v", err)
	}
	if err := json.Unmarshal(data, &profile); err != nil {
		return "", err
	}
	syscalls, _ := profile["syscalls"].([]any)
	known := false
	for _, r := range syscalls {
		names, _ := r.(map[string]any)["names"].([]any)
		for _, n := range names {
			if n == "fchmodat2" {
				known = true
			}
		}
	}
	if !known {
		profile["syscalls"] = append(syscalls, map[string]any{"names": []string{"fchmodat2"}, "action": "SCMP_ACT_ERRNO", "errnoRet": 38})
	}
	out, _ := json.Marshal(profile)
	path := filepath.Join(i.Dir, "seccomp.json")
	return path, os.WriteFile(path, out, 0o600)
}

// createArgs: no network of its own (the TAP comes from the host), only
// NET_ADMIN + /dev/net/tun added, the host user's uid inside (keep-id), the
// identity (machine id, hostname, time zone, locale) from identity.json, the
// home and the shares as bind mounts (read-only ones stay so: no
// CAP_SYS_ADMIN).
//
// fromHost: the from_host mounts (fromHostMounts). They are the host's own
// files and are never relabelled; on an SELinux host the container then runs
// without SELinux separation (label=disable), or it could not read them.
func (i *Instance) createArgs(seccomp string, gpu *GPU, fromHost []string) []string {
	c, id := i.Config, i.Identity
	args := []string{"create", "--name", i.Container(), "--label", "happy-sandbox=" + c.Name,
		"--label", identityLabel + "=" + id.Hash(), "--label", limitsLabel + "=" + c.limitsKey(),
		"--label", fromHostLabel + "=" + fromHostKey(c.FromHost),
		"--label", linkLabel + "=" + linkVersion,
		// The network link's socket directory (ServeNetwork, hsb-link).
		"-v", i.mountSpec(i.LinkDir(), LinkDirInContainer, "", privateLabel),
		"--network", "none", "--security-opt", "seccomp=" + seccomp,
		"--userns=keep-id", "--user", "0:0",
		"-e", "HSB_UID=" + strconv.Itoa(os.Getuid()), "-e", "HSB_GID=" + strconv.Itoa(os.Getgid()),
		"-e", "HSB_TIMEZONE=" + id.Timezone, "-e", "HSB_LOCALE=" + id.Locale, "-e", "TZ=" + id.Timezone,
		"-v", i.mountSpec(i.MachineIDPath(), "/etc/machine-id", "ro", privateLabel),
		// The crontab lives in the container: hsb-setup writes our lines and the
		// installer's nightly line comes back with the next happy update.
		"-v", i.mountSpec(i.HomeDir(), "/home/dev", "", privateLabel),
		"--cgroupns", "private", "--ipc", "private", "--hostname", id.Hostname,
		"--device", "/dev/net/tun", "--cap-add", "NET_ADMIN",
		"--tmpfs", "/run", "--tmpfs", "/tmp", "--stop-signal", "SIGRTMIN+3", "--stop-timeout", "30",
		"--systemd", "always", "--pull", "never", "--http-proxy=false"}
	args = append(args, c.limitArgs()...)
	if gpu != nil {
		args = append(args, "--label", gpuLabel+"="+gpu.Key)
		args = append(args, gpu.args()...)
	} else {
		args = append(args, "--label", gpuLabel+"=-")
	}
	for _, s := range c.Shares {
		mode := "rw"
		if s.ReadOnly {
			mode = "ro"
		}
		args = append(args, "-v", i.mountSpec(s.Source, s.Target, mode, sharedLabel))
	}
	// After /home/dev's own mount (podman orders mounts by destination too).
	args = append(args, fromHost...)
	if len(fromHost) > 0 && i.selinux {
		args = append(args, "--security-opt", "label=disable")
	}
	// By id: the container is from exactly the image Ensure compared.
	return append(args, i.imageID, "/sbin/init")
}

const identityLabel = "happy-sandbox.identity"

// fromHostLabel names the from_host list a container was made with; a
// container from before it (no label) counts as "-" (none), so upgrading
// recreates nothing.
const fromHostLabel = "happy-sandbox.from-host"

const limitsLabel = "happy-sandbox.limits"

// linkLabel names how the network link reaches the container; a container
// from before the socket link (0.3.0) lacks the mount and is recreated.
const linkLabel = "happy-sandbox.link"

const linkVersion = "socket1"

// gpuLabel names the GPU spec and choice a container was made with ("-": none).
const gpuLabel = "happy-sandbox.gpu"

// limitsKey names the limits a container was made with ("-": none).
func (c Config) limitsKey() string {
	return "m" + strconv.FormatInt(c.MemoryBytes, 10) + ",c" + strconv.FormatFloat(c.CPUs, 'f', -1, 64) + ",p" + strconv.FormatInt(c.PidsLimit, 10)
}

type labelKind int

const (
	noLabel      labelKind = iota
	privateLabel           // the sandbox's own files (:Z)
	sharedLabel            // a share, possibly used by other sandboxes (:z)
)

// mountSpec builds a `-v` value: source:target, then mode (ro/rw/"") and the
// SELinux relabel option as comma-separated options in the *third* colon
// field. The label is a mount option, not part of the target: appending it to
// the target made podman create a directory literally named "/home/dev,Z".
func (i *Instance) mountSpec(source, target, mode string, kind labelKind) string {
	opts := []string{}
	if mode != "" {
		opts = append(opts, mode)
	}
	if l := i.selinuxLabel(source, kind); l != "" {
		opts = append(opts, l)
	}
	spec := source + ":" + target
	if len(opts) > 0 {
		spec += ":" + strings.Join(opts, ",")
	}
	return spec
}

// selinuxLabel is "Z" for the sandbox's own files, "z" for a share, "" with no
// SELinux or for a share the filesystem cannot relabel (CIFS / NFS carry their
// label from the mount options instead).
func (i *Instance) selinuxLabel(source string, kind labelKind) string {
	if !i.selinux || kind == noLabel {
		return ""
	}
	if kind == privateLabel {
		return "Z"
	}
	if !relabelable(source) {
		return ""
	}
	return "z"
}

// relabelable: SELinux can label files of local filesystems only.
func relabelable(path string) bool {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return true // do not refuse a share over an odd statfs error
	}
	switch uint32(st.Type) {
	case 0xFF534D42, // cifs
		0x6969,     // nfs
		0x517B,     // smb
		0xFE534D42, // smb2
		0x01021997, // 9p (v9fs)
		0x0000F15F, // vboxsf
		0x65735546: // fuse
		return false
	}
	return true
}

// shareLabelOpt: the label for a share, only when its filesystem can carry one.
func (i *Instance) shareLabelOpt(source string) string {
	if !i.selinux || !relabelable(source) {
		return ""
	}
	return ",z"
}

// fillHome creates the home from the image's /home/dev the first time: into
// a staging directory, renamed into place when complete.
//
// The copy goes to a *new* directory the container creates itself
// (<staging>/home), never onto the mount point: `cp -a` ends by setting the
// destination's own timestamps, and the mount point belongs to the host user,
// which container root may not be allowed to touch (it is a sub-id, and how
// keep-id maps it differs between Podman versions and hosts).
func (i *Instance) fillHome(ctx context.Context, seccomp string) error {
	if _, err := os.Stat(i.HomeDir()); err == nil {
		return nil
	}
	staging := i.path("home.new")
	// A fill that did not finish: its files may belong to sub-ids.
	if _, err := os.Stat(staging); err == nil {
		if _, err := podman(ctx, "unshare", "rm", "-rf", staging); err != nil {
			return err
		}
	}
	if err := os.Mkdir(staging, 0o700); err != nil {
		return err
	}
	owner := strconv.Itoa(os.Getuid()) + ":" + strconv.Itoa(os.Getgid())
	if _, err := podman(ctx, "run", "--rm", "--network", "none", "--security-opt", "seccomp="+seccomp,
		"--userns=keep-id", "--user", "0:0", "--pull", "never", "-v", i.mountSpec(staging, "/mnt", "", privateLabel),
		i.Config.Image, "sh", "-c", "cp -a /home/dev /mnt/home && chown -R "+owner+" /mnt/home"); err != nil {
		return fmt.Errorf("filling the home from the image: %v", err)
	}
	if err := os.Rename(filepath.Join(staging, "home"), i.HomeDir()); err != nil {
		return err
	}
	return os.Remove(staging)
}

// Ensure creates the container if needed and starts it. A container made
// for another identity (identity.json was edited), from an older image or
// with other limits (memory_bytes, cpus, pids_limit) or another GPU spec
// (a driver update rewrites it) is recreated: the home stays, system changes outside it are reset. It
// reports whether it did.
func (i *Instance) Ensure(ctx context.Context) (recreated bool, err error) {
	if i.Identity == nil {
		return false, errors.New("no identity")
	}
	// identity.json is the source: the mounted machine-id file follows it.
	if err := writeFile(i.MachineIDPath(), []byte(i.Identity.MachineID+"\n"), 0o644); err != nil {
		return false, err
	}
	i.selinux = SELinux(ctx)
	imageID, err := podman(ctx, "image", "inspect", "--format", "{{.Id}}", i.Config.Image)
	if err != nil {
		return false, fmt.Errorf("image %s is not installed: happy-sandbox image load FILE", i.Config.Image)
	}
	i.imageID = strings.TrimSpace(imageID)
	st := i.State(ctx)
	if st.Exists {
		// The limits are fixed at creation too (Podman 3.4 has no update): the
		// container carries them as a label.
		out, _ := podman(ctx, "container", "inspect", "--format", "{{index .Config.Labels \""+identityLabel+"\"}} {{.Image}} {{index .Config.Labels \""+limitsLabel+"\"}} {{index .Config.Labels \""+gpuLabel+"\"}} {{index .Config.Labels \""+linkLabel+"\"}} {{index .Config.Labels \""+fromHostLabel+"\"}}", i.Container())
		got := strings.TrimSpace(out)
		if strings.HasSuffix(got, " <no value>") {
			got = strings.TrimSuffix(got, "<no value>") + "-"
		}
		if got != i.Identity.Hash()+" "+i.imageID+" "+i.Config.limitsKey()+" "+gpuKey(i.Config.GPU)+" "+linkVersion+" "+fromHostKey(i.Config.FromHost) {
			if err := i.Remove(ctx); err != nil {
				return false, err
			}
			st, recreated = ContainerState{}, true
		}
	}
	if !st.Exists {
		seccomp, err := i.seccompProfile()
		if err != nil {
			return false, err
		}
		if err := i.fillHome(ctx, seccomp); err != nil {
			return false, err
		}
		if err := os.MkdirAll(i.LinkDir(), 0o700); err != nil {
			return false, err
		}
		gpu, err := FindGPU(i.Config.GPU)
		if err != nil {
			return false, err
		}
		fromHost, skipped, err := i.fromHostMounts()
		if err != nil {
			return false, err
		}
		for _, p := range skipped {
			fmt.Fprintf(os.Stderr, "from_host: ~/%s does not exist on this host, not lent\n", p)
		}
		if _, err := podman(ctx, i.createArgs(seccomp, gpu, fromHost)...); err != nil {
			if strings.Contains(err.Error(), "cgroup controller") {
				return false, fmt.Errorf("%v: a limit in config.json needs a cgroup controller this host does not delegate (%s)", err, limitsFix)
			}
			return false, err
		}
	}
	if st.Status == "stopping" {
		st = i.settleStopped(ctx)
	}
	if !st.Running {
		if _, err := podman(ctx, "start", i.Container()); err != nil {
			return recreated, err
		}
	}
	return recreated, nil
}

// InstallHelper copies this binary in (the guest's TAP helper must match it).
func (i *Instance) InstallHelper(ctx context.Context) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if _, err := podman(ctx, "cp", self, i.Container()+":/usr/local/lib/happy-sandbox/happy-sandbox"); err != nil {
		return err
	}
	_, err = podman(ctx, "exec", "--user", "0", i.Container(), "chmod", "0755", "/usr/local/lib/happy-sandbox/happy-sandbox")
	return err
}

func (i *Instance) Stop(ctx context.Context) error {
	if st := i.State(ctx); !st.Running && st.Status != "stopping" {
		return nil
	}
	if _, err := podman(ctx, "stop", "--time", "30", i.Container()); err != nil {
		// Podman 3.4 can lose the exit file and leave it "stopping": finish the job.
		if st := i.settleStopped(ctx); st.Running || st.Status == "stopping" {
			return err
		}
	}
	return nil
}

// Remove deletes the container only: the sandbox directory (home, identity) stays.
func (i *Instance) Remove(ctx context.Context) error {
	if !i.State(ctx).Exists {
		return nil
	}
	_, err := podman(ctx, "rm", "--force", i.Container())
	return err
}

// AsDev runs a command in the container as dev with a login environment.
// runuser sets dev's groups the normal way (podman exec --user would add
// group 0 on Podman 3.4).
func (i *Instance) AsDev(ctx context.Context, command string) (string, error) {
	return podman(ctx, "exec", "--user", "0", "-w", "/home/dev", i.Container(), "runuser", "-l", "dev", "-c", command)
}

// Destroy removes the container and the whole sandbox directory: home,
// identity, node file, logs. Files in the home may belong to sub-ids (made
// by root or other users inside), so it removes them in podman's namespace.
func (i *Instance) Destroy(ctx context.Context) error {
	if err := i.Remove(ctx); err != nil {
		return err
	}
	if _, err := os.Stat(i.Dir); errors.Is(err, os.ErrNotExist) {
		return nil
	}
	_, err := podman(ctx, "unshare", "rm", "-rf", i.Dir)
	return err
}

// LoadImage installs an image archive (podman save / OCI archive) and tags it
// as the default image.
func LoadImage(ctx context.Context, file string) error {
	out, err := podman(ctx, "load", "--quiet", "--input", file)
	if err != nil {
		return err
	}
	// "Loaded image(s): NAME[,NAME…]" (Podman 3.4) / "Loaded image: NAME".
	lines := strings.Split(strings.TrimSpace(out), "\n")
	last := lines[len(lines)-1]
	loaded := strings.TrimSpace(strings.Split(last[strings.Index(last, ":")+1:], ",")[0])
	if loaded == "" {
		return fmt.Errorf("podman load: no image in %q", out)
	}
	if loaded != DefaultImage {
		_, err = podman(ctx, "tag", loaded, DefaultImage)
	}
	return err
}

func ListImages(ctx context.Context) (string, error) {
	return podman(ctx, "images", "--filter", "reference=localhost/happy-sandbox*", "--format", "{{.Repository}}:{{.Tag}}  {{.ID}}  {{.Created}}  {{.Size}}")
}
