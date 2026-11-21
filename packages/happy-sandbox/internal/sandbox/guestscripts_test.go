package sandbox

import (
	"os"
	"strings"
	"testing"
)

// The image takes the guest files from internal/sandbox/guest, the same
// files happy-sandbox embeds: every one written at start must be copied in.
func TestContainerfileCopiesTheGuestScripts(t *testing.T) {
	data, err := os.ReadFile("../../image/Containerfile")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range append([]string{"hsb-setup.sh", "hsb-setup.service", "hsb-packages.service", "99happy-sandbox"}, guestScriptNames...) {
		if _, err := os.Stat("guest/" + name); err != nil {
			t.Error(err)
		}
		if !strings.Contains(string(data), "internal/sandbox/guest/"+name) {
			t.Errorf("image/Containerfile does not copy internal/sandbox/guest/%s", name)
		}
	}
}
