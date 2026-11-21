/**
 * Original Happy: every `happy` command, ours and upstream's, in one table.
 *
 * This table drives `happy --help`, `happy help <command>`, `happy <command>
 * --help`, the bash/zsh completion and docs/COMMANDS*.md (generated; a test
 * fails when they are stale). A new command, subcommand or option goes here,
 * in English and Chinese, or it is missing from all of them.
 *
 * `happy agent` (happy-agent) and `happy cage` (happy-sandbox) are separate
 * programs; their entries mirror their own option lists (happy-agent's
 * commander definitions, happy-sandbox's usage text in cmd/happy-sandbox).
 */

export type Lang = 'en' | 'zh';
export type Text = { en: string; zh: string };
/** Values the completion looks up at Tab time. */
export type Complete = 'sessions' | 'sandboxes' | 'files' | 'dirs';

export type Option = {
    flag: string;
    alias?: string;
    /** Placeholder of the value, e.g. `<n>`; absent for a switch. */
    value?: string;
    /** Fixed values offered by the completion. */
    values?: string[];
    complete?: Complete;
    text: Text;
};

export type Command = {
    name: string;
    /** Positional arguments in the usage line, e.g. `<session-id>`. */
    args?: string;
    /** What the first positional argument completes to. */
    argComplete?: Complete;
    /** Fixed values for the first positional argument. */
    argValues?: string[];
    text: Text;
    /** Longer explanation for `happy help <command>`. Options of a command apply to its subcommands too. */
    more?: Text;
    options?: Option[];
    subcommands?: Command[];
    examples?: string[];
    /** Without arguments it shows its help (it does nothing on its own). */
    helpWhenBare?: boolean;
    /** Internal: completed and documented nowhere. */
    hidden?: boolean;
};

export type Group = { id: string; title: Text; intro?: Text; commands: Command[] };

const t = (en: string, zh: string): Text => ({ en, zh });

const json = { flag: '--json', text: t('Output as JSON', '以 JSON 输出') };

const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'auto', 'read-only', 'safe-yolo', 'yolo'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** `happy` itself: a Claude Code session (`happy claude` is the same). */
export const CLAUDE: Command = {
    name: 'claude',
    args: '[options]',
    text: t('Start a Claude Code session you can follow from the app', '启动 Claude Code 会话，可在手机/网页上跟进'),
    more: t(
        'Plain `happy` (or `happy claude`) runs Claude Code under Happy. Every Claude Code option works as well: happy passes what it does not know to claude.',
        '直接运行 `happy`（或 `happy claude`）就是在 Happy 下启动 Claude Code。Claude Code 的所有选项都能用：happy 不认识的选项会原样交给 claude。',
    ),
    options: [
        { flag: '--yolo', text: t('Skip all permission prompts (= --dangerously-skip-permissions)', '跳过所有权限确认（= --dangerously-skip-permissions）') },
        { flag: '--model', value: '<model>', text: t('Model, e.g. claude-opus-5-5', '模型，例如 claude-opus-5-5') },
        { flag: '--effort', value: '<level>', values: EFFORTS, text: t('Reasoning effort', '推理强度') },
        { flag: '--permission-mode', value: '<mode>', values: PERMISSION_MODES, text: t('Permission mode to start in', '启动时的权限模式') },
        { flag: '--resume', alias: '-r', value: '[claude-id]', text: t("Claude Code's own resume (picker without an id)", 'Claude Code 自己的恢复（不给 id 则弹出选择）') },
        { flag: '--continue', alias: '-c', text: t('Continue the latest conversation in this directory', '接着本目录最近的对话') },
        { flag: '--chrome', text: t('Give Claude the Chrome browser', '让 Claude 使用 Chrome 浏览器') },
        { flag: '--no-chrome', text: t('No Chrome, even if it is on in the settings', '不用 Chrome（即使设置里开着）') },
        { flag: '--no-sandbox', text: t('Without the OS sandbox of `happy sandbox` for this session', '本次不用 `happy sandbox` 的系统沙盒') },
        { flag: '--claude-env', value: 'KEY=VALUE', text: t('Environment for Claude, e.g. ANTHROPIC_BASE_URL=…', '传给 Claude 的环境变量，例如 ANTHROPIC_BASE_URL=…') },
        { flag: '--js-runtime', value: '<runtime>', values: ['node', 'bun'], text: t('Run Claude Code with node or bun', '用 node 或 bun 运行 Claude Code') },
        { flag: '--version', alias: '-v', text: t('Versions of happy and Claude Code', 'happy 和 Claude Code 的版本') },
    ],
    examples: ['happy', 'happy --yolo', 'happy --model claude-opus-5-5 --effort high', 'happy --resume'],
};

