package sandbox

import (
	"net"
	"os"
	"regexp"
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

// A generated identity looks like an ordinary machine: a NIC vendor's MAC
// (not a locally administered one), a workstation's host name, unique here.
func TestIdentityLooksOrdinary(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	for k := 0; k < 50; k++ {
		id := NewIdentity(UniqueHostname("t"), "", "")
		if err := id.Validate(); err != nil {
			t.Fatal(err)
		}
		hw, _ := net.ParseMAC(id.MAC)
		if hw[0]&2 != 0 || hw[0]&1 != 0 {
			t.Fatalf("mac %s is locally administered or multicast", id.MAC)
		}
		known := false
		for _, v := range nicVendors {
			known = known || (hw[0] == v[0] && hw[1] == v[1] && hw[2] == v[2])
		}
		if !known {
			t.Fatalf("mac %s is no NIC vendor's", id.MAC)
		}
		if !regexp.MustCompile(`^(ws|dev|pc)-[a-z2-9]{6}$`).MatchString(id.Hostname) || strings.Contains(id.Hostname, "sandbox") {
			t.Fatalf("hostname %q", id.Hostname)
		}
	}
}

func TestHostnameUniqueOnTheHost(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	node := writeTestNode(t)
	if _, err := Create(Config{Name: "a", ExitIP: "8.8.8.8"}, node, NewIdentity("ws-abc234", "", "")); err != nil {
		t.Fatal(err)
	}
	if who := HostnameTaken("WS-ABC234", "b"); who != "sandbox a" {
		t.Fatalf("taken by %q", who)
	}
	if who := HostnameTaken("ws-abc234", "a"); who != "" {
		t.Fatalf("a's own name counted as taken: %q", who)
	}
	if err := CheckHostnameFree("ws-abc234", "b"); err == nil {
		t.Fatal("a second sandbox got the same name")
	}
	if h, _ := os.Hostname(); CheckHostnameFree(h, "b") == nil {
		t.Fatal("the host's own name accepted")
	}
	if h := UniqueHostname("b"); h == "ws-abc234" || CheckHostnameFree(h, "b") != nil {
		t.Fatalf("unique: %q", h)
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
		"short mac":     func(i *Identity) { i.MAC = "00:11:22:33:44" },
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

// The older top-level limits still apply where access.resources is silent.
func TestLegacyLimits(t *testing.T) {
	var none Config
	if err := none.CheckLimits(); err != nil {
		t.Fatal(err)
	}
	r := Resources{Shm: "1G", Ulimits: "podman"}
	set := &Instance{Config: Config{MemoryBytes: 8 << 30, CPUs: 2.5, PidsLimit: 8192, Access: Access{Resources: r}}}
	if got := strings.Join(set.resourceArgs(), " "); got != "--memory 8589934592 --pids-limit 8192 --cpus 2.5 --shm-size 1073741824" {
		t.Fatalf("limits: %q", got)
	}
	r.Memory, r.Pids, r.CPUs = "4G", "max", "all"
	set.Config.Access.Resources = r
	if got := strings.Join(set.resourceArgs(), " "); got != "--memory 4294967296 --pids-limit -1 --shm-size 1073741824" {
		t.Fatalf("access wins: %q", got)
	}
	for _, bad := range []Config{{MemoryBytes: -1}, {MemoryBytes: 1 << 20}, {CPUs: -1}, {PidsLimit: 10}, {PidsLimit: -5}} {
		if err := bad.CheckLimits(); err == nil {
			t.Errorf("%+v accepted", bad)
		}
	}
}

func writeTestNode(t *testing.T) string {
	t.Helper()
	node := t.TempDir() + "/node.yaml"
	if err := os.WriteFile(node, []byte("proxies:\n  - {name: n, type: vless, server: example.com, port: 443, uuid: 00000000-0000-0000-0000-000000000000, tls: true}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return node
}

func TestInterfaceName(t *testing.T) {
	id := NewIdentity("ws-abc234", "", "")
	if id.Interface == "" || !strings.HasPrefix(id.Interface, "en") || id.Validate() != nil {
		t.Fatalf("new identity's interface %q", id.Interface)
	}
	for _, bad := range []string{"wlan0", "en", "enp6s0;rm", "enp0s31f6abcdefgh", "tap0"} {
		id.Interface = bad
		if id.Validate() == nil {
			t.Errorf("interface %q accepted", bad)
		}
	}
	id.Interface = ""
	if id.Validate() != nil || id.NIC() != "eth0" {
		t.Fatalf("an identity from before interface names: %q", id.NIC())
	}
}

// An identity.json from before interface names gets the host's NIC's at load.
func TestLoadGivesOlderIdentitiesAnInterface(t *testing.T) {
	t.Setenv("HSB_HOME", t.TempDir())
	inst, err := Create(Config{Name: "1", ExitIP: "8.8.8.8"}, writeTestNode(t), NewIdentity("ws-abc235", "", ""))
	if err != nil {
		t.Fatal(err)
	}
	id := *inst.Identity
	id.Interface = ""
	if err := inst.SaveIdentity(id); err != nil {
		t.Fatal(err)
	}
	again, err := Load("1")
	if err != nil {
		t.Fatal(err)
	}
	if again.Identity.Interface != HostNIC() {
		t.Fatalf("interface %q, want %q", again.Identity.Interface, HostNIC())
	}
	data, _ := os.ReadFile(again.IdentityPath())
	if !strings.Contains(string(data), `"interface": "`+HostNIC()+`"`) {
		t.Fatalf("not saved:\n%s", data)
	}
}
