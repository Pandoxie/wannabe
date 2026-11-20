# wannabe

*wanna be happy*：想要 happy，但有分寸。

[Happy](https://github.com/slopus/happy)（MIT）的非官方分支。用手机或浏览器
驱动你自己机器上的 Claude Code 和 Codex，端到端加密。它继续兼容上游的 relay
和上游的 iOS / Android App，并加上了我们日常在用的东西：重做的 web 客户端、
项目和 worktree 视图、Fleet Watch（会话之间互相汇报）、`happy agent`、
`happy-sandbox`（agent 跑在 rootless Podman 盒子里，只有一个受控的网络出口）。

和 Happy 及其作者没有关系，也不承诺支持：源码都在这里，看得懂就改，改完自己构建。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/happy-app` | web 客户端（Expo） |
| `packages/happy-cli` | `happy` 命令和 daemon（运行 Claude Code / Codex 会话） |
| `packages/happy-agent` | `happy agent`：在终端里列出、阅读、驱动会话 |
| `packages/happy-fleet` | Fleet Watch，由 daemon 运行（`happy fleet on`） |
| `packages/happy-sandbox` | `happy-sandbox` / `happy cage`（Go，Linux + rootless Podman） |
| `packages/happy-wire` | 协议定义，原样跟随上游 |
| `release/install.sh` | 安装器，也是 `happy update` |
| `scripts/release-cli.mjs` | 构建 CLI 发布包 |

命令仍然叫 `happy`，数据目录仍然是 `~/.happy`。官方 npm 包 `happy-coder`
也提供 `happy` 命令，两者会冲突，装之前先卸载它：`npm rm -g happy-coder`。

## 一览：每样东西从哪来

| 东西 | 怎么办 |
| --- | --- |
| 手机 | 用官方 Happy App（App Store / Google Play 搜 Happy），本项目不发 App |
| web | 用 <https://pandoxie.github.io/wannabe>，或者自己部署（见下文） |
| CLI（`happy`） | 自己构建、自己安装（见下文） |
| sandbox | 自己构建镜像（见下文） |
| relay | 默认用上游官方的；想自建就用上游的 relay |

手机 App、web 和 CLI 登录同一个账号（扫码配对），在哪边都能看到和驱动同一批会话。
用自己的 relay 时，官方 App 里也可以填自定义服务器地址。

## 准备

- Linux x64 或 macOS（arm64 / x64）
- Node 20 以上、git
- pnpm 10：`corepack enable`
- Claude Code（`curl -fsSL https://claude.ai/install.sh | bash`），Codex 可选
- 构建 sandbox 还要：Go 1.26 以上、rootless Podman、pigz

```bash
git clone https://github.com/Pandoxie/wannabe.git
cd wannabe
pnpm install
```

## Web 客户端

现成的：<https://pandoxie.github.io/wannabe>，由 `.github/workflows/pages.yml`
自动构建，连接上游官方 relay `https://api.cluster-fluster.com`。密钥只在你的
浏览器里，relay 只看得到密文。

自己托管（它是纯静态网站）：

```bash
pnpm --filter @slopus/happy-wire build
node packages/happy-app/scripts/copy-katex.cjs
cd packages/happy-app
APP_ENV=production NODE_ENV=production npx expo export --platform web --output-dir dist
```

- 把 `dist/` 交给任意静态服务器，找不到的路径返回 `index.html`（单页应用）。
- 挂在子路径下（比如 `https://example.com/happy/`）：构建时加 `HAPPY_WEB_BASE_URL=/happy`。
- 换成自己的 relay：构建时设 `EXPO_PUBLIC_HAPPY_SERVER_URL=https://…`，或者在网页的设置里改。
- 也可以直接构建 nginx 镜像：`docker build -f Dockerfile.webapp -t wannabe-web .`

fork 之后想用自己的 GitHub Pages：仓库公开后，在 Settings → Pages → Source
选 GitHub Actions，推一次 `main` 就会发布到 `https://<你的用户名>.github.io/<仓库名>/`。

## CLI：构建、发布、安装

### 1. 构建发布包

```bash
mkdir -p ~/wannabe-dist
node scripts/release-cli.mjs --dist ~/wannabe-dist     # 加 --skip-tests 跳过测试，快一些
```

它会做类型检查和测试，把 `happy`、`happy-agent`、`happy-fleet` 打包（`happy`
每个平台一个包），连同 `manifest.json`、安装器和说明一起写进 `~/wannabe-dist`。
版本号取自 `packages/happy-cli/package.json`；再发一版之前先改版本号。
如果 `--dist` 是一个 git 仓库，每次发布会提交一次，加 `--publish` 还会推送。

### 2. 安装

本机：

```bash
bash ~/wannabe-dist/install.sh
happy auth login        # 用手机 App 或 web 客户端扫码配对
```

直接运行发布目录里的 `install.sh`，它就从这个目录安装。

其他机器：把 `~/wannabe-dist` 放到任何能下载文件的地方（自己的 web 服务器、
对象存储、git 托管的 raw 文件都行），然后：

```bash
curl -fsSL https://你的地址/install.sh | HAPPY_DIST_URL=https://你的地址 bash
# 需要登录的话再加 HAPPY_DIST_AUTH=用户名:令牌
```

### 3. 更新

安装器会记住来源（`~/.happy-dist/url`），之后不用再告诉它：

- `happy update`：更新 Claude Code、Codex 和 happy；有变化才重启会话。
- 安装时会配好每天凌晨的自动更新；不想要就 `touch ~/.happy-dist/no-nightly`。
- `happy update list | status | verify | <版本>`：查看、校验、回滚。

所以改完代码，重新跑一次 `release-cli.mjs`（记得改版本号），各台机器
`happy update` 就能装上。

### 其他

- CLI 默认连上游官方 relay；用自己的 relay：`happy server`（见 `happy help server`）。
- 所有命令：`happy help all`。
- 卸载：`happy uninstall` 先列出要删什么，`happy uninstall --yes` 才真删。

## happy-sandbox

只支持 Linux + rootless Podman。先读 `packages/happy-sandbox/README.md`。

镜像需要你自己构建。先按上面「CLI」一节在本机做好发布目录（比如 `~/wannabe-dist`），
镜像里的 happy 就从它装。

构建用的东西都放在 `~/build/happy-sandbox-v2`（可用 `HSB_BUILD` 改），构建用的
Podman 存储也在那里（`tools/podman-dev`），不会碰你自己的 Podman。

1. 准备一个 mihomo 能用的代理节点文件（VLESS 等，chmod 600）和它的出口 IP。
   sandbox 的所有流量只走这一个出口。把节点文件也放一份到
   `~/build/happy-sandbox-v2/secrets/`：发布前会检查镜像里没有它的凭证。
2. 构建工具和镜像：
   ```bash
   cd packages/happy-sandbox
   go build -o ~/build/happy-sandbox-v2/bin/happy-sandbox ./cmd/happy-sandbox
   # 把 mihomo 放到 ~/build/happy-sandbox-v2/deps/mihomo
   HAPPY_DIST_URL=file://$HOME/wannabe-dist tools/build-image.sh 节点.yaml 出口IP
   ```
   `build-image.sh` 先把发布目录里最新的 happy 拷进构建用的 sandbox，再通过那个
   出口装 Node、Claude Code、Codex，然后装 happy。拷进去的文件装完就删，不会留在镜像里。
3. 发布：`HAPPY_DIST=~/wannabe-dist tools/release.sh 0.1.0`，写进同一个发布目录的 `sandbox/`。
4. 安装：`bash ~/wannabe-dist/sandbox/install.sh`，或者在装了 happy 的机器上
   `happy cage install`（和 happy 同一个来源）。

sandbox 里看不到宿主的发布目录。想在 sandbox 里更新 happy，就把发布目录只读共享进去：
`happy-sandbox share add ~/wannabe-dist /reference/wannabe-dist --ro`（先 down，再 up），
然后在 sandbox 里运行一次 `bash /reference/wannabe-dist/install.sh`，之后 `happy update`
就记住了这个来源。也可以直接重新构建镜像。

## 和上游的关系

`packages/happy-wire` 原样跟随上游；`happy-cli`、`happy-agent` 保持上游的目录
结构，上游的提交可以按路径移植。relay 和原生 App 都用上游的。

## 许可证

MIT，和上游一样（`LICENSE`）。`packages/happy-sandbox` 里引用的代码另见
`LICENSE.cage` / `NOTICE.cage`。
