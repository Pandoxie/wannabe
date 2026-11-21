// happy-sandbox: a rootless container, like a small Linux server, whose only
// way out is one VLESS exit locked to its IP.
//
//	happy-sandbox init --node FILE --exit-ip IP [--profile isolated|host] [--timezone TZ] [--locale L] [--share SRC[:TARGET[:ro]]]... [--name N]
//	happy-sandbox up | down | restart | status | identity | shell | here [CMD...] | exec -- CMD... | destroy --yes [--name N]
//	happy-sandbox config show | set KEY VALUE | unset KEY | edit | preset host|isolated [--name N]
//	happy-sandbox share list | add SRC [TARGET] [--ro] [--submounts] | rm TARGET [--name N]
//	happy-sandbox list
//
//	happy-sandbox enable | disable [--name N]
//
// Internal: run (systemd's: container + network in the foreground),
// stop-container, net-serve (the host network process), guest-tap (inside,
// as root).
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/gate"
	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/netstack"
	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/sandbox"
)

// version is set by the release build (-ldflags "-X main.version=…").
var version = "dev"

const usage = `happy-sandbox — a Linux sandbox whose only way out is one VLESS exit

  happy-sandbox init --node FILE --exit-ip IP [--profile isolated|host]
                     [--share SRC[:TARGET[:ro]]]... [--timezone America/New_York]
                     [--locale en_US.UTF-8] [--hostname H]
                          create a sandbox (FILE: one mihomo node, chmod 600);
                          time zone and locale should match the exit's region.
                          --profile host: the host user, home, /mnt, memory and GPU;
                          only the network (the exit) and the identity are its own
  happy-sandbox up        start it; the network opens once the exit is IP
  happy-sandbox restart   down, then up (applies configuration changes)
  happy-sandbox shell     a shell inside, as the sandbox's user
  happy-sandbox here [CMD...]
                          run CMD (default: a shell) inside, in the host's current
                          directory; claude / codex get access.tool_args (full access;
                          HSB_SAFE=1 leaves them out)
  happy-sandbox exec -- CMD...
  happy-sandbox status
  happy-sandbox identity [set hostname NAME|random | set mac random | set timezone TZ | set locale L]
                          what this sandbox looks like from inside (identity.json);
                          host names are unique on this host
  happy-sandbox down      stop it (files and logins are kept)
  happy-sandbox config show | set KEY VALUE | unset KEY | edit | preset host|isolated
                          what the sandbox gets of the host (access: user, home, env,
                          resources, devices); e.g. config set access.resources.memory 64G
  happy-sandbox packages list | add PKG... | rm PKG...
                          apt packages the sandbox keeps: installed at every up when
                          missing (a recreated container starts from the image)
  happy-sandbox share list | add SRC [TARGET] [--ro] [--submounts] | rm TARGET
                          host directories inside (TARGET defaults to SRC's path;
                          --submounts: every disk mounted below SRC too)
  happy-sandbox list      all sandboxes
  happy-sandbox check     can this host run sandboxes (and if not, why)
  happy-sandbox selinux-policy [--install]
                          SELinux hosts (CentOS, RHEL, Fedora): the one policy rule
                          sandboxes need (the TAP device); prints the steps, or with
                          --install runs them through sudo
  happy-sandbox image load FILE | list
                          install the image (an OCI archive); sandboxes move to it
                          at their next up (home kept)
  happy-sandbox enable    start it with the host, and restart its network if it fails
  happy-sandbox disable   start it only by hand again (stops it now)
  happy-sandbox destroy --yes
                          delete the sandbox and everything in ~/.happy-sandbox/<name>

  happy-sandbox version

  Configuration changes (config, share) apply at the next up / restart: the
  container is recreated; the home, logins and data are kept.

  --name N                another sandbox than "default"

  ~/.happy-sandbox/<name>/config.json also takes (README): host_ports
  (development: reach the host's 127.0.0.1:<port>); the older memory_bytes,
  cpus, pids_limit and gpu still apply where access says nothing.
  Packages you apt install come back after a recreation by themselves.
`

