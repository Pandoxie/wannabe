package sandbox

import (
	"os"
	"strings"
	"testing"
)

func TestIdentityIsFixedOnceCreated(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	inst := &Instance{Config: Config{Name: "t"}, Dir: Dir("t")}
	if err := os.MkdirAll(inst.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	id := NewIdentity("host-sandbox", "", "")
	if id.Timezone != DefaultTimezone || id.Locale != DefaultLocale {
		t.Fatal("defaults", id)
	}
	if err := inst.SaveIdentity(id); err != nil {
		t.Fatal(err)
	}
	for k := 0; k < 3; k++ {
		got, err := inst.LoadIdentity()
		if err != nil || got != id {
			t.Fatal("identity changed on reload", got, err)
		}
	}
	data, _ := os.ReadFile(inst.MachineIDPath())
	if string(data) != id.MachineID+"\n" {
		t.Fatal("machine-id file", string(data))
	}
	other := NewIdentity("host-sandbox", "", "")
	if other.MachineID == id.MachineID || other.MAC == id.MAC {
		t.Fatal("two sandboxes got the same identity")
	}
}

func TestIdentityValidation(t *testing.T) {
	good := NewIdentity("h", "Asia/Tokyo", "ja_JP.UTF-8")
	if err := good.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*Identity){
		"machine id":    func(i *Identity) { i.MachineID = "XYZ" },
		"multicast mac": func(i *Identity) { i.MAC = "01:00:5e:00:00:01" },
		"global mac":    func(i *Identity) { i.MAC = "00:11:22:33:44:55" },
		"same macs":     func(i *Identity) { i.GatewayMAC = i.MAC },
		"timezone":      func(i *Identity) { i.Timezone = "Mars/Base" },
		"locale":        func(i *Identity) { i.Locale = "english" },
		"hostname":      func(i *Identity) { i.Hostname = "bad host" },
	} {
		id := good
		change(&id)
		if id.Validate() == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

func TestIdentityHashFollowsValuesNotCreationTime(t *testing.T) {
	a := NewIdentity("box", "", "")
	b := a
	b.CreatedAt = b.CreatedAt.Add(1e9)
	if a.Hash() != b.Hash() {
		t.Fatal("creation time changed the hash")
	}
	b.Timezone = "Asia/Tokyo"
	if a.Hash() == b.Hash() {
		t.Fatal("a new time zone must recreate the container")
	}
}

func TestCreateWritesIdentityAndMachineID(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	node := t.TempDir() + "/node.yaml"
	if err := os.WriteFile(node, []byte("proxies:\n  - {name: n, type: vless, server: example.com, port: 443, uuid: 00000000-0000-0000-0000-000000000000, tls: true}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	id := NewIdentity("box", "Asia/Tokyo", "ja_JP.UTF-8")
	if _, err := Create(Config{Name: "t1", ExitIP: "8.8.8.8"}, node, id); err != nil {
		t.Fatal(err)
	}
	inst, err := Load("t1")
	if err != nil {
		t.Fatal(err)
	}
	if inst.Identity.MachineID != id.MachineID || inst.Hostname() != "box" || inst.Identity.Locale != "ja_JP.UTF-8" {
		t.Fatalf("loaded %+v", inst.Identity)
	}
	data, _ := os.ReadFile(inst.MachineIDPath())
	st, _ := os.Stat(inst.MachineIDPath())
	if string(data) != id.MachineID+"\n" || st.Mode().Perm() != 0o644 {
		t.Fatalf("machine-id %q %v", data, st.Mode())
	}
	if _, err := Create(Config{Name: "t1", ExitIP: "8.8.8.8"}, node, NewIdentity("box", "", "")); err == nil {
		t.Fatal("Create overwrote an existing sandbox")
	}
}

func TestCheckHostPorts(t *testing.T) {
	got, err := CheckHostPorts([]int{22, 22, 8080})
	if err != nil || len(got) != 2 || got[0] != 22 || got[1] != 8080 {
		t.Fatalf("got %v, %v", got, err)
	}
	for _, bad := range [][]int{{0}, {65536}, {-1}} {
		if _, err := CheckHostPorts(bad); err == nil {
			t.Errorf("%v accepted", bad)
		}
	}
	if got, err := CheckHostPorts(nil); err != nil || got != nil {
		t.Fatalf("nil: %v, %v", got, err)
	}
}

func TestLimitsNoneUnlessWritten(t *testing.T) {
	var none Config
	if err := none.CheckLimits(); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(none.limitArgs(), " "); got != "--pids-limit -1" {
		t.Fatalf("no limits: %q", got)
	}
	set := Config{MemoryBytes: 8 << 30, CPUs: 2.5, PidsLimit: 8192}
	if got := strings.Join(set.limitArgs(), " "); got != "--memory 8589934592 --cpus 2.5 --pids-limit 8192" {
		t.Fatalf("limits: %q", got)
	}
	if none.limitsKey() == set.limitsKey() {
		t.Fatal("limits key does not change with the limits")
	}
	for _, bad := range []Config{{MemoryBytes: -1}, {MemoryBytes: 1 << 20}, {CPUs: -1}, {PidsLimit: 10}, {PidsLimit: -5}} {
		if err := bad.CheckLimits(); err == nil {
			t.Errorf("%+v accepted", bad)
		}
	}
}