const CODEX: Command = {
    name: 'codex',
    args: '[options]',
    text: t('Start a Codex session you can follow from the app', '启动 Codex 会话，可在手机/网页上跟进'),
    options: [
        { flag: '--yolo', text: t('No approvals, full access', '不需要批准，完全权限') },
        { flag: '--model', value: '<model>', text: t('Model, e.g. gpt-6.2-astra', '模型，例如 gpt-6.2-astra') },
        { flag: '--effort', value: '<level>', values: ['none', 'minimal', ...EFFORTS, 'ultra'], text: t('Reasoning effort', '推理强度') },
        { flag: '--permission-mode', value: '<mode>', values: PERMISSION_MODES, text: t('Permission mode to start in', '启动时的权限模式') },
        { flag: '--resume', alias: '-r', value: '<thread-id>', text: t('Continue a Codex thread', '接着一个 Codex 线程') },
        { flag: '--no-sandbox', text: t('Without the OS sandbox of `happy sandbox` for this session', '本次不用 `happy sandbox` 的系统沙盒') },
    ],
    examples: ['happy codex', 'happy codex --model gpt-6.2-astra --effort high'],
};

const RESUME: Command = {
    name: 'resume',
    args: '<session-id>',
    argComplete: 'sessions',
    text: t('Resume a Happy session (id or prefix) in its directory', '按 Happy 会话 id（或前缀）在原目录恢复会话'),
    more: t(
        'Reuses the saved directory and resumes the Claude Code or Codex conversation. Tab completes the sessions this machine knows (newest first).',
        '回到保存的目录，接着 Claude Code 或 Codex 的对话。按 Tab 会列出本机记得的会话（最新的在前）。',
    ),
    examples: ['happy resume cmmij8'],
};

// ─── happy agent (happy-agent) ───

