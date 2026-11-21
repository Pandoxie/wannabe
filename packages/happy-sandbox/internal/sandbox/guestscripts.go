package sandbox

import (
	"bytes"
	"context"
	"embed"
	"fmt"
	"os/exec"
	"strings"
)

// The guest's own scripts (the image copies the same files), written into the container
// at every start like the network helper. A fix to them then reaches existing
// sandboxes with a new happy-sandbox, without a new image.
//
//go:embed guest/hsb-apt-record.sh guest/hsb-packages.sh
var guestScripts embed.FS

var guestScriptNames = []string{"hsb-apt-record.sh", "hsb-packages.sh"}

// InstallGuestScripts writes the scripts to /usr/local/lib/happy-sandbox.
func (i *Instance) InstallGuestScripts(ctx context.Context) error {
	for _, name := range guestScriptNames {
		data, err := guestScripts.ReadFile("guest/" + name)
		if err != nil {
			return err
		}
		target := "/usr/local/lib/happy-sandbox/" + name
		cmd := exec.CommandContext(ctx, Podman(), "exec", "-i", "--user", "0", i.Container(), "sh", "-c", "cat > "+target+".new && chmod 755 "+target+".new && mv -f "+target+".new "+target)
		cmd.Stdin = bytes.NewReader(data)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("writing %s into the sandbox: %v: %s", name, err, strings.TrimSpace(stderr.String()))
		}
	}
	return nil
}
