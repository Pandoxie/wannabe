# happy 命令参考

由 `packages/happy-cli/src/original/help/registry.ts` 生成（`pnpm docs:commands`），请勿手改。终端里同样的内容：`happy help all`。English: [COMMANDS.md](COMMANDS.md).

`LANG`（或 `HAPPY_LANG`）以 `zh` 开头时帮助显示中文。bash/zsh 的 Tab 补全：`happy completion install`（安装器会自动做）。

- [开始会话](#start)
- [机器与会话](#manage)
- [安装与更新](#install)
- [沙盒](#sandbox)
- [网络](#network)
- [Fleet 与通知](#together)
- [账号](#account)
- [排错](#trouble)
- [其他（上游）](#other)

<a id="start"></a>

## 开始会话

### `happy [选项]`

启动 Claude Code 会话，可在手机/网页上跟进。

直接运行 `happy`（或 `happy claude`）就是在 Happy 下启动 Claude Code。Claude Code 的所有选项都能用：happy 不认识的选项会原样交给 claude。

| 选项 | 作用 |
| --- | --- |
| `--yolo` | 跳过所有权限确认（= --dangerously-skip-permissions） |
| `--model <model>` | 模型，例如 claude-opus-5-5 |
| `--effort <level>` | 推理强度 |
| `--permission-mode <mode>` | 启动时的权限模式 |
| `-r, --resume [claude-id]` | Claude Code 自己的恢复（不给 id 则弹出选择） |
| `-c, --continue` | 接着本目录最近的对话 |
| `--chrome` | 让 Claude 使用 Chrome 浏览器 |
| `--no-chrome` | 不用 Chrome（即使设置里开着） |
| `--no-sandbox` | 本次不用 `happy sandbox` 的系统沙盒 |
| `--claude-env KEY=VALUE` | 传给 Claude 的环境变量，例如 ANTHROPIC_BASE_URL=… |
| `--js-runtime <runtime>` | 用 node 或 bun 运行 Claude Code |
| `-v, --version` | happy 和 Claude Code 的版本 |

Claude Code 的其他选项也都能用：happy 会原样交给 `claude`（`happy help claude` 会列出）。

```sh
happy
happy --yolo
happy --model claude-opus-5-5 --effort high
happy --resume
```

### `happy codex [选项]`

启动 Codex 会话，可在手机/网页上跟进。

| 选项 | 作用 |
| --- | --- |
| `--yolo` | 不需要批准，完全权限 |
| `--model <model>` | 模型，例如 gpt-6.2-astra |
| `--effort <level>` | 推理强度 |
| `--permission-mode <mode>` | 启动时的权限模式 |
| `-r, --resume <thread-id>` | 接着一个 Codex 线程 |
| `--no-sandbox` | 本次不用 `happy sandbox` 的系统沙盒 |

```sh
happy codex
happy codex --model gpt-6.2-astra --effort high
```

### `happy resume <session-id>`

按 Happy 会话 id（或前缀）在原目录恢复会话。

回到保存的目录，接着 Claude Code 或 Codex 的对话。按 Tab 会列出本机记得的会话（最新的在前）。

```sh
happy resume cmmij8
```

<a id="manage"></a>

## 机器与会话

### `happy agent <命令>`

在终端里管理账号下的机器和会话（happy-agent）。

happy-agent 用自己的登录（`happy agent auth login`，在 App 里扫二维码）连接中继，能看到账号下所有机器和会话，不只是本机。

| 命令 | 作用 |
| --- | --- |
| `happy agent auth login` | 用 App 扫二维码登录 |
| `happy agent auth logout` | 删除保存的登录 |
| `happy agent auth status` | 查看登录状态 |
| `happy agent machines` | 列出机器<br>`--active` 只看在线的机器<br>`--json` 以 JSON 输出 |
| `happy agent list` | 列出会话<br>`--active` 只看活跃的会话<br>`--json` 以 JSON 输出 |
| `happy agent status <session-id>` | 会话的实时状态<br>`--json` 以 JSON 输出 |
| `happy agent spawn` | 在某台机器上启动新会话<br>`--machine <machine-id>` 机器 id 或前缀<br>`--path <path>` 工作目录（默认是主目录）<br>`--agent <agent>` claude 或 codex<br>`--create-dir` 目录不存在时创建<br>`--json` 以 JSON 输出 |
| `happy agent resume <session-id>` | 在原机器上恢复会话<br>`--json` 以 JSON 输出 |
| `happy agent create` | 只创建会话记录（不启动 agent）<br>`--tag <tag>` 会话标签<br>`--path <path>` 工作目录<br>`--json` 以 JSON 输出 |
| `happy agent send <session-id> <message>` | 给会话发消息<br>`--yolo` 以 yolo 权限模式发送<br>`--model <model>` 本条及之后消息用的模型<br>`--wait` 等到 agent 空闲<br>`--json` 以 JSON 输出 |
| `happy agent history <session-id>` | 读取会话的消息<br>`--limit <n>` 最多 n 条<br>`--json` 以 JSON 输出 |
| `happy agent stop <session-id>` | 停止会话 |
| `happy agent wait <session-id>` | 等到 agent 空闲<br>`--timeout <seconds>` 超时秒数（默认 300） |
| `happy agent cleanup` | 删除离线很久的机器和结束的旧会话（默认只列出，加 --yes 才删）<br>`--yes` 真的删除列出的内容<br>`--machine-days <n>` 离线超过 n 天的机器（默认 5）<br>`--short-days <n>` 短会话/空会话结束超过 n 天（默认 5）<br>`--long-days <n>` 其他结束的会话超过 n 天（默认 50）<br>`--short-messages <n>` “短会话”指消息少于 n 条（默认 30）<br>`--json` 以 JSON 输出计划 |

### `happy daemon <命令>`

后台服务：让 App 能在本机启动会话。

每个 happy 主目录（HAPPY_HOME_DIR，默认 ~/.happy）一个 daemon。daemon 停了，会话照样运行。

| 命令 | 作用 |
| --- | --- |
| `happy daemon start` | 启动 daemon（后台） |
| `happy daemon stop` | 停止 daemon（会话继续运行） |
| `happy daemon status` | daemon 状态 |
| `happy daemon list` | 这个 daemon 管理的会话 |
| `happy daemon stop-session <session-id>` | 停止一个会话 |
| `happy daemon restart-sessions` | 让运行中的会话换到已安装的 happy、Claude Code、Codex 上重启<br>`--outdated` 只重启跑在旧版 happy 上的 |
| `happy daemon clean` | 停止 daemon 已不在的会话（本 HAPPY_HOME_DIR）<br>`--dry-run` 只列出 |
| `happy daemon logs` | 最新 daemon 日志的路径 |
| `happy daemon install` | macOS：安装为系统服务（sudo） |
| `happy daemon uninstall` | macOS：移除系统服务（sudo） |

<a id="install"></a>

## 安装与更新

### `happy update [<命令> | <version>]`

更新 Claude Code、Codex 和 happy；有变化时重启会话。

运行 ~/.happy-dist/install.sh。不会动 happy-sandbox（那个用 `happy cage update`）。其他 happy 主目录：HAPPY_HOME_DIR=~/.happy_x happy update。

| 命令 | 作用 |
| --- | --- |
| `happy update status` | 版本、daemon、每晚自动更新 |
| `happy update verify` | 检查安装（更新中断之后用） |
| `happy update list` | 所有版本，最新的在最后 |

```sh
happy update
happy update 1.2.6+orig.58
```

### `happy uninstall [选项]`

从本机卸载 happy（先列出要做的事）。

| 选项 | 作用 |
| --- | --- |
| `--yes` | 真的执行 |
| `--purge` | 同时删除 happy 主目录（登录、会话密钥） |

### `happy completion <命令>`

bash 和 zsh 的 Tab 补全。

安装器会自动配置（`happy completion install`），之后开一个新 shell 即可。`happy completion bash|zsh` 打印脚本。

| 命令 | 作用 |
| --- | --- |
| `happy completion install` | 写入 ~/.bashrc 和 ~/.zshrc |
| `happy completion uninstall` | 移除 |
| `happy completion bash` | 打印 bash 脚本 |
| `happy completion zsh` | 打印 zsh 脚本 |

<a id="sandbox"></a>

## 沙盒

cage = 只有一个固定出口 IP 的容器（wannabe）；sandbox = 本机上的系统级限制（上游）。

### `happy cage <命令>`

Podman 沙盒，唯一出口是指定的 IP（happy-sandbox）。

happy-sandbox（Linux，rootless Podman）把 happy 和 agent 放进一个容器，网络只有一个 VLESS 出口，模型厂商看到的 IP、时区、语言始终一致。它有自己的安装器：`happy cage install`。和 `happy sandbox` 不是一回事：后者只限制 Claude/Codex 在本机能碰哪些文件。

| 命令 | 作用 |
| --- | --- |
| `happy cage install` | 安装 happy-sandbox（从 happy 的同一个发布源） |
| `happy cage update` | 更新 happy-sandbox |
| `happy cage uninstall` | 卸载 happy-sandbox |
| `happy cage init` | 创建沙盒<br>`--node <file>` 一个 mihomo 节点文件（chmod 600）<br>`--exit-ip <ip>` 模型厂商必须看到的公网 IPv4<br>`--share SRC:TARGET[:ro]` 共享宿主机目录（可多次）<br>`--timezone <tz>` 出口所在地的时区<br>`--locale <locale>` 出口所在地的 locale<br>`--hostname <name>` 主机名（App 里显示的机器名）<br>`--image <image>` 镜像 |
| `happy cage up` | 启动；出口确认是该 IP 后才放行网络 |
| `happy cage down` | 停止（文件和登录都保留） |
| `happy cage shell` | 以 dev 用户进入沙盒的 shell |
| `happy cage exec -- <command>...` | 在沙盒里执行命令 |
| `happy cage status` | 状态、出口、网络 |
| `happy cage identity` | 从沙盒里面看到的身份信息 |
| `happy cage list` | 所有沙盒 |
| `happy cage check` | 本机能否运行沙盒（不能的话原因） |
| `happy cage share list` | 列出共享 |
| `happy cage share add <src> <target>` | 添加共享<br>`--ro` 只读 |
| `happy cage share rm <target>` | 删除共享 |
| `happy cage image load <file>` | 安装镜像（OCI 包）；沙盒下次 up 时切换过去 |
| `happy cage image list` | 已安装的镜像 |
| `happy cage enable` | 随宿主机启动；网络出错时自动重启 |
| `happy cage disable` | 改回手动启动（现在就停止） |
| `happy cage selinux-policy` | SELinux 主机：沙盒需要的策略<br>`--install` 通过 sudo 安装 |
| `happy cage destroy` | 删除沙盒及其主目录<br>`--yes` 确认删除 |
| `happy cage version` | happy-sandbox 版本 |

| 选项 | 作用 |
| --- | --- |
| `--name <name>` | 操作 "default" 以外的沙盒 |

### `happy sandbox <命令>`

限制 Claude/Codex 在本机能访问的文件和网络（上游的系统沙盒）。

上游的沙盒在本机用操作系统机制包住每个会话（文件、网络）。它不改变出口 IP；要固定出口用 `happy cage`。

| 命令 | 作用 |
| --- | --- |
| `happy sandbox configure` | 交互式配置 |
| `happy sandbox status` | 当前配置 |
| `happy sandbox disable` | 关闭 |

<a id="network"></a>

## 网络

### `happy egress <命令>`

只通过预期的出口访问模型厂商。

本 HAPPY_HOME_DIR 的 daemon 每轮对话前检查出口，出口不对时暂停会话。

| 命令 | 作用 |
| --- | --- |
| `happy egress lock [IP[,IP]]` | 锁定到这些 IP 和/或国家<br>`--country <cc[,cc]>` 国家代码，例如 US |
| `happy egress unlock` | 解除锁定 |
| `happy egress status` | 锁定设置和当前出口 |

```sh
happy egress lock 203.0.113.7 --country US
happy egress status
```

<a id="together"></a>

## Fleet 与通知

### `happy fleet <命令>`

Fleet：让账号下的 agent 互相发现、互发消息。

agent 通过 happy 工具 list_agents 和 send_to_agent 通信。每个账号只需在一台机器上打开；第二台会等待。

| 命令 | 作用 |
| --- | --- |
| `happy fleet on` | 为本 HAPPY_HOME_DIR 打开（没有 agent.key 时需扫码） |
| `happy fleet off` | 关闭<br>`--delete` 同时删除 $HAPPY_HOME_DIR/fleet |
| `happy fleet status` | 开关状态、hub、最近日志 |
| `happy fleet logs` | hub 的日志<br>`-f` 持续跟踪 |

### `happy notify [选项]`

给手机发推送通知。

| 选项 | 作用 |
| --- | --- |
| `-p <message>` | 消息内容（必填） |
| `-t <title>` | 标题（默认 "Happy"） |

```sh
happy notify -p "Deployment complete" -t "Server"
```

<a id="account"></a>

## 账号

### `happy auth <命令>`

本机登录 Happy。

| 命令 | 作用 |
| --- | --- |
| `happy auth login` | 登录（在 App 里扫二维码）<br>`--force` 清除凭据和机器 id、停止 daemon 后重新登录 |
| `happy auth logout` | 删除登录和机器数据 |
| `happy auth status` | 查看登录状态 |

### `happy connect <命令>`

把 AI 厂商的 API key 存到 Happy 云端。

| 命令 | 作用 |
| --- | --- |
| `happy connect claude` | 存入你的 Anthropic API key |
| `happy connect codex` | 存入你的 OpenAI（Codex）API key |
| `happy connect status` | 已连接哪些厂商 |

<a id="trouble"></a>

## 排错

### `happy doctor <命令>`

诊断：版本、进程、日志。

| 命令 | 作用 |
| --- | --- |
| `happy doctor clean` | 杀掉所有 happy 进程（daemon 和会话） |

### `happy help [all | <command>…]`

本帮助；`happy help <命令>` 看单个命令，`happy help all` 看全部。

<a id="other"></a>

## 其他（上游）

### `happy server [选项]`

本地运行 Happy 服务器（上游自托管；需要 happy-server-self-host）。

| 选项 | 作用 |
| --- | --- |
| `-p, --port <n>` | 端口（默认 3005） |
| `--host <ip>` | 监听地址（默认 127.0.0.1） |
| `--reset` | 先清空本地服务器数据 |
| `--no-persist` | 不把 serverUrl 写入 settings.json |
| `--master-secret <hex>` | 使用指定的 master secret |
