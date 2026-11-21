package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("HSB_HOME", "")
	t.Setenv("HSB_BUILD", "")
	return home
}

func TestParseFromHost(t *testing.T) {
	fakeHome(t)
	for v, want := range map[string]FromHost{
		".ssh":           {Path: ".ssh"},
		"~/.gitconfig":   {Path: ".gitconfig"},
		".config/gh:rw":  {Path: ".config/gh", RW: true},
		".aws:ro":        {Path: ".aws"},
		"projects/notes": {Path: "projects/notes"},
	} {
		got, err := ParseFromHost(v)
		if err != nil || got != want {
			t.Errorf("%q: got %+v, %v; want %+v", v, got, err, want)
		}
	}
	for _, v := range []string{"", ".", "..", "../x", "/etc/passwd", "a//b", "a/../b", "x:y", "my dir",
		// the sandbox's own tools and logins
		".happy", ".happy-dist", ".happy-sandbox", ".happy-sandbox/default/node.yaml", ".claude", ".claude.json",
		".claude-work", ".codex", ".codex/auth.json", ".nvm", ".local", ".local/bin", ".npm", ".cache",
		// the image build's secrets, or a directory holding them
		"build", "build/happy-sandbox-v2", "build/happy-sandbox-v2/secrets/node.yaml"} {
		if _, err := ParseFromHost(v); err == nil {
			t.Errorf("%q: accepted", v)
		}
	}
}

func TestFromHostRefusesTheSandboxesWhereverTheyLive(t *testing.T) {
	home := fakeHome(t)
	t.Setenv("HSB_HOME", filepath.Join(home, "sb"))
	t.Setenv("HSB_BUILD", filepath.Join(home, "work", "hsb"))
	for _, v := range []string{"sb", "sb/default", "work", "work/hsb/secrets"} {
		if _, err := ParseFromHost(v); err == nil {
			t.Errorf("%q: accepted", v)
		}
	}
	if _, err := ParseFromHost("work/hsb/bin"); err != nil {
		t.Errorf("work/hsb/bin: %v", err)
	}
}

func TestCheckFromHostRefusesOverlaps(t *testing.T) {
	fakeHome(t)
	if _, err := CheckFromHost([]string{".ssh", ".config/gh", ".gitconfig"}); err != nil {
		t.Fatal(err)
	}
	for _, l := range [][]string{{".ssh", ".ssh:rw"}, {".config", ".config/gh"}, {".config/gh", ".config"}} {
		if _, err := CheckFromHost(l); err == nil {
			t.Errorf("%v: accepted", l)
		}
	}
}

func TestFromHostMountsPreparesMountPointsAndSkipsMissing(t *testing.T) {
	home := fakeHome(t)
	os.MkdirAll(filepath.Join(home, ".ssh"), 0o700)
	os.MkdirAll(filepath.Join(home, ".config", "gh"), 0o700)
	os.WriteFile(filepath.Join(home, ".gitconfig"), []byte("[user]\n"), 0o644)
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "home"), 0o755)
	// The sandbox's own .gitconfig stays (covered while lent, not replaced).
	os.WriteFile(filepath.Join(dir, "home", ".gitconfig"), []byte("own"), 0o644)
	i := &Instance{Dir: dir, Config: Config{FromHost: []string{".ssh", ".gitconfig", ".config/gh:rw", ".aws"}}}
	args, skipped, err := i.fromHostMounts()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"-v", home + "/.ssh:/home/dev/.ssh:ro",
		"-v", home + "/.gitconfig:/home/dev/.gitconfig:ro",
		"-v", home + "/.config/gh:/home/dev/.config/gh:rw",
	}
	if strings.Join(args, " ") != strings.Join(want, " ") {
		t.Fatalf("args:\n got %q\nwant %q", args, want)
	}
	if len(skipped) != 1 || skipped[0] != ".aws" {
		t.Fatalf("skipped: %v", skipped)
	}
	if st, err := os.Stat(filepath.Join(dir, "home", ".config", "gh")); err != nil || !st.IsDir() {
		t.Fatalf("mount point .config/gh: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "home", ".gitconfig")); string(b) != "own" {
		t.Fatalf("the sandbox's own .gitconfig was touched: %q", b)
	}
}

