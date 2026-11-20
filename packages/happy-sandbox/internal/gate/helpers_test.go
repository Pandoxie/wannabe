// Derived from Claude Cage (MIT), internal/cage/gate_probe_test.go: the
// fixture proxy used by the egress tests.
package gate

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"
)

func exitProbeProxy(t *testing.T, scheme, upstream string) (string, *atomic.Int32) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	count := new(atomic.Int32)
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer connection.Close()
				_ = connection.SetDeadline(time.Now().Add(10 * time.Second))
				reader := bufio.NewReader(connection)
				var target string
				if scheme == "http" {
					request, err := http.ReadRequest(reader)
					if err != nil || request.Method != "CONNECT" {
						t.Error("expected HTTP CONNECT")
						return
					}
					if request.Header.Get("Proxy-Authorization") != "Basic dGVzdC11c2VyOnRlc3QtcGFzc3dvcmQ=" {
						t.Error("HTTP proxy authentication was lost")
						return
					}
					target = request.Host
					_, _ = io.WriteString(connection, "HTTP/1.1 200 Connection Established\r\n\r\n")
				} else {
					var header [4]byte
					if _, err := io.ReadFull(reader, header[:2]); err != nil {
						return
					}
					if _, err := io.CopyN(io.Discard, reader, int64(header[1])); err != nil {
						return
					}
					_, _ = connection.Write([]byte{5, 2})
					if _, err := io.ReadFull(reader, header[:2]); err != nil {
						return
					}
					username := make([]byte, int(header[1]))
					if _, err := io.ReadFull(reader, username); err != nil {
						return
					}
					passwordLength, err := reader.ReadByte()
					if err != nil {
						return
					}
					password := make([]byte, int(passwordLength))
					if _, err := io.ReadFull(reader, password); err != nil {
						return
					}
					if string(username) != "test-user" || string(password) != "test-password" {
						t.Error("SOCKS proxy authentication was lost")
						return
					}
					_, _ = connection.Write([]byte{1, 0})
					if _, err := io.ReadFull(reader, header[:]); err != nil {
						return
					}
					if header[0] != 5 || header[1] != 1 || header[3] != 3 {
						t.Error("SOCKS probe resolved its hostname outside the proxy")
						return
					}
					length, err := reader.ReadByte()
					if err != nil {
						return
					}
					host := make([]byte, length)
					if _, err := io.ReadFull(reader, host); err != nil {
						return
					}
					if _, err := io.ReadFull(reader, header[:2]); err != nil {
						return
					}
					target = net.JoinHostPort(string(host), fmt.Sprint(binary.BigEndian.Uint16(header[:2])))
					_, _ = connection.Write([]byte{5, 0, 0, 1, 127, 0, 0, 1, 0, 80})
				}
				if target != "ipv4.icanhazip.com:443" && target != "api.ipify.org:443" {
					t.Error("probe followed a redirect or changed destination")
					return
				}
				count.Add(1)
				remote, err := net.DialTimeout("tcp", upstream, time.Second)
				if err != nil {
					t.Error(err)
					return
				}
				defer remote.Close()
				go func() { _, _ = io.Copy(remote, reader); _ = remote.(*net.TCPConn).CloseWrite() }()
				_, _ = io.Copy(connection, remote)
			}()
		}
	}()
	return scheme + "://test-user:test-password@" + listener.Addr().String(), count
}
