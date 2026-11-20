package sandbox

import (
	"strings"
	"testing"
)

// The label is a mount option in the third colon field. Appending it to the
// target instead made podman create a directory named "/mnt,Z" and the home
// stayed empty (0.1.2 on a CentOS host).
func TestMountSpecPutsTheLabelInTheOptionsField(t *testing.T) {
	i := &Instance{}
	if got, want := i.mountSpec("/h", "/home/dev", "", noLabel), "/h:/home/dev"; got != want {
		t.Fatalf("no SELinux: got %q, want %q", got, want)
	}
	i.selinux = true
	if got, want := i.mountSpec("/h", "/home/dev", "", privateLabel), "/h:/home/dev:Z"; got != want {
		t.Fatalf("private: got %q, want %q", got, want)
	}
	if got, want := i.mountSpec("/m", "/etc/machine-id", "ro", privateLabel), "/m:/etc/machine-id:ro,Z"; got != want {
		t.Fatalf("read-only private: got %q, want %q", got, want)
	}
	local := t.TempDir()
	if got, want := i.mountSpec(local, "/workspace/x", "rw", sharedLabel), local+":/workspace/x:rw,z"; got != want {
		t.Fatalf("local share: got %q, want %q", got, want)
	}
	if got, want := i.mountSpec(local, "/reference/x", "ro", sharedLabel), local+":/reference/x:ro,z"; got != want {
		t.Fatalf("read-only local share: got %q, want %q", got, want)
	}
	// A network share cannot be relabelled: no option, so no fourth field.
	if !relabelable(local) {
		t.Fatal("a local temporary directory must be relabelable")
	}
	if got, want := i.mountSpec("/net/share", "/workspace/n", "rw", noLabel), "/net/share:/workspace/n:rw"; got != want {
		t.Fatalf("unlabelled share: got %q, want %q", got, want)
	}
}

// No target ever carries the label; every option field is a valid option.
func TestMountSpecNeverAttachesTheLabelToTheTarget(t *testing.T) {
	i := &Instance{selinux: true}
	for _, spec := range []string{
		i.mountSpec("/h", "/home/dev", "", privateLabel),
		i.mountSpec("/m", "/etc/machine-id", "ro", privateLabel),
		i.mountSpec("/s", "/workspace/s", "rw", sharedLabel),
	} {
		parts := strings.Split(spec, ":")
		if len(parts) > 3 || strings.Contains(parts[1], ",") {
			t.Fatalf("%q: the target must not carry options", spec)
		}
		for _, opt := range strings.Split(strings.Join(parts[2:], ","), ",") {
			if opt == "" {
				continue
			}
			if opt != "ro" && opt != "rw" && opt != "z" && opt != "Z" {
				t.Fatalf("%q: %q is not an option", spec, opt)
			}
		}
	}
}
