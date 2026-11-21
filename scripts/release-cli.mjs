#!/usr/bin/env node
// Builds a release of the two CLIs (`happy`, `happy-agent`) and adds it to a
// local checkout of the happy-dist repository. See docs/RELEASE-CLI.md.
//
// Usage (from the local-disk clone, not the CIFS checkout):
//   node scripts/release-cli.mjs [--dist ~/build/happy-dist] [--skip-tests] [--skip-claude-turn] [--publish] [--allow-dirty]
//
// Steps: check both trees are clean → typecheck + test (+ build) both
// packages → pnpm pack → pin dependencies with npm-shrinkwrap.json → one
// happy tarball per platform (only that platform's ripgrep/difftastic) →
// install into a temporary prefix and smoke-test → write
// releases/<release>/ with manifest.json, update latest, releases.txt and
// install.sh → commit in happy-dist; --publish also pushes it.
// The release id is the happy version (e.g. 1.2.6+orig.1); bump
// packages/happy-cli/package.json (and happy-agent's when it changed) first.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
};
const distDir = resolve(opt('--dist', join(homedir(), 'build', 'happy-dist')).replace(/^~(?=\/)/, homedir()));

const PLATFORMS = ['linux-x64', 'darwin-arm64', 'darwin-x64'];
const HOST_PLATFORM = `${process.platform}-${process.arch}`;

const run = (cmd, argv, opts = {}) => {
    console.log(`$ ${cmd} ${argv.join(' ')}${opts.cwd ? `   (in ${opts.cwd})` : ''}`);
    return execFileSync(cmd, argv, { stdio: 'inherit', ...opts });
};
const out = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', ...opts }).trim();
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

// --- Preconditions ---------------------------------------------------------
// A network share (CIFS / SMB, NFS) has no exec permission for the build:
// judged by the filesystem the checkout is on, not by its path.
const checkoutFs = (() => {
    try {
        let best = '', type = '';
        for (const line of readFileSync('/proc/self/mounts', 'utf8').split('\n')) {
            const [, mp, fs] = line.split(' ');
            const point = (mp || '').replace(/\\040/g, ' ');
            if (fs && (root === point || root.startsWith(point.endsWith('/') ? point : point + '/')) && point.length > best.length) {
                best = point; type = fs;
            }
        }
        return type;
    } catch { return ''; }  // macOS: no /proc
})();
if (/^(cifs|smb3?|nfs4?)$/.test(checkoutFs)) fail(`run this from a clone on a local disk: ${root} is on ${checkoutFs}, which has no exec permission`);
// The dist is a git checkout (the release becomes a commit; --publish pushes
// it) or a plain directory (files only: serve it over http(s), or install
// from it with HAPPY_DIST_URL=file:///…).
if (!existsSync(distDir)) fail(`no dist directory at ${distDir} (git clone your dist repository there, or mkdir it)`);
const distIsGit = existsSync(join(distDir, '.git'));
if (flag('--publish') && !distIsGit) fail(`--publish needs a git checkout at ${distDir}`);
const dirty = (dir) => out('git', ['-C', dir, 'status', '--porcelain']);
if (!flag('--allow-dirty') && dirty(root)) fail('this checkout has uncommitted changes (commit first, or --allow-dirty)');
if (distIsGit && dirty(distDir)) fail(`${distDir} has uncommitted changes`);

const cliDir = join(root, 'packages', 'happy-cli');
const agentDir = join(root, 'packages', 'happy-agent');
const fleetDir = join(root, 'packages', 'happy-fleet');
const cliVersion = readJson(join(cliDir, 'package.json')).version;
const agentVersion = readJson(join(agentDir, 'package.json')).version;
const fleetVersion = readJson(join(fleetDir, 'package.json')).version;
const release = cliVersion;
const releaseDir = join(distDir, 'releases', release);
if (existsSync(releaseDir)) fail(`release ${release} already exists in ${distDir}; bump packages/happy-cli/package.json`);
const minClaudeCode = readFileSync(join(cliDir, 'src', 'claude', 'sdk', 'claudeExecutable.ts'), 'utf8')
    .match(/MIN_CLAUDE_CODE_VERSION = '([^']+)'/)?.[1];
