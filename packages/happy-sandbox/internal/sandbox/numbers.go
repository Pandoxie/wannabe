package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Sandboxes are numbered: 1, 2, 3…, the lowest free number first. The number
// is the name (~/.happy-sandbox/1), the commands are claude1, codex1, happy1,
// shell1 (links.go), and the Happy app shows the sandbox as <host>-1. There
// are no other names: a sandbox from before numbering (default) is moved to
// the next free number.

var numberRe = regexp.MustCompile(`^[1-9][0-9]{0,3}$`)

// IsNumber: a numbered sandbox's name.
func IsNumber(name string) bool { return numberRe.MatchString(name) }

// NextNumber is the lowest number no sandbox has (nor a leftover directory).
func NextNumber() string {
	for n := 1; ; n++ {
		if _, err := os.Stat(Dir(strconv.Itoa(n))); errors.Is(err, os.ErrNotExist) {
			return strconv.Itoa(n)
		}
	}
}

// HostShortName is the host's name up to the first dot.
func HostShortName() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "host"
	}
	h, _, _ = strings.Cut(h, ".")
	return h
}

// HappyMachineName is HAPPY_MACHINE_NAME for the sandbox: the host's short
// name and the number (ls5-1); "" for a sandbox from before numbering.
func (i *Instance) HappyMachineName() string {
	if !IsNumber(i.Config.Name) {
		return ""
	}
	return HostShortName() + "-" + i.Config.Name
}

// Rename moves a stopped sandbox from before numbering to its number: its
// directory (home, logins, identity, packages) and config.json. The
// container goes; the next up creates it under the new name. The caller
// stops the sandbox and moves its systemd unit and commands.
func (i *Instance) Rename(ctx context.Context, name string) (*Instance, error) {
	if err := ValidName(name); err != nil {
		return nil, err
	}
	if name == i.Config.Name {
		return nil, fmt.Errorf("sandbox %q already has that name", name)
	}
	if _, err := os.Stat(Dir(name)); err == nil {
		return nil, fmt.Errorf("%s already exists", Dir(name))
	}
	if i.State(ctx).Running {
		return nil, fmt.Errorf("sandbox %q is running: stop it first", i.Config.Name)
	}
	if _, alive := i.ReadStatus(); alive {
		return nil, fmt.Errorf("the network of sandbox %q is still running", i.Config.Name)
	}
	if err := i.Remove(ctx); err != nil {
		return nil, err
	}
	if err := os.Rename(i.Dir, Dir(name)); err != nil {
		return nil, err
	}
	n, err := Load(name)
	if err != nil {
		return nil, err
	}
	n.Config.Name = name
	return n, n.Save()
}
