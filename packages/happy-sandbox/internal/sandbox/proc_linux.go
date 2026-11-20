package sandbox

import (
	"os"
	"strconv"
	"strings"
	"syscall"
)

// processAlive: the pid exists and is a happy-sandbox network process
// (net-serve, started by up; run, started by systemd).
func processAlive(pid int) bool {
	if syscall.Kill(pid, 0) != nil {
		return false
	}
	cmd, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/cmdline")
	if err != nil {
		return false
	}
	args := strings.Split(string(cmd), "\x00")
	return len(args) > 1 && strings.HasSuffix(args[0], "happy-sandbox") && (args[1] == "net-serve" || args[1] == "run")
}