// usageText is usage under the name the user typed: `happy cage` runs this
// with HSB_AS="happy cage", so the help shows one name.
func usageText() string {
	if as := os.Getenv("HSB_AS"); as != "" {
		return strings.ReplaceAll(usage, "happy-sandbox ", as+" ")
	}
	return usage
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usageText())
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "guest-tap":
		// Before 0.3.0 the link was this, over a podman exec pipe; kept for
		// sandboxes whose container is not recreated yet.
		err = netstack.RunTAP(ctx, os.Stdin, os.Stdout, args...)
	case "guest-link":
		// Inside, as the hsb-link unit: guest-link SOCKET [MAC].
		if len(args) < 1 {
			err = errors.New("guest-link SOCKET [MAC]")
			break
		}
		err = netstack.RunLink(ctx, args[0], args[1:]...)
	case "net-serve":
		err = netServe(ctx, args)
	case "run":
		err = cmdRun(ctx, args)
	case "stop-container":
		// systemd's ExecStop: the network first (it exits cleanly on SIGTERM),
		// then the container.
		var inst *sandbox.Instance
		if inst, _, err = load(args); err == nil {
			stopNetwork(inst)
			err = inst.Stop(context.Background())
		}
	case "enable":
		err = cmdEnable(ctx, args)
	case "disable":
		err = cmdDisable(ctx, args)
	case "net-dev":
		// Development / image build: the network for a container by name.
		if len(args) != 4 {
			err = errors.New("net-dev CONTAINER NODE_FILE EXIT_IP RUN_DIR")
			break
		}
		var inst *sandbox.Instance
		if inst, err = sandbox.ForContainer(args[0], args[1], args[2], args[3]); err == nil {
			err = inst.ServeNetwork(ctx)
		}
	case "init":
		err = cmdInit(args)
	case "up":
		err = cmdUp(ctx, args)
	case "down":
		err = cmdDown(ctx, args)
	case "status":
		err = cmdStatus(ctx, args)
	case "shell":
		err = cmdShell(args)
	case "exec":
		err = cmdExec(args)
	case "here":
		err = cmdHere(ctx, args)
	case "config":
		err = cmdConfig(ctx, args)
	case "packages":
		err = cmdPackages(ctx, args)
	case "restart":
		if err = cmdDown(ctx, args); err == nil {
			err = cmdUp(ctx, args)
		}
	case "share":
		err = cmdShare(ctx, args)
	case "list":
		err = cmdList(ctx)
	case "image":
		err = cmdImage(ctx, args)
	case "check":
		if bad := printChecks(ctx); bad > 0 {
			os.Exit(1)
		}
	case "selinux-policy":
		err = cmdSELinuxPolicy(args)
	case "identity":
		err = cmdIdentity(args)
	case "destroy":
		err = cmdDestroy(ctx, args)
	case "version", "--version":
		fmt.Println("happy-sandbox", version)
		if out, e := exec.Command(sandbox.Podman(), "image", "inspect", "--format", "{{.Id}} {{.Created}}", sandbox.DefaultImage).Output(); e == nil {
			fmt.Println("image", sandbox.DefaultImage, strings.TrimSpace(string(out)))
		} else {
			fmt.Println("image", sandbox.DefaultImage, "not installed")
		}
	case "-h", "--help", "help":
		fmt.Print(usageText())
	default:
		fmt.Fprint(os.Stderr, usageText())
		os.Exit(2)
	}
	if err != nil && ctx.Err() == nil {
		fmt.Fprintln(os.Stderr, "happy-sandbox:", err)
		os.Exit(1)
	}
}

// selinuxModule is what a sandbox needs from SELinux: its init domain may open
// the TAP device, and (1.1, happy-sandbox 0.3.0) the network link inside may
// connect to the host network process's socket, which runs as the user
// (unconfined_t; container_runtime_t when started through a runtime). CentOS /
// RHEL / Fedora deny both by default.
const selinuxModule = `module happy-sandbox 1.1;

require {
    type container_init_t;
    type container_t;
    type tun_tap_device_t;
    type unconfined_t;
    type container_runtime_t;
    class chr_file { getattr open read write ioctl map };
    class unix_stream_socket connectto;
}

# The sandbox's network interface is a TAP device (as in a VM).
allow container_init_t tun_tap_device_t:chr_file { getattr open read write ioctl map };
allow container_t tun_tap_device_t:chr_file { getattr open read write ioctl map };

# Its frames reach the host's network process over a unix socket (0.3.0).
allow container_t unconfined_t:unix_stream_socket connectto;
allow container_t container_runtime_t:unix_stream_socket connectto;
`

// cmdSELinuxPolicy prints the module and the commands that install it. With
// --install it runs them through sudo (the user asks for that explicitly); it
// never changes host policy on its own.
func cmdSELinuxPolicy(args []string) error {
	if !sandbox.SELinux(context.Background()) {
		fmt.Println("This host does not confine containers with SELinux: nothing to install.")
		return nil
	}
	if len(args) > 0 && args[0] == "--install" {
		return installSELinuxPolicy()
	}
	fmt.Println(`On a host with SELinux (CentOS, RHEL, Fedora) a container may not open the TAP
device by default, so a sandbox's network cannot start ("cannot open /dev/net/tun:
permission denied", with an avc denial in the audit log). This one rule allows it.

Install it once, as root — either let this command do it:
  happy-sandbox selinux-policy --install      (asks for your sudo password)

or run the steps yourself:`)
	fmt.Println()
	fmt.Println("cat > /tmp/happy-sandbox.te <<'EOF'\n" + selinuxModule + "EOF")
	fmt.Println("sudo dnf install -y policycoreutils-python-utils checkpolicy")
	fmt.Println("sudo checkmodule -M -m -o /tmp/happy-sandbox.mod /tmp/happy-sandbox.te")
	fmt.Println("sudo semodule_package -o /tmp/happy-sandbox.pp -m /tmp/happy-sandbox.mod")
	fmt.Println("sudo semodule -i /tmp/happy-sandbox.pp")
	fmt.Println()
	fmt.Println("Then: happy-sandbox up")
	fmt.Println()
	fmt.Println("To undo: sudo semodule -r happy-sandbox")
	return nil
}