const AGENT: Command = {
    helpWhenBare: true,
    name: 'agent',
    text: t('Machines and sessions of your account, from the terminal (happy-agent)', '在终端里管理账号下的机器和会话（happy-agent）'),
    more: t(
        'happy-agent talks to the relay with its own login (`happy agent auth login`, a QR code scanned in the app). It sees every machine and session of the account, not only this machine.',
        'happy-agent 用自己的登录（`happy agent auth login`，在 App 里扫二维码）连接中继，能看到账号下所有机器和会话，不只是本机。',
    ),
    subcommands: [
        {
            name: 'auth', text: t('Log happy-agent in or out', 'happy-agent 登录、登出'),
            subcommands: [
                { name: 'login', text: t('Log in with a QR code scanned in the app', '用 App 扫二维码登录') },
                { name: 'logout', text: t('Remove the stored login', '删除保存的登录') },
                { name: 'status', text: t('Show the login', '查看登录状态') },
            ],
        },
        { name: 'machines', text: t('List machines', '列出机器'), options: [{ flag: '--active', text: t('Only online machines', '只看在线的机器') }, json] },
        { name: 'list', text: t('List sessions', '列出会话'), options: [{ flag: '--active', text: t('Only active sessions', '只看活跃的会话') }, json] },
        { name: 'status', args: '<session-id>', argComplete: 'sessions', text: t('Live state of a session', '会话的实时状态'), options: [json] },
        {
            name: 'spawn', text: t('Start a new session on a machine', '在某台机器上启动新会话'),
            options: [
                { flag: '--machine', value: '<machine-id>', text: t('Machine id or prefix', '机器 id 或前缀') },
                { flag: '--path', value: '<path>', text: t('Directory (default: the home directory)', '工作目录（默认是主目录）') },
                { flag: '--agent', value: '<agent>', values: ['claude', 'codex'], text: t('claude or codex', 'claude 或 codex') },
                { flag: '--create-dir', text: t('Create the directory if it is missing', '目录不存在时创建') },
                json,
            ],
            examples: ['happy agent spawn --machine 46a3 --path ~/src/app --agent codex'],
        },
        { name: 'resume', args: '<session-id>', argComplete: 'sessions', text: t('Resume a session on the machine it ran on', '在原机器上恢复会话'), options: [json] },
        {
            name: 'create', text: t('Create a session record (no agent runs)', '只创建会话记录（不启动 agent）'),
            options: [
                { flag: '--tag', value: '<tag>', text: t('Session tag', '会话标签') },
                { flag: '--path', value: '<path>', complete: 'dirs', text: t('Directory', '工作目录') },
                json,
            ],
        },
        {
            name: 'send', args: '<session-id> <message>', argComplete: 'sessions', text: t('Send a message to a session', '给会话发消息'),
            options: [
                { flag: '--yolo', text: t('Send with permission mode yolo', '以 yolo 权限模式发送') },
                { flag: '--model', value: '<model>', text: t('Model for this and later messages', '本条及之后消息用的模型') },
                { flag: '--wait', text: t('Wait until the agent is idle', '等到 agent 空闲') },
                json,
            ],
            examples: ['happy agent send cmmij8 "run the tests" --wait'],
        },
        { name: 'history', args: '<session-id>', argComplete: 'sessions', text: t('Read the messages of a session', '读取会话的消息'), options: [{ flag: '--limit', value: '<n>', text: t('At most n messages', '最多 n 条') }, json] },
        { name: 'stop', args: '<session-id>', argComplete: 'sessions', text: t('Stop a session', '停止会话') },
        { name: 'wait', args: '<session-id>', argComplete: 'sessions', text: t('Wait until the agent is idle', '等到 agent 空闲'), options: [{ flag: '--timeout', value: '<seconds>', text: t('Give up after this (default 300)', '超时秒数（默认 300）') }] },
        {
            name: 'cleanup', text: t('Delete old machines and finished sessions (lists only, unless --yes)', '删除离线很久的机器和结束的旧会话（默认只列出，加 --yes 才删）'),
            options: [
                { flag: '--yes', text: t('Delete what is listed', '真的删除列出的内容') },
                { flag: '--machine-days', value: '<n>', text: t('Machines offline longer than this (default 5)', '离线超过 n 天的机器（默认 5）') },
                { flag: '--short-days', value: '<n>', text: t('Short/empty finished sessions idle longer than this (default 5)', '短会话/空会话结束超过 n 天（默认 5）') },
                { flag: '--long-days', value: '<n>', text: t('Other finished sessions idle longer than this (default 50)', '其他结束的会话超过 n 天（默认 50）') },
                { flag: '--short-messages', value: '<n>', text: t('"Short" means fewer messages than this (default 30)', '“短会话”指消息少于 n 条（默认 30）') },
                { flag: '--json', text: t('The plan as JSON', '以 JSON 输出计划') },
            ],
            examples: ['happy agent cleanup', 'happy agent cleanup --yes'],
        },
    ],
};

// ─── happy cage (happy-sandbox) ───