if (!minClaudeCode) fail('cannot read MIN_CLAUDE_CODE_VERSION');
const commit = out('git', ['-C', root, 'rev-parse', 'HEAD']);
console.log(`release ${release}: happy ${cliVersion}, happy-agent ${agentVersion}, happy-fleet ${fleetVersion}, commit ${commit.slice(0, 9)}, claude >= ${minClaudeCode}`);

// --- Test and build --------------------------------------------------------
for (const dir of [cliDir, agentDir, fleetDir]) {
    run('pnpm', ['typecheck'], { cwd: dir });
    const hasBuild = !!readJson(join(dir, 'package.json')).scripts?.build;
    if (!flag('--skip-tests')) run('pnpm', ['test'], { cwd: dir });
    else if (hasBuild) run('pnpm', ['build'], { cwd: dir });
}

// --- Pack ------------------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'happy-release-'));
const outDir = join(work, 'out');
mkdirSync(outDir);

// Unpacks a pnpm-packed tarball, drops devDependencies and pins the runtime
// dependency tree with npm-shrinkwrap.json (npm honours it on install), so
// every server gets the same versions as the smoke test.
function stage(tgz, name) {
    const dir = join(work, name);
    mkdirSync(dir);
    run('tar', ['-xzf', tgz, '-C', dir]);
    const pkgDir = join(dir, 'package');
    const pkg = readJson(join(pkgDir, 'package.json'));
    delete pkg.devDependencies;
    writeJson(join(pkgDir, 'package.json'), pkg);
    run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: pkgDir });
    renameSync(join(pkgDir, 'package-lock.json'), join(pkgDir, 'npm-shrinkwrap.json'));
    return pkgDir;
}

function pnpmPack(dir) {
    const dest = join(work, 'pnpm');
    mkdirSync(dest, { recursive: true });
    const before = new Set(readdirSync(dest));
    run('pnpm', ['pack', '--pack-destination', dest], { cwd: dir });
    const created = readdirSync(dest).filter((f) => !before.has(f));
    if (created.length !== 1) fail(`pnpm pack in ${dir} produced ${created.join(', ') || 'nothing'}`);
    return join(dest, created[0]);
}

function npmPack(pkgDir, finalName) {
    const produced = out('npm', ['pack', '--silent', '--pack-destination', outDir], { cwd: pkgDir }).split('\n').pop();
    const target = join(outDir, finalName);
    renameSync(join(outDir, produced), target);
    return target;
}

const fileName = (name, version, suffix = '') => `${name}-${version.replace('+', '_')}${suffix}.tgz`;

const cliStage = stage(pnpmPack(cliDir), 'happy');
const files = {};
for (const platform of PLATFORMS) {
    const dir = join(work, `happy-${platform}`);
    cpSync(cliStage, dir, { recursive: true });
    // Archives are named <tool>-<arch>-<os>.tar.gz (e.g. ripgrep-x64-linux).
    const [os, arch] = platform.split('-');
    const archives = join(dir, 'tools', 'archives');
    for (const f of readdirSync(archives)) {
        if (f.endsWith('.tar.gz') && !f.endsWith(`-${arch}-${os}.tar.gz`)) rmSync(join(archives, f));
    }
    const kept = readdirSync(archives).filter((f) => f.endsWith('.tar.gz'));
    if (kept.length < 2) fail(`${platform}: expected ripgrep and difftastic archives, kept ${kept.join(', ')}`);
    const tgz = npmPack(dir, fileName('happy', cliVersion, `-${platform}`));
    files[platform] = { file: tgz.split('/').pop(), sha256: sha256(tgz), size: statSync(tgz).size };
}
const agentStage = stage(pnpmPack(agentDir), 'happy-agent');
const agentTgz = npmPack(agentStage, fileName('happy-agent', agentVersion));
const fleetStage = stage(pnpmPack(fleetDir), 'happy-fleet');
const fleetTgz = npmPack(fleetStage, fileName('happy-fleet', fleetVersion));

