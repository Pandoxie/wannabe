/**
 * Original Happy: the daemon's egress guard (`happy egress lock …`).
 *
 * When this machine's egress is locked (egress.json in HAPPY_HOME_DIR: the
 * allowed IPs and/or countries), nothing is sent to an LLM unless the exit
 * the providers see is one of them. One guard per daemon, shared by all its
 * sessions; three states:
 *
 *   idle     no session working: a check every 5 minutes
 *   busy     a session works (it asks the daemon every few seconds): every 15 s
 *   error    the exit is wrong, or the providers cannot be reached: sessions
 *            stop their turns and refuse messages; checks back off from 15 s
 *            to 10 minutes; two good results in a row recover
 *
 * The first message after idle waits for a check (a result younger than
 * 15 s counts). One wrong exit is a fault at once (the dangerous case: the
 * account); unreachable needs three failures (requests would fail anyway).
 * Recovery needs two good results in a row. No daemon, no checking.
 */
import { EGRESS_ENDPOINTS, type ProbeResult } from './egressProbe';

export type EgressLock = { ips: string[]; countries: string[] };
export type EgressState = 'off' | 'idle' | 'busy' | 'error';
export type EgressFault = { kind: 'changed'; ip: string; country: string | null } | { kind: 'unreachable'; error: string };

export type EgressStatus = {
    state: EgressState;
    lock: EgressLock | null;
    ip: string | null;
    country: string | null;
    checkedAt: number | null;
    fault: EgressFault | null;
    faultSince: number | null;
    nextCheckAt: number | null;
};

export const BUSY_INTERVAL_MS = 15_000;
export const IDLE_INTERVAL_MS = 5 * 60_000;
export const ERROR_MAX_INTERVAL_MS = 10 * 60_000;
export const FRESH_MS = 15_000;
const BUSY_HOLD_MS = 20_000; // a session counts as working this long after it last asked
const UNREACHABLE_AFTER = 3;

export function lockMatches(lock: EgressLock, ip: string, country: string | null): boolean {
    const ipOk = lock.ips.length === 0 || lock.ips.includes(ip);
    const countryOk = lock.countries.length === 0 || (country !== null && lock.countries.includes(country.toUpperCase()));
    return ipOk && countryOk;
}

/** For the owner (pushes, chat notices): in Chinese, like the other Happy pushes. */
export function describeFault(f: EgressFault, lock: EgressLock | null): string {
    if (f.kind === 'unreachable') return `连不上 AI 服务商（${f.error}）`;
    const expected = [lock?.ips.join(', '), lock?.countries.join(', ')].filter(Boolean).join(' / ');
    return `出口 IP 变成了 ${f.ip}${f.country ? `（${f.country}）` : ''}，应为 ${expected}`;
}

export type EgressGuardOptions = {
    readLock: () => EgressLock | null;
    probe: (endpoint: string) => Promise<ProbeResult>;
    onFault: (fault: EgressFault, status: EgressStatus) => void;
    onRecover: (status: EgressStatus, downMs: number) => void;
    now?: () => number;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
    log?: (msg: string) => void;
};

export class EgressGuard {
    private readonly now: () => number;
    private readonly setTimer: (fn: () => void, ms: number) => unknown;
    private readonly clearTimer: (h: unknown) => void;
    private next = 0; // endpoint rotation
    private timer: unknown = null;
    private running: Promise<void> | null = null;
    private lastBusyAt = -Infinity;
    private failures = 0;
    private goodInError = 0;
    private errorBackoff = BUSY_INTERVAL_MS;
    private st: Omit<EgressStatus, 'state' | 'lock' | 'nextCheckAt'> & { error: boolean } = {
        ip: null, country: null, checkedAt: null, fault: null, faultSince: null, error: false,
    };
    private nextCheckAt: number | null = null;
    private checkedLock: string | null = null; // the lock the last result was judged against

    constructor(private readonly opts: EgressGuardOptions) {
        this.now = opts.now ?? Date.now;
        this.setTimer = opts.setTimer ?? ((fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; });
        this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    }

    start(): void { this.schedule(0); }
    stop(): void { if (this.timer !== null) this.clearTimer(this.timer); this.timer = null; }

    status(): EgressStatus {
        const lock = this.opts.readLock();
        const state: EgressState = !lock ? 'off' : this.st.error ? 'error' : this.busy() ? 'busy' : 'idle';
        const { error: _e, ...rest } = this.st;
        return { state, lock, ...rest, nextCheckAt: this.nextCheckAt };
    }

