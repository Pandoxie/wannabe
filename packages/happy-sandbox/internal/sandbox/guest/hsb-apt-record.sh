#!/bin/bash
# apt hook (DPkg::Post-Invoke, /etc/apt/apt.conf.d/99happy-sandbox): after
# every install or removal, record the packages the user added on top of the
# image (apt-mark showmanual minus the image's own list) in the home, so they
# come back when the container is recreated (hsb-packages.service).
# Never fails apt: errors are swallowed.
# One collation for the baseline (sorted at image build) and now: comm needs
# both sorted the same way, and the sandbox's locale (en_US, ko_KR…) differs.
export LC_ALL=C
base=/usr/local/lib/happy-sandbox/apt-baseline
dir=/home/dev/.config/happy-sandbox
out="$dir/apt-packages.auto"
[ -f "$base" ] && [ -d /home/dev ] || exit 0
now="$(apt-mark showmanual 2>/dev/null | sort -u | comm -13 <(sort -u "$base") -)" || exit 0
new="# Recorded by happy-sandbox after each apt install/remove: what you added
# to the image. Reinstalled after the container is recreated. Edit
# apt-packages (next to this file) for packages of your own choosing.
$now"
[ -f "$out" ] && [ "$(cat "$out")" = "$new" ] && exit 0
owner="$(stat -c %u:%g /home/dev)"
mkdir -p "$dir" && chown "$owner" "$dir" /home/dev/.config 2>/dev/null
printf '%s\n' "$new" > "$out.tmp" && chown "$owner" "$out.tmp" && mv -f "$out.tmp" "$out"
exit 0
