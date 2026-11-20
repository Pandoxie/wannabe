import { describe, it, expect } from 'vitest';
import { updateArguments } from './update';

describe('happy update', () => {
    it('maps to the installer', () => {
        expect(updateArguments([])).toEqual(['--update']);
        expect(updateArguments(['status'])).toEqual(['--status']);
        expect(updateArguments(['verify'])).toEqual(['--verify']);
        expect(updateArguments(['list'])).toEqual(['--list']);
        expect(updateArguments(['1.2.6+orig.30'])).toEqual(['1.2.6+orig.30']);
        expect(updateArguments(['--help'])).toBe('help');
    });
});
