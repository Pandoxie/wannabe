import { execSync } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detectCLIAvailability } from './detectCLI';

vi.mock('child_process', () => ({ execSync: vi.fn() }));
vi.mock('fs', () => ({ existsSync: vi.fn() }));
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/home/person'),
    platform: vi.fn(() => 'darwin'),
  },
}));

const mockedExecSync = vi.mocked(execSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedPlatform = vi.mocked(os.platform);

describe('CLI availability detection', () => {
  beforeEach(() => {
    mockedExecSync.mockReset();
    mockedExecSync.mockImplementation(() => {
      throw new Error('not installed');
    });
    mockedExistsSync.mockReset();
    mockedExistsSync.mockReturnValue(false);
    mockedPlatform.mockReturnValue('darwin');
  });

  it('never reports Gemini or Antigravity, which this build removed', () => {
    // Every command "exists": gemini and agy still must not be offered.
    mockedExecSync.mockImplementation(() => Buffer.from(''));
    const availability = detectCLIAvailability();
    expect(availability.claude).toBe(true);
    expect(availability.codex).toBe(true);
    // Kept (always false) because the web and iOS schemas require it.
    expect(availability.gemini).toBe(false);
    expect('agy' in availability).toBe(false);
  });
});