const CAGE: Command = {
    helpWhenBare: true,
    name: 'cage',
    text: t('A Podman sandbox whose only way out is one exit IP (happy-sandbox)', 'Podman 沙盒，唯一出口是指定的 IP（happy-sandbox）'),
    more: t(
        'happy-sandbox (Linux, rootless Podman) runs happy and the agents in a container whose only network is one VLESS exit, so the providers always see the same IP, time zone and locale. Sandboxes are numbered 1, 2, 3…: the number comes right after the command (`happy cage up 2`; none: sandbox 1). It has its own installer: `happy cage install`. Not the same as `happy sandbox`, which only limits what Claude/Codex may touch on this machine.',
        'happy-sandbox（Linux，rootless Podman）把 happy 和 agent 放进一个容器，网络只有一个 VLESS 出口，模型厂商看到的 IP、时区、语言始终一致。沙盒按 1、2、3… 编号，序号紧跟在命令后面（`happy cage up 2`；不写就是 1 号）。它有自己的安装器：`happy cage install`。和 `happy sandbox` 不是一回事：后者只限制 Claude/Codex 在本机能碰哪些文件。',
    ),
    subcommands: [
        { name: 'install', text: t('Install happy-sandbox (from the release source happy came from)', '安装 happy-sandbox（从 happy 的同一个发布源）') },
        { name: 'update', text: t('Update happy-sandbox', '更新 happy-sandbox') },
        { name: 'uninstall', text: t('Remove happy-sandbox', '卸载 happy-sandbox') },
        {
            name: 'init', text: t('Create a sandbox', '创建沙盒'),
            options: [
                { flag: '--node', value: '<file>', complete: 'files', text: t('One mihomo node (chmod 600)', '一个 mihomo 节点文件（chmod 600）') },
                { flag: '--exit-ip', value: '<ip>', text: t('The public IPv4 the providers must see', '模型厂商必须看到的公网 IPv4') },
                { flag: '--share', value: 'SRC:TARGET[:ro]', text: t('Share a host directory (repeatable)', '共享宿主机目录（可多次）') },
                { flag: '--timezone', value: '<tz>', text: t("Time zone of the exit's region", '出口所在地的时区') },
                { flag: '--locale', value: '<locale>', text: t("Locale of the exit's region", '出口所在地的 locale') },
                { flag: '--image', value: '<image>', text: t('Image', '镜像') },
                { flag: '--profile', value: 'isolated|host', text: t("host: the host's user, home, /mnt, memory and GPU; only the network and identity differ", 'host：用宿主的用户、home、/mnt、内存和 GPU，只有网络和身份不同') },
            ],
            examples: ['happy cage init --node ~/node.yaml --exit-ip 203.0.113.7 --timezone America/New_York'],
        },
        { name: 'up', args: '[N]', argComplete: 'sandboxes', text: t('Start it; the network opens once the exit is the IP', '启动；出口确认是该 IP 后才放行网络') },
        { name: 'down', args: '[N]', argComplete: 'sandboxes', text: t('Stop it (files and logins are kept)', '停止（文件和登录都保留）') },
        { name: 'restart', args: '[N]', argComplete: 'sandboxes', text: t('Down, then up (applies configuration changes)', '先 down 再 up（让配置改动生效）') },
        { name: 'here', args: '[N] [command...]', argComplete: 'sandboxes', text: t("Run a command (default: a shell) inside, in the host's current directory", '在宿主当前目录对应的沙盒路径里运行命令（默认 shell）') },
        {
            name: 'config', text: t('What the sandbox gets of the host (apply at the next up)', '沙盒能用宿主的哪些东西（下次 up 生效）'),
            subcommands: [
                { name: 'show', text: t('Show config.json', '显示 config.json') },
                { name: 'set', args: '<key> <value>', text: t('Set a key (dotted, e.g. access.resources.memory)', '设置一项（点号路径，如 access.resources.memory）') },
                { name: 'unset', args: '<key>', text: t('Remove a key', '删除一项') },
                { name: 'edit', text: t('Edit in $EDITOR, then check', '用 $EDITOR 编辑后检查') },
                { name: 'preset', args: 'host|isolated', text: t('Host mirror or isolated', '宿主镜像模式或隔离模式') },
            ],
        },
        {
            name: 'packages', text: t('apt packages the sandbox keeps (installed at every up when missing)', '沙盒一直保留的 apt 包（每次 up 时补装）'),
            subcommands: [
                { name: 'list', text: t('List them', '列出') },
                { name: 'add', args: '<package>...', text: t('Add packages', '添加') },
                { name: 'rm', args: '<package>...', text: t('Remove packages', '删除') },
            ],
        },
        { name: 'links', args: '[N]', argComplete: 'sandboxes', text: t("A sandbox's commands: claudeN, codexN, happyN, shellN", '沙盒的命令：claudeN、codexN、happyN、shellN'), options: [{ flag: '--remove', text: t('Remove them', '删除这些命令') }] },
        { name: 'shell', args: '[N]', argComplete: 'sandboxes', text: t('A shell inside, as dev', '以 dev 用户进入沙盒的 shell') },
        { name: 'exec', args: '[N] -- <command>...', argComplete: 'sandboxes', text: t('Run a command inside', '在沙盒里执行命令') },
        { name: 'status', args: '[N]', argComplete: 'sandboxes', text: t('State, exit, network', '状态、出口、网络') },
        { name: 'identity', args: '[N]', argComplete: 'sandboxes', text: t('What the sandbox looks like from inside', '从沙盒里面看到的身份信息') },
        { name: 'list', text: t('All sandboxes', '所有沙盒') },
        { name: 'check', text: t('Can this host run sandboxes (and if not, why)', '本机能否运行沙盒（不能的话原因）') },
        {
            name: 'share', text: t('Host directories inside the sandbox (apply at the next up)', '共享到沙盒的宿主机目录（下次 up 生效）'),
            subcommands: [
                { name: 'list', text: t('List shares', '列出共享') },
                { name: 'add', args: '<src> [target]', argComplete: 'dirs', text: t('Add a share', '添加共享'), options: [{ flag: '--ro', text: t('Read-only', '只读') }, { flag: '--submounts', text: t('Also every disk mounted below src', '同时包含 src 下挂载的每块盘') }] },
                { name: 'rm', args: '<target>', text: t('Remove a share', '删除共享') },
            ],
        },
        {
            name: 'image', text: t('Sandbox images', '沙盒镜像'),
            subcommands: [
                { name: 'load', args: '<file>', argComplete: 'files', text: t('Install an image (OCI archive); sandboxes move to it at their next up', '安装镜像（OCI 包）；沙盒下次 up 时切换过去') },
                { name: 'list', text: t('Installed images', '已安装的镜像') },
            ],
        },
        { name: 'enable', args: '[N]', argComplete: 'sandboxes', text: t('Start it with the host; restart its network if it fails', '随宿主机启动；网络出错时自动重启') },
        { name: 'disable', args: '[N]', argComplete: 'sandboxes', text: t('Start it only by hand again (stops it now)', '改回手动启动（现在就停止）') },
        { name: 'selinux-policy', text: t('SELinux hosts: the policy sandboxes need', 'SELinux 主机：沙盒需要的策略'), options: [{ flag: '--install', text: t('Install it through sudo', '通过 sudo 安装') }] },
        { name: 'destroy', args: '[N]', argComplete: 'sandboxes', text: t('Delete the sandbox and its home', '删除沙盒及其主目录'), options: [{ flag: '--yes', text: t('Really delete', '确认删除') }] },
        { name: 'version', text: t('Version of happy-sandbox', 'happy-sandbox 版本') },
    ],
};