// --- Smoke test on this machine -------------------------------------------
if (files[HOST_PLATFORM]) {
    const prefix = join(work, 'prefix');
    // The installed `happy` talks to the daemon of HAPPY_HOME_DIR and replaces
    // one running another version. Never let the smoke test see the real
    // ~/.happy: it once swapped this machine's daemon for one running from
    // this temporary prefix.
    const smokeEnv = { ...process.env, HAPPY_HOME_DIR: join(work, 'happy-home') };
    mkdirSync(smokeEnv.HAPPY_HOME_DIR, { recursive: true });
    // As install.sh does: no npm scripts, then happy's postinstall by hand.
    run('npm', ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', '--ignore-scripts',
        join(outDir, files[HOST_PLATFORM].file), agentTgz, fleetTgz]);
    // install.sh unpacks with the system tar (unpack-tools.cjs can hang after unpacking).
    const toolsDir = join(prefix, 'lib', 'node_modules', 'happy', 'tools');
    const plat = `${process.arch}-${process.platform}`;
    mkdirSync(join(toolsDir, 'unpacked'), { recursive: true });
    for (const a of ['difftastic', 'ripgrep']) run('tar', ['-xzf', join(toolsDir, 'archives', `${a}-${plat}.tar.gz`), '-C', join(toolsDir, 'unpacked')]);
    if (!existsSync(join(prefix, 'lib', 'node_modules', 'happy', 'tools', 'unpacked', 'rg'))) fail('happy\'s tools are missing after install');
    // Same removal as install.sh (keep the two in step).
    const sdkScope = join(prefix, 'lib', 'node_modules', 'happy', 'node_modules', '@anthropic-ai');
    for (const d of readdirSync(sdkScope)) {
        if (d.startsWith('claude-agent-sdk-')) rmSync(join(sdkScope, d), { recursive: true, force: true });
    }
    const bin = (b) => join(prefix, 'bin', b);
    const happyVersion = out(bin('happy'), ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], env: smokeEnv });
    if (!happyVersion.includes(cliVersion)) fail(`installed happy reports "${happyVersion}", expected ${cliVersion}`);
    const agentReported = out(bin('happy-agent'), ['--version'], { env: smokeEnv });
    if (agentReported !== agentVersion) fail(`installed happy-agent reports "${agentReported}", expected ${agentVersion}`);
    // Fleet Watch (happy-fleet, run by the daemon): its config and dependencies must load from the install.
    const fleetLib = join(prefix, 'lib', 'node_modules', 'happy-fleet');
    const fleetHome = join(smokeEnv.HAPPY_HOME_DIR, 'fleet');
    mkdirSync(fleetHome, { recursive: true });
    const fleetCheck = out(process.execPath, [join(fleetLib, 'hub.mjs'), '--check-config'], { env: smokeEnv });
    if (!/OK/.test(fleetCheck)) fail(`fleet hub --check-config: ${fleetCheck}`);
    const fleetStatus = out(bin('happy'), ['fleet', 'status'], { env: smokeEnv });
    if (!/Fleet hub: off/.test(fleetStatus)) fail(`happy fleet status: ${fleetStatus}`);
    const lib = join(prefix, 'lib', 'node_modules', 'happy');
    const bundled = out('find', [join(lib, 'node_modules'), '-type', 'd', '-path', '*/@anthropic-ai/claude-agent-sdk-*', '-prune']);
    if (bundled) fail(`a bundled Claude Code is still installed:\n${bundled}`);
    if (existsSync(join(lib, 'node_modules', '@slopus', 'happy-terminal'))) fail('@slopus/happy-terminal got installed; it should not be a dependency');
    // One real remote-mode turn through the installed SDK and the machine's claude.
    // --skip-claude-turn: on a machine without a logged-in claude (e.g. one
    // that only builds for a sandbox).
    if (flag('--skip-claude-turn')) {
        console.log('(real Claude turn skipped)');
    } else {
        const probe = join(lib, 'release-probe.mjs');
        writeFileSync(probe, `
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { findGlobalClaudeCliPath } = require('./scripts/claude_version_utils.cjs');
const q = query({ prompt: 'Reply with exactly: ok', options: { cwd: ${JSON.stringify(work)}, maxTurns: 1, model: 'claude-haiku-5-5', pathToClaudeCodeExecutable: findGlobalClaudeCliPath().path } });
for await (const m of q) {
    if (m.type === 'system' && m.subtype === 'init') console.log('claude_code_version ' + m.claude_code_version);
    if (m.type === 'result') { console.log('result ' + m.subtype); break; }
}
`);
        const probeOut = out(process.execPath, [probe], { cwd: lib, env: smokeEnv });
        // Belt and braces: a daemon started under the temporary home must not outlive the test.
        try { execFileSync(bin('happy'), ['daemon', 'stop'], { env: smokeEnv, stdio: 'ignore', timeout: 20_000 }); } catch {}
        rmSync(probe);
        console.log(probeOut);
        if (!/result success/.test(probeOut)) fail('the probe turn through the installed SDK and the machine claude failed');
    }
    if (!existsSync(join(lib, 'tools', 'unpacked', 'rg'))) fail('tools were not unpacked on install');
    const size = out('du', ['-sh', lib]).split('\t')[0];
    console.log(`smoke test OK: happy ${cliVersion}, happy-agent ${agentVersion}, happy-fleet ${fleetVersion}, no bundled Claude Code, ${flag('--skip-claude-turn') ? 'no real turn' : 'real turn OK'}, installed size ${size}`);
} else {
    console.log(`(no package for this platform, ${HOST_PLATFORM}; smoke test skipped)`);
}

