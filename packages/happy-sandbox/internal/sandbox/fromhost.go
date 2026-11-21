package sandbox

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// from_host: files and directories of the host user's home lent to the
// sandbox at the same place in dev's home (~/.ssh -> /home/dev/.ssh,
// ~/.gitconfig -> /home/dev/.gitconfig), read-only unless written PATH:rw.
// For credentials and settings people would otherwise copy in (ssh keys, git
// and gh settings, cloud CLI logins). The sandbox stays as it is: its own
// home, its own Claude, Codex and happy and their logins; only the listed
// paths are the host's.

// FromHost is one entry of config.json's from_host.
type FromHost struct {
	Path string // relative to the home, clean
	RW   bool
}

func (f FromHost) String() string {
	if f.RW {
		return f.Path + ":rw"
	}
	return f.Path
}

// fromHostRefused: the sandbox's own tools and their state (its Claude,
// Codex, happy, Node and the installers' files), and the sandboxes
// themselves. Lending the host's would mix two installations and two logins.
var fromHostRefused = []string{".happy", ".happy-dist", ".happy-sandbox", ".claude", ".claude.json", ".codex", ".nvm", ".local", ".npm", ".cache"}

// ParseFromHost reads and checks one entry ("PATH" or "PATH:rw"; PATH
// relative to the home, a leading "~/" is accepted).
func ParseFromHost(v string) (FromHost, error) {
	f := FromHost{Path: v}
	if p, ok := strings.CutSuffix(v, ":rw"); ok {
		f = FromHost{Path: p, RW: true}
	} else if p, ok := strings.CutSuffix(v, ":ro"); ok {
		f.Path = p
	}
	f.Path = strings.TrimPrefix(f.Path, "~/")
	if f.Path == "" || filepath.IsAbs(f.Path) || filepath.Clean(f.Path) != f.Path || f.Path == "." ||
		f.Path == ".." || strings.HasPrefix(f.Path, "../") || strings.ContainsAny(f.Path, ":, \t\n") {
		return f, fmt.Errorf("from_host %q: a clean path inside your home, like .ssh or .config/gh (PATH or PATH:rw)", v)
	}
	first := strings.SplitN(f.Path, "/", 2)[0]
	for _, r := range fromHostRefused {
		if first == r || (r == ".happy" && strings.HasPrefix(first, ".happy")) || (r == ".claude" && strings.HasPrefix(first, ".claude")) {
			return f, fmt.Errorf("from_host %q: %s belongs to the sandbox itself (its own tools and logins)", v, first)
		}
	}
	src := filepath.Join(os.Getenv("HOME"), f.Path)
	for _, private := range privateHostDirs() {
		if src == private || strings.HasPrefix(private+"/", src+"/") || strings.HasPrefix(src+"/", private+"/") {
			return f, fmt.Errorf("from_host %q: would show the sandboxes' own files (%s), node credentials included", v, private)
		}
	}
	return f, nil
}

// privateHostDirs never reach a sandbox: the sandboxes (node files, the
// network sockets of every sandbox) and the image build's secrets.
func privateHostDirs() []string {
	build := os.Getenv("HSB_BUILD")
	if build == "" {
		build = filepath.Join(os.Getenv("HOME"), "build", "happy-sandbox-v2")
	}
	return []string{filepath.Clean(Home()), filepath.Join(filepath.Clean(build), "secrets")}
}

// CheckFromHost parses a whole from_host list (duplicates and nested entries
// refused: one mount per place).
func CheckFromHost(list []string) ([]FromHost, error) {
	var out []FromHost
	for _, v := range list {
		f, err := ParseFromHost(v)
		if err != nil {
			return nil, err
		}
		for _, e := range out {
			if e.Path == f.Path || strings.HasPrefix(f.Path+"/", e.Path+"/") || strings.HasPrefix(e.Path+"/", f.Path+"/") {
				return nil, fmt.Errorf("from_host %q overlaps %q", f.Path, e.Path)
			}
		}
		out = append(out, f)
	}
	return out, nil
}

// fromHostKey names the from_host mounts a container was made with ("-": none).
func fromHostKey(list []string) string {
	if len(list) == 0 {
		return "-"
	}
	return strings.Join(list, ",")
}

// fromHostMounts prepares the mount points in the sandbox's home (as the host
// user, so dev owns the parent directories; left to the runtime they would
// belong to container root) and returns the podman flags. An entry missing on
// the host is skipped and reported.
func (i *Instance) fromHostMounts() (args []string, skipped []string, err error) {
	list, err := CheckFromHost(i.Config.FromHost)
	if err != nil {
		return nil, nil, err
	}
	home := os.Getenv("HOME")
	for _, f := range list {
		src := filepath.Join(home, f.Path)
		st, statErr := os.Stat(src)
		if statErr != nil {
			skipped = append(skipped, f.Path)
			continue
		}
		dst := filepath.Join(i.HomeDir(), f.Path)
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, nil, err
		}
		if st.IsDir() {
			if err := os.MkdirAll(dst, 0o700); err != nil {
				return nil, nil, err
			}
		} else if _, e := os.Lstat(dst); errors.Is(e, os.ErrNotExist) {
			if err := os.WriteFile(dst, nil, 0o600); err != nil {
				return nil, nil, err
			}
		}
		mode := "ro"
		if f.RW {
			mode = "rw"
		}
		// No SELinux relabel: these are the host's own files (relabelling
		// ~/.ssh would break the host's sshd); see createArgs.
		args = append(args, "-v", src+":/home/dev/"+f.Path+":"+mode)
	}
	return args, skipped, nil
}
