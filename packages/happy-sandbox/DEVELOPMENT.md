# happy-sandbox — development

For maintainers. Users read README.md.

## Layout

| path | what |
| --- | --- |
| `cmd/happy-sandbox` | the one binary: user commands, plus internal `run` (systemd), `net-serve`, `stop-container`, `net-dev` (image build), `guest-tap` (inside, as root) |
| `cmd/hsb-probe` | host-only exit probe through a node (debugging) |
| `internal/gate` | egress gate (opens on an exit-IP verdict), single-upstream egress, exit probe |
| `internal/netguard` | address policy (no private, loopback, link-local…) |
| `internal/netstack` | user-space stack (gvisor-tap-vsock), frame transport, guest TAP |
| `internal/proxycore` | managed mihomo: one node, loopback SOCKS5 with a random password |
| `internal/sandbox` | instance files, identity, container, network process, push, systemd unit, prerequisite check; `access.go` (what a sandbox gets of the host: user, home, env, resources, devices, presets), `guest.go` (the guest user, the generated `/etc/happy-sandbox` files, path mapping, submounts, GPU) |
| `internal/sandbox/guest/` | the guest's files, the only copy (the image takes them from here): `hsb-setup.sh` / `.service` (every boot, as root: mounted over the image's copies), `hsb-packages.sh` / `.service` and `hsb-apt-record.sh` + `99happy-sandbox` (apt packages back after a recreation: written in at every start); all embedded, so a sandbox runs its happy-sandbox's version |
| `image/` | Containerfile (base; build context is the repository, `.containerignore` keeps it to the guest files), `provision.sh` (tools, run inside a gated build sandbox), `installers.lock.json` |
| `tools/` | `podman-dev`, `build-image.sh`, `seccomp-profile` |
| `third_party/gvisor-tap-vsock` | Cage's patched copy, `pkg/` only (go.mod replace) |

Outside the repo, never committed: `~/build/happy-sandbox-v2/` holds the Go
toolchain and caches, binaries, `deps/mihomo` (pinned, hash-checked against
Cage's lock), the development Podman storage, test instances, and
`secrets/` (node files, 0600).

## Development environment

```bash
cd packages/happy-sandbox && source .envrc.example     # Go toolchain, caches
go vet ./cmd/... ./internal/... && go test ./internal/...
export HSB_HOME=~/build/happy-sandbox-v2/instances HSB_PODMAN=$PWD/tools/podman-dev   # isolated test instances
```

`tools/podman-dev` is rootless Podman with everything (storage, runtime,
config) under `~/build/happy-sandbox-v2` (`HSB_BUILD` moves it): the
developer's own Podman storage is never used, Docker and sudo Podman never.
`HSB_HOME` moves the instances, `HSB_MIHOMO` the exit client.

## Building the image

```bash
tools/build-image.sh NODE_FILE EXIT_IP [TAG]     # default localhost/happy-sandbox:latest
```

1. The base from `image/Containerfile` (Ubuntu 24.04, systemd, cron, build
   tools, locales; units a container does not need are masked; journal in
   memory; user `dev`; no machine id: `/etc/machine-id` empty and dbus's a
   link to it).
2. A build sandbox from the base, with its own gated network (the node's
   credentials stay on the host), runs `provision.sh` as dev: Node (nvm,
   prebuilt only), Claude Code, Codex, happy; installers pinned by SHA-256,
   steps retried; per-machine state removed (`.claude.json`, `~/.happy`,
   caches).
3. Committed; the script refuses an image with a machine id.

## How it works

**Network.** The container is `--network none`; only `NET_ADMIN` and
`/dev/net/tun` are added (no `SYS_ADMIN`: read-only bind mounts stay
read-only for guest root). The host's `net-serve` (or `run`) process:
starts mihomo (one node, one MATCH rule, loopback SOCKS5 with a random
password, Pdeathsig), listens on a unix socket in `run/link` (mounted at
`/var/lib/happy-sandbox/link`), and the guest's `hsb-link` unit
(`happy-sandbox guest-link`, started with `systemd-run` from the host)
connects, creates the TAP `eth0` (192.168.64.2/24, gateway .1) and passes
Ethernet frames over the socket, reconnecting whenever the link ends (a lost
link closes the gate; the next one gets a new stack and gate). Not a
`podman exec` pipe: Podman 3.4 declared long-lived execs dead on busy hosts. TCP goes through the gate to the one upstream; DNS is DoH
through the same path; UDP, ICMP (answered locally), IPv6 and private
addresses are refused.

**Gate.** Closed at start. The monitor probes the exit every 15 s
(Cloudflare `/cdn-cgi/trace` on api.anthropic.com, api.openai.com,
claude.ai, chatgpt.com in turn; 5 s timeout; a failure retries the next
endpoint at once). A probe equal to `exit_ip` grants or renews a verdict;
the open gate lapses 90 s after the last renewal. A wrong exit closes it at
once; three failed probes in a row close it. Every closure revokes all
connections. On close / reopen the host pushes through the relay to the
happy account logged in inside (its access key read through the container;
relay `/v1/push-tokens`, then Expo, one request per token).

**Users and files.** `--userns=keep-id --user 0:0`; `hsb-setup.service`
gives `dev` the host user's uid/gid (`HSB_UID`/`HSB_GID`) and chowns
anything in the home that is not the host user's, so files in the home and
in shares belong to the host user. Interactive entry is
`podman exec --user 0 … runuser -l dev` (Podman 3.4 adds group 0 to
`exec --user`). The home is a bind mount of `~/.happy-sandbox/NAME/home`,
filled once from the image's `/home/dev` (via `home.new`, renamed when
complete).

