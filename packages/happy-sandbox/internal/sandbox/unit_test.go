package sandbox

import (
	"errors"
	"strings"
	"testing"
)

func TestUserBusEnv(t *testing.T) {
	has := func(paths ...string) func(string) bool {
		return func(p string) bool {
			for _, x := range paths {
				if p == x {
					return true
				}
			}
			return false
		}
	}
	// su - / sudo -iu: neither variable, the user's manager is running.
	env, err := userBusEnv([]string{"HOME=/home/han"}, 1002, "han", has("/run/user/1002/bus"))
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "XDG_RUNTIME_DIR=/run/user/1002") || !strings.Contains(joined, "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1002/bus") {
		t.Fatalf("not filled in: %v", env)
	}
	// A normal login: left alone.
	full := []string{"XDG_RUNTIME_DIR=/run/user/1002", "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1002/bus"}
	if env, _ := userBusEnv(full, 1002, "han", has()); len(env) != 2 {
		t.Fatalf("changed a complete environment: %v", env)
	}
	// No manager at all: a clear error naming the fix.
	_, err = userBusEnv([]string{"HOME=/home/han"}, 1002, "han", has())
	var none ErrNoUserManager
	if !errors.As(err, &none) || !strings.Contains(err.Error(), "sudo loginctl enable-linger han") {
		t.Fatalf("want a clear error, got %v", err)
	}
	if strings.Contains(err.Error(), "DBUS") {
		t.Fatalf("leaks the dbus wording: %v", err)
	}
}
