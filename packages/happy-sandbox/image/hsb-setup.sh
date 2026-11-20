#!/bin/bash
# First boot of a sandbox, as root (hsb-setup.service): give the `dev` user the
# host user's uid / gid, so files in shares (bind mounts, --userns=keep-id)
# and in the home volume belong to the host user. Idempotent.
set -euo pipefail
want_uid="${HSB_UID:-1000}" want_gid="${HSB_GID:-1000}"

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
    printf 'export LANG=%s\n' "$HSB_LOCALE" > /etc/profile.d/00-hsb-locale.sh  # shells (runuser -l)
fi
cur_uid="$(id -u dev)" cur_gid="$(id -g dev)"
if [ "$cur_gid" != "$want_gid" ]; then
    groupmod -o -g "$want_gid" dev
fi
if [ "$cur_uid" != "$want_uid" ]; then
    usermod -o -u "$want_uid" dev
fi
# The home (~/.happy-sandbox/<name>/home, a bind mount) is filled from the
# image's /home/dev by happy-sandbox; hand over anything not the host user's.
# (usermod -u already moves the owner of files in the home, not their group,
# so look for any file still not the host user's.)
if [ -n "$(find /home/dev \( ! -user "$want_uid" -o ! -group "$want_gid" \) -print -quit)" ]; then
    chown -R --no-dereference "$want_uid:$want_gid" /home/dev
fi
# dev's crontab: the nightly happy update and keeping the happy daemon running
# once logged in. In the container, so it is rewritten when a container is
# recreated (shares or identity changed); the nightly line also comes from the installer.
tab=/var/spool/cron/crontabs/dev
touch "$tab"
if ! grep -q 'happy-dist nightly update' "$tab"; then
    echo '0 3 * * * /home/dev/.happy-dist/nightly-update.sh # happy-dist nightly update' >> "$tab"
fi
if ! grep -q 'happy-sandbox: keep the happy daemon running' "$tab"; then
    cat >> "$tab" <<'CRON'
# happy-sandbox: keep the happy daemon running (once logged in: happy auth login)
@reboot bash -lc '[ -f ~/.happy/access.key ] && happy daemon start' >/dev/null 2>&1
*/5 * * * * bash -lc '[ -f ~/.happy/access.key ] && happy daemon start' >/dev/null 2>&1
CRON
fi
chown "dev:crontab" "$tab"
chmod 600 "$tab"
