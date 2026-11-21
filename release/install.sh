#!/usr/bin/env bash
# wannabe installer: installs or updates `happy` (CLI + daemon),
# `happy-agent` and `happy-fleet` (Fleet Watch, which the daemon runs after
# `happy fleet on`) from the happy-dist repository.
#
#   curl -fsSL -u USER:TOKEN <base>/install.sh | HAPPY_DIST_AUTH=USER:TOKEN bash
#   ~/.happy-dist/install.sh            # update to the latest release
#   ~/.happy-dist/install.sh 1.2.6+orig.1   # install that release (rollback)
#   ~/.happy-dist/install.sh --list     # releases, newest last
#   ~/.happy-dist/install.sh --status   # versions and daemon status
#   ~/.happy-dist/install.sh --verify   # check the install against the release
#   happy update                        # = install.sh --update: claude update,
#                                       #   codex update, newest happy release;
#                                       #   restart sessions if anything changed
#                                       #   (happy update status|verify|list|<version>;
#                                       #   after a rollback before orig.32, which has no
#                                       #   `happy update`: ~/.happy-dist/install.sh)
#
# Needs Node >= 20, npm and Claude Code (`claude`) already installed; Codex is
# optional. Linux x64, macOS arm64 and macOS x64.
#
# Environment:
#   HAPPY_DIST_URL   base URL, or file:///dir (default: DEFAULT_DIST_URL below);
#                    remembered in ~/.happy-dist/url
#   HAPPY_DIST_AUTH  USER:TOKEN for the dist repository; saved to
#                    ~/.happy-dist/auth (mode 600) for later updates
#   HAPPY_DIST_HOME  state directory (default ~/.happy-dist)
#   HAPPY_DIST_HOMES "dir dir"  extra HAPPY_HOME_DIRs to watch (default: every
#                    ~/.happy* directory with a running daemon, and $HAPPY_HOME_DIR)
#   HAPPY_DIST_NO_DAEMON=1  do not wait for daemons / report sessions
#   HAPPY_DIST_NO_NIGHTLY=1 no nightly update (also: touch ~/.happy-dist/no-nightly)
#
# Daemons are not stopped or started by this script, so each keeps the
# environment it was started in (one per HAPPY_HOME_DIR, e.g. ~/.happy_a,
# ~/.happy_b). Each notices the new install within a minute, hands off to the
# new version with its own environment, and the new daemon restarts its
# sessions in place (same session, same conversation) on the new happy and
# the machine's current claude / codex. A turn in progress is interrupted.
# Sessions started from a terminal are left alone. A daemon started with
# HAPPY_KEEP_SESSIONS_ON_UPGRADE=1 keeps its sessions as they are.

set -euo pipefail

# Where releases come from: HAPPY_DIST_URL (an http(s) URL or file:///dir),
# else the release directory this script sits in, else the one remembered in
# $STATE/url (written by the first two, for later updates), else the default.
DEFAULT_DIST_URL=""
STATE="${HAPPY_DIST_HOME:-$HOME/.happy-dist}"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

mkdir -p "$STATE"
chmod 700 "$STATE"

# Run from a release directory itself (bash ~/dist/install.sh, not piped
# from curl): that directory is the source.
HERE=""
if [ -f "${BASH_SOURCE[0]:-}" ]; then
    HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    { [ -f "$HERE/latest" ] && [ -d "$HERE/releases" ]; } || HERE=""
fi
if [ -n "${HAPPY_DIST_URL:-}" ] || [ -n "$HERE" ]; then
    BASE="${HAPPY_DIST_URL:-file://$HERE}"
    BASE="${BASE%/}"
    [ "$BASE" = "$DEFAULT_DIST_URL" ] && rm -f "$STATE/url" || printf '%s\n' "$BASE" > "$STATE/url"
elif [ -s "$STATE/url" ]; then
    BASE="$(head -n1 "$STATE/url")"
else
    BASE="$DEFAULT_DIST_URL"
fi
# No source at all (a build without a default, e.g. a sandbox image built
# from a local release directory): `happy update` then updates claude and
# codex only; anything else needs one.
NO_SOURCE=""
if [ -z "$BASE" ]; then
    [ "${1:-}" = --update ] || die "no release source: set HAPPY_DIST_URL to where your build is published (https://… or file:///path/to/dist)"
    NO_SOURCE=1
fi

# Node must run before anything else: the installer itself uses it.
if ! command -v node >/dev/null 2>&1; then
    die "node not found; install Node 20+ first (nvm: https://github.com/nvm-sh/nvm)"
fi
if ! NODE_CHECK="$(node --version 2>&1)"; then
    case "$NODE_CHECK" in
        *libatomic*) die "node ($(command -v node)) cannot start: libatomic is missing. Install it: sudo apt install libatomic1 (Debian/Ubuntu) or sudo dnf install libatomic (Fedora/RHEL)" ;;
        *) die "node ($(command -v node)) cannot start: $NODE_CHECK" ;;
    esac
fi

AUTH="${HAPPY_DIST_AUTH:-}"
if [ -n "$AUTH" ]; then
    (umask 077; printf '%s\n' "$AUTH" > "$STATE/auth")
elif [ -f "$STATE/auth" ]; then
    AUTH="$(head -n1 "$STATE/auth")"
fi