// installSELinuxPolicy writes the module source and runs the packaging and
// install steps with sudo. The tools come from the distribution's repos.
func installSELinuxPolicy() error {
	if _, err := exec.LookPath("sudo"); err != nil {
		return errors.New("sudo not found: run the steps printed by `happy-sandbox selinux-policy` as root")
	}
	dir, err := os.MkdirTemp("", "happy-sandbox-selinux-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	te := filepath.Join(dir, "happy-sandbox.te")
	if err := os.WriteFile(te, []byte(selinuxModule), 0o644); err != nil {
		return err
	}
	steps := [][]string{
		{"dnf", "install", "-y", "policycoreutils-python-utils", "checkpolicy"},
		{"checkmodule", "-M", "-m", "-o", filepath.Join(dir, "happy-sandbox.mod"), te},
		{"semodule_package", "-o", filepath.Join(dir, "happy-sandbox.pp"), "-m", filepath.Join(dir, "happy-sandbox.mod")},
		{"semodule", "-i", filepath.Join(dir, "happy-sandbox.pp")},
	}
	for _, step := range steps {
		fmt.Println("==> sudo", strings.Join(step, " "))
		cmd := exec.Command("sudo", step...)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("sudo %s: %v", strings.Join(step, " "), err)
		}
	}
	fmt.Println("\nInstalled. Now: happy-sandbox up")
	fmt.Println("To undo: sudo semodule -r happy-sandbox")
	return nil
}

// nameFlag pulls --name N out of args (anywhere), default "default".
func nameFlag(args []string) (string, []string) {
	name, rest := "default", []string{}
	for k := 0; k < len(args); k++ {
		if args[k] == "--name" && k+1 < len(args) {
			name = args[k+1]
			k++
		} else if strings.HasPrefix(args[k], "--name=") {
			name = strings.TrimPrefix(args[k], "--name=")
		} else {
			rest = append(rest, args[k])
		}
	}
	return name, rest
}

func load(args []string) (*sandbox.Instance, []string, error) {
	name, rest := nameFlag(args)
	inst, err := sandbox.Load(name)
	return inst, rest, err
}

type shareList []string

func (s *shareList) String() string     { return strings.Join(*s, ",") }
func (s *shareList) Set(v string) error { *s = append(*s, v); return nil }

// parseShare: SRC, SRC:TARGET, SRC:TARGET:ro (an empty TARGET is SRC's own path).
func parseShare(v string) (sandbox.Share, error) {
	parts := strings.Split(v, ":")
	if len(parts) > 3 || (len(parts) == 3 && parts[2] != "ro" && parts[2] != "rw") {
		return sandbox.Share{}, fmt.Errorf("--share %q: SRC, SRC:TARGET or SRC:TARGET:ro", v)
	}
	s := sandbox.Share{Source: parts[0]}
	if len(parts) > 1 {
		s.Target = parts[1]
	}
	s.ReadOnly = len(parts) == 3 && parts[2] == "ro"
	return s, nil
}

// addHostMounts adds the host preset's /mnt and /media, unless a share
// already covers them (those are replaced: the preset mounts everything below).
func addHostMounts(shares []sandbox.Share) []sandbox.Share {
	for _, m := range sandbox.HostMounts() {
		kept := shares[:0:0]
		for _, s := range shares {
			if s.Target != m.Target && !strings.HasPrefix(s.Target, m.Target+"/") {
				kept = append(kept, s)
			}
		}
		shares = append(kept, m)
	}
	return shares
}

