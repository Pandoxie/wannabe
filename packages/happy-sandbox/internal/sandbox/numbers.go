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

// Sandboxes are numbered: 1, 2, 3… The number is the name (~/.happy-sandbox/1),
// the commands are claude1, codex1, happy1, shell1 (links.go), and the Happy
// app shows the sandbox as <host>-1.

var numberRe = regexp.MustCompile(`^[1-9][0-9]{0,3}$`)

// IsNumber: a numbered sandbox's name.
func IsNumber(name string) bool { return numberRe.MatchString(name) }

// LegacyName is the sandbox name before numbering.
const LegacyName = "default"

func sandboxExists(name string) bool {
	_, err := os.Stat(Dir(name) + "/config.json")
	return err == nil
}

// DefaultName is the sandbox a command without --name means: 1, or the older
// "default" while there is no 1.
func DefaultName() string {
	if !sandboxExists("1") && sandboxExists(LegacyName) {
		return LegacyName
	}
	return "1"
}

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

// HappyMachineName is HAPPY_MACHINE_NAME for the sandbox ("" sets none).
func (i *Instance) HappyMachineName() string {
	switch n := strings.TrimSpace(i.Config.MachineName); {
	case n == "none":
		return ""
	case n != "":
		return n
	case IsNumber(i.Config.Name):
		return HostShortName() + "-" + i.Config.Name
	}
	return ""
}

// Rename moves a stopped sandbox to a new name: its directory (home, logins,
// identity, packages) and config.json. The container goes; the next up
// creates it under the new name. The caller stops the sandbox and moves its
// systemd unit and command links.
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
		return nil, fmt.Errorf("sandbox %q is running: happy-sandbox down --name %s first", i.Config.Name, i.Config.Name)
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