# fetch <path> <dest>: exactly HTTP 200 or fail. Gogs answers 302 to its login
# page when the credentials are missing or wrong; curl -f does not catch that.
# HAPPY_DIST_PROGRESS=1 (set for the package downloads): a progress bar when
# stderr is a terminal; cron and pipes get none.
fetch() {
    local code progress=(-sS)
    # curl's progress meter: size, received, speed, time left (the bar has no speed).
    if [ "${HAPPY_DIST_PROGRESS:-}" = 1 ] && { [ -t 2 ] || [ "${HAPPY_DIST_TTY:-}" = 1 ]; }; then progress=(-S); fi
    if [ -n "$AUTH" ]; then
        code="$(curl "${progress[@]}" -u "$AUTH" -o "$2" -w '%{http_code}' "$BASE/$1")" || die "download failed: $BASE/$1"
    else
        code="$(curl "${progress[@]}" -o "$2" -w '%{http_code}' "$BASE/$1")" || die "download failed: $BASE/$1"
    fi
    case "$code" in
        200) ;;
        000) case "$BASE" in file://*) ;; *) die "$BASE/$1: no HTTP answer" ;; esac ;;
        302|401|403) die "$BASE/$1: HTTP $code — the dist repository needs a login; set HAPPY_DIST_AUTH=USER:TOKEN" ;;
        *) die "$BASE/$1: HTTP $code" ;;
    esac
}

version_ge() { # version_ge A B: A >= B (numeric x.y.z, suffixes ignored)
    node -e '
        const p = (v) => v.split(/[-+]/)[0].split(".").map(Number);
        const [a, b] = [p(process.argv[1]), p(process.argv[2])];
        for (let i = 0; i < 3; i++) if (a[i] !== b[i]) process.exit(a[i] > b[i] ? 0 : 1);
        process.exit(0);' "$1" "$2"
}

tool_version() { # tool_version <command>: first version line, or "not installed"
    local v
    if ! command -v "$1" >/dev/null; then echo 'not installed'; return; fi
    v="$("$1" --version 2>/dev/null || true)"
    echo "${v%%$'\n'*}"
}

# Installed package version, read from disk: `happy --version` in official
# builds also authenticates and starts / replaces a daemon.
package_version() {
    node -e 'try { console.log(require(require("path").join(process.argv[1], process.argv[2], "package.json")).version) } catch { console.log("not installed") }' \
        "$(npm root -g 2>/dev/null)" "$1"
}

# HAPPY_HOME_DIRs of this user with a running daemon, one per line.
daemon_homes() {
    node -e '
        const fs = require("fs"), path = require("path"), os = require("os");
        const home = os.homedir();
        const expand = (d) => path.resolve(d.replace(/^~(?=$|\/)/, home));
        let names = [];
        try { names = fs.readdirSync(home).filter((n) => n.startsWith(".happy") && n !== ".happy-dist"); } catch {}
        const candidates = [
            ...(process.env.HAPPY_DIST_HOMES || "").split(/\s+/).filter(Boolean),
            process.env.HAPPY_HOME_DIR || "",
            ...names.map((n) => path.join(home, n)),
        ].filter(Boolean).map(expand);
        const seen = new Set();
        for (const dir of candidates) {
            if (seen.has(dir)) continue;
            seen.add(dir);
            try {
                const state = JSON.parse(fs.readFileSync(path.join(dir, "daemon.state.json"), "utf8"));
                process.kill(state.pid, 0);
                console.log(dir);
            } catch {}
        }'
}

OUR_RELAY="https://api.cluster-fluster.com"

# The relay a home's running daemon is connected to (its local /status), or nothing.
relay_of() {
    node -e '
        (async () => {
            try {
                const s = JSON.parse(require("fs").readFileSync(require("path").join(process.argv[1], "daemon.state.json"), "utf8"));
                const r = await fetch(`http://127.0.0.1:${s.httpPort}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(2000) });
                const j = await r.json();
                if (j.serverUrl) console.log(j.serverUrl);
            } catch {}
        })()' "$1"
}

# The egress lock of a home and its daemon's verdict, one line, or nothing
# when there is no lock (`happy egress lock`; the daemon's /egress).
egress_of() {
    node -e '
        (async () => {
            const fs = require("fs"), path = require("path"), home = process.argv[1];
            let lock;
            try { lock = JSON.parse(fs.readFileSync(path.join(home, "egress.json"), "utf8")); } catch { return; }
            const want = [...(lock.ips || []), ...(lock.countries || [])].join(" / ");
            if (!want) return;
            let st = null;
            try {
                const s = JSON.parse(fs.readFileSync(path.join(home, "daemon.state.json"), "utf8"));
                const r = await fetch(`http://127.0.0.1:${s.httpPort}/egress`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passive: true }), signal: AbortSignal.timeout(2000) });
                st = await r.json();
            } catch {}
            if (!st || !st.state || st.state === "off") { console.log(`locked to ${want} (daemon does not check it: update or start it)`); return; }
            const at = st.checkedAt ? new Date(st.checkedAt).toTimeString().slice(0, 8) : "not yet";
            const exit = st.ip ? `${st.ip}${st.country ? " (" + st.country + ")" : ""}` : "?";
            const why = st.state === "error" ? (st.fault?.kind === "unreachable" ? ", providers unreachable" : ", WRONG EXIT: sending stopped") : "";
            console.log(`locked to ${want}; ${st.state}, exit ${exit}, checked ${at}${why}`);
        })()' "$1"
}

# "<pid> <version>" of a home's running daemon, or nothing.
daemon_of() {
    node -e '
        try {
            const s = JSON.parse(require("fs").readFileSync(require("path").join(process.argv[1], "daemon.state.json"), "utf8"));
            process.kill(s.pid, 0);
            console.log(s.pid + " " + s.startedWithCliVersion);
        } catch {}' "$1"
}

status() {
    printf 'happy:        %s\n' "$(package_version happy)"
    printf 'happy-agent:  %s\n' "$(package_version happy-agent)"
    printf 'happy-fleet:  %s\n' "$(package_version happy-fleet)"
    printf 'claude:       %s\n' "$(tool_version claude)"
    printf 'codex:        %s\n' "$(tool_version codex)"
    printf 'release:      %s\n' "$(cat "$STATE/installed" 2>/dev/null || echo 'none (not installed by this script)')"
    printf 'nightly:      %s\n' "$( { [ -f "$HOME/Library/LaunchAgents/com.happy-dist.nightly-update.plist" ] || crontab -l 2>/dev/null | grep -q 'nightly-update.sh'; } && echo 'happy update at 03:00 local time (log ~/.happy-dist/nightly.log)' || echo 'off')"
    local homes h d r e
    homes="$(daemon_homes)"
    if [ -z "$homes" ]; then
        echo 'daemons:      none running'
    else
        echo 'daemons:'
        while IFS= read -r h; do
            d="$(daemon_of "$h")"
            r="$(relay_of "$h")"
            printf '  %-28s pid %s, happy %s, relay %s%s\n' "$h" "${d%% *}" "${d#* }" "${r:-unknown}" "$([ -f "$h/fleet/enabled" ] && echo ', fleet on')"
            e="$(egress_of "$h")"
            [ -n "$e" ] && printf '  %-28s egress %s\n' '' "$e"
            if [ -n "$r" ] && [ "$r" != "$OUR_RELAY" ]; then
                warn "$h is connected to $r, not the default relay $OUR_RELAY"
            fi
        done <<< "$homes"
    fi
    # Sessions a daemon started keep running when it stops (they are their
    # own processes): they still talk to the relay and their agent, but no
    # daemon watches them (no egress check, no restart on update).
    local orphans
    orphans="$(session_processes | while read -r pid home; do
        printf '%s\n' "$homes" | while read -r h; do realpath -m "$h"; done | grep -qxF "$home" || echo "$pid $home"
    done)"
    if [ -n "$orphans" ]; then
        echo "sessions without a daemon: $(printf '%s\n' "$orphans" | wc -l)"
        printf '%s\n' "$orphans" | while read -r pid home; do printf '  pid %-8s %s\n' "$pid" "$home"; done
        echo "  (happy daemon clean stops them; happy daemon start brings a daemon back)"
    fi
}