    /**
     * A session asks before sending to its agent (`firstMessage`) and every few
     * seconds while it works. Marks the daemon busy; checks now when the last
     * good result is older than FRESH_MS and a message is about to go out.
     */
    async check(opts: { firstMessage?: boolean; passive?: boolean } = {}): Promise<EgressStatus> {
        if (opts.passive) return this.status(); // a session waiting for recovery: does not make the daemon busy
        const wasBusy = this.busy();
        this.lastBusyAt = this.now();
        const lock = this.opts.readLock();
        if (!lock) return this.status();
        const stale = this.st.checkedAt === null || this.now() - this.st.checkedAt > FRESH_MS;
        // A new lock (`happy egress lock`) is judged at once, whatever the last result.
        const lockChanged = JSON.stringify(lock) !== this.checkedLock;
        if (lockChanged || (opts.firstMessage && !this.st.error && stale)) {
            await this.runCheck();
            // A check that was already running judged the old lock: judge the new one too.
            if (JSON.stringify(this.opts.readLock()) !== this.checkedLock) await this.runCheck();
        }
        if (!wasBusy && !this.st.error) this.schedule(BUSY_INTERVAL_MS); // idle → busy: speed up
        return this.status();
    }

    private busy(): boolean { return this.now() - this.lastBusyAt < BUSY_HOLD_MS; }

    private interval(): number {
        if (this.st.error) return this.errorBackoff;
        return this.busy() ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS;
    }

    private schedule(ms: number) {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.nextCheckAt = this.now() + ms;
        this.timer = this.setTimer(() => {
            this.timer = null;
            this.runCheck().finally(() => { if (this.timer === null) this.schedule(this.interval()); });
        }, ms);
    }

    private runCheck(): Promise<void> {
        this.running ??= this.doCheck().finally(() => { this.running = null; });
        return this.running;
    }

    private endpoint(): string {
        const e = EGRESS_ENDPOINTS[this.next % EGRESS_ENDPOINTS.length];
        this.next += 1;
        return e;
    }

    private async doCheck(): Promise<void> {
        const lock = this.opts.readLock();
        if (!lock) {
            if (this.st.error) this.recover();
            return;
        }
        let r = await this.opts.probe(this.endpoint());
        // One slow or failing endpoint: ask the next one at once.
        if (!r.ok) {
            this.failures += 1;
            this.opts.log?.(`[EGRESS] ${r.endpoint}: ${r.error}; trying the next endpoint`);
            r = await this.opts.probe(this.endpoint());
        }
        this.st.checkedAt = this.now();
        this.checkedLock = JSON.stringify(lock);
        if (!r.ok) {
            this.failures += 1;
            this.opts.log?.(`[EGRESS] ${r.endpoint}: ${r.error} (${this.failures} in a row)`);
            this.goodInError = 0;
            if (!this.st.error && this.failures >= UNREACHABLE_AFTER) this.fault({ kind: 'unreachable', error: r.error });
            else if (this.st.error) this.backOff();
            else if (this.timer === null || this.busy()) this.schedule(BUSY_INTERVAL_MS); // retry soon on another endpoint
            return;
        }
        this.failures = 0;
        this.st.ip = r.ip;
        this.st.country = r.country;
        if (!lockMatches(lock, r.ip, r.country)) {
            this.goodInError = 0;
            if (!this.st.error) this.fault({ kind: 'changed', ip: r.ip, country: r.country });
            else { this.st.fault = { kind: 'changed', ip: r.ip, country: r.country }; this.backOff(); }
            return;
        }
        if (this.st.error) {
            this.goodInError += 1;
            if (this.goodInError >= 2) this.recover();
            else this.schedule(BUSY_INTERVAL_MS); // confirm soon
        }
    }

    private fault(f: EgressFault) {
        this.st.error = true;
        this.st.fault = f;
        this.st.faultSince = this.now();
        this.errorBackoff = BUSY_INTERVAL_MS;
        this.opts.log?.(`[EGRESS] fault: ${describeFault(f, this.opts.readLock())}`);
        this.opts.onFault(f, this.status());
        this.schedule(this.errorBackoff);
    }

    private backOff() {
        this.errorBackoff = Math.min(this.errorBackoff * 2, ERROR_MAX_INTERVAL_MS);
        this.schedule(this.errorBackoff);
    }

    private recover() {
        const downMs = this.st.faultSince === null ? 0 : this.now() - this.st.faultSince;
        this.st.error = false;
        this.st.fault = null;
        this.st.faultSince = null;
        this.goodInError = 0;
        this.failures = 0;
        this.opts.log?.('[EGRESS] recovered');
        this.opts.onRecover(this.status(), downMs);
        this.schedule(this.interval());
    }
}