func cmdInit(args []string) error {
	name, rest := nameFlag(args)
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	node := fs.String("node", "", "mihomo node file (one node, chmod 600)")
	exitIP := fs.String("exit-ip", "", "the public IPv4 the providers must see")
	image := fs.String("image", sandbox.DefaultImage, "image")
	hostname := fs.String("hostname", "", "the sandbox's hostname (shown as the machine in the Happy app; default: a random one like ws-7k3q2m, unique on this host)")
	timezone := fs.String("timezone", sandbox.DefaultTimezone, "IANA time zone of the exit's region")
	locale := fs.String("locale", sandbox.DefaultLocale, "locale (LANG) of the exit's region")
	profile := fs.String("profile", "isolated", "isolated, or host: the host user, home, /mnt, memory and GPU (only the network and identity differ)")
	var shares shareList
	fs.Var(&shares, "share", "SRC[:TARGET[:ro]], repeatable; TARGET defaults to SRC's own path")
	if err := fs.Parse(rest); err != nil {
		return err
	}
	if *node == "" || *exitIP == "" {
		return errors.New("init needs --node FILE and --exit-ip IP")
	}
	if bad := sandbox.PrerequisitesFailed(sandbox.Prerequisites(context.Background())); len(bad) > 0 {
		printChecks(context.Background())
		return fmt.Errorf("this host cannot run a sandbox yet (%d of the checks above)", len(bad))
	}
	// The host name: random and like any workstation's unless given; never
	// one the host or another sandbox here already has.
	host := *hostname
	if host == "" {
		host = sandbox.UniqueHostname(name)
	} else if err := sandbox.CheckHostnameFree(host, name); err != nil {
		return err
	}
	c := sandbox.Config{Name: name, Image: *image, ExitIP: *exitIP}
	for _, v := range shares {
		s, err := parseShare(v)
		if err != nil {
			return err
		}
		c.Shares = append(c.Shares, s)
	}
	switch *profile {
	case "isolated":
	case "host":
		c.Access = sandbox.HostPreset()
		c.Shares = addHostMounts(c.Shares)
	default:
		return fmt.Errorf("--profile %q: isolated or host", *profile)
	}
	inst, err := sandbox.Create(c, *node, sandbox.NewIdentity(host, *timezone, *locale))
	if err != nil {
		return err
	}
	fmt.Printf("Created sandbox %q in %s (exit %s, access %s).\n", name, inst.Dir, c.ExitIP, c.Access.Describe())
	printIdentity(inst)
	fmt.Println("Next: happy-sandbox up")
	return nil
}

// startNetwork runs `happy-sandbox net-serve` detached, logging to run/net.log.
func startNetwork(inst *sandbox.Instance) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	logf, err := os.OpenFile(filepath.Join(inst.RunDir(), "net.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer logf.Close()
	cmd := exec.Command(self, "net-serve", "--name", inst.Config.Name)
	cmd.Stdout, cmd.Stderr = logf, logf
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	_ = os.WriteFile(inst.PidPath(), []byte(fmt.Sprintln(cmd.Process.Pid)), 0o600)
	return cmd.Process.Release()
}

func cmdUp(ctx context.Context, args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	if err := sandbox.Rootless(ctx); err != nil {
		return err
	}
	if err := os.MkdirAll(inst.RunDir(), 0o700); err != nil {
		return err
	}
	if _, alive := inst.ReadStatus(); alive {
		fmt.Println("Already up.")
		ensurePackages(ctx, inst)
		return cmdStatus(ctx, args)
	}
	if inst.UnitEnabled(ctx) {
		// systemd runs it (happy-sandbox enable): the container and the network.
		fmt.Printf("Starting %s (the network opens once the exit is %s)…\n", inst.Unit(), inst.Config.ExitIP)
		_ = os.Remove(filepath.Join(inst.RunDir(), "state.json"))
		if err := inst.UnitStart(ctx); err != nil {
			return err
		}
	} else {
		fmt.Println("Starting the container…")
		if err := prepare(ctx, inst); err != nil {
			return err
		}
		fmt.Printf("Starting the network (opens once the exit is %s)…\n", inst.Config.ExitIP)
		if err := startNetwork(inst); err != nil {
			return err
		}
	}
	if waitOpen(inst, 90*time.Second) {
		ensurePackages(ctx, inst)
		// The happy daemon, once logged in (the crontab keeps it running afterwards).
		_, _ = inst.AsUser(ctx, startHappyDaemon)
	} else if st, _ := inst.ReadStatus(); st != nil && strings.Contains(st.Reason, "waiting for the sandbox") && sandbox.SELinux(ctx) {
		// The link never came: on an SELinux host the usual reason is a policy
		// without the socket rule (module 1.0, from before 0.3.0).
		fmt.Println("The sandbox has not connected to its network. On this SELinux host that usually means")
		fmt.Println("the happy-sandbox policy predates 0.3.0 (it needs the socket rule of module 1.1):")
		fmt.Println("  happy-sandbox selinux-policy --install     (then: happy-sandbox down && happy-sandbox up)")
		fmt.Println("Denials, if any: sudo ausearch -m avc -ts recent | grep happy")
	}
	return cmdStatus(ctx, args)
}

// startHappyDaemon starts the happy daemon once logged in; its state is
// $HAPPY_HOME_DIR (the sandbox's own with access.home.private "happy").
const startHappyDaemon = `[ -f "${HAPPY_HOME_DIR:-$HOME/.happy}/access.key" ] && happy daemon start >/dev/null 2>&1 || true`

// ensurePackages installs missing access.packages (through the gate, so only
// once it is open). A failure is reported, not fatal: the sandbox runs.
func ensurePackages(ctx context.Context, inst *sandbox.Instance) {
	if len(inst.Config.Access.Packages) == 0 {
		return
	}
	fmt.Printf("Checking packages (%s)…\n", strings.Join(inst.Config.Access.Packages, " "))
	installed, err := inst.EnsurePackages(ctx)
	switch {
	case err != nil:
		fmt.Fprintln(os.Stderr, "happy-sandbox: packages:", err)
	case len(installed) > 0:
		fmt.Printf("Installed: %s\n", strings.Join(installed, " "))
	}
}

// prepare: the container (recreated if identity.json changed) and the TAP helper.
func prepare(ctx context.Context, inst *sandbox.Instance) error {
	recreated, err := inst.Ensure(ctx)
	if err != nil {
		return err
	}
	if recreated {
		fmt.Println("The configuration, identity.json, the image or the GPU changed: the container was recreated (home kept; apt packages come back by themselves).")
	}
	// The guest side of the network link runs the helper: stop it before the
	// helper is replaced, start it again after.
	if err := inst.StopGuestLink(ctx); err != nil {
		return err
	}
	if err := inst.InstallHelper(ctx); err != nil {
		return err
	}
	if err := inst.InstallGuestScripts(ctx); err != nil {
		return err
	}
	if err := inst.StartGuestLink(ctx); err != nil {
		return err
	}
	gpu, err := inst.SetupGPU(ctx)
	if err != nil {
		if g := inst.Config.Access.Devices.GPU; g != "" && g != "auto" || inst.Config.GPU != "" {
			return err
		}
		// Automatic: a GPU problem must not keep the sandbox from starting.
		fmt.Fprintf(os.Stderr, "happy-sandbox: GPU not set up (%v); happy-sandbox config set access.devices.gpu none turns it off\n", err)
		gpu = nil
	}
	if gpu != nil {
		fmt.Printf("GPU: %s from %s (nvidia-smi inside)\n", gpu.Device, gpu.Spec)
	}
	return nil
}

// waitOpen waits for the network process to open the gate.
func waitOpen(inst *sandbox.Instance, d time.Duration) bool {
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		time.Sleep(time.Second)
		st, alive := inst.ReadStatus()
		if st != nil && st.Gate == gate.GateOpen {
			return true
		}
		if st != nil && !alive && st.Reason == "stopped" {
			fmt.Printf("The network process stopped; see %s (or journalctl --user -u %s)\n", filepath.Join(inst.RunDir(), "net.log"), inst.Unit())
			return false
		}
	}
	return false
}

