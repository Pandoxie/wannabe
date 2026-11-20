#!/usr/bin/env bash
# Prepares the build directory for tools/build-image.sh and tools/release.sh:
#   bin/happy-sandbox   this checkout, built (Go)
#   deps/mihomo         the exit client (MetaCubeX/mihomo, GPL-3.0), the
#                       pinned release below, checked against its sha256
#   secrets/            for your node files (0700; release.sh checks that no
#                       credential from them ended up in the image)
#
#   tools/prepare-build.sh            # HSB_BUILD (default ~/build/happy-sandbox-v2)
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
B="${HSB_BUILD:-$HOME/build/happy-sandbox-v2}"

MIHOMO_VERSION=v1.19.33
MIHOMO_FILE="mihomo-linux-amd64-compatible-$MIHOMO_VERSION.gz"
MIHOMO_URL="https://github.com/MetaCubeX/mihomo/releases/download/$MIHOMO_VERSION/$MIHOMO_FILE"
MIHOMO_GZ_SHA256=386508bfb1c72c43b6a0eda73708ecdce82546581b0ebcb16366c53757c622b6
MIHOMO_SHA256=817f50b3ac6a8b1c4360c5cf2961906057f3a883d970ebbcb0028a01632b620f

command -v go >/dev/null || { echo "go is required (1.26+: https://go.dev/dl/)" >&2; exit 1; }
mkdir -p "$B/bin" "$B/deps" "$B/secrets"
chmod 700 "$B" "$B/secrets"

echo "==> happy-sandbox → $B/bin/happy-sandbox"
(cd "$here" && CGO_ENABLED=0 go build -trimpath -o "$B/bin/happy-sandbox" ./cmd/happy-sandbox)

sha() { sha256sum "$1" | cut -d' ' -f1; }
if [ -x "$B/deps/mihomo" ] && [ "$(sha "$B/deps/mihomo")" = "$MIHOMO_SHA256" ]; then
    echo "==> mihomo $MIHOMO_VERSION already in $B/deps"
else
    echo "==> mihomo $MIHOMO_VERSION → $B/deps/mihomo"
    curl -fsSL -o "$B/deps/$MIHOMO_FILE" "$MIHOMO_URL"
    [ "$(sha "$B/deps/$MIHOMO_FILE")" = "$MIHOMO_GZ_SHA256" ] || { echo "$MIHOMO_FILE: sha256 mismatch" >&2; exit 1; }
    gzip -dc "$B/deps/$MIHOMO_FILE" > "$B/deps/mihomo.tmp"
    [ "$(sha "$B/deps/mihomo.tmp")" = "$MIHOMO_SHA256" ] || { echo "mihomo: sha256 mismatch" >&2; exit 1; }
    chmod 755 "$B/deps/mihomo.tmp" && mv -f "$B/deps/mihomo.tmp" "$B/deps/mihomo"
fi

cat <<EOF

Ready. Next: put your node file (chmod 600) into $B/secrets/, then
  HAPPY_DIST_URL=file:///your/release/dir tools/build-image.sh $B/secrets/NODE.yaml EXIT_IP
EOF