# session_processes: "PID HAPPY_HOME_DIR" of this user's happy session
# processes (claude / codex sessions, not daemons). The home comes from the
# process environment (readable for one's own processes), else ~/.happy.
session_processes() {
    local pid home
    # The subcommand right after index.mjs: claude / codex (daemons are "daemon").
    for pid in $(pgrep -u "$(id -u)" -f 'happy/dist/index\.mjs (claude|codex)( |$)' 2>/dev/null); do
        # Ours only: a sandbox's sessions (same uid with keep-id) live in another mount namespace.
        [ "$(readlink "/proc/$pid/ns/mnt" 2>/dev/null)" = "$(readlink /proc/self/ns/mnt)" ] || continue
        home="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^HAPPY_HOME_DIR=//p' | head -n1)"
        home="${home:-$HOME/.happy}"
        echo "$pid $(realpath -m "${home/#\~/$HOME}" 2>/dev/null || echo "$home")"
    done
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

UPDATE_ALL=0
case "${1:-}" in
    -h|--help) sed -n '2,30p' "$0" 2>/dev/null || true; exit 0 ;;
    --update) UPDATE_ALL=1; shift ;;
    --status) status; exit 0 ;;
    --verify) VERIFY=1 ;;
    --list)
        fetch releases.txt "$TMP/releases.txt"
        cat "$TMP/releases.txt"
        echo "latest: $(fetch latest "$TMP/latest"; cat "$TMP/latest")"
        exit 0 ;;
esac

