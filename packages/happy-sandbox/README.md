# happy-sandbox

一个 rootless Podman 容器，用起来像一台小 Linux 服务器（systemd、cron、Node、Claude Code、Codex、happy 都在里面）。
**它对外只有一条路：一个 VLESS 出口，并且锁定在这个出口的 IP 上。** 出口不对或连不上，所有对外连接立即断开，不会走宿主的网络。

它和 happy 是两套东西：`happy update` 和 happy 的安装脚本都不会装它，也不会下载它的镜像。

## 需要什么

- Linux x86_64（arm64 暂不支持）
- rootless Podman 3.4+（Ubuntu 22.04 起自带：`sudo apt install podman uidmap`）、cgroup v2
- 你的用户有 subuid/subgid（`/etc/subuid`、`/etc/subgid` 里有你的用户名）
- 约 10 GB 磁盘（镜像约 2 GB，加上每个沙箱的 home）
- 一个 mihomo 格式的出口节点文件（一个节点），以及这个节点的出口公网 IP

安装时会先检查这些；缺什么会说明为什么需要、怎么解决，然后停下，不会装一半。随时可以用 `happy-sandbox check` 再查。

## 安装、更新和卸载

和 happy 的安装一样：

```bash
curl -fsSL "$HAPPY_DIST_URL/sandbox/install.sh" | bash   # HAPPY_DIST_URL: where your build is published (see the top README)
```

- 工具装在 `~/.happy-sandbox/bin`，`~/.local/bin/happy-sandbox` 是指向它的链接。
- 装了 happy 的机器上也可以统一用 `happy cage …`（和 `happy-sandbox …` 完全一样）：`happy cage install`、`happy cage update`、`happy cage uninstall`。
- 镜像约 700 MB 下载（解开约 2 GB），装进你自己的 Podman。
- 更新：`~/.happy-sandbox/bin/install.sh`（镜像没变就不重新下载）
- 卸载：先 `happy-sandbox destroy --yes --name 名字` 删掉每个沙箱，再 `~/.happy-sandbox/bin/install.sh --uninstall`

全程不需要 root，也不会调用 sudo。

## 开始用

```bash
chmod 600 node.yaml
happy-sandbox init --node node.yaml --exit-ip 203.0.113.7 \
    --timezone America/Los_Angeles --locale en_US.UTF-8 \
    --share ~/proj:/workspace/proj --share ~/data:/reference/data:ro
happy-sandbox up          # 起容器和网络；确认出口 IP 正确后才放行
happy-sandbox shell       # 以 dev 用户进去
```

第一次进去后：

```bash
happy auth login          # 扫码；App 里会多出一台机器（沙箱的 hostname）
claude                    # 登录你自己的账号
codex login
```

登录信息都在沙箱的 home 里，重启、升级镜像以后都还在。happy daemon 由沙箱里的 cron 保持运行，happy 每天夜里自动更新。

时区和 locale 请选得和出口所在地区一致。不写的话默认是美国西部、en_US.UTF-8。

## 命令

```
happy-sandbox init --node FILE --exit-ip IP [--timezone TZ] [--locale L] [--hostname H] [--share SRC:TARGET[:ro]]...
happy-sandbox up | down | status | shell | exec -- CMD...
happy-sandbox identity              这台沙箱从里面看是什么样的机器
happy-sandbox share list | add SRC TARGET [--ro] | rm TARGET     先 down 再改，下次 up 生效
happy-sandbox enable | disable      跟宿主一起启动；网络进程出错时自动重启
happy-sandbox list
happy-sandbox check                 宿主能不能跑沙箱
happy-sandbox image list | load FILE
happy-sandbox destroy --yes         删掉这个沙箱和它的整个目录
happy-sandbox version
--name N                            操作 default 以外的沙箱（可以有多个，每个可以用不同的出口）
```

## 文件在哪

每个沙箱的所有东西都在 `~/.happy-sandbox/<名字>/`：

| 文件 | 内容 |
| --- | --- |
| `config.json` | 出口 IP、镜像、共享目录；可选的资源限制和宿主端口（见下） |
| `identity.json` | 机器身份（见下） |
| `machine-id` | 由 identity.json 生成，只读挂载为 `/etc/machine-id` |
| `node.yaml` | 出口节点（权限 600） |
| `home/` | dev 用户的 home：登录信息、代码、在里面生成的 ssh/git 密钥 |
| `run/` | 网络状态和日志：`gate.log`（出口检查）、`net.log`、`mihomo.log` |

