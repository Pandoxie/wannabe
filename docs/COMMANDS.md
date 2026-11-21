# happy commands

Generated from `packages/happy-cli/src/original/help/registry.ts` (`pnpm docs:commands`); do not edit by hand. The same text: `happy help all`. 中文版：[COMMANDS.zh.md](COMMANDS.zh.md).

Help is in Chinese when `LANG` (or `HAPPY_LANG`) starts with `zh`. Tab completion for bash and zsh: `happy completion install` (the installer does this).

- [Start sessions](#start)
- [Machines and sessions](#manage)
- [Install and update](#install)
- [Sandboxes](#sandbox)
- [Network](#network)
- [Fleet and notifications](#together)
- [Account](#account)
- [Troubleshooting](#trouble)
- [Other (upstream)](#other)

<a id="start"></a>

## Start sessions

### `happy [options]`

Start a Claude Code session you can follow from the app.

Plain `happy` (or `happy claude`) runs Claude Code under Happy. Every Claude Code option works as well: happy passes what it does not know to claude.

| Option | What it does |
| --- | --- |
| `--yolo` | Skip all permission prompts (= --dangerously-skip-permissions) |
| `--model <model>` | Model, e.g. claude-opus-5-5 |
| `--effort <level>` | Reasoning effort |
| `--permission-mode <mode>` | Permission mode to start in |
| `-r, --resume [claude-id]` | Claude Code's own resume (picker without an id) |
| `-c, --continue` | Continue the latest conversation in this directory |
| `--chrome` | Give Claude the Chrome browser |
| `--no-chrome` | No Chrome, even if it is on in the settings |
| `--no-sandbox` | Without the OS sandbox of `happy sandbox` for this session |
| `--claude-env KEY=VALUE` | Environment for Claude, e.g. ANTHROPIC_BASE_URL=… |
| `--js-runtime <runtime>` | Run Claude Code with node or bun |
| `-v, --version` | Versions of happy and Claude Code |

All other Claude Code options work too: happy passes them to `claude` (`happy help claude` lists them).

```sh
happy
happy --yolo
happy --model claude-opus-5-5 --effort high
happy --resume
```

### `happy codex [options]`

Start a Codex session you can follow from the app.

| Option | What it does |
| --- | --- |
| `--yolo` | No approvals, full access |
| `--model <model>` | Model, e.g. gpt-6.2-astra |
| `--effort <level>` | Reasoning effort |
| `--permission-mode <mode>` | Permission mode to start in |
| `-r, --resume <thread-id>` | Continue a Codex thread |
| `--no-sandbox` | Without the OS sandbox of `happy sandbox` for this session |

```sh
happy codex
happy codex --model gpt-6.2-astra --effort high
```

### `happy resume <session-id>`

Resume a Happy session (id or prefix) in its directory.

Reuses the saved directory and resumes the Claude Code or Codex conversation. Tab completes the sessions this machine knows (newest first).

```sh
happy resume cmmij8
```

<a id="manage"></a>

## Machines and sessions

### `happy agent <command>`

Machines and sessions of your account, from the terminal (happy-agent).

happy-agent talks to the relay with its own login (`happy agent auth login`, a QR code scanned in the app). It sees every machine and session of the account, not only this machine.

| Command | What it does |
| --- | --- |
| `happy agent auth login` | Log in with a QR code scanned in the app |
| `happy agent auth logout` | Remove the stored login |
| `happy agent auth status` | Show the login |
| `happy agent machines` | List machines<br>`--active` Only online machines<br>`--json` Output as JSON |
| `happy agent list` | List sessions<br>`--active` Only active sessions<br>`--json` Output as JSON |
| `happy agent status <session-id>` | Live state of a session<br>`--json` Output as JSON |
| `happy agent spawn` | Start a new session on a machine<br>`--machine <machine-id>` Machine id or prefix<br>`--path <path>` Directory (default: the home directory)<br>`--agent <agent>` claude or codex<br>`--create-dir` Create the directory if it is missing<br>`--json` Output as JSON |
| `happy agent resume <session-id>` | Resume a session on the machine it ran on<br>`--json` Output as JSON |
| `happy agent create` | Create a session record (no agent runs)<br>`--tag <tag>` Session tag<br>`--path <path>` Directory<br>`--json` Output as JSON |
| `happy agent send <session-id> <message>` | Send a message to a session<br>`--yolo` Send with permission mode yolo<br>`--model <model>` Model for this and later messages<br>`--wait` Wait until the agent is idle<br>`--json` Output as JSON |
| `happy agent history <session-id>` | Read the messages of a session<br>`--limit <n>` At most n messages<br>`--json` Output as JSON |
| `happy agent stop <session-id>` | Stop a session |
| `happy agent wait <session-id>` | Wait until the agent is idle<br>`--timeout <seconds>` Give up after this (default 300) |
| `happy agent cleanup` | Delete old machines and finished sessions (lists only, unless --yes)<br>`--yes` Delete what is listed<br>`--machine-days <n>` Machines offline longer than this (default 5)<br>`--short-days <n>` Short/empty finished sessions idle longer than this (default 5)<br>`--long-days <n>` Other finished sessions idle longer than this (default 50)<br>`--short-messages <n>` "Short" means fewer messages than this (default 30)<br>`--json` The plan as JSON |

### `happy daemon <command>`

The background service that starts sessions from the app.

One daemon per happy home (HAPPY_HOME_DIR, default ~/.happy). Sessions keep running when it stops.

| Command | What it does |
| --- | --- |
| `happy daemon start` | Start the daemon (detached) |
| `happy daemon stop` | Stop the daemon (sessions stay alive) |
| `happy daemon status` | Daemon status |
| `happy daemon list` | Sessions this daemon runs |
| `happy daemon stop-session <session-id>` | Stop one session |
| `happy daemon restart-sessions` | Restart running sessions on the installed happy, Claude Code and Codex<br>`--outdated` Only those on another happy version |
| `happy daemon clean` | Stop sessions whose daemon is gone (this HAPPY_HOME_DIR)<br>`--dry-run` Only list them |
| `happy daemon logs` | Path of the latest daemon log |
| `happy daemon install` | macOS: install as a system service (sudo) |
| `happy daemon uninstall` | macOS: remove the system service (sudo) |

<a id="install"></a>

## Install and update

### `happy update [<command> | <version>]`

Update Claude Code, Codex and happy; restarts sessions if anything changed.

Runs ~/.happy-dist/install.sh. Never touches happy-sandbox (`happy cage update`). Another happy home: HAPPY_HOME_DIR=~/.happy_x happy update.

| Command | What it does |
| --- | --- |
| `happy update status` | Versions, daemons, nightly update |
| `happy update verify` | Check the install (after an interrupted update) |
| `happy update list` | Releases, newest last |

```sh
happy update
happy update 1.2.6+orig.58
```

### `happy uninstall [options]`

Remove happy from this machine (lists first).

| Option | What it does |
| --- | --- |
| `--yes` | Do it |
| `--purge` | Also delete the happy homes (logins, session keys) |

### `happy completion <command>`

Tab completion for bash and zsh.

The installer sets it up (`happy completion install`); open a new shell afterwards. `happy completion bash|zsh` prints the script.

| Command | What it does |
| --- | --- |
| `happy completion install` | Set it up in ~/.bashrc and ~/.zshrc |
| `happy completion uninstall` | Remove it again |
| `happy completion bash` | Print the bash script |
| `happy completion zsh` | Print the zsh script |

<a id="sandbox"></a>

## Sandboxes

cage = a container with one fixed exit IP (wannabe); sandbox = OS limits on this machine (upstream).

### `happy cage <command>`

A Podman sandbox whose only way out is one exit IP (happy-sandbox).

happy-sandbox (Linux, rootless Podman) runs happy and the agents in a container whose only network is one VLESS exit, so the providers always see the same IP, time zone and locale. It has its own installer: `happy cage install`. Not the same as `happy sandbox`, which only limits what Claude/Codex may touch on this machine.

| Command | What it does |
| --- | --- |
| `happy cage install` | Install happy-sandbox (from the release source happy came from) |
| `happy cage update` | Update happy-sandbox |
| `happy cage uninstall` | Remove happy-sandbox |
| `happy cage init` | Create a sandbox<br>`--node <file>` One mihomo node (chmod 600)<br>`--exit-ip <ip>` The public IPv4 the providers must see<br>`--share SRC:TARGET[:ro]` Share a host directory (repeatable)<br>`--from-host PATH[:rw]` Lend a file or directory of your home, e.g. .ssh (repeatable)<br>`--timezone <tz>` Time zone of the exit's region<br>`--locale <locale>` Locale of the exit's region<br>`--hostname <name>` Hostname (the machine name in the app)<br>`--image <image>` Image |
| `happy cage up` | Start it; the network opens once the exit is the IP |
| `happy cage down` | Stop it (files and logins are kept) |
| `happy cage shell` | A shell inside, as dev |
| `happy cage exec -- <command>...` | Run a command inside |
| `happy cage status` | State, exit, network |
| `happy cage identity` | What the sandbox looks like from inside |
| `happy cage list` | All sandboxes |
| `happy cage check` | Can this host run sandboxes (and if not, why) |
| `happy cage share list` | List shares |
| `happy cage share add <src> <target>` | Add a share<br>`--ro` Read-only |
| `happy cage share rm <target>` | Remove a share |
| `happy cage from-host list` | What is lent |
| `happy cage from-host add <path[:rw]>...` | Lend, read-only unless :rw |
| `happy cage from-host rm <path>...` | Stop lending |
| `happy cage image load <file>` | Install an image (OCI archive); sandboxes move to it at their next up |
| `happy cage image list` | Installed images |
| `happy cage enable` | Start it with the host; restart its network if it fails |
| `happy cage disable` | Start it only by hand again (stops it now) |
| `happy cage selinux-policy` | SELinux hosts: the policy sandboxes need<br>`--install` Install it through sudo |
| `happy cage destroy` | Delete the sandbox and its home<br>`--yes` Really delete |
| `happy cage version` | Version of happy-sandbox |

| Option | What it does |
| --- | --- |
| `--name <name>` | Another sandbox than "default" |

### `happy sandbox <command>`

Limit what Claude/Codex may touch on this machine (upstream's OS sandbox).

Upstream's sandbox wraps each session in an OS-level sandbox on this machine (files, network). It does not change the exit IP; for that use `happy cage`.

| Command | What it does |
| --- | --- |
| `happy sandbox configure` | Set it up interactively |
| `happy sandbox status` | Current settings |
| `happy sandbox disable` | Switch it off |

<a id="network"></a>

## Network

### `happy egress <command>`

Send to the AI providers only through the expected exit.

The daemon of this HAPPY_HOME_DIR checks the exit before every turn and holds sessions while it is wrong.

| Command | What it does |
| --- | --- |
| `happy egress lock [IP[,IP]]` | Lock to these IPs and/or a country<br>`--country <cc[,cc]>` Country codes, e.g. US |
| `happy egress unlock` | Remove the lock |
| `happy egress status` | The lock and the current exit |

```sh
happy egress lock 203.0.113.7 --country US
happy egress status
```

<a id="together"></a>

## Fleet and notifications

### `happy fleet <command>`

Fleet hub: your agents find and message each other.

Agents use the happy tools list_agents and send_to_agent. Switch it on on one machine per account; a second one waits.

| Command | What it does |
| --- | --- |
| `happy fleet on` | Switch on for this HAPPY_HOME_DIR (QR scan if there is no agent.key) |
| `happy fleet off` | Switch off<br>`--delete` Also delete $HAPPY_HOME_DIR/fleet |
| `happy fleet status` | On/off, hub, last log lines |
| `happy fleet logs` | The hub's log<br>`-f` Follow |

### `happy notify [options]`

Send a push notification to your phone.

| Option | What it does |
| --- | --- |
| `-p <message>` | The message (required) |
| `-t <title>` | Title (default "Happy") |

```sh
happy notify -p "Deployment complete" -t "Server"
```

<a id="account"></a>

## Account

### `happy auth <command>`

Log this machine in to Happy.

| Command | What it does |
| --- | --- |
| `happy auth login` | Log in (scan the QR code in the app)<br>`--force` Clear credentials and machine id, stop the daemon, log in again |
| `happy auth logout` | Remove the login and machine data |
| `happy auth status` | Show the login |

### `happy connect <command>`

Store an AI vendor API key in Happy cloud.

| Command | What it does |
| --- | --- |
| `happy connect claude` | Your Anthropic API key |
| `happy connect codex` | Your OpenAI (Codex) API key |
| `happy connect status` | Which vendors are connected |

<a id="trouble"></a>

## Troubleshooting

### `happy doctor <command>`

Diagnostics: versions, processes, logs.

| Command | What it does |
| --- | --- |
| `happy doctor clean` | Kill every happy process (daemon and sessions) |

### `happy help [all | <command>…]`

This help; `happy help <command>` for one command, `happy help all` for everything.

<a id="other"></a>

## Other (upstream)

### `happy server [options]`

Run a local Happy server (upstream self-host; needs happy-server-self-host).

| Option | What it does |
| --- | --- |
| `-p, --port <n>` | Port (default 3005) |
| `--host <ip>` | Address to bind (default 127.0.0.1) |
| `--reset` | Wipe the local server data first |
| `--no-persist` | Do not write serverUrl into settings.json |
| `--master-secret <hex>` | Use this master secret |