func TestCreateArgsCarryFromHost(t *testing.T) {
	fakeHome(t)
	i := &Instance{Dir: t.TempDir(), Config: Config{Name: "t", FromHost: []string{".ssh"}}, Identity: &Identity{Hostname: "h"}}
	mounts := []string{"-v", "/h/.ssh:/home/dev/.ssh:ro"}
	args := strings.Join(i.createArgs("/s.json", nil, mounts), " ")
	if !strings.Contains(args, "--label "+fromHostLabel+"=.ssh") || !strings.Contains(args, "/h/.ssh:/home/dev/.ssh:ro") {
		t.Fatalf("from_host missing: %s", args)
	}
	if strings.Contains(args, "label=disable") {
		t.Fatal("label=disable without SELinux")
	}
	i.selinux = true
	if args := strings.Join(i.createArgs("/s.json", nil, mounts), " "); !strings.Contains(args, "--security-opt label=disable") {
		t.Fatalf("SELinux host with from_host must disable labels: %s", args)
	}
	if args := strings.Join(i.createArgs("/s.json", nil, nil), " "); strings.Contains(args, "label=disable") {
		t.Fatal("label=disable without from_host")
	}
	i.Config.FromHost = nil
	if args := strings.Join(i.createArgs("/s.json", nil, nil), " "); !strings.Contains(args, "--label "+fromHostLabel+"=-") {
		t.Fatalf("empty from_host label: %s", args)
	}
}

func TestShareAtItsOwnHostPath(t *testing.T) {
	// Not under /tmp (a guest system directory): next to the package.
	wd, _ := os.Getwd()
	home, err := os.MkdirTemp(wd, ".test-home-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(home) })
	t.Setenv("HOME", home)
	t.Setenv("HSB_HOME", "")
	t.Setenv("HSB_BUILD", "")
	proj := filepath.Join(home, "proj")
	os.MkdirAll(proj, 0o755)
	s, err := CheckShare(Share{Source: proj, Target: proj}, nil)
	if err != nil || s.Target != proj {
		t.Fatalf("own path: %+v, %v", s, err)
	}
	if _, err := CheckShare(Share{Source: proj, Target: "/workspace/proj"}, nil); err != nil {
		t.Fatalf("/workspace: %v", err)
	}
	// Another path than the source's, outside /workspace and /reference.
	if _, err := CheckShare(Share{Source: proj, Target: "/data/proj"}, nil); err == nil {
		t.Fatal("a target that is neither /workspace, /reference nor the source's path was accepted")
	}
	// The source's own path inside the guest system.
	for _, p := range []string{"/tmp", "/var", "/opt", "/srv"} {
		if hostPathTarget(p + "/x") {
			t.Errorf("%s/x accepted as a host path target", p)
		}
	}
	for _, p := range []string{"/home/dev/x", "/home", "/mnt", "/"} {
		if hostPathTarget(p) {
			t.Errorf("%s accepted as a host path target", p)
		}
	}
	for _, p := range []string{"/home/me/proj", "/mnt/data", "/media/me/disk", "/data/x"} {
		if !hostPathTarget(p) {
			t.Errorf("%s refused as a host path target", p)
		}
	}
	// The sandboxes and the build secrets never, whatever the target.
	os.MkdirAll(filepath.Join(home, "build", "happy-sandbox-v2", "secrets"), 0o700)
	for _, src := range []string{filepath.Join(home, "build"), filepath.Join(home, "build", "happy-sandbox-v2")} {
		if _, err := CheckShare(Share{Source: src, Target: "/workspace/b"}, nil); err == nil {
			t.Errorf("%s accepted", src)
		}
	}
	os.MkdirAll(filepath.Join(home, ".happy-sandbox", "default"), 0o700)
	if _, err := CheckShare(Share{Source: filepath.Join(home, ".happy-sandbox"), Target: "/workspace/s"}, nil); err == nil {
		t.Error("~/.happy-sandbox accepted")
	}
}