// ─── upstream commands ───

const AUTH: Command = {
    helpWhenBare: true,
    name: 'auth',
    text: t('Log this machine in to Happy', '本机登录 Happy'),
    subcommands: [
        { name: 'login', text: t('Log in (scan the QR code in the app)', '登录（在 App 里扫二维码）'), options: [{ flag: '--force', text: t('Clear credentials and machine id, stop the daemon, log in again', '清除凭据和机器 id、停止 daemon 后重新登录') }] },
        { name: 'logout', text: t('Remove the login and machine data', '删除登录和机器数据') },
        { name: 'status', text: t('Show the login', '查看登录状态') },
    ],
};

const CONNECT: Command = {
    helpWhenBare: true,
    name: 'connect',
    text: t('Store an AI vendor API key in Happy cloud', '把 AI 厂商的 API key 存到 Happy 云端'),
    subcommands: [
        { name: 'claude', text: t('Your Anthropic API key', '存入你的 Anthropic API key') },
        { name: 'codex', text: t('Your OpenAI (Codex) API key', '存入你的 OpenAI（Codex）API key') },
        { name: 'status', text: t('Which vendors are connected', '已连接哪些厂商') },
    ],
};

const DAEMON: Command = {
    helpWhenBare: true,
    name: 'daemon',
    text: t('The background service that starts sessions from the app', '后台服务：让 App 能在本机启动会话'),
    more: t(
        'One daemon per happy home (HAPPY_HOME_DIR, default ~/.happy). Sessions keep running when it stops.',
        '每个 happy 主目录（HAPPY_HOME_DIR，默认 ~/.happy）一个 daemon。daemon 停了，会话照样运行。',
    ),
    subcommands: [
        { name: 'start', text: t('Start the daemon (detached)', '启动 daemon（后台）') },
        { name: 'stop', text: t('Stop the daemon (sessions stay alive)', '停止 daemon（会话继续运行）') },
        { name: 'status', text: t('Daemon status', 'daemon 状态') },
        { name: 'list', text: t('Sessions this daemon runs', '这个 daemon 管理的会话') },
        { name: 'stop-session', args: '<session-id>', argComplete: 'sessions', text: t('Stop one session', '停止一个会话') },
        { name: 'restart-sessions', text: t('Restart running sessions on the installed happy, Claude Code and Codex', '让运行中的会话换到已安装的 happy、Claude Code、Codex 上重启'), options: [{ flag: '--outdated', text: t('Only those on another happy version', '只重启跑在旧版 happy 上的') }] },
        { name: 'clean', text: t('Stop sessions whose daemon is gone (this HAPPY_HOME_DIR)', '停止 daemon 已不在的会话（本 HAPPY_HOME_DIR）'), options: [{ flag: '--dry-run', text: t('Only list them', '只列出') }] },
        { name: 'logs', text: t('Path of the latest daemon log', '最新 daemon 日志的路径') },
        { name: 'install', text: t('macOS: install as a system service (sudo)', 'macOS：安装为系统服务（sudo）') },
        { name: 'uninstall', text: t('macOS: remove the system service (sudo)', 'macOS：移除系统服务（sudo）') },
        { name: 'start-sync', text: t('Run the daemon in the foreground', '前台运行 daemon'), hidden: true },
    ],
};