容器本身随时可以从这些文件重建。改共享目录、改身份、改资源限制、换新镜像时都会自动重建，home 保留。只有 home 以外的系统改动会丢掉，比如用 apt 装的包。

### 自己装的系统包（重建后自动补回）

`apt install` 装的东西在容器层里，容器重建时本来会丢。现在是自动的：

- 每次 `apt install`、`apt remove` 之后，沙箱都会把「你在镜像之外加装的包」记到 home 里的 `~/.config/happy-sandbox/apt-packages.auto`。
- 容器重建后开机，等网络通了，会自动把缺的包装回来（日志用 `journalctl -u hsb-packages` 查看）。

所以平时照常 `sudo apt install` 就行，什么都不用记。想在重建后多装一些还没装过的包，可以写进同目录的 `apt-packages`，一行一个，`#` 后面是注释。两个列表会合在一起装。

镜像里已经自带常用工具：vim、jq、rsync、ripgrep、tree、htop、file、zip、lsof、strace、ssh 客户端，还有 Chromium 需要的系统库和中日韩字体。这些不用写进列表。

### 资源限制（默认不限）

默认不限制 CPU、内存和进程数，沙箱和宿主上的其他程序一样，用多少占多少。需要限制时，在 `config.json` 里写上，下次 `up` 生效（会重建容器，home 保留）：

```json
"memory_bytes": 34359738368,
"cpus": 8,
"pids_limit": 16384
```

- `memory_bytes`：内存上限，单位字节（上例是 32 GiB，至少 256 MiB）。
- `cpus`：最多用几个核，可以写小数，比如 `2.5`。
- `pids_limit`：进程加线程的总数上限（至少 256）。编译、测试这类并行任务很容易用到几千个，设得太小会出现 `fork: resource temporarily unavailable`。
- 不写或写 0 就是不限制。限制是整个沙箱共用的，里面所有会话加在一起算。
- 每一项都要宿主把对应的 cgroup 控制器交给普通用户（`happy-sandbox check` 会列出有哪些）。Ubuntu 默认只给 memory 和 pids，要用 `cpus` 得先加一个 systemd 配置：`/etc/systemd/system/user@.service.d/delegate.conf` 写 `[Service]` 和 `Delegate=cpu cpuset io memory pids`，然后 `sudo systemctl daemon-reload`，重新登录。

### GPU（NVIDIA，自动）

宿主有 NVIDIA 显卡，并且装了驱动和 NVIDIA Container Toolkit（有 `/etc/cdi/nvidia.yaml` 或 `/var/run/cdi/nvidia.yaml`）时，沙箱会自动用上所有 GPU：

- 沙箱里能直接用 `nvidia-smi`。驱动用的是宿主的，宿主升级驱动后，下次 `up` 会自动重建容器跟上，home 保留。
- PyTorch 这类框架在 home 里安装就行，比如 `python3 -m venv ~/venv && ~/venv/bin/pip install torch`。它们自带 CUDA 运行库，只需要宿主的驱动；装在 home 里，重建也不会丢。
- `config.json` 里写 `"gpu": "none"` 就不给 GPU；写 `"gpu": "0"` 或某块卡的 UUID，就只给那一块。
- 没有描述文件时（比如刚装好 Toolkit），在宿主上执行一次 `sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml`。`happy-sandbox check` 会显示检测结果。

### 开发用：从沙箱连宿主端口（默认关）

`"host_ports": [22]`：沙箱里访问 `192.168.64.254:22`，就连到宿主本机的 `127.0.0.1:22`（比如从沙箱 ssh 到宿主）。只开列出的 TCP 端口、只到宿主本机，其他流量照旧只走出口。改完 `down` 再 `up` 生效，不重建容器。

宿主上的东西只有共享目录会进到沙箱里：不会带进宿主的 home，也不会带进 ssh/git 凭据。需要的话在沙箱里自己配，配好后会跟着 home 一起保留。

## 网络是怎么锁住的

- 容器没有自己的网络（`--network none`）。它唯一的网卡由宿主上的一个用户态网络栈提供。这个网络栈只把 TCP 交给 mihomo（只配置了这一个节点）；DNS 也经同一条路走 DoH。
- UDP、IPv6、局域网和宿主本机都不通，也不存在任何直连路由（`host_ports` 明确打开的宿主端口除外）。
- 出口在开始时是关着的。宿主每 15 秒通过这条路访问 AI 服务商（Anthropic、OpenAI）的 Cloudflare trace，看对方看到的 IP 是不是你配置的出口 IP，是才放行。
- 出口 IP 一旦不对，立即关闭，并断开所有已有连接。连续连不上约 15–25 秒后关闭。超过 90 秒没有确认，也会自动关闭。
- 关闭和恢复时，宿主会推送到沙箱里登录的那个 happy 账号的设备上：「⚠️ 沙箱网络已断开」「✅ 沙箱网络已恢复」。
- 沙箱里 `ping` 任何地址都会"通"：这是网络栈自己回的，没有任何数据出去。

