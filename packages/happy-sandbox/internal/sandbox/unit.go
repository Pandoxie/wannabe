package sandbox

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
)

// Starting with the host: a systemd user unit per sandbox,
// happy-sandbox@<name>.service, runs `happy-sandbox run` — the container and
// its network process in the foreground — and restarts it when it fails.
// Lingering (loginctl enable-linger) starts the user's units at boot, without
// a login.

const unitTemplate = "happy-sandbox@.service"

func unitDir() string {
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		return filepath.Join(d, "systemd", "user")
	}
	return filepath.Join(os.Getenv("HOME"), ".config", "systemd", "user")
}

func (i *Instance) Unit() string { return "happy-sandbox@" + i.Config.Name + ".service" }

// unitText: the container's monitor (conmon) lands in this unit's cgroup,
// so KillMode=process: a failed network process is restarted alone and the
// container keeps running; only an explicit stop (ExecStop) stops the
// container, gracefully, before the network process gets SIGTERM. The
// development variables (another home, podman, mihomo) are kept if set.
func unitText(self string) string {
	var env strings.Builder
	for _, k := range []string{"HSB_HOME", "HSB_PODMAN", "HSB_MIHOMO"} {
		if v := os.Getenv(k); v != "" {
			fmt.Fprintf(&env, "Environment=%s=%s\n", k, v)
		}
	}
	return fmt.Sprintf(`# Written by happy-sandbox enable; removed by happy-sandbox disable.
[Unit]
Description=happy-sandbox %%i (a sandbox whose only way out is one exit)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
%sExecStart=%s run --name %%i
ExecStop=%s stop-container --name %%i
KillMode=process
Restart=on-failure
RestartSec=15
TimeoutStopSec=60

[Install]
WantedBy=default.target
`, env.String(), self, self)
}

// ErrNoUserManager: this user's systemd is not running (no login session,
// no lingering), so there is nothing systemctl --user could talk to.
type ErrNoUserManager struct{ User, Dir string }

func (e ErrNoUserManager) Error() string {
	return fmt.Sprintf("the systemd user manager of %s is not running (%s does not exist: no login session and no lingering).\n"+
		"Start it once and keep it across logouts and reboots: sudo loginctl enable-linger %s", e.User, e.Dir, e.User)
}

// userBusEnv gives systemctl --user what it needs to find this user's
// systemd. A shell from `su - user` or `sudo -iu user` has neither
// XDG_RUNTIME_DIR nor DBUS_SESSION_BUS_ADDRESS; the manager is still there,
// at /run/user/<uid>/bus, so fill in what is missing (for the child only).
func userBusEnv(env []string, uid int, userName string, exists func(string) bool) ([]string, error) {
	get := func(k string) string {
		for _, kv := range env {
			if strings.HasPrefix(kv, k+"=") {
				return kv[len(k)+1:]
			}
		}
		return ""
	}
	runtimeDir, bus := get("XDG_RUNTIME_DIR"), get("DBUS_SESSION_BUS_ADDRESS")
	if runtimeDir != "" && bus != "" {
		return env, nil
	}
	dir := fmt.Sprintf("/run/user/%d", uid)
	if runtimeDir != "" {
		dir = runtimeDir
	}
	if !exists(dir + "/bus") {
		return env, ErrNoUserManager{User: userName, Dir: dir + "/bus"}
	}
	out := append([]string{}, env...)
	if runtimeDir == "" {
		out = append(out, "XDG_RUNTIME_DIR="+dir)
	}
	if bus == "" {
		out = append(out, "DBUS_SESSION_BUS_ADDRESS=unix:path="+dir+"/bus")
	}
	return out, nil
}

func systemctlCommand(ctx context.Context, args ...string) (*exec.Cmd, error) {
	name := "this user"
	if u, err := user.Current(); err == nil {
		name = u.Username
	}
	env, err := userBusEnv(os.Environ(), os.Getuid(), name, func(p string) bool { _, err := os.Stat(p); return err == nil })
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, "systemctl", append([]string{"--user"}, args...)...)
	cmd.Env = env
	return cmd, nil
}

func systemctl(ctx context.Context, args ...string) (string, error) {
	cmd, err := systemctlCommand(ctx, args...)
	if err != nil {
		return "", err
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("systemctl --user %s: %v: %s", strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// UnitEnabled: the sandbox starts with the host (and up/down go through
// systemd). Without a reachable user manager the answer comes from the
// enablement link on disk, so up/down still take the systemd path and say
// why it cannot run, instead of quietly starting the sandbox by hand.
func (i *Instance) UnitEnabled(ctx context.Context) bool {
	cmd, err := systemctlCommand(ctx, "is-enabled", i.Unit())
	if err != nil {
		_, statErr := os.Lstat(filepath.Join(unitDir(), "default.target.wants", i.Unit()))
		return statErr == nil
	}
	out, _ := cmd.Output()
	return strings.TrimSpace(string(out)) == "enabled"
}

func Lingering() bool {
	u, err := user.Current()
	if err != nil {
		return false
	}
	_, err = os.Stat("/var/lib/systemd/linger/" + u.Username)
	return err == nil
}

// Enable installs the unit template (again: the binary may have moved) and
// enables this sandbox's unit. It does not start it.
func (i *Instance) Enable(ctx context.Context) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if self, err = filepath.EvalSymlinks(self); err != nil {
		return err
	}
	if err := os.MkdirAll(unitDir(), 0o755); err != nil {
		return err
	}
	if err := writeFile(filepath.Join(unitDir(), unitTemplate), []byte(unitText(self)), 0o644); err != nil {
		return err
	}
	if _, err := systemctl(ctx, "daemon-reload"); err != nil {
		return err
	}
	_, err = systemctl(ctx, "enable", i.Unit())
	return err
}

// Disable: the sandbox no longer starts with the host. The template stays
// while other sandboxes may use it.
func (i *Instance) Disable(ctx context.Context) error {
	_, err := systemctl(ctx, "disable", i.Unit())
	return err
}

func (i *Instance) UnitStart(ctx context.Context) error {
	_, err := systemctl(ctx, "start", i.Unit())
	return err
}

func (i *Instance) UnitStop(ctx context.Context) error {
	_, err := systemctl(ctx, "stop", i.Unit())
	return err
}