const DOCTOR: Command = {
    name: 'doctor',
    text: t('Diagnostics: versions, processes, logs', '诊断：版本、进程、日志'),
    subcommands: [
        { name: 'clean', text: t('Kill every happy process (daemon and sessions)', '杀掉所有 happy 进程（daemon 和会话）') },
    ],
};

const SANDBOX: Command = {
    helpWhenBare: true,
    name: 'sandbox',
    text: t("Limit what Claude/Codex may touch on this machine (upstream's OS sandbox)", '限制 Claude/Codex 在本机能访问的文件和网络（上游的系统沙盒）'),
    more: t(
        'Upstream\'s sandbox wraps each session in an OS-level sandbox on this machine (files, network). It does not change the exit IP; for that use `happy cage`.',
        '上游的沙盒在本机用操作系统机制包住每个会话（文件、网络）。它不改变出口 IP；要固定出口用 `happy cage`。',
    ),
    subcommands: [
        { name: 'configure', text: t('Set it up interactively', '交互式配置') },
        { name: 'status', text: t('Current settings', '当前配置') },
        { name: 'disable', text: t('Switch it off', '关闭') },
    ],
};

const NOTIFY: Command = {
    name: 'notify',
    text: t('Send a push notification to your phone', '给手机发推送通知'),
    options: [
        { flag: '-p', value: '<message>', text: t('The message (required)', '消息内容（必填）') },
        { flag: '-t', value: '<title>', text: t('Title (default "Happy")', '标题（默认 "Happy"）') },
    ],
    examples: ['happy notify -p "Deployment complete" -t "Server"'],
};

