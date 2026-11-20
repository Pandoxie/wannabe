package sandbox

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Identity is everything that makes a sandbox look like one particular
// machine, decided once at init and used for every container created from
// then on (restarts, recreation after share changes, image updates). It is
// a plain file: inspect it, back it up, edit it; restoring it restores the
// identity. Generated values are random; nothing is derived from the host.
//
// What it does not cover: the CPU model and count and the kernel version are
// the host's (a container cannot change them); the exit IP is the node's;
// happy's machine id, Claude Code's machineID / userID and the Codex login
// live in the home (home/), created by those tools on first use.
type Identity struct {
	Version    int       `json:"version"`
	MachineID  string    `json:"machine_id"` // /etc/machine-id, 32 hex
	MAC        string    `json:"mac"`        // the guest's network interface
	GatewayMAC string    `json:"gateway_mac"`
	Hostname   string    `json:"hostname"`
	Timezone   string    `json:"timezone"` // IANA, follows the exit region
	Locale     string    `json:"locale"`   // LANG
	CreatedAt  time.Time `json:"created_at"`
}

const (
	DefaultTimezone = "America/Los_Angeles"
	DefaultLocale   = "en_US.UTF-8"
)

var (
	machineIDRe = regexp.MustCompile(`^[0-9a-f]{32}$`)
	hostnameRe  = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)
	localeRe    = regexp.MustCompile(`^[a-z]{2}_[A-Z]{2}\.UTF-8$`)
)

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// randomMAC: locally administered, unicast.
func randomMAC() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	b[0] = (b[0] &^ 1) | 2
	return net.HardwareAddr(b).String()
}

func NewIdentity(hostname, timezone, locale string) Identity {
	if timezone == "" {
		timezone = DefaultTimezone
	}
	if locale == "" {
		locale = DefaultLocale
	}
	mac, gw := randomMAC(), randomMAC()
	for gw == mac {
		gw = randomMAC()
	}
	return Identity{Version: 1, MachineID: randomHex(16), MAC: mac, GatewayMAC: gw, Hostname: hostname,
		Timezone: timezone, Locale: locale, CreatedAt: time.Now().UTC().Truncate(time.Second)}
}

func (id Identity) Validate() error {
	if id.Version != 1 {
		return fmt.Errorf("identity version %d is not supported", id.Version)
	}
	if !machineIDRe.MatchString(id.MachineID) {
		return errors.New("identity: machine_id must be 32 lowercase hex digits")
	}
	for _, m := range []string{id.MAC, id.GatewayMAC} {
		hw, err := net.ParseMAC(m)
		if err != nil || len(hw) != 6 || hw[0]&1 != 0 || hw[0]&2 == 0 {
			return fmt.Errorf("identity: %q must be a locally administered unicast MAC", m)
		}
	}
	if id.MAC == id.GatewayMAC {
		return errors.New("identity: mac and gateway_mac must differ")
	}
	if !hostnameRe.MatchString(id.Hostname) {
		return fmt.Errorf("identity: hostname %q is not a valid host name", id.Hostname)
	}
	if _, err := time.LoadLocation(id.Timezone); err != nil {
		return fmt.Errorf("identity: unknown time zone %q", id.Timezone)
	}
	if !localeRe.MatchString(id.Locale) {
		return fmt.Errorf("identity: locale %q must look like en_US.UTF-8", id.Locale)
	}
	return nil
}

func (i *Instance) IdentityPath() string  { return i.path("identity.json") }
func (i *Instance) MachineIDPath() string { return i.path("machine-id") }

func (i *Instance) LoadIdentity() (Identity, error) {
	var id Identity
	data, err := os.ReadFile(i.IdentityPath())
	if err != nil {
		return id, err
	}
	if err := json.Unmarshal(data, &id); err != nil {
		return id, fmt.Errorf("%s: %v", i.IdentityPath(), err)
	}
	return id, id.Validate()
}

func (i *Instance) SaveIdentity(id Identity) error {
	if err := id.Validate(); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(id, "", "  ")
	if err := writePrivate(i.IdentityPath(), append(data, '\n')); err != nil {
		return err
	}
	// The file mounted read-only at /etc/machine-id: readable by every user
	// inside, as on any Linux machine (the sandbox directory itself is 0700).
	return writeFile(i.MachineIDPath(), []byte(id.MachineID+"\n"), 0o644)
}

// Hash identifies an identity's values (not its creation time): stored as a
// container label, so a changed identity.json recreates the container.
func (id Identity) Hash() string {
	id.CreatedAt = time.Time{}
	data, _ := json.Marshal(id)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}

func writePrivate(path string, data []byte) error { return writeFile(path, data, 0o600) }

func writeFile(path string, data []byte, mode os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, mode); err != nil {
		return err
	}
	if err := os.Chmod(tmp, mode); err != nil { // whatever the umask
		return err
	}
	return os.Rename(tmp, filepath.Clean(path))
}
