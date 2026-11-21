package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultAndNextNumber(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	node := writeTestNode(t)
	if DefaultName() != "1" || NextNumber() != "1" {
		t.Fatalf("empty: default %q, next %q", DefaultName(), NextNumber())
	}
	if _, err := Create(Config{Name: LegacyName, ExitIP: "8.8.8.8"}, node, NewIdentity("ws-aaa222", "", "")); err != nil {
		t.Fatal(err)
	}
	if DefaultName() != LegacyName {
		t.Fatalf("with only the older default: %q", DefaultName())
	}
	for _, n := range []string{"1", "3"} {
		if _, err := Create(Config{Name: n, ExitIP: "8.8.8.8"}, node, NewIdentity("ws-aaa22"+n, "", "")); err != nil {
			t.Fatal(err)
		}
	}
	if DefaultName() != "1" || NextNumber() != "2" {
		t.Fatalf("default %q, next %q", DefaultName(), NextNumber())
	}
	for name, want := range map[string]bool{"1": true, "12": true, "0": false, "01": false, "default": false, "1a": false} {
		if IsNumber(name) != want {
			t.Errorf("IsNumber(%q) = %v", name, !want)
		}
	}
}

func TestHappyMachineName(t *testing.T) {
	host := HostShortName()
	for _, c := range []struct{ name, set, want string }{
		{"2", "", host + "-2"},
		{"work", "", ""},
		{"2", "Studio", "Studio"},
		{"2", "none", ""},
	} {
		i := &Instance{Config: Config{Name: c.name, MachineName: c.set}}
		if got := i.HappyMachineName(); got != c.want {
			t.Errorf("%s/%q: %q, want %q", c.name, c.set, got, c.want)
		}
	}
	i := &Instance{Dir: t.TempDir(), Config: Config{Name: "2"}}
	if err := i.writeGuestFiles(); err != nil {
		t.Fatal(err)
	}
	env, _ := os.ReadFile(filepath.Join(i.Dir, "guest", "env.sh"))
	if !strings.Contains(string(env), "export HAPPY_MACHINE_NAME='"+host+"-2'") {
		t.Fatalf("env.sh:\n%s", env)
	}
}

func TestLinks(t *testing.T) {
	bin := t.TempDir()
	t.Setenv("HSB_BIN_DIR", bin)
	// The user's own codex2 (another Codex account) stays.
	mine := filepath.Join(bin, "codex2")
	os.WriteFile(mine, []byte("#!/bin/bash\nexec codex \"$@\"\n"), 0o755)
	written, skipped, err := WriteLinks("2")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(written, " ") != "claude2 happy2 shell2" || len(skipped) != 1 || skipped[0] != mine {
		t.Fatalf("written %q, skipped %q", written, skipped)
	}
	if data, _ := os.ReadFile(mine); strings.Contains(string(data), linkMark) {
		t.Fatal("the user's codex2 was replaced")
	}
	for _, c := range written {
		p := filepath.Join(bin, c)
		if out, err := exec.Command("bash", "-n", p).CombinedOutput(); err != nil {
			t.Fatalf("%s: %v %s", c, err, out)
		}
	}
	claude, _ := os.ReadFile(filepath.Join(bin, "claude2"))
	if !strings.Contains(string(claude), `here --name 2 -- claude "$@"`) {
		t.Fatalf("claude2:\n%s", claude)
	}
	// Sandbox 12's commands are not sandbox 2's: removing 12 leaves 2.
	if _, _, err := WriteLinks("12"); err != nil {
		t.Fatal(err)
	}
	if removed, _ := RemoveLinks("12"); len(removed) != 4 {
		t.Fatalf("removed %q", removed)
	}
	if _, err := os.Stat(filepath.Join(bin, "claude2")); err != nil {
		t.Fatal(err)
	}
	if removed, _ := RemoveLinks("2"); strings.Join(removed, " ") != "claude2 happy2 shell2" {
		t.Fatalf("removed %q", removed)
	}
	if _, err := os.Stat(mine); err != nil {
		t.Fatal("the user's codex2 was removed")
	}
	if w, _, _ := WriteLinks("work"); len(w) != 0 {
		t.Fatal("commands for a name that is not a number")
	}
}

// happyN puts --yolo where happy reads it: before the arguments of a Claude
// session, after the codex / claude subcommand; nothing with HSB_SAFE.
func TestHappyLinkArguments(t *testing.T) {
	bin := t.TempDir()
	t.Setenv("HSB_BIN_DIR", bin)
	if _, _, err := WriteLinks("3"); err != nil {
		t.Fatal(err)
	}
	// A fake happy-sandbox that prints its arguments.
	fake := t.TempDir()
	os.WriteFile(filepath.Join(fake, "happy-sandbox"), []byte("#!/bin/bash\necho \"$*\"\n"), 0o755)
	for _, c := range []struct {
		args []string
		safe bool
		want string
	}{
		{nil, false, "here --name 3 -- happy --yolo"},
		{[]string{"--resume"}, false, "here --name 3 -- happy --yolo --resume"},
		{[]string{"codex", "-m", "x"}, false, "here --name 3 -- happy codex --yolo -m x"},
		{[]string{"auth", "login"}, false, "here --name 3 -- happy auth login"},
		{nil, true, "here --name 3 -- happy"},
	} {
		cmd := exec.Command(filepath.Join(bin, "happy3"), c.args...)
		cmd.Env = append(os.Environ(), "PATH="+fake+":"+os.Getenv("PATH"))
		if c.safe {
			cmd.Env = append(cmd.Env, "HSB_SAFE=1")
		}
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatal(err, string(out))
		}
		if got := strings.TrimSpace(string(out)); got != c.want {
			t.Errorf("happy3 %q: %q, want %q", c.args, got, c.want)
		}
	}
}
