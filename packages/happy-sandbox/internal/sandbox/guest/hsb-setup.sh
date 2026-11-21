#!/bin/bash
# Boot of a sandbox, as root (hsb-setup.service): the image's `dev` user
# becomes the guest user happy-sandbox asks for (HSB_USER: dev, or the host
# user's name with its home path and shell) with the host user's uid / gid,
# so files in the home and the shares (bind mounts, --userns=keep-id) belong
# to the host user. Idempotent. happy-sandbox mounts this file over the
# image's copy, so a sandbox always runs the version of its happy-sandbox.
set -euo pipefail
want_uid="${HSB_UID:-1000}" want_gid="${HSB_GID:-1000}"
user="${HSB_USER:-dev}" group="${HSB_GROUP:-${HSB_USER:-dev}}"
home="${HSB_HOME:-/home/$user}" shell="${HSB_SHELL:-/bin/bash}"
home_mode="${HSB_HOME_MODE:-sandbox}"

# Identity from identity.json (passed by happy-sandbox): time zone and locale.
# The machine id is mounted read-only at /etc/machine-id by the host.
if [ -n "${HSB_TIMEZONE:-}" ] && [ -f "/usr/share/zoneinfo/$HSB_TIMEZONE" ]; then
    ln -sf "/usr/share/zoneinfo/$HSB_TIMEZONE" /etc/localtime
    echo "$HSB_TIMEZONE" > /etc/timezone
fi
if [ -n "${HSB_LOCALE:-}" ]; then
    # Generated in the image: en_US, en_GB, de_DE, fr_FR, ja_JP, zh_CN; others once here.
    norm="$(echo "$HSB_LOCALE" | sed 's/UTF-8$/utf8/')"
    if ! locale -a | grep -qx "$norm"; then
        locale-gen "$HSB_LOCALE" >/dev/null || echo "hsb-setup: cannot generate locale $HSB_LOCALE" >&2
    fi
    printf 'LANG=%s\n' "$HSB_LOCALE" > /etc/default/locale   # cron, PAM
    printf 'LANG=%s\n' "$HSB_LOCALE" > /etc/locale.conf      # systemd services
    printf 'export LANG=%s\n' "$HSB_LOCALE" > /etc/profile.d/00-hsb-locale.sh  # shells
fi

# /etc/hosts of an ordinary machine (podman's is off: --no-hosts): this host
# name and localhost, nothing of the host or the container.
name="$(hostname)"
cat > /etc/hosts <<HOSTS
127.0.0.1	localhost
127.0.1.1	$name
::1	localhost ip6-localhost ip6-loopback
ff02::1	ip6-allnodes
ff02::2	ip6-allrouters
HOSTS

# The guest user: dev renamed (once; the container keeps it until recreated).
if ! id -u "$user" >/dev/null 2>&1; then
    usermod -l "$user" dev
fi
cur_group="$(id -gn "$user")"
if [ "$cur_group" != "$group" ] && ! getent group "$group" >/dev/null; then
    groupmod -n "$group" "$cur_group"
fi
if [ "$(getent passwd "$user" | cut -d: -f6)" != "$home" ]; then
    usermod -d "$home" "$user"   # never -m: the home is a mount
fi
[ -x "$shell" ] || shell=/bin/bash
if [ "$(getent passwd "$user" | cut -d: -f7)" != "$shell" ]; then
    usermod -s "$shell" "$user"
fi
cur_uid="$(id -u "$user")" cur_gid="$(id -g "$user")"
if [ "$cur_gid" != "$want_gid" ]; then
    groupmod -o -g "$want_gid" "$(id -gn "$user")"
fi
if [ "$cur_uid" != "$want_uid" ]; then
    usermod -o -u "$want_uid" "$user"
fi
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$user" > /etc/sudoers.d/dev
chmod 440 /etc/sudoers.d/dev

# A private home (~/.happy-sandbox/<name>/home, filled from the image's
# /home/dev by happy-sandbox): hand over anything not the host user's. The
# host's own home (home mode "host") is never touched.
if [ "$home_mode" != host ] && [ -d "$home" ] &&
    [ -n "$(find "$home" \( ! -user "$want_uid" -o ! -group "$want_gid" \) -print -quit)" ]; then
    chown -R --no-dereference "$want_uid:$want_gid" "$home"
fi
# Private tool state (access.home.private) and the apt record, mounted under
# /var/lib/happy-sandbox. Never link/: the host's network process listens
# there and must keep it (a build container has no keep-id: a chown would
# hand it to a sub-uid the host user cannot write).
for d in /var/lib/happy-sandbox/*/; do
    case "$d" in */link/) continue ;; esac
    [ -d "$d" ] && chown "$want_uid:$want_gid" "$d"
done

# The user's crontab: the nightly happy update and keeping the happy daemon
# running once logged in. In the container, so it is rewritten when a
# container is recreated; the nightly line also comes from the installer.
tab="/var/spool/cron/crontabs/$user"
touch "$tab"
# happy lives in the image's /home/dev (also with the host's home); without
# it (an image built without happy) there is nothing to keep running. Both
# lines run through /etc/happy-sandbox/run: the environment of every way in
# (HAPPY_HOME_DIR and the other private tool state, access.env).
dist=/home/dev/.happy-dist
if [ -x "$dist/nightly-update.sh" ] && ! grep -q 'happy-dist nightly update' "$tab"; then
    echo "0 3 * * * /etc/happy-sandbox/run $dist/nightly-update.sh # happy-dist nightly update" >> "$tab"
fi
# Lines from before the run wrapper: replaced.
sed -i '/happy-sandbox: keep the happy daemon running/,+2d' "$tab"
if [ -d "$dist" ]; then
    cat >> "$tab" <<'CRON'
# happy-sandbox: keep the happy daemon running (once logged in: happy auth login)
@reboot /etc/happy-sandbox/run bash -c '[ -f "${HAPPY_HOME_DIR:-$HOME/.happy}/access.key" ] && happy daemon start' >/dev/null 2>&1
*/5 * * * * /etc/happy-sandbox/run bash -c '[ -f "${HAPPY_HOME_DIR:-$HOME/.happy}/access.key" ] && happy daemon start' >/dev/null 2>&1
CRON
fi
chown "$user:crontab" "$tab"
chmod 600 "$tab"