// --- Write the release into happy-dist ------------------------------------
mkdirSync(releaseDir, { recursive: true });
for (const f of [...Object.values(files).map((x) => x.file)]) cpSync(join(outDir, f), join(releaseDir, f));
cpSync(agentTgz, join(releaseDir, agentTgz.split('/').pop()));
cpSync(fleetTgz, join(releaseDir, fleetTgz.split('/').pop()));
writeJson(join(releaseDir, 'manifest.json'), {
    release,
    date: new Date().toISOString(),
    commit,
    minClaudeCode,
    node: '>=20',
    packages: {
        happy: { version: cliVersion, files },
        'happy-agent': { version: agentVersion, file: agentTgz.split('/').pop(), sha256: sha256(agentTgz), size: statSync(agentTgz).size },
        'happy-fleet': { version: fleetVersion, file: fleetTgz.split('/').pop(), sha256: sha256(fleetTgz), size: statSync(fleetTgz).size },
    },
});
cpSync(join(root, 'release', 'install.sh'), join(distDir, 'install.sh'));
cpSync(join(root, 'release', 'dist-README.md'), join(distDir, 'README.md'));
// The command reference (generated from the happy-cli command table): install.sh puts it next to the manual.
for (const f of ['COMMANDS.md', 'COMMANDS.zh.md']) cpSync(join(root, 'docs', f), join(distDir, f));
writeFileSync(join(distDir, 'latest'), release + '\n');
const listFile = join(distDir, 'releases.txt');
const list = existsSync(listFile) ? readFileSync(listFile, 'utf8').split('\n').filter(Boolean) : [];
list.push(`${release}  ${new Date().toISOString().slice(0, 10)}  ${commit.slice(0, 9)}`);
writeFileSync(listFile, list.join('\n') + '\n');

if (!distIsGit) {
    console.log(`release ${release} written to ${distDir} (a plain directory: no commit)`);
} else {
    run('git', ['-C', distDir, 'add', '-A']);
    run('git', ['-C', distDir, 'commit', '-q', '-m', `Release ${release}\n\nhappy ${cliVersion}, happy-agent ${agentVersion}, happy-fleet ${fleetVersion}\nhappy-original ${commit}`]);
    if (flag('--publish')) {
        run('git', ['-C', distDir, 'push', '-q', 'origin', 'HEAD']);
        console.log(`published ${release}`);
    } else {
        console.log(`release ${release} committed in ${distDir}; push with: git -C ${distDir} push origin HEAD`);
    }
}
rmSync(work, { recursive: true, force: true });
