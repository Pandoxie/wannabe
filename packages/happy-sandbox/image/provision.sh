#!/bin/bash
# Installs Node (nvm), Claude Code, Codex and happy into /home/dev, as dev,
# inside a running sandbox: all downloads go through the sandbox's one exit.
# After the happy-sandbox headless work's install-tools.sh (pinned installer
# scripts, binary-only Node, relative links).
#
#   EXPECTED_EXIT_IP   must be what the providers see, or nothing is installed
#   HAPPY_DIST_URL     where happy's releases are (http(s) via the exit, or file:/// inside the box)
#   HAPPY_DIST_AUTH    its login, if it needs one
#   LOCK               installers.lock.json (url + sha256 per installer)
set -euo pipefail
: "${EXPECTED_EXIT_IP:?}" "${HAPPY_DIST_URL:?}" "${LOCK:?}"
[ "$(id -un)" = dev ] || { echo "run as dev" >&2; exit 1; }
cd "$HOME"

exit_ip="$(curl -fsS --max-time 20 https://api.anthropic.com/cdn-cgi/trace | sed -n 's/^ip=//p')"
[ "$exit_ip" = "$EXPECTED_EXIT_IP" ] || { echo "exit is $exit_ip, expected $EXPECTED_EXIT_IP: not installing" >&2; exit 1; }
echo "exit $exit_ip verified"

work="$(mktemp -d)"
# Large downloads over a long line break off now and then (a partial file, a
# moment without DNS): retry each install step a few times.
retry() {
    local n
    for n in 1 2 3 4; do
        "$@" && return 0
        echo "attempt $n of: $* failed; retrying in $((n * 15)) s" >&2
        sleep $((n * 15))
    done
    "$@"
}
fetch() { # fetch <name>: download a locked installer and check its sha256
    local url sum
    url="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]["url"])' "$LOCK" "$1")"
    sum="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]["sha256"])' "$LOCK" "$1")"
    curl -fsSL --max-time 120 -o "$work/$1" "$url"
    echo "$sum  $work/$1" | sha256sum -c --quiet || { echo "$1 changed upstream (sha256); review it and update the lock" >&2; exit 1; }
}
retry fetch nvm.sh; retry fetch claude.sh; retry fetch codex.sh

export NVM_DIR="$HOME/.nvm"
PROFILE=/dev/null METHOD=script bash "$work/nvm.sh"
. "$NVM_DIR/nvm.sh"
retry nvm install -b --lts    # prebuilt binary only, never a source build
nvm alias default "$(node --version)"

retry bash "$work/claude.sh" latest
retry env CODEX_NON_INTERACTIVE=true sh "$work/codex.sh"
export PATH="$HOME/.local/bin:$PATH"

# happy: the same one-line installer as any server (no daemon here; nightly
# update cron line included).
login=(); [ -z "${HAPPY_DIST_AUTH:-}" ] || login=(-u "$HAPPY_DIST_AUTH")
retry curl -fsSL "${login[@]}" -o "$work/happy-install.sh" "$HAPPY_DIST_URL/install.sh"
retry env HAPPY_DIST_URL="$HAPPY_DIST_URL" HAPPY_DIST_AUTH="${HAPPY_DIST_AUTH:-}" HAPPY_DIST_NO_DAEMON=1 bash "$work/happy-install.sh"

for f in .bashrc .profile; do
    grep -q 'happy-sandbox tools' "$HOME/$f" 2>/dev/null || cat >> "$HOME/$f" <<'SHELL'
# happy-sandbox tools
export PATH="$HOME/.local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ ! -s "$NVM_DIR/nvm.sh" ] || . "$NVM_DIR/nvm.sh"
SHELL
done

# Links pointing into the home stay valid if the home moves.
python3 - <<'PY'
import os
from pathlib import Path
root = Path.home()
for parent, dirs, files in os.walk(root, followlinks=False):
    for name in dirs + files:
        p = Path(parent) / name
        if p.is_symlink():
            t = os.readlink(p)
            if t.startswith(str(root) + '/'):
                p.unlink(); p.symlink_to(os.path.relpath(t, p.parent))
PY

python3 - <<'PY'
import json, subprocess
from pathlib import Path
v = {}
for k, cmd in {'node': ['node', '--version'], 'npm': ['npm', '--version'], 'claude': ['claude', '--version'],
               'codex': ['codex', '--version'], 'happy': ['happy', '--version']}.items():
    v[k] = subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT).strip().splitlines()[0]
Path.home().joinpath('.happy-sandbox-tools.json').write_text(json.dumps(v, indent=2) + '\n')
print(json.dumps(v, indent=2))
PY
# Leave no per-machine identity or install residue in the image's home: each
# sandbox's tools create their own on first use (Claude Code's machineID /
# userID in .claude.json; happy's logs), and caches are not needed.
rm -rf "$work" "$HOME/.npm" "$HOME/.cache" "$HOME/.nvm/.cache" "$HOME/.happy" "$HOME/.claude/backups"
rm -f "$HOME/.claude.json"