# --- Detach ----------------------------------------------------------------
# An install or update runs on its own, in a new session: a dropped SSH, a
# closed terminal, Ctrl-C or a restarted agent session cannot cut it in half
# (npm killed mid-install once left happy missing). This process only shows
# the log until it is done and returns its exit code. Not for `curl | bash`
# (no script file to start again; that is the first install anyway).
if [ -z "${HAPPY_DIST_DETACHED:-}" ] && [ -z "${VERIFY:-}" ] && [ -f "$0" ] && { [ "$UPDATE_ALL" = 1 ] || [ -n "${1:-}" ]; }; then
    LOG="$STATE/update.log"
    [ -f "$LOG" ] && mv -f "$LOG" "$LOG.1"
    : > "$LOG"
    args=()
    [ "$UPDATE_ALL" = 1 ] && args+=(--update)
    args+=("$@")
    detach=(nohup)
    if command -v setsid >/dev/null 2>&1; then detach=(setsid nohup)
    elif command -v perl >/dev/null 2>&1; then detach=(perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV' nohup)
    fi
    tty=0; [ -t 2 ] && tty=1
    HAPPY_DIST_DETACHED=1 HAPPY_DIST_TTY=$tty "${detach[@]}" bash "$0" "${args[@]}" >>"$LOG" 2>&1 </dev/null &
    pid=$!
    say "Running on its own: losing SSH or closing this terminal does not stop it (Ctrl-C only stops watching)."
    say "Log: $LOG"
    tail -n +1 -f "$LOG" &
    tailpid=$!
    code=0
    wait "$pid" || code=$?
    sleep 0.5
    kill "$tailpid" 2>/dev/null || true
    wait "$tailpid" 2>/dev/null || true
    exit "$code"
fi

# --- Self-update -----------------------------------------------------------
# `happy update` runs the copy in $STATE. Fetch the published installer first
# and, if it differs, install it and run it instead, so a fix to this script
# reaches every machine even when there is no new happy release.
# HAPPY_DIST_SELF_UPDATED stops a loop if the published copy is broken.
if [ "$UPDATE_ALL" = 1 ] && [ -z "${HAPPY_DIST_SELF_UPDATED:-}" ] && [ -z "$NO_SOURCE" ]; then
    # Subshell: fetch exits on failure; a network error must not stop the update.
    if (fetch install.sh "$TMP/install.sh") 2>/dev/null && bash -n "$TMP/install.sh" 2>/dev/null; then
        if ! cmp -s "$TMP/install.sh" "$STATE/install.sh"; then
            say "Updating the installer itself"
            cp "$TMP/install.sh" "$STATE/install.sh.new" && chmod 755 "$STATE/install.sh.new" \
                && mv "$STATE/install.sh.new" "$STATE/install.sh"
            rm -rf "$TMP"
            HAPPY_DIST_SELF_UPDATED=1 exec bash "$STATE/install.sh" --update "$@"
        fi
    else
        warn "could not fetch the published installer; using this copy"
    fi
fi

# The short manual (happy-dist README) and the command reference next to the
# installer: ~/.happy-dist/README.md, COMMANDS.md, COMMANDS.zh.md.
# Subshell: fetch exits on failure, and a missing manual must not stop anything.
fetch_manual() {
    local f
    for f in README.md COMMANDS.md COMMANDS.zh.md; do
        if (fetch "$f" "$TMP/$f") 2>/dev/null; then cp "$TMP/$f" "$STATE/$f"; fi
    done
}
[ "$UPDATE_ALL" = 1 ] && [ -z "$NO_SOURCE" ] && fetch_manual

# --- Nightly update ----------------------------------------------------------
# Every machine runs `happy update` at 03:00 local time (cron), as this user:
# the same rules as by hand — nothing changes when all three are current,
# sessions restart in place when any of them changed. The script records the
# directories node, npm, happy, claude and codex are in now (cron has a bare
# PATH; nvm is loaded too) and is rewritten on every install and update.
# Off: touch ~/.happy-dist/no-nightly (the next update removes the cron line).
NIGHTLY_MARK='# happy-dist nightly update'
NIGHTLY_LABEL='com.happy-dist.nightly-update'
NIGHTLY_PLIST="$HOME/Library/LaunchAgents/$NIGHTLY_LABEL.plist"

# The script cron / launchd run: it carries the directories node, npm, happy,
# claude and codex are in now (their PATH is bare) and loads nvm.
write_nightly_script() {
    local dirs="" d c
    for c in node npm happy claude codex; do
        d="$(command -v "$c" 2>/dev/null || true)"
        [ -n "$d" ] || continue
        d="$(dirname "$d")"
        case ":$dirs:" in *":$d:"*) ;; *) dirs="$dirs${dirs:+:}$d" ;; esac
    done
    cat > "$STATE/nightly-update.sh.new" <<NIGHTLY
#!/usr/bin/env bash
# Written by ~/.happy-dist/install.sh: \`happy update\` at 03:00 local time
# (cron on Linux, launchd on macOS). Log: ~/.happy-dist/nightly.log (rotated
# at 1 MB). Off: touch ~/.happy-dist/no-nightly, then happy update.
set -u
LOG="$STATE/nightly.log"
[ -f "\$LOG" ] && [ "\$(wc -c < "\$LOG" 2>/dev/null || echo 0)" -gt 1048576 ] && mv -f "\$LOG" "\$LOG.1"
exec >>"\$LOG" 2>&1
# cron and launchd start this with a bare environment: the state directory
# this script belongs to (HAPPY_DIST_HOME, if it is not ~/.happy-dist).
export HAPPY_DIST_HOME="$STATE"
[ -s "\$HOME/.nvm/nvm.sh" ] && . "\$HOME/.nvm/nvm.sh" >/dev/null 2>&1
export PATH="$dirs:\$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH"
echo "===== \$(date '+%F %T') nightly happy update"
if command -v flock >/dev/null 2>&1; then
    exec flock -n "$STATE/nightly.lock" happy update
fi
exec happy update
NIGHTLY
    chmod 755 "$STATE/nightly-update.sh.new" && mv "$STATE/nightly-update.sh.new" "$STATE/nightly-update.sh"
}

nightly_off() {
    [ -f "$STATE/no-nightly" ] || [ "${HAPPY_DIST_NO_NIGHTLY:-}" = 1 ]
}

# Linux (and anything with cron but not launchd): one crontab line.
setup_nightly_cron() {
    command -v crontab >/dev/null 2>&1 || { warn "no crontab command; no nightly update on this machine"; return 0; }
    local current; current="$(crontab -l 2>/dev/null | grep -v -F "$NIGHTLY_MARK" | grep -v 'nightly-update.sh' || true)"
    if nightly_off; then
        if crontab -l 2>/dev/null | grep -q 'nightly-update.sh'; then
            printf '%s\n' "$current" | sed '/^$/d' | crontab - && say "Nightly update switched off (~/.happy-dist/no-nightly)"
        fi
        return 0
    fi
    write_nightly_script
    local line="0 3 * * * $STATE/nightly-update.sh $NIGHTLY_MARK"
    if ! crontab -l 2>/dev/null | grep -q -F "$line"; then
        { printf '%s\n' "$current" | sed '/^$/d'; echo "$line"; } | crontab - \
            && say "Nightly update: happy update at 03:00 local time (log ~/.happy-dist/nightly.log; off: touch ~/.happy-dist/no-nightly)" \
            || warn "could not install the nightly cron line"
    fi
}

