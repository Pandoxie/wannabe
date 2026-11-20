import { describe, expect, it } from 'vitest';
import { filterFolders, folderQuery } from './folderQuery';

describe('folderQuery', () => {
    it('lists home for an empty field or ~', () => {
        expect(folderQuery('')).toEqual({ base: '~/', prefix: '' });
        expect(folderQuery('~')).toEqual({ base: '~/', prefix: '' });
    });
    it('splits at the last slash', () => {
        expect(folderQuery('~/code/hap')).toEqual({ base: '~/code/', prefix: 'hap' });
        expect(folderQuery('~/code/')).toEqual({ base: '~/code/', prefix: '' });
        expect(folderQuery('/mnt/Prod')).toEqual({ base: '/mnt/', prefix: 'Prod' });
        expect(folderQuery('/')).toEqual({ base: '/', prefix: '' });
    });
    it('treats a bare name as a folder in home', () => {
        expect(folderQuery('proj')).toEqual({ base: '~/', prefix: 'proj' });
    });
});

describe('filterFolders', () => {
    it('filters by prefix, hides dot folders unless asked, sorts', () => {
        const names = ['zeta', '.happy', 'Happy-original', 'happy', 'alpha'];
        expect(filterFolders(names, '')).toEqual(['alpha', 'happy', 'Happy-original', 'zeta']);
        expect(filterFolders(names, 'HAP')).toEqual(['happy', 'Happy-original']);
        expect(filterFolders(names, '.h')).toEqual(['.happy']);
    });
});