const SERVER: Command = {
    name: 'server',
    text: t('Run a local Happy server (upstream self-host; needs happy-server-self-host)', '本地运行 Happy 服务器（上游自托管；需要 happy-server-self-host）'),
    options: [
        { flag: '--port', alias: '-p', value: '<n>', text: t('Port (default 3005)', '端口（默认 3005）') },
        { flag: '--host', value: '<ip>', text: t('Address to bind (default 127.0.0.1)', '监听地址（默认 127.0.0.1）') },
        { flag: '--reset', text: t('Wipe the local server data first', '先清空本地服务器数据') },
        { flag: '--no-persist', text: t('Do not write serverUrl into settings.json', '不把 serverUrl 写入 settings.json') },
        { flag: '--master-secret', value: '<hex>', text: t('Use this master secret', '使用指定的 master secret') },
    ],
};

// ─── ours ───

const UPDATE: Command = {
    name: 'update',
    args: '[<version>]',
    text: t('Update Claude Code, Codex and happy; restarts sessions if anything changed', '更新 Claude Code、Codex 和 happy；有变化时重启会话'),
    more: t(
        'Runs ~/.happy-dist/install.sh. Never touches happy-sandbox (`happy cage update`). Another happy home: HAPPY_HOME_DIR=~/.happy_x happy update.',
        '运行 ~/.happy-dist/install.sh。不会动 happy-sandbox（那个用 `happy cage update`）。其他 happy 主目录：HAPPY_HOME_DIR=~/.happy_x happy update。',
    ),
    subcommands: [
        { name: 'status', text: t('Versions, daemons, nightly update', '版本、daemon、每晚自动更新') },
        { name: 'verify', text: t('Check the install (after an interrupted update)', '检查安装（更新中断之后用）') },
        { name: 'list', text: t('Releases, newest last', '所有版本，最新的在最后') },
    ],
    examples: ['happy update', 'happy update 1.2.6+orig.58'],
};

const UNINSTALL: Command = {
    name: 'uninstall',
    text: t('Remove happy from this machine (lists first)', '从本机卸载 happy（先列出要做的事）'),
    options: [
        { flag: '--yes', text: t('Do it', '真的执行') },
        { flag: '--purge', text: t('Also delete the happy homes (logins, session keys)', '同时删除 happy 主目录（登录、会话密钥）') },
    ],
};

const COMPLETION: Command = {
    helpWhenBare: true,
    name: 'completion',
    text: t('Tab completion for bash and zsh', 'bash 和 zsh 的 Tab 补全'),
    more: t(
        'The installer sets it up (`happy completion install`); open a new shell afterwards. `happy completion bash|zsh` prints the script.',
        '安装器会自动配置（`happy completion install`），之后开一个新 shell 即可。`happy completion bash|zsh` 打印脚本。',
    ),
    subcommands: [
        { name: 'install', text: t('Set it up in ~/.bashrc and ~/.zshrc', '写入 ~/.bashrc 和 ~/.zshrc') },
        { name: 'uninstall', text: t('Remove it again', '移除') },
        { name: 'bash', text: t('Print the bash script', '打印 bash 脚本') },
        { name: 'zsh', text: t('Print the zsh script', '打印 zsh 脚本') },
    ],
};

const EGRESS: Command = {
    name: 'egress',
    text: t('Send to the AI providers only through the expected exit', '只通过预期的出口访问模型厂商'),
    more: t(
        "The daemon of this HAPPY_HOME_DIR checks the exit before every turn and holds sessions while it is wrong.",
        '本 HAPPY_HOME_DIR 的 daemon 每轮对话前检查出口，出口不对时暂停会话。',
    ),
    subcommands: [
        { name: 'lock', args: '[IP[,IP]]', text: t('Lock to these IPs and/or a country', '锁定到这些 IP 和/或国家'), options: [{ flag: '--country', value: '<cc[,cc]>', text: t('Country codes, e.g. US', '国家代码，例如 US') }] },
        { name: 'unlock', text: t('Remove the lock', '解除锁定') },
        { name: 'status', text: t('The lock and the current exit', '锁定设置和当前出口') },
    ],
    examples: ['happy egress lock 203.0.113.7 --country US', 'happy egress status'],
};