// cmdRun is systemd's (happy-sandbox@NAME.service): the container, then the
// network in the foreground. A failure exits non-zero and systemd restarts it.
func cmdRun(ctx context.Context, args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	if err := sandbox.Rootless(ctx); err != nil {
		return err
	}
	if err := os.MkdirAll(inst.RunDir(), 0o700); err != nil {
		return err
	}
	if st, alive := inst.ReadStatus(); alive && st.Pid != os.Getpid() {
		return fmt.Errorf("its network already runs (pid %d), started by hand: happy-sandbox down first", st.Pid)
	}
	if err := prepare(ctx, inst); err != nil {
		return err
	}
	go func() {
		if waitOpen(inst, 3*time.Minute) {
			ensurePackages(ctx, inst)
			_, _ = inst.AsUser(ctx, startHappyDaemon)
		}
	}()
	return inst.ServeNetwork(ctx)
}

func cmdEnable(ctx context.Context, args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	if _, alive := inst.ReadStatus(); alive && !inst.UnitEnabled(ctx) {
		fmt.Println("Handing the running sandbox over to systemd…")
		if err := cmdDown(ctx, args); err != nil {
			return err
		}
	}
	if err := inst.Enable(ctx); err != nil {
		return err
	}
	fmt.Printf("Enabled %s: it starts with the host and its network restarts if it fails.\n", inst.Unit())
	if !sandbox.Lingering() {
		// Without lingering, user units start only at login and stop at logout.
		// A host-wide setting: the user decides, happy-sandbox does not change it.
		fmt.Printf("\nFor it to start at boot without a login, once (your user's services keep running then):\n  sudo loginctl enable-linger %s\n\n", os.Getenv("USER"))
	}
	return cmdUp(ctx, args)
}

func cmdDisable(ctx context.Context, args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	if inst.UnitEnabled(ctx) {
		if err := inst.UnitStop(ctx); err != nil {
			return err
		}
	}
	if err := inst.Disable(ctx); err != nil {
		return err
	}
	fmt.Println("Disabled: it no longer starts with the host, and it is stopped. Start it by hand: happy-sandbox up")
	return nil
}

