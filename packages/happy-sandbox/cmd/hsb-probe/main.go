// hsb-probe is a development check: start the managed mihomo with a node
// file, then probe the exit through it as the gate does. No container.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/gate"
	"github.com/Pandoxie/wannabe/packages/happy-sandbox/internal/proxycore"
)

func main() {
	if len(os.Args) != 4 {
		fmt.Fprintln(os.Stderr, "usage: hsb-probe MIHOMO NODE_FILE WORK_DIR")
		os.Exit(2)
	}
	node, err := proxycore.LoadNode(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "node:", err)
		os.Exit(1)
	}
	log, _ := os.OpenFile(filepath.Join(os.Args[3], "mihomo.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	core, err := proxycore.Start(ctx, os.Args[1], node, os.Args[3], log)
	if err != nil {
		fmt.Fprintln(os.Stderr, "core:", err)
		os.Exit(1)
	}
	defer core.Stop()
	cfg := gate.Config{ProxyURL: core.ProxyURL(), DNSURL: gate.DefaultDNSURL(), ExitIP: "198.51.100.1"}
	for i := 0; i < 4; i++ {
		t := time.Now()
		exit, err := gate.ProbeExit(ctx, cfg)
		fmt.Printf("%-44s ip=%s country=%s err=%v %dms\n", exit.Endpoint, exit.IP, exit.Country, err, time.Since(t).Milliseconds())
	}
}