## 机器身份

从沙箱里面看到的"这台机器"，分三层：

1. **identity.json（我们控制）**：machine-id、网卡 MAC、hostname、时区、locale。`init` 时随机生成，不取宿主的任何信息，镜像里也不带任何身份，所以同一个镜像的不同用户、不同沙箱都各不相同。之后每次 `up` 都按这个文件来，重启宿主、换新镜像、重建容器，看到的都是同一台机器。改这个文件（或从备份恢复）后，下次 `up` 就按新的来。
2. **宿主硬件（如实暴露）**：CPU 型号和核数、内存、内核版本。容器和宿主共用内核，改不了，同一台宿主上的所有沙箱都一样。我们不去伪造它们。硬件序列号这类只有宿主 root 能读的信息，沙箱里读不到。
3. **工具自己的标识（在 home 里）**：Claude Code、Codex、happy 第一次运行时各自生成的安装 ID 和登录信息，都存在 home 里，一直保留。

对外的公网 IP 就是出口 IP。

## 跟宿主一起启动

```bash
happy-sandbox enable
sudo loginctl enable-linger $USER     # 只需一次：不登录也能在开机时启动（宿主级设置，需要管理员）
```

`enable` 会为这个沙箱装一个 systemd 用户服务（`happy-sandbox@<名字>.service`）：开机启动；网络进程出错时，15 秒后自动重启，容器不受影响。启用以后 `up` / `down` 会通过 systemd 来执行。`disable` 取消开机启动，并停下沙箱。

## SELinux（CentOS / RHEL / Fedora）

这些系统默认不让容器打开 TAP 设备，而沙箱唯一的网卡就是一个 TAP。不装规则的话，
`up` 之后网络一直是 down，沙箱里连 DNS 都用不了，表现为 `EAI_AGAIN`。

装一次即可（需要 root）：

```bash
happy-sandbox selinux-policy --install    # 让它执行（会要 sudo 密码）
happy-sandbox selinux-policy              # 或者只打印命令，自己执行
```

装完 `happy-sandbox up` 就正常。撤销：`sudo semodule -r happy-sandbox`。
`happy-sandbox check` 会告诉你这条规则装了没有。

**从 0.3.0 起要重装一次规则**（模块版本 1.1）：0.3.0 的网络改成容器里的服务通过 socket 连宿主上的网络进程，
SELinux 默认也不允许这一步。旧规则（1.0）只放行了 TAP 设备。升级到 0.3.0 以后，先执行一次
`happy-sandbox selinux-policy --install`，再 `happy-sandbox down && happy-sandbox up`。
没装新规则时，`up` 会停在「等待沙箱连接」，并提示这条命令；被拒绝的记录可以用
`sudo ausearch -m avc -ts recent | grep happy` 查看。

共享目录如果在 SMB / NFS 上，还有另一个限制：网络文件系统没法打 SELinux 标签。
在挂载那个网络盘时加容器上下文（SMB 的 fstab 加
`context=system_u:object_r:container_file_t:s0`），或者把要共享的内容放本地磁盘。

## 出问题时

- `happy-sandbox status`：容器、网络（出口、上次检查时间、关闭原因）、开机启动、happy 登录状态
- `~/.happy-sandbox/<名字>/run/gate.log`：每次出口检查的结果
- 启用了开机启动的：`journalctl --user -u happy-sandbox@<名字>`
- 网络一直关着：先看节点能不能用，以及 `--exit-ip` 是不是这个节点真实的出口 IP（`gate.log` 里会写看到的是哪个 IP）
- CentOS / RHEL / Fedora（SELinux 开着）：沙箱自己的目录会自动打上容器标签，不用管。
  TAP 设备需要一条 SELinux 规则：见上面「SELinux」一节。
  共享目录如果在网络盘上（SMB、NFS），SELinux 没法给它打标签，沙箱里会读不了：
  挂载那个网络盘时加容器上下文，例如 SMB 的 fstab 里加
  `context=system_u:object_r:container_file_t:s0`；或者把要共享的内容放到本地磁盘。

## 许可

网络核心来自 Claude Cage（MIT，见 `LICENSE.cage`、`NOTICE.cage`），用户态网络栈来自 gvisor-tap-vsock（Apache-2.0）。
