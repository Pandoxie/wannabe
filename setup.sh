#!/usr/bin/env bash
# wannabe 一键安装：构建 happy 套件和 sandbox 镜像，装好一个带 happy 的 sandbox。
#
#   ./setup.sh 节点.yaml [出口IP]
#
# 节点.yaml：一个代理节点（mihomo 格式，见 node.example.yaml）。出口 IP：这个
# 节点对外显示的公网 IP；节点的 server 写的是 IP 时可以省略（就用它）。
# 可以重复运行：做过的步骤会跳过。
#
# 环境变量（都可不设）：
#   WANNABE_DIST     发布目录（默认 ~/wannabe-dist）
#   HSB_BUILD        构建目录（默认 ~/build/happy-sandbox-v2）
#   WANNABE_SANDBOX  sandbox 名字（默认 default）
#   WANNABE_REBUILD=1  重新构建镜像
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="${WANNABE_DIST:-$HOME/wannabe-dist}"
B="${HSB_BUILD:-$HOME/build/happy-sandbox-v2}"
NAME="${WANNABE_SANDBOX:-default}"
SB="$ROOT/packages/happy-sandbox"

step() { printf '\n\033[1;36m[%s] %s\033[0m\n' "$1" "$2"; }
say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[31m错误：\033[0m%s\n' "$*" >&2; exit 1; }

node_file="${1:-}"
exit_ip="${2:-}"
[ -n "$node_file" ] || die "用法：./setup.sh 节点.yaml [出口IP]（节点文件的写法见 node.example.yaml）"
[ -f "$node_file" ] || die "找不到节点文件 $node_file"

# ── 1. 检查环境 ────────────────────────────────────────────────────────────
step 1/7 "检查环境"
[ "$(uname -s)" = Linux ] || die "sandbox 只支持 Linux"
case "$(uname -m)" in x86_64|amd64) ;; *) die "sandbox 目前只支持 x86_64" ;; esac
[ "$(id -u)" != 0 ] || die "请用普通用户运行，不要用 root（sandbox 用 rootless Podman）"
missing=()
for c in git curl node python3 podman go pigz gzip sha256sum; do command -v "$c" >/dev/null || missing+=("$c"); done
[ ${#missing[@]} -eq 0 ] || die "缺少：${missing[*]}
  Ubuntu：sudo apt install git curl python3 podman uidmap pigz
  Node 20+：https://github.com/nvm-sh/nvm    Go 1.26+：https://go.dev/dl/"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)' || die "需要 Node 20 以上（现在是 $(node --version)）"
go_minor="$(go env GOVERSION | sed -E 's/^go1\.([0-9]+).*/\1/')"
[ "${go_minor:-0}" -ge 26 ] 2>/dev/null || die "需要 Go 1.26 以上（现在是 $(go env GOVERSION)）"
if ! command -v pnpm >/dev/null; then
    say "启用 pnpm（corepack）"
    corepack enable 2>/dev/null || die "没有 pnpm：运行 corepack enable（可能要 sudo），或 npm i -g pnpm@10"
fi

# 出口 IP：没给就用节点的 server（如果它是 IP）。
if [ -z "$exit_ip" ]; then
    exit_ip="$(sed -n -E 's/^[[:space:]]*server:[[:space:]]*"?([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)"?.*/\1/p' "$node_file" | head -n1)"
    [ -n "$exit_ip" ] || die "节点的 server 不是 IP，请把出口 IP 作为第二个参数给出：./setup.sh $node_file 出口IP"
    say "出口 IP 用节点的 server：$exit_ip（不对的话作为第二个参数给出）"
fi
[[ "$exit_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "出口 IP 格式不对：$exit_ip"

# 节点文件的副本（chmod 600）：构建、发布检查和 sandbox 都用它。
mkdir -p "$B/secrets" && chmod 700 "$B" "$B/secrets"
node_copy="$B/secrets/node-$NAME.yaml"
install -m 600 "$node_file" "$node_copy"

# ── 2. happy 套件 ──────────────────────────────────────────────────────────
step 2/7 "构建 happy 套件（happy、happy-agent、happy-fleet）→ $DIST"
cd "$ROOT"
pnpm install --frozen-lockfile
version="$(node -p 'require("./packages/happy-cli/package.json").version')"
mkdir -p "$DIST"
if [ -d "$DIST/releases/$version" ]; then
    say "happy $version 已经构建过（改了代码要先改 packages/happy-cli/package.json 的版本号）"
else
    node scripts/release-cli.mjs --dist "$DIST" --skip-tests --skip-claude-turn --allow-dirty
fi

# ── 3. sandbox 工具 ────────────────────────────────────────────────────────
step 3/7 "构建 happy-sandbox，下载 mihomo"
"$SB/tools/prepare-build.sh" > /dev/null
say "检查这台机器能不能跑 sandbox"
HSB_MIHOMO="$B/deps/mihomo" HSB_BUILD="$B" "$B/bin/happy-sandbox" check \
    || die "这台机器还不能跑 sandbox：先解决上面 FAIL 的项，再运行 ./setup.sh"

# ── 4. 镜像 ────────────────────────────────────────────────────────────────
step 4/7 "构建 sandbox 镜像（第一次要二三十分钟）"
stamp="happy $version, $(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo src), exit $exit_ip"
if [ "${WANNABE_REBUILD:-}" != 1 ] && [ "$(cat "$B/image.stamp" 2>/dev/null)" = "$stamp" ] \
    && "$SB/tools/podman-dev" image exists localhost/happy-sandbox:latest; then
    say "镜像已是最新（WANNABE_REBUILD=1 强制重建）"
else
    HSB_BUILD="$B" HAPPY_DIST_URL="file://$DIST" "$SB/tools/build-image.sh" "$node_copy" "$exit_ip"
    printf '%s\n' "$stamp" > "$B/image.stamp"
fi

# ── 5. 发布 sandbox ────────────────────────────────────────────────────────
step 5/7 "把 sandbox 写进发布目录"
image_id="$("$SB/tools/podman-dev" image inspect --format '{{.Id}}' localhost/happy-sandbox:latest)"
latest="$(cat "$DIST/sandbox/latest" 2>/dev/null || true)"
if [ -n "$latest" ] && grep -qx "image_id $image_id" "$DIST/sandbox/releases/$latest/manifest" 2>/dev/null; then
    say "happy-sandbox $latest 已经是这个镜像"
else
    n="$( (ls "$DIST/sandbox/releases" 2>/dev/null || true) | sed -n 's/^0\.1\.\([0-9]*\)$/\1/p' | sort -n | tail -n1)"
    sb_version="0.1.$(( ${n:--1} + 1 ))"
    HSB_BUILD="$B" HAPPY_DIST="$DIST" "$SB/tools/release.sh" "$sb_version"
fi

# ── 6. 安装 sandbox ────────────────────────────────────────────────────────
step 6/7 "安装 happy-sandbox 和镜像（到 ~/.happy-sandbox 和你自己的 Podman）"
bash "$DIST/sandbox/install.sh"
hsb="$HOME/.happy-sandbox/bin/happy-sandbox"
name_opt=(); [ "$NAME" = default ] || name_opt=(--name "$NAME")

# ── 7. 建 sandbox 并启动 ───────────────────────────────────────────────────
step 7/7 "创建并启动 sandbox「$NAME」"
if [ -f "$HOME/.happy-sandbox/$NAME/config.json" ]; then
    say "sandbox「$NAME」已经存在，直接启动"
else
    "$hsb" init "${name_opt[@]}" --node "$node_copy" --exit-ip "$exit_ip"
fi
"$hsb" up "${name_opt[@]}"

cat <<EOF

装好了。进 sandbox，登录一次：

  happy-sandbox shell${name_opt[*]:+ ${name_opt[*]}}
  happy auth login      # 用手机上的官方 Happy App 扫码（或 web：https://pandoxie.github.io/wannabe）
  claude                # 登录你的 Claude 账号
  codex login           # 可选

之后在手机或网页上就能看到这台 sandbox，在里面开 Claude / Codex 会话。
  跟宿主一起启动：happy-sandbox enable      停止：happy-sandbox down
  发布目录：$DIST（宿主上也想用 happy：bash $DIST/install.sh）
EOF
