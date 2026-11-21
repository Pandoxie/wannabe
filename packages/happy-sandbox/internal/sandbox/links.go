package sandbox

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// The commands of a numbered sandbox N, small scripts in ~/.local/bin: each
// runs its tool inside sandbox N, in the host's current directory
// (happy-sandbox here). claudeN / codexN get access.tool_args (full access),
// happyN gets --yolo; HSB_SAFE=1 leaves both out.

// linkMark is in every script happy-sandbox writes: only those it replaces or
// deletes, never a file of the user's with the same name.
const linkMark = "# happy-sandbox: command of sandbox "

// LinkTools are the commands of a numbered sandbox, as <tool><N>.
var LinkTools = []string{"claude", "codex", "happy", "shell"}

// BinDir is where the commands go: $HSB_BIN_DIR, else ~/.local/bin.
func BinDir() string {
	if d := os.Getenv("HSB_BIN_DIR"); d != "" {
		return d
	}
	return filepath.Join(os.Getenv("HOME"), ".local", "bin")
}

// selfCommand is how the scripts call happy-sandbox: the installed binary
// (~/.happy-sandbox/bin) by its path, anything else through PATH.
func selfCommand() string {
	self, err := os.Executable()
	if err == nil {
		if real, err := filepath.EvalSymlinks(self); err == nil {
			self = real
		}
		if filepath.Dir(self) == filepath.Join(Home(), "bin") {
			return shellQuote(self)
		}
	}
	return "happy-sandbox"
}

func linkScript(tool, name string) string {
	var b strings.Builder
	b.WriteString("#!/bin/bash\n" + linkMark + name + " (happy-sandbox links " + name + " writes it again)\n")
	here := "exec " + selfCommand() + " here " + name + " --"
	switch tool {
	case "shell":
		b.WriteString("# A shell, or the command given, inside sandbox " + name + ", in this directory.\n")
		b.WriteString("[ $# -gt 0 ] || set -- bash\n" + here + ` "$@"` + "\n")
	case "happy":
		b.WriteString("# happy inside sandbox " + name + " (a Claude session, or: happy" + name + " codex), in this\n")
		b.WriteString("# directory, without permission prompts (HSB_SAFE=1: with them).\n")
		b.WriteString(`if [ -z "${HSB_SAFE:-}" ]; then
    case "${1:-}" in
        "" | -*) set -- --yolo "$@" ;;
        claude | codex) t="$1"; shift; set -- "$t" --yolo "$@" ;;
    esac
fi
`)
		b.WriteString(here + ` happy "$@"` + "\n")
	default:
		b.WriteString("# " + tool + " inside sandbox " + name + ", in this directory (full access: access.tool_args;\n")
		b.WriteString("# HSB_SAFE=1 keeps the permission prompts).\n")
		b.WriteString(here + " " + tool + ` "$@"` + "\n")
	}
	return b.String()
}

// ours: the file is a command happy-sandbox wrote for sandbox name.
func ours(path, name string) bool {
	data, err := os.ReadFile(path)
	return err == nil && bytes.Contains(data, []byte(linkMark+name+" "))
}

// WriteLinks writes the commands of numbered sandbox name. A file of the
// same name that happy-sandbox did not write stays: it is in skipped.
func WriteLinks(name string) (written, skipped []string, err error) {
	if !IsNumber(name) {
		return nil, nil, nil
	}
	if err := os.MkdirAll(BinDir(), 0o755); err != nil {
		return nil, nil, err
	}
	for _, t := range LinkTools {
		p := filepath.Join(BinDir(), t+name)
		if _, e := os.Lstat(p); e == nil && !ours(p, name) {
			skipped = append(skipped, p)
			continue
		}
		tmp := p + ".hsb-tmp"
		if err := os.WriteFile(tmp, []byte(linkScript(t, name)), 0o755); err != nil {
			return written, skipped, err
		}
		if err := os.Rename(tmp, p); err != nil {
			os.Remove(tmp)
			return written, skipped, err
		}
		written = append(written, t+name)
	}
	return written, skipped, nil
}

// RemoveLinks deletes the commands happy-sandbox wrote for sandbox name.
func RemoveLinks(name string) ([]string, error) {
	var removed []string
	for _, t := range LinkTools {
		p := filepath.Join(BinDir(), t+name)
		if !ours(p, name) {
			continue
		}
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return removed, err
		}
		removed = append(removed, t+name)
	}
	return removed, nil
}

// BinDirInPath: the commands are found without a path.
func BinDirInPath() bool {
	for _, d := range filepath.SplitList(os.Getenv("PATH")) {
		if filepath.Clean(d) == filepath.Clean(BinDir()) {
			return true
		}
	}
	return false
}