const FLEET: Command = {
    name: 'fleet',
    text: t('Fleet hub: your agents find and message each other', 'Fleet：让账号下的 agent 互相发现、互发消息'),
    more: t(
        'Agents use the happy tools list_agents and send_to_agent. Switch it on on one machine per account; a second one waits.',
        'agent 通过 happy 工具 list_agents 和 send_to_agent 通信。每个账号只需在一台机器上打开；第二台会等待。',
    ),
    subcommands: [
        { name: 'on', text: t('Switch on for this HAPPY_HOME_DIR (QR scan if there is no agent.key)', '为本 HAPPY_HOME_DIR 打开（没有 agent.key 时需扫码）') },
        { name: 'off', text: t('Switch off', '关闭'), options: [{ flag: '--delete', text: t('Also delete $HAPPY_HOME_DIR/fleet', '同时删除 $HAPPY_HOME_DIR/fleet') }] },
        { name: 'status', text: t('On/off, hub, last log lines', '开关状态、hub、最近日志') },
        { name: 'logs', text: t("The hub's log", 'hub 的日志'), options: [{ flag: '-f', text: t('Follow', '持续跟踪') }] },
    ],
};

const HELP: Command = {
    name: 'help',
    args: '[all | <command>…]',
    text: t('This help; `happy help <command>` for one command, `happy help all` for everything', '本帮助；`happy help <命令>` 看单个命令，`happy help all` 看全部'),
};

export const GROUPS: readonly Group[] = [
    { id: 'start', title: t('Start sessions', '开始会话'), commands: [CLAUDE, CODEX, RESUME] },
    { id: 'manage', title: t('Machines and sessions', '机器与会话'), commands: [AGENT, DAEMON] },
    { id: 'install', title: t('Install and update', '安装与更新'), commands: [UPDATE, UNINSTALL, COMPLETION] },
    {
        id: 'sandbox', title: t('Sandboxes', '沙盒'),
        intro: t(
            'cage = a container with one fixed exit IP (wannabe); sandbox = OS limits on this machine (upstream).',
            'cage = 只有一个固定出口 IP 的容器（wannabe）；sandbox = 本机上的系统级限制（上游）。',
        ),
        commands: [CAGE, SANDBOX],
    },
    { id: 'network', title: t('Network', '网络'), commands: [EGRESS] },
    { id: 'together', title: t('Fleet and notifications', 'Fleet 与通知'), commands: [FLEET, NOTIFY] },
    { id: 'account', title: t('Account', '账号'), commands: [AUTH, CONNECT] },
    { id: 'trouble', title: t('Troubleshooting', '排错'), commands: [DOCTOR, HELP] },
    { id: 'other', title: t('Other (upstream)', '其他（上游）'), commands: [SERVER] },
];

/** Every top-level command, `claude` included. */
export function allCommands(): Command[] {
    return GROUPS.flatMap((g) => g.commands);
}

/** The command at `path` (`['agent', 'send']`), or undefined. */
export function findCommand(path: readonly string[]): Command | undefined {
    let list = allCommands();
    let found: Command | undefined;
    for (const name of path) {
        found = list.find((c) => c.name === name);
        if (!found) return undefined;
        list = found.subcommands ?? [];
    }
    return found;
}

/**
 * The longest command path at the start of `args` (flags and their values
 * skipped): `['agent', '--json', 'list']` → `['agent', 'list']`, and the index
 * after its last word. Stops at `--`.
 */
export function commandPath(args: readonly string[]): { path: string[]; end: number } {
    const path: string[] = [];
    let end = 0;
    let list = allCommands();
    let current: Command | undefined;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--') break;
        if (arg.startsWith('-')) {
            const option = current?.options?.find((o) => o.flag === arg || o.alias === arg);
            if (option?.value && !option.value.startsWith('[')) i++;
            continue;
        }
        const next = list.find((c) => c.name === arg && !c.hidden);
        if (!next) break;
        path.push(arg);
        end = i + 1;
        current = next;
        list = next.subcommands ?? [];
    }
    return { path, end };
}
