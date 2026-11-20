# wannabe

**给你的 AI agent 一个完全受控的网络环境，再配一套用起来很舒服的遥控器。**

> **English:** wannabe runs Claude Code and Codex agents in a sandbox (rootless
> Podman) whose only way out is one proxy exit (VLESS, Trojan, Hysteria2, … via
> mihomo), locked to that exit's IP: if the exit fails, the network is cut, nothing
> leaks. Inside is a modified [Happy](https://github.com/slopus/happy) harness: drive
> your agents from the official Happy iOS / Android app or the web, end-to-end
> encrypted, synced in real time; agents message each other across machines (Fleet
> Watch); Claude Code and Codex update themselves nightly. The sandbox builds on
> Claude Cage (MIT). One-click setup: `./setup.sh node.yaml`.


### 受控的网络

Claude Code、Codex 这类 agent 跑在一个 sandbox 里：它是一台小 Linux 服务器
（rootless Podman），对外只有一条路，就是你指定的那个代理出口，并且锁定在这个
出口的 IP 上。出口不对或者连不上，所有对外连接立刻断开，不会漏到你本机的网络。
agent 在哪里、从哪个 IP 出去，始终由你决定。

### 随时随地遥控你的 agent

[Happy](https://github.com/slopus/happy) 是一个开源的 Claude Code / Codex 遥控器：
agent 在你自己的机器上跑，你在手机或浏览器上看它干活、给它发消息、批准它的操作，
全程端到端加密，服务器只看得到密文。

wannabe 在 Happy 的基础上做了大量改进，sandbox 里已经预装好：

- **iOS、Android、网页实时同步**：同一个会话，在手机上发一句，电脑浏览器里立刻出现；
  出门在路上用手机接着聊，回到桌前在网页上继续，无缝切换，非常舒服。
- **重做的网页客户端**：按项目和 worktree 组织会话，多台机器、多个项目一目了然。
- **Fleet Watch**：同一个账号下的 agent 能互相找到、互相发消息、互相汇报。
  让一个 agent 把活儿交给另一台机器上的 agent，做完了再报回来。
- **做完了会叫你**：agent 完成任务或卡在需要你决定的地方，会给你手机推送通知；
  还能定时给自己安排任务，比如每天收盘后做一次复盘。
- **`happy agent`**：在终端里列出、阅读、驱动所有会话，方便写脚本。

### Claude Code 和 Codex 自动保持最新

这两家几乎每周都在更新，手动跟着升级很折腾。wannabe 每天凌晨 3 点（本机时间）
自动更新 Claude Code 和 Codex；有新版本时，正在运行的会话会原地重启到新版本上，
还是同一个会话、同一段对话，你在手机上接着用就行。不需要你记得去升级，你的会话
用的永远是最新版。

本项目是 Happy（MIT）的非官方分支，和 Happy 及其作者没有关系，也不承诺支持：源码都在这里，看得懂就改，改完自己构建。

## 一键安装

一条命令：在你的 Linux 机器上构建 happy 套件和 sandbox，装好一个 sandbox，
里面已经带着 happy。然后用手机上的官方 Happy App 扫码，就能在手机上用这台
sandbox 里的 Claude / Codex。

**你需要：**

- 一台 Linux x86_64 机器（比如 Ubuntu 22.04 / 24.04），普通用户，不要用 root
- 一个代理节点（VLESS 等）：sandbox 的所有流量只走它，出口固定，连不上就断网，
  不会漏到你本机的网络
- 手机上装官方 **Happy** App（App Store / Google Play）

**第 1 步：装依赖**（Ubuntu 示例）

```bash
sudo apt install git curl python3 podman uidmap pigz
# Node 20+（推荐 nvm：https://github.com/nvm-sh/nvm）
# Go 1.26+（https://go.dev/dl/）
```

**第 2 步：写节点文件**

照着 [`node.example.yaml`](node.example.yaml) 写一个，填上你的服务器信息：

```yaml
proxies:
  - name: my-node
    type: vless
    server: 203.0.113.10            # 你的服务器 IP（或域名）
    port: 443
    uuid: 00000000-0000-0000-0000-000000000000
    network: tcp
    udp: true
    tls: true
    flow: xtls-rprx-vision
    servername: www.example.com     # REALITY 用的伪装域名（SNI）
    client-fingerprint: chrome
    reality-opts:
      public-key: 服务器的公钥
      short-id: 服务器的 short id
```

只能有一个节点。vmess、trojan、ss、hysteria2、tuic、anytls 也支持，写法见
[mihomo 文档](https://wiki.metacubex.one/config/proxies/)。

**第 3 步：运行**

```bash
git clone https://github.com/Pandoxie/wannabe.git
cd wannabe
./setup.sh ~/node.yaml            # server 是域名时再加出口 IP：./setup.sh ~/node.yaml 203.0.113.10
```

第一次要几十分钟（主要是构建镜像）。中途失败了，解决后再运行一次就行，做过的步骤会跳过。

**第 4 步：登录**

```bash
happy-sandbox shell     # 进入 sandbox
happy auth login        # 用手机 App 扫码
claude                  # 登录你的 Claude 账号
codex login             # 可选
```

手机 App 里会出现这台 sandbox，在上面开会话就行。也可以用网页：
<https://pandoxie.github.io/wannabe>。

---

**以下是给懂技术的人看的**：每一步具体做了什么，怎么单独构建、自己托管、改了代码怎么更新。

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
改了代码还没提交时加 `--allow-dirty`；这台机器上的 `claude` 没登录时加 `--skip-claude-turn`
（默认会用本机的 Claude 跑一轮真实对话来冒烟测试）。

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

1. 准备构建目录：
   ```bash
   cd packages/happy-sandbox
   tools/prepare-build.sh
   ```
   它会编译 `happy-sandbox`，并下载 sandbox 的出口客户端 [mihomo](https://github.com/MetaCubeX/mihomo)
   （固定版本，校验 sha256），放进构建目录。
2. 准备一个代理节点：mihomo 格式的节点文件（VLESS 等，chmod 600），和它的出口 IP
   （这个节点对外显示的公网 IP，安装前会核对）。sandbox 的所有流量只走这一个出口。
   节点文件放进 `~/build/happy-sandbox-v2/secrets/`，发布前会检查镜像里没有它的凭证。然后构建镜像：
   ```bash
   HAPPY_DIST_URL=file://$HOME/wannabe-dist tools/build-image.sh ~/build/happy-sandbox-v2/secrets/节点.yaml 出口IP
   ```
   `build-image.sh` 先把发布目录里最新的 happy 拷进构建用的 sandbox，再通过那个
   出口装 Node、Claude Code、Codex，然后装 happy。拷进去的文件装完就删，不会留在镜像里。
3. 发布：`HAPPY_DIST=~/wannabe-dist tools/release.sh 0.1.0`，写进同一个发布目录的 `sandbox/`。
4. 安装：`bash ~/wannabe-dist/sandbox/install.sh`，或者在装了 happy 的机器上
   `happy cage install`（和 happy 同一个来源）。

sandbox 里每天凌晨会自动更新 Claude Code 和 Codex（`happy update`，有更新才重启会话）。
happy 本身不跟着更新：sandbox 里看不到宿主的发布目录。想在 sandbox 里更新 happy，就把发布目录只读共享进去：
`happy-sandbox share add ~/wannabe-dist /reference/wannabe-dist --ro`（先 down，再 up），
然后在 sandbox 里运行一次 `bash /reference/wannabe-dist/install.sh`，之后 `happy update`
就记住了这个来源。也可以直接重新构建镜像。

## 和上游的关系

`packages/happy-wire` 原样跟随上游；`happy-cli`、`happy-agent` 保持上游的目录
结构，上游的提交可以按路径移植。relay 和原生 App 都用上游的。

## 许可证

MIT，和上游一样（`LICENSE`）。`packages/happy-sandbox` 里引用的代码另见
`LICENSE.cage` / `NOTICE.cage`。
