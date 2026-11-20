#!/usr/bin/env bash
# Builds the happy-sandbox image in two steps:
#   1. the base (image/Containerfile): Ubuntu 24.04, systemd, cron, build tools;
#   2. a sandbox started from it, with its gated network (the one VLESS exit),
#      runs image/provision.sh as dev: Node, Claude Code, Codex, happy into
#      /home/dev. The result is committed as the image.
# No proxy credential is ever inside the build: the container's only network
# is the sandbox network itself.
#
#   tools/build-image.sh NODE_FILE EXIT_IP [TAG]
#   HAPPY_DIST_URL / HAPPY_DIST_AUTH: where provision.sh installs happy from
#   (https://…, or file:///dir: a local release directory, copied in)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
B="${HSB_BUILD:-$HOME/build/happy-sandbox-v2}"
P="$here/tools/podman-dev"
node="${1:?node file}" exit_ip="${2:?exit ip}" tag="${3:-localhost/happy-sandbox:latest}"
name="hsb-build-$(date +%Y%m%d%H%M%S)"
run="$B/run/$name"
# The network link's socket directory: where net-dev (ServeNetwork) listens,
# $run/run/link, mounted where the guest's hsb-link connects.
mkdir -p "$run/run/link" && chmod 700 "$run" "$run/run" "$run/run/link"

echo "==> base image"
# APT_MIRROR (optional) only speeds up the base build; the image keeps the
# official Ubuntu archive either way.
"$P" build --network host ${APT_MIRROR:+--build-arg "APT_MIRROR=$APT_MIRROR"} \
    -t localhost/happy-sandbox-base:dev "$here/image" > "$run/base-build.log" 2>&1

echo "==> seccomp profile"
"$here/tools/seccomp-profile" > "$run/seccomp.json"

echo "==> build sandbox $name"
"$P" create --name "$name" --network none --security-opt "seccomp=$run/seccomp.json" \
    --cgroupns private --ipc private --hostname hsb-build --memory 4294967296 --pids-limit 4096 \
    --device /dev/net/tun --cap-add NET_ADMIN --tmpfs /run --tmpfs /tmp \
    -v "$run/run/link:/var/lib/happy-sandbox/link" \
    --stop-signal SIGRTMIN+3 --systemd always --pull never --http-proxy=false \
    localhost/happy-sandbox-base:dev /sbin/init > /dev/null
"$P" start "$name" > /dev/null
# A failed build leaves no container behind (a rerun starts a new one).
net="" done=""
trap '[ -z "$net" ] || kill $net 2>/dev/null || true; [ -n "$done" ] || "$P" rm -f "$name" > /dev/null 2>&1 || true' EXIT
sleep 4
"$P" cp "$B/bin/happy-sandbox" "$name:/usr/local/lib/happy-sandbox/happy-sandbox"
"$P" cp "$here/image/provision.sh" "$name:/tmp/provision.sh"
"$P" cp "$here/image/installers.lock.json" "$name:/tmp/installers.lock.json"
"$P" exec --user 0 "$name" chmod 755 /tmp/provision.sh /usr/local/lib/happy-sandbox/happy-sandbox
# The guest side of the network link (0.3.0: a socket, not an exec pipe).
"$P" exec --user 0 "$name" systemd-run --unit hsb-link --collect --property Restart=always --property RestartSec=1 \
    /usr/local/lib/happy-sandbox/happy-sandbox guest-link /var/lib/happy-sandbox/link/net.sock > /dev/null

HSB_PODMAN="$P" HSB_MIHOMO="$B/deps/mihomo" \
    "$B/bin/happy-sandbox" net-dev "$name" "$node" "$exit_ip" "$run" > "$run/net.log" 2>&1 &
net=$!
for _ in $(seq 30); do grep -q "gate open" "$run/net.log" && break; sleep 1; done
grep -q "gate open" "$run/net.log" || {
    echo "the exit did not open in 30 s: is the node reachable, and is $exit_ip really its exit IP?" >&2
    echo "  logs: $run/net.log, $run/run/mihomo.log, $run/run/state.json" >&2
    exit 1
}

# Where happy comes from. A local release directory (file:///…) is copied
# in (its latest release only): the build's only network is the exit.
dist="${HAPPY_DIST_URL:-}"
case "$dist" in
    file://*)
        src="${dist#file://}"
        latest="$(head -n1 "$src/latest")"
        echo "==> happy $latest from $src"
        stage="$run/happy-dist"
        mkdir -p "$stage/releases"
        for f in install.sh latest releases.txt README.md COMMANDS.md COMMANDS.zh.md; do
            [ ! -f "$src/$f" ] || cp "$src/$f" "$stage/"
        done
        cp -r "$src/releases/$latest" "$stage/releases/"
        chmod -R a+rX "$stage"
        "$P" cp "$stage" "$name:/var/tmp/happy-dist"
        dist="file:///var/tmp/happy-dist"
        ;;
esac

echo "==> provision (log: $run/provision.log)"
"$P" exec --user dev --workdir /home/dev -e HOME=/home/dev -e "EXPECTED_EXIT_IP=$exit_ip" \
    -e "HAPPY_DIST_URL=$dist" \
    -e "HAPPY_DIST_AUTH=${HAPPY_DIST_AUTH:-}" -e LOCK=/tmp/installers.lock.json \
    "$name" bash /tmp/provision.sh > "$run/provision.log" 2>&1
tail -8 "$run/provision.log"
# A copied-in release leaves nothing behind: not the files, not the source
# (inside a sandbox, `happy update` then asks for one: HAPPY_DIST_URL=…).
if [ "$dist" = file:///var/tmp/happy-dist ]; then
    "$P" exec --user 0 "$name" rm -rf /var/tmp/happy-dist /home/dev/.happy-dist/url
fi

echo "==> finalize and commit $tag"
kill $net 2>/dev/null || true
"$P" exec --user 0 "$name" systemctl stop hsb-link > /dev/null 2>&1 || true   # it runs the helper truncated below
# Each sandbox generates its own machine id; the network helper is copied in
# at every start (it must match the host's happy-sandbox).
# (Podman 3.4 sometimes loses track of a finished exec: retry.)
for _ in 1 2 3; do
    "$P" exec --user 0 "$name" truncate -s 0 /etc/machine-id /usr/local/lib/happy-sandbox/happy-sandbox && break
    sleep 2
done
"$P" exec --user 0 "$name" stat -c '%s %n' /etc/machine-id /usr/local/lib/happy-sandbox/happy-sandbox
# No machine identity may ship in the image (every sandbox would share it).
if "$P" exec --user 0 "$name" test -s /var/lib/dbus/machine-id -o -s /etc/machine-id; then
    echo "a machine id is still in the image; refusing to commit" >&2; exit 1
fi
# (Podman 3.4 can time out on its exit file although the container stopped.)
"$P" stop "$name" > /dev/null 2>&1 || true
"$P" container inspect --format '{{.State.Running}}' "$name" | grep -qx false \
    || { echo "the build container did not stop" >&2; exit 1; }
"$P" commit --change 'CMD ["/sbin/init"]' --change 'STOPSIGNAL SIGRTMIN+3' "$name" "$tag" > /dev/null
"$P" rm "$name" > /dev/null
done=1
"$P" image inspect --format '{{.Id}} {{.Size}}' "$tag"