# macOS: a launchd agent. Needs no Full Disk Access (cron and crontab do),
# and a 03:00 missed while the Mac slept runs when it wakes.
setup_nightly_launchd() {
    local domain="gui/$(id -u)"
    # A cron line from an earlier installer: drop it (when crontab may be edited at all).
    if crontab -l 2>/dev/null | grep -q 'nightly-update.sh'; then
        crontab -l 2>/dev/null | grep -v -F "$NIGHTLY_MARK" | grep -v 'nightly-update.sh' | crontab - 2>/dev/null || true
    fi
    if nightly_off; then
        if [ -f "$NIGHTLY_PLIST" ]; then
            launchctl bootout "$domain/$NIGHTLY_LABEL" 2>/dev/null || launchctl unload "$NIGHTLY_PLIST" 2>/dev/null || true
            rm -f "$NIGHTLY_PLIST"
            say "Nightly update switched off (~/.happy-dist/no-nightly)"
        fi
        return 0
    fi
    write_nightly_script
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$NIGHTLY_PLIST.new" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$NIGHTLY_LABEL</string>
    <key>ProgramArguments</key>
    <array><string>/bin/bash</string><string>$STATE/nightly-update.sh</string></array>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
    <key>StandardOutPath</key><string>$STATE/nightly.launchd.log</string>
    <key>StandardErrorPath</key><string>$STATE/nightly.launchd.log</string>
</dict>
</plist>
PLIST
    local changed=1
    if [ -f "$NIGHTLY_PLIST" ] && cmp -s "$NIGHTLY_PLIST.new" "$NIGHTLY_PLIST"; then changed=0; fi
    mv "$NIGHTLY_PLIST.new" "$NIGHTLY_PLIST"
    if [ "$changed" = 1 ] || ! launchctl print "$domain/$NIGHTLY_LABEL" >/dev/null 2>&1; then
        launchctl bootout "$domain/$NIGHTLY_LABEL" 2>/dev/null || true
        if launchctl bootstrap "$domain" "$NIGHTLY_PLIST" 2>/dev/null || launchctl load -w "$NIGHTLY_PLIST" 2>/dev/null; then
            say "Nightly update: happy update at 03:00 local time via launchd (log ~/.happy-dist/nightly.log; off: touch ~/.happy-dist/no-nightly)"
        else
            warn "could not load the nightly launchd agent ($NIGHTLY_PLIST); it loads at the next login"
        fi
    fi
}

setup_nightly() {
    if [ "$(uname -s)" = Darwin ] && command -v launchctl >/dev/null 2>&1; then
        setup_nightly_launchd
    else
        setup_nightly_cron
    fi
}
[ -z "${VERIFY:-}" ] && setup_nightly

# --- --verify ---------------------------------------------------------------
# After an interrupted install: is what is installed exactly the release?
if [ "${VERIFY:-0}" = 1 ]; then
    G="$(npm root -g)"; PROBLEMS=0
    bad() { warn "$*"; PROBLEMS=$((PROBLEMS + 1)); }
    case "$(uname -s)-$(uname -m)" in
        Linux-x86_64) PLATFORM=linux-x64 ;; Darwin-arm64) PLATFORM=darwin-arm64 ;; Darwin-x86_64) PLATFORM=darwin-x64 ;;
        *) die "unsupported platform" ;;
    esac
    RELEASE="$(cat "$STATE/installed" 2>/dev/null || true)"
    [ -n "$RELEASE" ] || die "no release recorded in $STATE/installed; run the installer"
    say "Verifying release $RELEASE ($PLATFORM)"
    fetch "releases/$RELEASE/manifest.json" "$TMP/manifest.json"
    mfv() { node -e 'const m = require(process.argv[1]); const v = process.argv[2].split(".").reduce((o, k) => o?.[k], m); if (v === undefined) process.exit(1); console.log(v)' "$TMP/manifest.json" "$1"; }
    sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
    for pkg in happy happy-agent happy-fleet; do
        if [ "$pkg" = happy ]; then file="$(mfv "packages.happy.files.$PLATFORM.file")"; want="$(mfv "packages.happy.files.$PLATFORM.sha256")"
        else file="$(mfv "packages.$pkg.file" 2>/dev/null)" || continue; want="$(mfv "packages.$pkg.sha256")"; fi
        version="$(mfv "packages.$pkg.version")"
        [ "$(package_version "$pkg")" = "$version" ] || { bad "$pkg: installed $(package_version "$pkg"), release has $version"; continue; }
        fetch "releases/$RELEASE/$file" "$TMP/$file"
        [ "$(sha256 "$TMP/$file")" = "$want" ] || die "$file: download does not match the manifest"
        mkdir -p "$TMP/x-$pkg" && tar -xzf "$TMP/$file" -C "$TMP/x-$pkg"
        n=0; d=0
        while IFS= read -r f; do
            n=$((n + 1))
            cmp -s "$TMP/x-$pkg/package/$f" "$G/$pkg/$f" || { d=$((d + 1)); [ "$d" -le 5 ] && warn "$pkg: $f differs or is missing"; }
        done < <(cd "$TMP/x-$pkg/package" && find . -type f ! -name npm-shrinkwrap.json | sed 's|^\./||')
        if [ "$d" = 0 ]; then say "$pkg $version: $n files match the release"; else bad "$pkg: $d of $n files differ"; fi
        (cd "$G/$pkg" && npm ls --omit=dev --depth=0 >/dev/null 2>&1) || bad "$pkg: npm ls reports missing or invalid dependencies"
    done
    for t in rg difft; do [ -x "$G/happy/tools/unpacked/$t" ] || bad "tool missing: tools/unpacked/$t"; done
    for d in "$G"/happy/node_modules/@anthropic-ai/claude-agent-sdk-*; do [ -d "$d" ] && bad "bundled Claude Code present: $d"; done
    while IFS= read -r h; do
        [ -n "$h" ] || continue
        v="$(daemon_of "$h")"
        [ "${v#* }" = "$(package_version happy)" ] && say "daemon $h on ${v#* }" || bad "daemon $h runs ${v#* }, installed is $(package_version happy)"
        r="$(relay_of "$h")"
        [ -z "$r" ] || [ "$r" = "$OUR_RELAY" ] || bad "daemon $h is connected to $r, not $OUR_RELAY"
    done <<< "$(daemon_homes)"
    if [ "$PROBLEMS" = 0 ]; then say "Install verified: everything matches release $RELEASE"; exit 0; fi
    warn "$PROBLEMS problem(s); reinstall with: $STATE/install.sh $RELEASE"
    exit 1
