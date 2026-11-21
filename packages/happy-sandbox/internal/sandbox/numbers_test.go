package sandbox

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNextNumberFillsGaps(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	node := writeTestNode(t)
	if NextNumber() != "1" {
		t.Fatalf("empty: next %q", NextNumber())
	}
	for _, n := range []string{"1", "3"} {
		if _, err := Create(Config{Name: n, ExitIP: "8.8.8.8"}, node, NewIdentity("ws-aaa22"+n, "", "")); err != nil {
			t.Fatal(err)
		}
	}
	if NextNumber() != "2" {
		t.Fatalf("next %q, want the free 2", NextNumber())
	}
	for name, want := range map[string]bool{"1": true, "12": true, "0": false, "01": false, "default": false, "1a": false, "12345": false} {
		if IsNumber(name) != want {
			t.Errorf("IsNumber(%q) = %v", name, !want)
		}
	}
}

func TestHappyMachineName(t *testing.T) {
	host := HostShortName()
	if got := (&Instance{Config: Config{Name: "2"}}).HappyMachineName(); got != host+"-2" {
		t.Errorf("sandbox 2: %q", got)
	}
	if got := (&Instance{Config: Config{Name: "default"}}).HappyMachineName(); got != "" {
		t.Errorf("default: %q", got)
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

// A sandbox from before numbering moves to its number with everything in it.
func TestRenameKeepsTheSandbox(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	t.Setenv("HSB_PODMAN", "/bin/false") // no container: State says it does not exist
	inst, err := Create(Config{Name: "default", ExitIP: "8.8.8.8"}, writeTestNode(t), NewIdentity("ws-aaa229", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(inst.StateDir("claude"), 0o700)
	os.WriteFile(filepath.Join(inst.StateDir("claude"), "login"), []byte("x"), 0o600)
	n, err := inst.Rename(context.Background(), NextNumber())
	if err != nil {
		t.Fatal(err)
	}
	if n.Config.Name != "1" || n.Identity.Hostname != "ws-aaa229" {
		t.Fatalf("renamed: %+v %+v", n.Config, n.Identity)
	}
	if _, err := os.Stat(filepath.Join(n.StateDir("claude"), "login")); err != nil {
		t.Fatal("login lost:", err)
	}
	if again, err := Load("1"); err != nil || again.Config.Name != "1" {
		t.Fatalf("load 1: %v", err)
	}
	if _, err := os.Stat(Dir("default")); err == nil {
		t.Fatal("default is still there")
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
	if !strings.Contains(string(claude), `here 2 -- claude "$@"`) {
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
		{nil, false, "here 3 -- happy --yolo"},
		{[]string{"--resume"}, false, "here 3 -- happy --yolo --resume"},
		{[]string{"codex", "-m", "x"}, false, "here 3 -- happy codex --yolo -m x"},
		{[]string{"auth", "login"}, false, "here 3 -- happy auth login"},
		{nil, true, "here 3 -- happy"},
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
