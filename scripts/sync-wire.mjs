#!/usr/bin/env node
// Pre-build upstream check for the iOS + web + relay set, and the mirror of
// packages/happy-wire from an upstream slopus/happy checkout.
//
// Usage:
//   node scripts/sync-wire.mjs [--upstream ../happy] [--ref origin/main] [--check]
//
// --check only reports; it never writes. Without --check, the script replaces
// packages/happy-wire with the upstream tree at <ref> and updates UPSTREAM.md.
// It does not fetch: run `git -C <upstream> fetch origin` first.
//
// The report has three parts (plus 1d: upstream happy-cli commits since the
// commit recorded for packages/happy-cli in UPSTREAM.md) (see docs/RELEASE-CHECKLIST.md):
//   1. protocol paths and client model tables since the reviewed happy-wire
//      commit — what the web client may have to follow;
//   2. relay (happy-server) commits since the deployed relay commit, Prisma
//      migrations among them — whether the relay needs a rebuild;
//   3. /v1–/v3 endpoints the native iOS app calls that the deployed relay
//      does not serve — whether iOS still works against our relay.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const upstream = resolve(root, opt('--upstream', '../happy'));
const ref = opt('--ref', 'origin/main');
const checkOnly = args.includes('--check');

const git = (...a) => execFileSync('git', ['-C', upstream, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();

const upstreamMd = join(root, 'UPSTREAM.md');
const md = readFileSync(upstreamMd, 'utf8');
const wireRow = md.match(/^\| `packages\/happy-wire`.*$/m)?.[0];
const current = wireRow?.match(/slopus\/happy@([0-9a-f]{40})/)?.[1];
if (!current) throw new Error('UPSTREAM.md: cannot find the current happy-wire commit');
const relay = md.match(/^\| Relay .*slopus\/happy@([0-9a-f]{40})/m)?.[1];
if (!relay) throw new Error('UPSTREAM.md: cannot find the deployed relay commit');
const target = git('rev-parse', `${ref}^{commit}`);
// The CLI is ours since its import; report every upstream change since then.
const cliBase = md.match(/^\| `packages\/happy-cli`.*slopus\/happy@([0-9a-f]{40})/m)?.[1];
if (!cliBase) throw new Error('UPSTREAM.md: cannot find the happy-cli import commit');

const gitRaw = (...a) => execFileSync('git', ['-C', upstream, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd();
const log = (from, paths) => gitRaw('log', '--format=  %h %ad %s', '--date=short', `${from}..${target}`, '--', ...paths) || '  (none)';

// 1. Paths whose upstream changes the web client may have to follow.
const protocolPaths = [
    'packages/happy-wire',
    'packages/happy-server/sources/app/api',
    'packages/happy-server/sources/app/events',
    'packages/happy-server/prisma',
    'packages/happy-cli/src/api',
];
// Hard-coded model lists and defaults in the other clients and the CLI. The
// web picker (happy-app/sources/components/modelModeOptions.ts and
// sync/agentDefaults.ts) is maintained by hand against these.
const modelPaths = [
    'packages/happy-ios/Sources/HappyCore/Settings/AgentDefaults.swift',
    'packages/happy-android/app/src/main/kotlin/com/slopus/happy/model/settings/ModeOptions.kt',
    'packages/happy-android/app/src/main/kotlin/com/slopus/happy/model/settings/AgentDefaults.kt',
    'packages/happy-cli/src/codex/runCodex.ts',
    'packages/happy-cli/package.json',
];
// The native iOS paths that talk to an Original Happy relay.
const iosRelayPaths = [
    'packages/happy-ios/Sources/HappyCore/Sync/LegacySyncEngine.swift',
    'packages/happy-ios/Sources/HappyUI/Navigation/AccountAdding.swift',
];

console.log(`upstream:        ${upstream}`);
console.log(`target:          ${target.slice(0, 9)} (${ref}, ${git('log', '-1', '--format=%ad', '--date=short', target)})`);
console.log(`happy-wire:      ${current.slice(0, 9)}${current === target ? ' (up to date)' : ''}`);
console.log(`deployed relay:  ${relay.slice(0, 9)}${relay === target ? ' (up to date)' : ''}`);

console.log(`\n== 1. Web client: protocol paths since ${current.slice(0, 9)} ==`);
console.log(log(current, protocolPaths));
console.log(`\n== 1b. Model tables / CLI defaults since ${current.slice(0, 9)} ==`);
console.log(log(current, modelPaths));
console.log(`\n== 1c. iOS relay (legacy) sync since ${current.slice(0, 9)} ==`);
console.log(log(current, iosRelayPaths));
console.log(`\n== 1d. happy-cli since the reviewed ${cliBase.slice(0, 9)} (ours; port by hand) ==`);
console.log(log(cliBase, ['packages/happy-cli']));
if (current !== target) {
    const stat = git('diff', '--stat', current, target, '--', 'packages/happy-wire');
    console.log(`\nhappy-wire diff:\n${stat || '  (no changes)'}`);
}

// 2. Relay.
console.log(`\n== 2. Relay: happy-server and Dockerfile.server since deployed ${relay.slice(0, 9)} ==`);
console.log(log(relay, ['packages/happy-server', 'Dockerfile.server']));
const migrations = git('diff', '--name-only', '--diff-filter=A', relay, target, '--', 'packages/happy-server/prisma/migrations');
console.log(`\nNew Prisma migrations since the deployed relay:\n${migrations ? migrations.replace(/^/gm, '  ') : '  (none)'}`);

// 3. iOS endpoints vs the deployed relay's routes.
const routeRe = /\.(?:get|post|put|delete|patch)\(\s*['"](\/v[1-3]\/[^'"]*)/g;
const serverSrc = git('grep', '-h', '-E', "\\.(get|post|put|delete|patch)\\(\\s*['\"]/v[1-3]/", relay, '--', 'packages/happy-server/sources');
const routes = [...serverSrc.matchAll(routeRe)].map((m) => m[1].replace(/:[^/]+/g, '*'));
const iosSrc = git('grep', '-h', '-o', '-E', '"/v[1-3]/[A-Za-z0-9/_.-]*', target, '--', 'packages/happy-ios/Sources');
const iosPaths = [...new Set(iosSrc.split('\n').map((l) => l.replace(/^.*?"/, '')).filter(Boolean))].sort();
// A client path matches when it is a route, or a prefix of one (paths built
// by appending an id end in "/").
const served = (p) => routes.some((r) => {
    const re = new RegExp('^' + r.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+') + '$');
    return re.test(p) || r.startsWith(p) || re.test(p.replace(/\/$/, '/x'));
});
// Happy Cloud / App Store endpoints that iOS calls only for cloud or store
// accounts; reviewed 2026-11-10, the /v2/auth and /v1/invites ones 2026-11-18
// (CloudAccount.swift / CloudInvite.swift, HappyCloud.accounts only).
// Anything missing that is not here is new.
const knownCloudOnly = new Set([
    '/v1/auth/native', '/v1/auth/password', '/v1/receipts', '/v1/servers', '/v1/servers/',
    '/v1/servers/availability', '/v1/servers/join', '/v1/subscribers/', '/v1/updates/',
    '/v1/invites/accept', '/v1/invites/preview', '/v2/auth/email/start', '/v2/auth/email/verify',
    '/v2/auth/native', '/v2/auth/password',
]);
const missing = iosPaths.filter((p) => !served(p));
const newMissing = missing.filter((p) => !knownCloudOnly.has(p));
console.log(`\n== 3. iOS /v1–/v3 paths not served by the deployed relay ==`);
console.log(`  known cloud-only: ${missing.filter((p) => knownCloudOnly.has(p)).join(' ') || '(none)'}`);
console.log(newMissing.length
    ? `  NEW, check whether LegacySyncEngine uses them:\n${newMissing.map((p) => `    ${p}`).join('\n')}`
    : '  new: (none)');
console.log('  (/v0/* is Happy Cloud only and not checked.)');

// 4. Fork watch: signs that upstream iOS / relay / wire are moving away from
// what we maintain (web, happy-cli, happy-agent). See docs/ARCHITECTURE.md.
console.log(`\n== 4. Fork watch (see docs/ARCHITECTURE.md) ==`);
const alerts = [];

// 4a. Upstream iOS still talks to an Original Happy relay.
const iosLegacyFiles = [
    'packages/happy-ios/Sources/HappyCore/Sync/LegacySyncEngine.swift',
    'packages/happy-ios/Sources/HappyCore/Auth/LegacyPairingService.swift',
    'packages/happy-ios/Sources/HappyUI/Navigation/AccountAdding.swift',
];
const iosTree = new Set(git('ls-tree', '-r', '--name-only', target, '--', 'packages/happy-ios/Sources').split('\n'));
const goneLegacy = iosLegacyFiles.filter((f) => !iosTree.has(f));
console.log(`  4a. iOS Original-relay support files: ${goneLegacy.length ? 'MISSING ' + goneLegacy.join(', ') : 'present'}`);
if (goneLegacy.length) alerts.push('upstream iOS removed Original-relay support files: we would have to maintain iOS (or stay on the last iOS build that has them)');

// 4b. iOS feature gates on a newer happy-cli than ours.
const ourCli = JSON.parse(readFileSync(join(root, 'packages/happy-cli/package.json'), 'utf8')).version;
const coreOf = (v) => v.split('+')[0];
const cmpCore = (a, b) => {
    const [pa, pb] = [a, b].map((v) => v.split('-')[0].split('.').map(Number));
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
    // Same x.y.z: a prerelease (1.2.6-beta.0) is below the release.
    const [ra, rb] = [a.includes('-'), b.includes('-')];
    return ra === rb ? 0 : (ra ? -1 : 1);
};
const iosDefaults = git('show', `${target}:packages/happy-ios/Sources/HappyCore/Settings/AgentDefaults.swift`);
const iosGates = [...iosDefaults.matchAll(/static let (cliVersionWith\w+) = "([^"]+)"/g)].map((m) => ({ name: m[1], version: m[2] }));
const aheadGates = iosGates.filter((g) => cmpCore(g.version, coreOf(ourCli)) > 0);
console.log(`  4b. iOS gates on happy-cli versions (ours ${ourCli}): ${iosGates.map((g) => `${g.name}=${g.version}`).join(', ') || '(none found)'}`);
if (!iosGates.length) alerts.push('cannot read cliVersionWith* gates from iOS AgentDefaults.swift: check by hand');
for (const g of aheadGates) alerts.push(`iOS ${g.name} needs happy-cli ${g.version}, ours is ${ourCli}: port the upstream CLI change (section 1d) and bump our version`);

// 4c. Relay paths our clients call that the target relay (what an upgrade
// would deploy) does not serve.
const ourPaths = new Set();
const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== '__tests__') walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(ent.name) || /\.(test|spec)\.tsx?$/.test(ent.name)) continue;
        for (const m of readFileSync(p, 'utf8').matchAll(/\/v[1-3]\/[A-Za-z0-9/_.${}:-]+/g)) {
            // `${...}` parts are ids: keep the prefix up to them.
            ourPaths.add(m[0].replace(/\$\{.*$/, '').replace(/[.]$/, ''));
        }
    }
};
for (const d of ['packages/happy-app/sources', 'packages/happy-cli/src', 'packages/happy-agent/src']) walk(join(root, d));
const targetSrc = git('grep', '-h', '-E', "\\.(get|post|put|delete|patch)\\(\\s*['\"]/v[1-3]/", target, '--', 'packages/happy-server/sources');
const targetRoutes = [...targetSrc.matchAll(routeRe)].map((m) => m[1].replace(/:[^/]+/g, '*'));
const servedBy = (rs, p) => rs.some((r) => {
    const re = new RegExp('^' + r.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]+') + '$');
    return re.test(p) || r.startsWith(p) || re.test(p.replace(/\/$/, '/x'));
});
// Not relay HTTP routes: the socket.io path (checked below) and Anthropic's
// OAuth endpoint (console.anthropic.com).
const notRoutes = new Set(['/v1/updates', '/v1/oauth/token']);
const notAtTarget = [...ourPaths].filter((p) => !notRoutes.has(p) && !servedBy(targetRoutes, p)).sort();
const notDeployed = [...ourPaths].filter((p) => !notRoutes.has(p) && !servedBy(routes, p)).sort();
const socketPathAt = (ref) => /path:\s*['"]\/v1\/updates['"]/.test(
    git('show', `${ref}:packages/happy-server/sources/app/api/socketConfig.ts`));
if (!socketPathAt(target)) alerts.push(`upstream relay ${target.slice(0, 9)} no longer serves socket.io at /v1/updates (app/api/socketConfig.ts): every client would lose live updates`);
console.log(`  4c. relay paths our web/CLIs call: ${ourPaths.size}`);
console.log(`      not served by the deployed relay: ${notDeployed.join(' ') || '(none)'}`);
console.log(`      not served by upstream ${target.slice(0, 9)}: ${notAtTarget.join(' ') || '(none)'}`);
const newlyGone = notAtTarget.filter((p) => !notDeployed.includes(p));
if (newlyGone.length) alerts.push(`upstream relay ${target.slice(0, 9)} no longer serves ${newlyGone.join(' ')}, which our web/CLIs call: do not upgrade the relay as is`);

// 4d. Wire: the mirror is behind upstream.
if (current !== target) alerts.push(`happy-wire mirror ${current.slice(0, 9)} is behind upstream ${target.slice(0, 9)}: review section 1 and sync`);

console.log(alerts.length
    ? `\n  FORK ALERTS:\n${alerts.map((a) => `    ! ${a}`).join('\n')}`
    : '\n  FORK ALERTS: none');

if (checkOnly || current === target) process.exit(0);

const tmp = mkdtempSync(join(tmpdir(), 'happy-wire-'));
try {
    const tar = join(tmp, 'wire.tar');
    execFileSync('git', ['-C', upstream, 'archive', '-o', tar, target, 'packages/happy-wire']);
    rmSync(join(root, 'packages/happy-wire'), { recursive: true, force: true });
    execFileSync('tar', ['-xf', tar, '-C', root]);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(upstreamMd, md.replace(wireRow, wireRow.replace(current, target)));
console.log('\nUpdated packages/happy-wire and UPSTREAM.md.');
console.log('Next: install, typecheck and test happy-app, then commit with the upstream range in the message.');