fi

# --- Requirements ----------------------------------------------------------
command -v curl >/dev/null || die "curl is required"
command -v node >/dev/null || die "Node.js >= 20 is required (node not found)"
command -v npm  >/dev/null || die "npm is required"
NODE_VERSION="$(node -p process.versions.node)"
version_ge "$NODE_VERSION" 20.0.0 || die "Node.js >= 20 is required (found $NODE_VERSION)"

case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)  PLATFORM=linux-x64 ;;
    Darwin-arm64)  PLATFORM=darwin-arm64 ;;
    Darwin-x86_64) PLATFORM=darwin-x64 ;;
    *) die "unsupported platform: $(uname -s) $(uname -m)" ;;
esac

# --- --update: agents first, then happy ------------------------------------
# claude / codex update themselves; a session keeps the binary it started with
# until it is restarted, so a change to either restarts every daemon session.
AGENTS_CHANGED=0
if [ "$UPDATE_ALL" = 1 ]; then
    for tool in claude codex; do
        if ! command -v "$tool" >/dev/null; then continue; fi
        before="$(tool_version "$tool")"
        say "$tool update ($before)"
        "$tool" update 2>&1 | sed 's/^/    /' || warn "$tool update failed; keeping $before"
        hash -r
        after="$(tool_version "$tool")"
        if [ "$after" != "$before" ]; then
            say "$tool: $before -> $after"
            AGENTS_CHANGED=1
        fi
    done

    if [ -n "$NO_SOURCE" ]; then
        LATEST="$(package_version happy)"
        INSTALLED="$LATEST"
        say "happy stays at $LATEST: no release source on this machine (only claude and codex are updated; to update happy, run install.sh from a release directory once)"
    else
        fetch latest "$TMP/latest"
        LATEST="$(tr -d '[:space:]' < "$TMP/latest")"
        INSTALLED="$(cat "$STATE/installed" 2>/dev/null || true)"
    fi
    if [ -n "$LATEST" ] && [ "$LATEST" = "$INSTALLED" ] && [ "$(package_version happy)" = "$LATEST" ]; then
        say "happy $INSTALLED is the newest release"
        if [ "$AGENTS_CHANGED" = 0 ]; then
            say "Everything is up to date; sessions left as they are"
            exit 0
        fi
        HOMES="$(daemon_homes)"
        if [ -z "$HOMES" ]; then
            say "No running happy daemon; nothing to restart"
            exit 0
        fi
        while IFS= read -r h; do
            say "$h: restarting sessions on the updated claude / codex"
            HAPPY_HOME_DIR="$h" happy daemon restart-sessions 2>&1 | sed 's/^/    /' \
                || warn "$h: some sessions did not restart (resume them from the app)"
        done <<< "$HOMES"
        exit 0
    fi
    say "happy: ${INSTALLED:-$(package_version happy)} -> $LATEST"
    set -- "$LATEST"
fi

# --- Which release ---------------------------------------------------------
RELEASE="${1:-}"
if [ -z "$RELEASE" ]; then
    fetch latest "$TMP/latest"
    RELEASE="$(tr -d '[:space:]' < "$TMP/latest")"
fi
[ -n "$RELEASE" ] || die "no release given and no latest release published"
DIR="releases/$RELEASE"
fetch "$DIR/manifest.json" "$TMP/manifest.json"

mf() { node -e 'const m = require(process.argv[1]); const v = process.argv[2].split(".").reduce((o, k) => o?.[k], m); if (v === undefined) process.exit(1); console.log(v)' "$TMP/manifest.json" "$1"; }

CLI_VERSION="$(mf packages.happy.version)"
CLI_FILE="$(mf "packages.happy.files.$PLATFORM.file")" || die "release $RELEASE has no happy package for $PLATFORM"
CLI_SHA="$(mf "packages.happy.files.$PLATFORM.sha256")"
AGENT_VERSION="$(mf packages.happy-agent.version)"
AGENT_FILE="$(mf packages.happy-agent.file)"
AGENT_SHA="$(mf packages.happy-agent.sha256)"
# happy-fleet (Fleet Watch, run by the daemon with `happy fleet on`); releases before orig.24 have none.
FLEET_FILE="$(mf packages.happy-fleet.file 2>/dev/null || true)"
FLEET_SHA="$(mf packages.happy-fleet.sha256 2>/dev/null || true)"
FLEET_VERSION="$(mf packages.happy-fleet.version 2>/dev/null || true)"
MIN_CLAUDE="$(mf minClaudeCode)"

say "Release $RELEASE ($PLATFORM): happy $CLI_VERSION, happy-agent $AGENT_VERSION${FLEET_VERSION:+, happy-fleet $FLEET_VERSION}"

