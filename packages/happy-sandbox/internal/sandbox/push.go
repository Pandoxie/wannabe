package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

// Relay is the happy relay the sandbox's account uses ($HSB_RELAY, else ours).
func Relay() string {
	if r := os.Getenv("HSB_RELAY"); r != "" {
		return r
	}
	return "https://api.cluster-fluster.com"
}

// HappyHome is the happy state directory inside: the sandbox's own with
// access.home.private "happy", else ~/.happy of the guest user.
func (i *Instance) HappyHome() string {
	if i.Config.Access.PrivateTool("happy") {
		return stateRoot + "/happy"
	}
	return i.User().Home + "/.happy"
}

// Notify sends a push to the devices of the happy account logged in inside
// the sandbox, from the host. When the gate is closed the sandbox has no
// network at all, so it cannot tell anyone itself; the host can (its own
// network, to our relay and Expo, not through the VLESS). The token is read
// through the container (the volume's directories belong to the container's
// root on the host). Not logged in yet: nothing to do.
func (i *Instance) Notify(ctx context.Context, title, body string) error {
	out, err := podman(ctx, "exec", "--user", "0", i.Container(), "sh", "-c", "cat "+shellQuote(i.HappyHome()+"/access.key")+" 2>/dev/null || true")
	if err != nil {
		return err
	}
	data := []byte(out)
	if len(data) == 0 {
		return nil // not logged in
	}
	var key struct {
		Token string `json:"token"`
	}
	if json.Unmarshal(data, &key) != nil || key.Token == "" {
		return errors.New("unreadable happy access key")
	}
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequestWithContext(ctx, "GET", Relay()+"/v1/push-tokens", nil)
	req.Header.Set("Authorization", "Bearer "+key.Token)
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var tokens struct {
		Tokens []struct {
			Token string `json:"token"`
		} `json:"tokens"`
	}
	if resp.StatusCode != 200 || json.NewDecoder(resp.Body).Decode(&tokens) != nil {
		return fmt.Errorf("relay push tokens: HTTP %d", resp.StatusCode)
	}
	sent := 0
	// One request per token: Expo refuses a batch that mixes app projects.
	for _, t := range tokens.Tokens {
		msg, _ := json.Marshal([]map[string]any{{"to": t.Token, "title": title, "body": body, "sound": "default", "priority": "high"}})
		r, _ := http.NewRequestWithContext(ctx, "POST", "https://exp.host/--/api/v2/push/send", bytes.NewReader(msg))
		r.Header.Set("Content-Type", "application/json")
		if res, err := client.Do(r); err == nil {
			if res.StatusCode == 200 {
				sent++
			}
			res.Body.Close()
		}
	}
	if sent == 0 && len(tokens.Tokens) > 0 {
		return errors.New("no push delivered")
	}
	return nil
}
