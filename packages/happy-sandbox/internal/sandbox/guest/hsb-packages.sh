#!/bin/bash
# The user's own apt packages, back after the container is recreated (shares,
# identity, limits or the image changed: the container layer starts fresh,
# the home stays). Two lists in dev's home, one package per line, # comments:
# ~/.config/happy-sandbox/apt-packages (written by the user) and
# apt-packages.auto next to it (recorded by the apt hook, hsb-apt-record.sh). Runs at every boot as root
# (hsb-packages.service), waits for the network (the gate opens after boot),
# installs what is missing, and remembers the list it installed in the
# container layer so an unchanged list costs nothing.
set -uo pipefail
export LC_ALL=C
dir=/home/dev/.config/happy-sandbox
lists=()
for f in "$dir/apt-packages" "$dir/apt-packages.auto"; do [ -f "$f" ] && lists+=("$f"); done
done_file=/var/lib/happy-sandbox/apt-packages.done
log() { echo "hsb-packages: $*"; }

[ "${#lists[@]}" -gt 0 ] || exit 0
# Names only: never an option or anything else apt would read as one.
mapfile -t pkgs < <(cat "${lists[@]}" | sed 's/#.*//' | tr -s ' \t' '\n' | grep -E '^[a-z0-9][a-z0-9+.:-]*$' | sort -u)
bad="$(cat "${lists[@]}" | sed 's/#.*//' | tr -s ' \t' '\n' | grep -vE '^[a-z0-9][a-z0-9+.:-]*$|^$' | tr '\n' ' ')"
[ -z "$bad" ] || log "ignored (not package names): $bad"
[ "${#pkgs[@]}" -gt 0 ] || exit 0
want="$(printf '%s\n' "${pkgs[@]}")"
if [ -f "$done_file" ] && [ "$(cat "$done_file")" = "$want" ]; then
    exit 0
fi
missing=()
for p in "${pkgs[@]}"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || missing+=("$p")
done
if [ "${#missing[@]}" -eq 0 ]; then
    mkdir -p "$(dirname "$done_file")" && echo "$want" > "$done_file"
    exit 0
fi
log "to install: ${missing[*]}"
# The network comes up when the host's gate opens: wait for it (up to 30 min).
export DEBIAN_FRONTEND=noninteractive
for i in $(seq 60); do
    apt-get update -qq >/dev/null 2>&1 && break
    [ "$i" = 60 ] && { log "no network after 30 minutes; next boot tries again"; exit 1; }
    sleep 30
done
if apt-get install -y -qq --no-install-recommends "${missing[@]}"; then
    mkdir -p "$(dirname "$done_file")" && echo "$want" > "$done_file"
    log "installed: ${missing[*]}"
else
    # One unknown name must not keep the others out: try them one by one.
    failed=()
    for p in "${missing[@]}"; do
        apt-get install -y -qq --no-install-recommends "$p" >/dev/null 2>&1 || failed+=("$p")
    done
    log "could not install: ${failed[*]} (see apt-cache policy <name>)"
    exit 1
fi