# Claude Code: app sessions run the machine's claude (no bundled copy).
command -v claude >/dev/null || die "Claude Code is not installed (curl -fsSL https://claude.ai/install.sh | bash)"
CLAUDE_VERSION="$(claude --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
[ -n "$CLAUDE_VERSION" ] || die "cannot read \`claude --version\`"
version_ge "$CLAUDE_VERSION" "$MIN_CLAUDE" || die "Claude Code $CLAUDE_VERSION is too old; this release needs $MIN_CLAUDE+ (run: claude update)"
if command -v codex >/dev/null; then
    CODEX_VERSION="$(codex --version 2>/dev/null | head -n1 || true)"
else
    warn "codex not found; Codex sessions will not be available on this machine"
    CODEX_VERSION="not installed"
fi

GLOBAL_PREFIX="$(npm prefix -g)"
[ -w "$GLOBAL_PREFIX" ] || [ -w "$GLOBAL_PREFIX/lib" ] || die "npm's global prefix $GLOBAL_PREFIX is not writable by $(id -un); use a user-level Node (nvm) or set npm's prefix"

# --- Download and verify ---------------------------------------------------
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
for pair in "$CLI_FILE:$CLI_SHA" "$AGENT_FILE:$AGENT_SHA" ${FLEET_FILE:+"$FLEET_FILE:$FLEET_SHA"}; do
    f="${pair%%:*}"; want="${pair##*:}"
    say "Downloading $f"
    HAPPY_DIST_PROGRESS=1 fetch "$DIR/$f" "$TMP/$f"
    got="$(sha256 "$TMP/$f")"
    [ "$got" = "$want" ] || die "$f: sha256 mismatch (expected $want, got $got)"
done

# --- Install ---------------------------------------------------------------
PREVIOUS="$(cat "$STATE/installed" 2>/dev/null || true)"
DAEMON=1
[ "${HAPPY_DIST_NO_DAEMON:-}" = 1 ] && DAEMON=0
HOMES="$(daemon_homes)"

say "Installing with npm"
# --ignore-scripts: the only install script in these packages and their
# dependencies is happy's postinstall (unpack-tools.cjs), which runs below. With
# it, newer npm warns on every update that the script is blocked unless
# allow-scripts lists happy (the owner's `npm config set allow-scripts=happy`
# did not silence it).
# npm needs about 1 GB at its peak (measured: 930 MB for this release). On a
# small server the kernel kills it mid-install and happy is gone; refuse
# instead, while the old version still works.
if [ -r /proc/meminfo ]; then
    avail_kb="$(awk '/^MemAvailable:/{a=$2} /^SwapFree:/{s=$2} END{print a+s}' /proc/meminfo)"
    if [ -n "$avail_kb" ] && [ "$avail_kb" -lt 1258291 ]; then
        die "only $((avail_kb / 1024)) MB of memory + swap free; npm needs about 1 GB to install happy (it would be killed half-way). Add swap, then run this again:
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
    fi
fi

# npm moves the installed packages aside (node_modules/.<name>-XXXXXXXX) before
# writing the new ones. Killed in between (out of memory, power), it leaves
# empty package directories and no `happy`. Put the previous version back.
NODE_MODULES="$GLOBAL_PREFIX/lib/node_modules"
restore_previous() {
    local pkg live old name restored=""
    for pkg in happy happy-agent happy-fleet; do
        live="$NODE_MODULES/$pkg"
        [ -f "$live/package.json" ] && continue
        for old in "$NODE_MODULES"/."$pkg"-????????; do
            [ -f "$old/package.json" ] || continue
            name="$(node -e 'try { console.log(require(process.argv[1]).name) } catch {}' "$old/package.json")"
            [ "$name" = "$pkg" ] || continue
            # The empty shell npm left: aside, as npm names it (it clears those itself next time).
            [ -e "$live" ] && mv "$live" "$NODE_MODULES/.$pkg-broken$$"
            mv "$old" "$live" && restored="$restored $pkg $(package_version "$pkg")"
            break
        done
    done
    # The links npm makes, as package.json "bin" says.
    ln -sf ../lib/node_modules/happy/bin/happy.mjs "$GLOBAL_PREFIX/bin/happy" 2>/dev/null || true
    ln -sf ../lib/node_modules/happy/bin/happy-mcp.mjs "$GLOBAL_PREFIX/bin/happy-mcp" 2>/dev/null || true
    ln -sf ../lib/node_modules/happy-agent/bin/happy-agent.mjs "$GLOBAL_PREFIX/bin/happy-agent" 2>/dev/null || true
    [ -n "$restored" ] && warn "npm stopped half-way; put the previous version back:$restored"
    return 0
}
if ! npm install -g --no-fund --no-audit --ignore-scripts "$TMP/$CLI_FILE" "$TMP/$AGENT_FILE" ${FLEET_FILE:+"$TMP/$FLEET_FILE"}; then
    restore_previous
    die "npm install failed (killed? see dmesg); happy ${PREVIOUS:-before} is still installed. Run this again: $STATE/install.sh --update"
fi
# The Agent SDK's optional platform packages each hold a ~230 MB Claude Code
# copy; happy runs the machine's claude instead. npm installs them even with
# --omit=optional on a global install, so remove them here.
HAPPY_MODULES="$GLOBAL_PREFIX/lib/node_modules/happy/node_modules"
for d in "$HAPPY_MODULES"/@anthropic-ai/claude-agent-sdk-*; do
    if [ -d "$d" ]; then rm -rf "$d"; fi
