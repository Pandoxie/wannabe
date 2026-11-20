import { describe, expect, it, vi } from 'vitest'
import { ClaudeExecutableError, MIN_CLAUDE_CODE_VERSION, resolveClaudeExecutable, type ClaudeLookup } from './claudeExecutable'

const compareVersions = (a: string, b: string) => {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
    }
    return 0
}

function lookup(found: { path: string; source: string } | null, version: string | null): ClaudeLookup {
    return {
        findGlobalClaudeCliPath: vi.fn(() => found),
        getVersion: vi.fn(() => version),
        compareVersions,
    }
}

describe('resolveClaudeExecutable', () => {
    it('returns the machine claude when it is new enough', () => {
        const l = lookup({ path: '/opt/claude/a', source: 'PATH' }, '2.1.321')
        expect(resolveClaudeExecutable({}, l)).toBe('/opt/claude/a')
    })

    it('accepts exactly the minimum version', () => {
        const l = lookup({ path: '/opt/claude/b', source: 'PATH' }, MIN_CLAUDE_CODE_VERSION)
        expect(resolveClaudeExecutable({}, l)).toBe('/opt/claude/b')
    })

    it('rejects an older claude and says to run claude update', () => {
        const l = lookup({ path: '/opt/claude/c', source: 'npm' }, '2.1.200')
        expect(() => resolveClaudeExecutable({}, l)).toThrow(ClaudeExecutableError)
        expect(() => resolveClaudeExecutable({}, l)).toThrow(/2\.1\.200.*too old.*claude update/)
    })

    it('explains how to install when no claude is found', () => {
        const l = lookup(null, null)
        expect(() => resolveClaudeExecutable({}, l)).toThrow(/not installed.*HAPPY_CLAUDE_PATH/)
    })

    it('fails clearly when the version cannot be read', () => {
        const l = lookup({ path: '/opt/claude/d', source: 'PATH' }, null)
        expect(() => resolveClaudeExecutable({}, l)).toThrow(/Cannot read the version/)
    })

    it('leaves the choice to the SDK with HAPPY_CLAUDE_USE_BUNDLED=1', () => {
        const l = lookup(null, null)
        expect(resolveClaudeExecutable({ HAPPY_CLAUDE_USE_BUNDLED: '1' }, l)).toBeUndefined()
        expect(l.findGlobalClaudeCliPath).not.toHaveBeenCalled()
    })

    it('reads the version once per file', () => {
        const l = lookup({ path: '/opt/claude/e', source: 'PATH' }, '2.1.321')
        resolveClaudeExecutable({}, l)
        resolveClaudeExecutable({}, l)
        expect(l.getVersion).toHaveBeenCalledTimes(1)
    })

    it('finds the real claude_version_utils script', () => {
        // The default lookup loads scripts/claude_version_utils.cjs from the
        // package; whether a claude is installed depends on the machine.
        try {
            expect(typeof resolveClaudeExecutable({})).toBe('string')
        } catch (e) {
            expect(e).toBeInstanceOf(ClaudeExecutableError)
        }
    })
})
