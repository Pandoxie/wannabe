/**
 * Original Happy: sessions no daemon manages any more.
 *
 * A session is its own process. When its daemon stops, the session keeps
 * running — still connected to the relay and its agent, but nobody checks the
 * egress lock for it and `happy update` cannot restart it. This finds and
 * stops those, whatever HAPPY_HOME_DIR started them: "no running daemon lists
 * it" is the whole test.
 *
 * What is never touched: sessions started by hand (no `--started-by`), other
 * users' processes, and a sandbox's sessions (same uid with keep-id, another
 * mount namespace).
 */
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type OrphanSession = { pid: number; home: string | null; log: string | null; args: string }

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0)
    } catch {
        return false
    }
    // A killed process its parent has not reaped yet is a zombie: already gone.
    try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
        return stat[stat.lastIndexOf(')') + 2] !== 'Z'
    } catch {
        return true // no /proc (macOS): the kill(0) answer stands
    }
}

/** Our mount namespace? (No /proc on macOS: true.) */
function inOurNamespace(pid: number): boolean {
    try {
        return readlinkSync(`/proc/${pid}/ns/mnt`) === readlinkSync('/proc/self/ns/mnt')
    } catch {
        return true
    }
}

/** Candidate HAPPY_HOME_DIRs of this user: $HAPPY_HOME_DIR and ~/.happy*. */
export function candidateHomes(): string[] {
    const homes = new Set<string>()
    if (process.env.HAPPY_HOME_DIR) homes.add(process.env.HAPPY_HOME_DIR)
    const home = homedir()
    try {
        for (const name of readdirSync(home)) {
            if (name.startsWith('.happy')) homes.add(join(home, name))
        }
    } catch { /* no home dir */ }
    return [...homes]
}

/** Pids the running daemons of this user manage (each home's own /list). */
async function managedPids(): Promise<{ pids: Set<number>; daemons: number }> {
    const pids = new Set<number>()
    let daemons = 0
    for (const home of candidateHomes()) {
        const stateFile = join(home, 'daemon.state.json')
        if (!existsSync(stateFile)) continue
        try {
            const state = JSON.parse(readFileSync(stateFile, 'utf8'))
            if (!state?.httpPort) continue
            process.kill(state.pid, 0)
            const res = await fetch(`http://127.0.0.1:${state.httpPort}/list`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
                signal: AbortSignal.timeout(3_000),
            })
            const body: any = await res.json()
            for (const child of body?.children ?? []) {
                if (typeof child?.pid === 'number') pids.add(child.pid)
            }
            daemons += 1
        } catch { /* not running */ }
    }
    return { pids, daemons }
}

/** This user's session processes: index.mjs (claude|codex) … --started-by daemon. */
function sessionProcesses(): Array<{ pid: number; args: string }> {
    const out: Array<{ pid: number; args: string }> = []
    let entries: string[] = []
    try { entries = readdirSync('/proc') } catch { return out }
    for (const name of entries) {
        const pid = Number(name)
        if (!pid || pid === process.pid) continue
        let args: string[]
        try {
            args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
        } catch { continue }
        const entry = args.findIndex((a) => a.endsWith('index.mjs') || a.endsWith('index.js'))
        if (entry < 0) continue
        const sub = args[entry + 1]
        if (sub !== 'claude' && sub !== 'codex') continue
        if (!args.includes('--started-by')) continue // started by hand: not ours to stop
        if (!inOurNamespace(pid)) continue
        out.push({ pid, args: args.slice(entry + 1).join(' ') })
    }
    return out
}

/** The home a session belongs to, best effort (its logs/ hold `<date>-pid-<pid>.log`). */
function homeOf(pid: number, homes: string[]): { home: string | null; log: string | null } {
    for (const home of homes) {
        const logs = join(home, 'logs')
        if (!existsSync(logs)) continue
        for (const name of readdirSync(logs)) {
            if (name.endsWith(`-pid-${pid}.log`)) return { home, log: join(logs, name) }
        }
    }
    return { home: null, log: null }
}

/** This process and its ancestors: a cleanup must never stop the command it runs in. */
function ancestors(): Set<number> {
    const out = new Set<number>([process.pid])
    let pid = process.pid
    for (let i = 0; i < 64; i++) {
        let ppid: number
        try {
            const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
            ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
        } catch { break }
        if (!ppid || ppid <= 1 || out.has(ppid)) break
        out.add(ppid)
        pid = ppid
    }
    return out
}

export type FindOptions = {
    /** The session processes to consider (tests inject; production reads /proc). */
    sessions?: Array<{ pid: number; args: string }>
    /** The daemon answers to ask (tests inject). */
    managed?: () => Promise<{ pids: Set<number>; daemons: number }>
}

/** Every session of this user that no running daemon manages. */
export async function findOrphanSessions(opts: FindOptions = {}): Promise<{ orphans: OrphanSession[]; daemons: number }> {
    const { pids, daemons } = await (opts.managed ?? managedPids)()
    const homes = candidateHomes()
    const keep = ancestors()
    const orphans: OrphanSession[] = []
    for (const p of opts.sessions ?? sessionProcesses()) {
        if (pids.has(p.pid) || keep.has(p.pid) || !alive(p.pid)) continue
        const { home, log } = homeOf(p.pid, homes)
        orphans.push({ pid: p.pid, home, log, args: p.args })
    }
    return { orphans, daemons }
}

/**
 * Stops them: SIGTERM first (the session ends its turn and says goodbye as on
 * a restart), SIGKILL for those still there after `graceMs`, then a short wait.
 */
export async function cleanOrphanSessions(
    orphans: OrphanSession[],
    graceMs = 10_000,
): Promise<{ signalled: number[]; killed: number[] }> {
    const signalled: number[] = []
    const killed: number[] = []
    const keep = ancestors() // never the command's own process chain
    for (const o of orphans) {
        if (keep.has(o.pid)) continue
        try { process.kill(o.pid, 'SIGTERM'); signalled.push(o.pid) } catch { /* already gone */ }
    }
    const left = await waitGone(signalled, graceMs)
    for (const pid of left) {
        try { process.kill(pid, 'SIGKILL'); killed.push(pid) } catch { /* gone */ }
    }
    await waitGone(left, 5_000)
    return { signalled, killed }
}

async function waitGone(pids: number[], ms: number): Promise<number[]> {
    const deadline = Date.now() + ms
    let left = pids.slice()
    while (left.length > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100))
        left = left.filter(alive)
    }
    return left
}