done
# Unpack ripgrep / difftastic (and the macOS capability helper): what happy's
# postinstall (scripts/unpack-tools.cjs) does, with the system tar. That
# script sometimes never exits after unpacking (a tar stream event that does
# not come), which hung the whole install.
unpack_tools() {
    local tools="$GLOBAL_PREFIX/lib/node_modules/happy/tools" plat a
    case "$(uname -s)-$(uname -m)" in
        Linux-x86_64) plat=x64-linux ;; Linux-aarch64|Linux-arm64) plat=arm64-linux ;;
        Darwin-arm64) plat=arm64-darwin ;; Darwin-x86_64) plat=x64-darwin ;;
        *) return 1 ;;
    esac
    mkdir -p "$tools/unpacked"
    # The archives were made on a Mac and carry its com.apple.provenance
    # attribute; GNU tar warns about that unknown header on every file.
    local quiet=()
    tar --version 2>/dev/null | grep -q 'GNU tar' && quiet=(--warning=no-unknown-keyword)
    for a in difftastic ripgrep happy-capability; do
        [ "$a" = happy-capability ] && [ "${plat#*-}" != darwin ] && continue
        tar ${quiet[@]+"${quiet[@]}"} -xzf "$tools/archives/$a-$plat.tar.gz" -C "$tools/unpacked" || return 1
    done
    for f in "$tools/unpacked"/*; do
        case "$f" in *.node) ;; *) [ -f "$f" ] && chmod 755 "$f" ;; esac
    done
}
if command -v tar >/dev/null 2>&1; then
    unpack_tools || die "could not unpack happy's tools (ripgrep, difftastic)"
else
    node "$GLOBAL_PREFIX/lib/node_modules/happy/scripts/unpack-tools.cjs" >/dev/null \
        || die "could not unpack happy's tools (ripgrep, difftastic)"
fi
[ -x "$GLOBAL_PREFIX/lib/node_modules/happy/tools/unpacked/rg" ] || die "happy's tools are missing after install"

printf '%s\n' "$RELEASE" > "$STATE/installed"
[ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ] && printf '%s\n' "$PREVIOUS" > "$STATE/previous"
# Keep a copy of this installer for updates and rollbacks (`happy update` runs it).
fetch install.sh "$STATE/install.sh.new" && mv "$STATE/install.sh.new" "$STATE/install.sh" && chmod 755 "$STATE/install.sh"
fetch_manual
# Releases before orig.33 put a `happy-update` wrapper next to `happy`; it is
# `happy update` now. Remove the wrapper only if it is ours.
OLD_WRAPPER="$GLOBAL_PREFIX/bin/happy-update"
if [ -f "$OLD_WRAPPER" ] && grep -q 'Original Happy' "$OLD_WRAPPER" 2>/dev/null; then
    rm -f "$OLD_WRAPPER"
fi

if [ "$DAEMON" = 1 ]; then
    if [ -z "$HOMES" ]; then
        warn "no running happy daemon for $(id -un); start one in the environment it should run in:"
        warn "  happy daemon start      (or HAPPY_HOME_DIR=~/.happy_x happy daemon start)"
    else
        WAIT="${HAPPY_DIST_WAIT:-150}"
        say "Waiting for $(printf '%s\n' "$HOMES" | wc -l | tr -d ' ') daemon(s) to switch to happy $CLI_VERSION (they check once a minute)"
        while IFS= read -r h; do
            waited=0
            d="$(daemon_of "$h")"
            while [ "${d#* }" != "$CLI_VERSION" ] && [ "$waited" -lt "$WAIT" ]; do
                sleep 5; waited=$((waited + 5))
                d="$(daemon_of "$h")"
            done
            if [ "${d#* }" != "$CLI_VERSION" ]; then
                warn "$h: daemon not running on $CLI_VERSION after ${WAIT}s; start it again in its own environment:"
                warn "  HAPPY_HOME_DIR=$h happy daemon start"
                continue
            fi
            say "$h: daemon on $CLI_VERSION (pid ${d%% *}); sessions:"
            HAPPY_HOME_DIR="$h" happy daemon restart-sessions --outdated 2>&1 | sed 's/^/    /' \
                || warn "$h: some sessions did not restart (resume them from the app)"
        done <<< "$HOMES"
    fi
fi

# Tab completion for bash and zsh: scripts in ~/.happy-dist/completion, one
# line in ~/.bashrc / ~/.zshrc; rewritten every install so it follows happy.
# Off: happy completion uninstall (leaves ~/.happy-dist/no-completion).
if [ -f "$STATE/no-completion" ]; then
    :
elif happy completion install --quiet 2>/dev/null; then
    say "Tab completion: happy <Tab> (in a new shell)"
else
    warn "could not set up tab completion (happy completion install)"
fi

echo
say "Installed release $RELEASE${PREVIOUS:+ (previous: $PREVIOUS)}"
echo "claude $CLAUDE_VERSION, codex $CODEX_VERSION"
status
echo
echo "=================== common commands ==================="
echo "  happy update                    claude, codex and happy; restarts sessions if anything changed"
echo "  happy update status             versions, daemons, nightly update"
echo "  happy update verify             check the install (after an interrupted update)"
echo "  happy daemon status"
[ -n "$FLEET_FILE" ] && echo "  happy fleet on | off | status   agents message each other (one machine per account)"
echo "  happy egress lock IP --country US | unlock | status   send to the AI only through that exit"
[ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ] && echo "  happy update $PREVIOUS   roll back"
echo "  happy help                      all commands (happy help <command>, happy help all)"
echo "  manual: $STATE/README.md   commands: $STATE/COMMANDS.md"
echo "======================================================="
exit 0
