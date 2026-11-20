#!/usr/bin/env bash
# Publishes a happy-sandbox release into the happy-dist checkout, under
# sandbox/ only — happy's installer and `happy update` never read it.
#
#   tools/release.sh VERSION [--publish]
#
#   sandbox/latest                         VERSION
#   sandbox/install.sh, sandbox/README.md  from release/ and README.md
#   sandbox/releases/VERSION/              happy-sandbox, mihomo, manifest
#   sandbox/images/happy-sandbox-ID.tar.gz the image (OCI archive, gzip);
#                                          shared by releases until it changes
#
# DIST is a git checkout (binaries and images become Git LFS objects; a
# commit, pushed with --publish) or a plain directory (files only: serve it
# over http(s), or install from it with HAPPY_DIST_URL=file:///…). The image is the one in the
# development storage (tools/build-image.sh); it is checked for the test
# node's credentials before it leaves.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
B="${HSB_BUILD:-$HOME/build/happy-sandbox-v2}"
DIST="${HAPPY_DIST:-$HOME/build/happy-dist}"
P="$here/tools/podman-dev"
version="${1:?version, e.g. 0.1.0}"
publish="${2:-}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version: x.y.z" >&2; exit 1; }
[ -d "$DIST" ] || { echo "no happy-dist directory at $DIST" >&2; exit 1; }
out="$DIST/sandbox"
rel="$out/releases/$version"
[ ! -e "$rel" ] || { echo "release $version exists already" >&2; exit 1; }
work="$B/release-work"
mkdir -p "$work"

echo "==> tests"
(cd "$here" && go vet ./cmd/... ./internal/... && go test ./internal/...) > "$work/test.log" 2>&1 || { cat "$work/test.log"; exit 1; }

echo "==> binary"
(cd "$here" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
    -ldflags "-s -w -X main.version=$version" -o "$work/happy-sandbox" ./cmd/happy-sandbox)
cp "$B/deps/mihomo" "$work/mihomo"

image=localhost/happy-sandbox:latest
id="$("$P" image inspect --format '{{.Id}}' "$image")"
archive="happy-sandbox-${id:0:12}.tar.gz"
mkdir -p "$out/images"
if [ -f "$out/images/$archive" ]; then
    echo "==> image ${id:0:12} already published"
else
    echo "==> image ${id:0:12}: saving"
    rm -f "$work/image.tar"
    "$P" save --format oci-archive -o "$work/image.tar" "$image"
    echo "==> image: no node credentials inside"
    # Every layer, uncompressed; the values are read here and never printed.
    python3 - "$B/secrets" "$work/image.tar" <<'PY'
import re, sys, pathlib, tarfile, gzip, io
vals = set()
for f in pathlib.Path(sys.argv[1]).glob('*.yaml'):
    for m in re.finditer(r'(uuid|public-key|short-id|password)\s*:\s*["\']?([^"\',}\s]+)', f.read_text()):
        if len(m.group(2)) >= 8: vals.add(m.group(2).encode())
hits, layers = 0, 0
with tarfile.open(sys.argv[2]) as t:
    for m in t:
        if not m.isfile() or m.size < 1024: continue
        raw = t.extractfile(m).read()
        if raw[:2] == b'\x1f\x8b':
            raw = gzip.decompress(raw); layers += 1
        hits += sum(raw.count(v) for v in vals)
print(f'   {len(vals)} values, {layers} layers checked, {hits} found')
sys.exit(1 if hits or not vals else 0)
PY
    echo "==> image: compressing"
    pigz -6 -c "$work/image.tar" > "$work/$archive"
    rm -f "$work/image.tar"
    mv "$work/$archive" "$out/images/$archive"
fi

sha() { sha256sum "$1" | cut -d' ' -f1; }
mkdir -p "$rel"
mv "$work/happy-sandbox" "$rel/happy-sandbox-linux-amd64"
mv "$work/mihomo" "$rel/mihomo-linux-amd64"
commit="$(git -C "$here" rev-parse HEAD)"
cat > "$rel/manifest" <<EOF
release $version
date $(date -u +%Y-%m-%dT%H:%M:%SZ)
commit $commit
happy-sandbox happy-sandbox-linux-amd64
happy-sandbox.sha256 $(sha "$rel/happy-sandbox-linux-amd64")
mihomo mihomo-linux-amd64
mihomo.sha256 $(sha "$rel/mihomo-linux-amd64")
image $archive
image.sha256 $(sha "$out/images/$archive")
image_id $id
image_size_mb $(( $(stat -c %s "$out/images/$archive") / 1048576 ))
EOF
cp "$here/release/install.sh" "$out/install.sh"
cp "$here/README.md" "$out/README.md"
echo "$version" > "$out/latest"

if [ ! -d "$DIST/.git" ]; then
    echo "happy-sandbox $version written to $DIST/sandbox (a plain directory: no commit)"
    exit 0
fi
# LFS for the large files only; the manifest, installer and README stay text.
attrs="$DIST/.gitattributes"
for pat in 'sandbox/images/*.tar.gz' 'sandbox/releases/*/*-linux-amd64'; do
    grep -qxF "$pat filter=lfs diff=lfs merge=lfs -text" "$attrs" 2>/dev/null || echo "$pat filter=lfs diff=lfs merge=lfs -text" >> "$attrs"
done
git -C "$DIST" lfs install --local > /dev/null
git -C "$DIST" add .gitattributes sandbox
git -C "$DIST" commit -q -m "happy-sandbox $version" -m "image ${id:0:12}, happy-original ${commit:0:9}"
git -C "$DIST" lfs ls-files | grep sandbox/ || true
if [ "$publish" = --publish ]; then
    git -C "$DIST" push -q origin HEAD
    echo "published happy-sandbox $version"
else
    echo "committed in $DIST; push with: git -C $DIST push origin HEAD"
fi
