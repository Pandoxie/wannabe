package sandbox

import (
	"os"
	"testing"
)

// The embedded copies must be the image's scripts.
func TestGuestScriptsMatchTheImage(t *testing.T) {
	for _, name := range guestScriptNames {
		embedded, err := guestScripts.ReadFile("guest/" + name)
		if err != nil {
			t.Fatal(err)
		}
		image, err := os.ReadFile("../../image/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if string(embedded) != string(image) {
			t.Errorf("internal/sandbox/guest/%s differs from image/%s: copy it over", name, name)
		}
	}
}