func cmdDown(ctx context.Context, args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	if inst.UnitEnabled(ctx) {
		if err := inst.UnitStop(ctx); err != nil {
			return err
		}
	}
	stopNetwork(inst)
	if err := inst.Stop(ctx); err != nil {
		return err
	}
	fmt.Println("Stopped. Files and logins are kept; start again: happy-sandbox up")
	if inst.UnitEnabled(ctx) {
		fmt.Println("(It is enabled: it starts again with the host. Not wanted: happy-sandbox disable)")
	}
	return nil
}

// stopNetwork ends the network process (the gate closes, the TAP goes).
func stopNetwork(inst *sandbox.Instance) {
	if st, alive := inst.ReadStatus(); alive {
		_ = syscall.Kill(st.Pid, syscall.SIGTERM)
		for k := 0; k < 50; k++ {
			if _, a := inst.ReadStatus(); !a {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
}

func cmdStatus(ctx context.Context, args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	c := inst.Config
	cs := inst.State(ctx)
	fmt.Printf("sandbox %q  (%s)\n", c.Name, inst.Dir)
	state := "not created"
	if cs.Exists {
		state = "stopped"
	}
	if cs.Running {
		state = "running"
	}
	fmt.Printf("  container: %s, hostname %s, image %s\n", state, inst.Hostname(), c.Image)
	fmt.Printf("  access:    %s\n", c.Access.Describe())
	if len(c.Access.Packages) > 0 {
		fmt.Printf("  packages:  %s (installed at every up when missing)\n", strings.Join(c.Access.Packages, " "))
	}
	st, alive := inst.ReadStatus()
	switch {
	case st == nil || !alive:
		fmt.Println("  network:   down")
	case st.Gate == gate.GateOpen:
		fmt.Printf("  network:   open, exit %s (%s), checked %s\n", st.ExitIP, st.Country, st.CheckedAt.Format("15:04:05"))
	default:
		fmt.Printf("  network:   CLOSED (%s); expected exit %s, last seen %s\n", st.Reason, c.ExitIP, orDash(st.ExitIP))
	}
	for _, s := range c.Shares {
		mode := "rw"
		if s.ReadOnly {
			mode = "ro"
		}
		if s.Submounts {
			mode += ", with everything mounted below"
		}
		fmt.Printf("  share:     %s -> %s (%s)\n", s.Source, s.Target, mode)
	}
	if c.Access.HostHome() {
		fmt.Printf("  home:      the host's %s (rw)\n", inst.User().Home)
	}
	switch {
	case !inst.UnitEnabled(ctx):
		fmt.Println("  boot:      started by hand (happy-sandbox enable: start with the host)")
	case !sandbox.Lingering():
		fmt.Printf("  boot:      enabled, but only while you are logged in: sudo loginctl enable-linger %s\n", os.Getenv("USER"))
	default:
		fmt.Println("  boot:      starts with the host")
	}
	if cs.Running {
		out, _ := inst.AsUser(ctx, `if ! command -v happy >/dev/null; then echo "not installed"; elif [ -f "${HAPPY_HOME_DIR:-$HOME/.happy}/access.key" ]; then happy daemon status 2>/dev/null | grep -m1 -iE "running|not running" || echo "logged in"; else echo "not logged in (happy-sandbox shell, then: happy auth login)"; fi`)
		fmt.Printf("  happy:     %s\n", strings.TrimSpace(out))
	}
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// execInto replaces this process with an interactive podman exec as dev.
func execInto(inst *sandbox.Instance, command []string, dir string, interactive bool) error {
	bin, err := exec.LookPath(sandbox.Podman())
	if err != nil {
		return err
	}
	if dir == "" {
		dir = inst.User().Home
	}
	argv := []string{bin, "exec", "-i", "--user", "0", "-w", dir}
	tty := false
	if fi, _ := os.Stdin.Stat(); fi != nil && fi.Mode()&os.ModeCharDevice != 0 {
		argv = append(argv, "-t")
		tty = true
	}
	argv = append(argv, inst.Container())
	argv = append(argv, inst.EnterArgs(command, interactive && tty)...)
	return syscall.Exec(bin, argv, os.Environ())
}

func shellJoin(words []string) string {
	quoted := make([]string, len(words))
	for k, w := range words {
		quoted[k] = "'" + strings.ReplaceAll(w, "'", `'\''`) + "'"
	}
	return strings.Join(quoted, " ")
}

func cmdShell(args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	if !inst.State(context.Background()).Running {
		return errors.New("the sandbox is not running: happy-sandbox up")
	}
	return execInto(inst, nil, "", true)
}

func cmdExec(args []string) error {
	inst, rest, err := load(args)
	if err != nil {
		return err
	}
	if len(rest) > 0 && rest[0] == "--" {
		rest = rest[1:]
	}
	if len(rest) == 0 {
		return errors.New("exec needs a command: happy-sandbox exec -- CMD...")
	}
	if !inst.State(context.Background()).Running {
		return errors.New("the sandbox is not running: happy-sandbox up")
	}
	return execInto(inst, rest, "", false)
}

// cmdHere runs a command inside, in the sandbox path of the host's current
// directory, as if typed in a terminal there. access.tool_args are added for
// the tools they name (claude, codex: full access).
func cmdHere(ctx context.Context, args []string) error {
	inst, rest, err := load(args)
	if err != nil {
		return err
	}
	if len(rest) > 0 && rest[0] == "--" {
		rest = rest[1:]
	}
	if len(rest) == 0 {
		rest = []string{"bash"}
	}
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	if real, err := filepath.EvalSymlinks(cwd); err == nil {
		cwd = real
	}
	dir, ok := inst.MapHostPath(cwd)
	if !ok {
		if _, err := sandbox.CheckShare(sandbox.Share{Source: cwd}, nil); err != nil {
			return fmt.Errorf("%s is not visible in sandbox %q, and cannot be shared at its own path (%v); run from a shared directory", cwd, inst.Config.Name, err)
		}
		return fmt.Errorf("%s is not visible in sandbox %q: happy-sandbox share add %s --name %s, then happy-sandbox restart --name %s", cwd, inst.Config.Name, cwd, inst.Config.Name, inst.Config.Name)
	}
	if _, alive := inst.ReadStatus(); !alive || !inst.State(ctx).Running {
		fmt.Fprintf(os.Stderr, "Starting sandbox %q…\n", inst.Config.Name)
		if err := cmdUp(ctx, []string{"--name", inst.Config.Name}); err != nil {
			return err
		}
	}
	if extra := inst.Config.Access.ToolArgs[filepath.Base(rest[0])]; len(extra) > 0 && os.Getenv("HSB_SAFE") == "" {
		rest = append(append([]string{rest[0]}, extra...), rest[1:]...)
	}
	return execInto(inst, rest, dir, true)
}

func cmdShare(ctx context.Context, args []string) error {
	inst, rest, err := load(args)
	if err != nil {
		return err
	}
	if len(rest) == 0 || rest[0] == "list" {
		if len(inst.Config.Shares) == 0 {
			fmt.Println("no shares")
		}
		for _, s := range inst.Config.Shares {
			mode := "rw"
			if s.ReadOnly {
				mode = "ro"
			}
			if s.Submounts {
				mode += ", with everything mounted below"
			}
			fmt.Printf("%s -> %s (%s)\n", s.Source, s.Target, mode)
		}
		return nil
	}
	switch rest[0] {
	case "add":
		// share add SRC [TARGET] [--ro] [--submounts]
		var pos []string
		share := sandbox.Share{}
		for _, a := range rest[1:] {
			switch a {
			case "--ro":
				share.ReadOnly = true
			case "--submounts":
				share.Submounts = true
			default:
				pos = append(pos, a)
			}
		}
		if len(pos) < 1 || len(pos) > 2 {
			return errors.New("share add SRC [TARGET] [--ro] [--submounts]   (TARGET defaults to SRC's own path)")
		}
		share.Source = pos[0]
		if len(pos) == 2 {
			share.Target = pos[1]
		}
		s, err := sandbox.CheckShare(share, inst.Config.Shares)
		if err != nil {
			return err
		}
		inst.Config.Shares = append(inst.Config.Shares, s)
	case "rm":
		if len(rest) < 2 {
			return errors.New("share rm TARGET")
		}
		kept := []sandbox.Share{}
		found := false
		for _, s := range inst.Config.Shares {
			if s.Target == rest[1] {
				found = true
				continue
			}
			kept = append(kept, s)
		}
		if !found {
			return fmt.Errorf("no share at %s", rest[1])
		}
		inst.Config.Shares = kept
	default:
		return errors.New("share list | add SRC [TARGET] [--ro] [--submounts] | rm TARGET")
	}
	// Mounts are fixed when a container is created: it is recreated at the
	// next up. The home stays.
	if err := inst.Save(); err != nil {
		return err
	}
	if inst.State(ctx).Running {
		fmt.Println("Shares changed; apply them with: happy-sandbox restart (home, logins and data are kept).")
	} else {
		fmt.Println("Shares changed; they apply at the next `happy-sandbox up` (home, logins and data are kept).")
	}
	return nil
}

func cmdList(ctx context.Context) error {
	names, err := sandbox.List()
	if err != nil {
		return err
	}
	if len(names) == 0 {
		fmt.Println("no sandboxes: happy-sandbox init --node FILE --exit-ip IP")
	}
	for _, n := range names {
		inst, err := sandbox.Load(n)
		if err != nil {
			continue
		}
		st, alive := inst.ReadStatus()
		net := "down"
		if alive && st != nil {
			net = st.Gate
		}
		fmt.Printf("%-12s exit %-16s network %s\n", n, inst.Config.ExitIP, net)
	}
	return nil
}

// printChecks prints the prerequisites; returns how many are missing.
func printChecks(ctx context.Context) int {
	cs := sandbox.Prerequisites(ctx)
	for _, c := range cs {
		mark := "ok  "
		if !c.OK && c.Warn {
			mark = "warn"
		} else if !c.OK {
			mark = "FAIL"
		}
		line := fmt.Sprintf("  %s  %s", mark, c.Name)
		if c.Detail != "" {
			line += " (" + c.Detail + ")"
		}
		fmt.Println(line)
		if !c.OK {
			fmt.Println("        → " + c.Fix)
		}
	}
	bad := len(sandbox.PrerequisitesFailed(cs))
	if bad == 0 {
		fmt.Println("This host can run sandboxes.")
	}
	return bad
}

func printIdentity(inst *sandbox.Instance) {
	id := inst.Identity
	fmt.Printf("  identity (%s):\n", inst.IdentityPath())
	fmt.Printf("    hostname   %s\n    machine-id %s\n    mac        %s (gateway %s)\n    timezone   %s\n    locale     %s\n",
		id.Hostname, id.MachineID, id.MAC, id.GatewayMAC, id.Timezone, id.Locale)
}

func cmdIdentity(args []string) error {
	inst, rest, err := load(args)
	if err != nil {
		return err
	}
	if len(rest) > 0 {
		return cmdIdentitySet(inst, rest)
	}
	printIdentity(inst)
	fmt.Println(`
  Fixed at init, random, nothing taken from the host. The same file gives the
  same machine every time: restarts, host reboots, new images, a recreated
  container. Edit it (or restore a backup) and the next up applies it.
  Not in it: CPU, memory and kernel are the host's (shared by all sandboxes
  on this host; a container cannot change them); the public IP is the exit's;
  the IDs Claude Code, Codex and happy create live in the home and persist.`)
	return nil
}

// cmdIdentitySet: identity set hostname NAME|random, timezone TZ, locale L.
// identity.json changes; the next up recreates the container with it.
func cmdIdentitySet(inst *sandbox.Instance, rest []string) error {
	if len(rest) != 3 || rest[0] != "set" {
		return errors.New("identity [set hostname NAME|random | set mac random | set timezone TZ | set locale L]")
	}
	if inst.Identity == nil {
		return errors.New("this sandbox has no identity.json")
	}
	id := *inst.Identity
	switch key, val := rest[1], rest[2]; key {
	case "hostname":
		if val == "random" {
			val = sandbox.UniqueHostname(inst.Config.Name)
		} else if err := sandbox.CheckHostnameFree(val, inst.Config.Name); err != nil {
			return err
		}
		id.Hostname = val
	case "mac":
		if val != "random" {
			return errors.New("identity set mac random: a new NIC vendor's MAC (and gateway MAC)")
		}
		fresh := sandbox.NewIdentity(id.Hostname, id.Timezone, id.Locale)
		id.MAC, id.GatewayMAC = fresh.MAC, fresh.GatewayMAC
	case "timezone":
		id.Timezone = val
	case "locale":
		id.Locale = val
	default:
		return fmt.Errorf("identity set %s: hostname, mac, timezone or locale", key)
	}
	if err := inst.SaveIdentity(id); err != nil {
		return err
	}
	inst.Identity = &id
	printIdentity(inst)
	fmt.Println("\nSaved. It applies at the next start: happy-sandbox restart (home, logins and data are kept).")
	return nil
}

func cmdImage(ctx context.Context, args []string) error {
	switch {
	case len(args) == 2 && args[0] == "load":
		fmt.Println("Loading the image (a few minutes for ~2 GB)…")
		if err := sandbox.LoadImage(ctx, args[1]); err != nil {
			return err
		}
		fmt.Println("Loaded. Running sandboxes move to it at their next down / up; the home is kept.")
		return nil
	case len(args) == 1 && args[0] == "list":
		out, err := sandbox.ListImages(ctx)
		fmt.Print(out)
		return err
	}
	return errors.New("image load FILE | image list")
}

func cmdDestroy(ctx context.Context, args []string) error {
	inst, rest, err := load(args)
	if err != nil {
		return err
	}
	if len(rest) == 0 || rest[0] != "--yes" {
		return fmt.Errorf("this deletes sandbox %q for good: its container and %s (home, logins, identity). Run: happy-sandbox destroy --yes --name %s", inst.Config.Name, inst.Dir, inst.Config.Name)
	}
	if inst.UnitEnabled(ctx) {
		if err := inst.UnitStop(ctx); err != nil {
			return err
		}
		if err := inst.Disable(ctx); err != nil {
			return err
		}
	}
	stopNetwork(inst)
	if err := inst.Destroy(ctx); err != nil {
		return err
	}
	fmt.Printf("Sandbox %q deleted.\n", inst.Config.Name)
	return nil
}

func netServe(ctx context.Context, args []string) error {
	inst, _, err := load(args)
	if err != nil {
		return err
	}
	return inst.ServeNetwork(ctx)
}