**Access.** `config.json`'s `access` (README: 宿主镜像模式) decides the
guest user (`dev`, or the host user: hsb-setup renames `dev` and sets the
host's home path and shell), the home (private, filled from the image once;
or the host's own, rw at its path, never chowned), read-only `protect`
mounts over it (the gate's configuration and binary), private tool state
(`CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `HAPPY_HOME_DIR` under
`/var/lib/happy-sandbox`; with the host's home also `state/apt`, the apt
hook's record), resources and devices (NVIDIA from the CDI spec, applied by
gpu.go since Podman 3.4 reads no CDI; AMD through /dev/kfd). happy stays the
image's (/home/dev, `HAPPY_DIST_HOME` points there); cron runs its lines
through `/etc/happy-sandbox/run`, so they get the same environment. Every way in (`shell`, `exec`,
`here`, `AsUser`) is `runuser -u USER -- env -i … ` then
`/etc/happy-sandbox/bashrc` (interactive: the user's login files, then
`env.sh`) or `/etc/happy-sandbox/run` (a command: the same, non-interactive):
`env.sh` is last, so `access.env` wins over the user's `.bashrc`. The
container carries a `happy-sandbox.spec` label, a hash of its whole create
command: any change of access, shares, identity or image recreates it at the
next up.

**Identity.** `identity.json` (see README). The container carries labels
with the identity hash; `Ensure` recreates the container when the hash or
the image id differs. hsb-setup applies time zone and locale on every boot
(`/etc/localtime`, `/etc/default/locale` for PAM/cron, `/etc/locale.conf`
for services, `/etc/profile.d/00-hsb-locale.sh` for login shells;
`locale-gen` for locales the image lacks). `systemd-machine-id-commit` is
masked: the machine id is a read-only mount, never transient.

**Seccomp.** The host's default profile plus `fchmodat2` → ENOSYS. glibc
2.39 uses fchmodat2; crun 0.17 ignores `defaultErrnoRet` and answers EPERM
for syscalls the profile does not know, which broke tar. ENOSYS makes glibc
fall back. The syscall stays blocked.

**systemd unit.** `happy-sandbox@NAME.service` runs `happy-sandbox run`
(container, then the network in the foreground), `Restart=on-failure`
after 15 s. conmon lands in the cgroup of whoever creates the container,
so `KillMode=process`: a failed network process is restarted alone and the
container keeps running. `ExecStop=happy-sandbox stop-container` stops the
network (SIGTERM, clean exit) and then the container. With the unit
enabled, `up`/`down` go through systemctl. Lingering is the user's
decision; we only print the command.

## Verifying

Run these after changing the network, the image or the container setup
(the development environment, a test node):

| property | how |
| --- | --- |
| nothing before the gate | before `up` finishes: only `lo` inside, no route, no DNS |
| one exit | inside: `curl https://api.anthropic.com/cdn-cgi/trace` and `curl https://api.ipify.org` show `exit_ip` |
| no other way out | inside: UDP to 8.8.8.8:53 times out; IPv6, host LAN addresses, the host itself, the gateway's ports refused |
| stall closes | `kill -STOP` mihomo: new connections fail at once; `gate.log` shows the close within ~25 s; `kill -CONT`: reopens by itself |
| crash closes | kill mihomo or the network process: the TAP disappears inside (only `lo`) |
| wrong exit | `init` with another `--exit-ip`: the gate never opens |
| users | inside `id` = host uid/gid; a file written in an rw share belongs to the host user; an ro share is read-only for root too, `mount -o remount,rw` denied |
| persistence | `down`/`up`, `share add` (recreate), a new image: home and logins kept |
| identity | two sandboxes from one image: different `/etc/machine-id` (also `/var/lib/dbus/machine-id`), MAC of `eth0`, hostname, `date +%Z`, `$LANG`; after a new image the same; editing identity.json → applied at the next `up` |
| systemd inside | `systemctl is-system-running` = `running` (no failed units) |
| host profile | `init --profile host`: inside `id`, `$HOME`, `which python` (the host's conda in an interactive `here`), no `*_proxy`; `memory.max`, `pids.max`, `/dev/shm`, `ulimit -n` as configured; `/mnt` disks listed; `protect` paths read-only; `claude -p` not logged in, host `~/.claude.json` untouched; LAN / host / UDP still refused |
| config applies | `config set access.resources.memory 64G` + `restart` → recreated, `memory.max` changed; a bad value or an unknown key refused |
| unit | `enable`; `kill -9` the unit's main pid → restarted after 15 s, container PID 1 start time unchanged; `down` → unit `inactive` (not failed), container exited |
| destroy | removes unit, container and directory; refuses without `--yes` |
| installer | `curl … sandbox/install.sh \| bash` with a fresh `HOME` and `HSB_BUILD` (`HSB_PODMAN=tools/podman-dev`): check runs before the image, image id matches the manifest; again → "image up to date"; `--uninstall` refuses while sandboxes exist, then removes tool, link and image |

Known harmless noise: Podman 3.4 prints "Storage … has been removed" and
sometimes times out on an exit file although the container stopped (we
check the state instead of failing); systemd logs "left-over process
conmon" after a network restart.

## Gotchas

- Podman 3.4: `exec --user` adds group 0; `podman cp` drops the exec bit;
  new named volumes take the image's ids uid-shifted (we use bind mounts
  only).
- Claude Code's own safety check blocks shell commands with `rm` inside
  `sh -c` / pipes: run removals as separate commands.
- `ping` inside always answers (the stack replies locally).
- Outage tests: always bound the stall (stop → wait for "gate closed" →
  fixed hold → `kill -CONT`, with a trap). Waiting for gate.log to go quiet
  never ends: the closed gate keeps logging failed probes.
- SELinux hosts (CentOS, RHEL, Fedora): container processes may not write a
  host directory labelled `user_home_t`, so every mount of ours carries a
  container label — `,Z` for the sandbox's own files, `,z` for shares — added
  only when `podman info` reports SELinux. Relabelling writes extended
  attributes, which CIFS / NFS / 9p / fuse do not carry: those shares are
  mounted unlabelled (the user gives the mount a `context=` option instead).
  Ubuntu has no SELinux, so this cannot be reproduced on the workstation.
- SELinux also denies the container's init domain the TAP device
  (`avc: denied { read write } for name="tun" … container_init_t`), so the
  network never starts and the sandbox has no DNS at all. Fixed on the host,
  not in the container: `happy-sandbox selinux-policy` prints a one-rule
  module (allow container_init_t / container_t on tun_tap_device_t) and the
  semodule commands; `check` reports whether it is loaded. An install script
  cannot do this (root, and a policy change is the operator's call).
- Gogs raw URLs return the LFS *pointer* (133 bytes) for LFS files; the
  installer downloads them from `<repo>.git/info/lfs/objects/basic/<sha256>`.
- A throw-away Podman storage (installer test with its own `HSB_BUILD`):
  keep `HSB_BUILD` short (Podman 3.4 refuses a runroot over 50 characters),
  and remove it inside one namespace:
  `podman-dev unshare sh -c 'umount …/storage/overlay; rm -rf DIR'`
  (the overlay mount exists only in that namespace).

## Origin

The network core is from Claude Cage (MIT, `LICENSE.cage`, `NOTICE.cage`),
as validated in the earlier happy-sandbox headless work:

| here | Cage |
| --- | --- |
| `internal/gate` | `internal/cage/gate.go`, `egress.go`, `config.go`, `gate_probe.go` — opens on an exit-IP verdict instead of Cage's safety report |
| `internal/netguard` | `internal/netguard` (unchanged) |
| `internal/netstack` | `internal/containerenv/network.go`, `frames.go`, `tap_linux.go` |
| `third_party/gvisor-tap-vsock` | Cage's patched copy (Apache-2.0), `pkg/` only |

Cage's tests for these parts came along and pass.
