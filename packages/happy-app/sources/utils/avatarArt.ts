/**
 * Generated session avatars (Original Happy). Every avatar is drawn from the
 * session id on a 100×100 canvas, so the same session always looks the same
 * on every device, at any size, with no image assets.
 *
 * Four styles share one set of hand-picked palettes; a palette is four
 * colours that sit well together (a ground, two accents and a light), which
 * is what keeps random compositions from looking random.
 *
 * Pure data: AvatarArt.tsx renders it with react-native-svg, and the unit
 * test / preview script render the same shapes as SVG markup.
 */

export const AVATAR_ART_STYLES = ['bauhaus', 'aurora', 'mosaic', 'orbit'] as const;
export type AvatarArtStyle = typeof AVATAR_ART_STYLES[number];

export type AvatarShape =
    | { kind: 'rect'; x: number; y: number; w: number; h: number; fill: string; rotate?: number; rx?: number; opacity?: number }
    | { kind: 'circle'; cx: number; cy: number; r: number; fill: string; opacity?: number }
    /** A soft glow: `color` at the centre fading to transparent at `r`. */
    | { kind: 'glow'; cx: number; cy: number; r: number; color: string; strength: number }
    | { kind: 'path'; d: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };

export type AvatarArt = {
    background: string;
    shapes: AvatarShape[];
    /** Whole-composition rotation about the centre, in degrees. */
    rotate: number;
};

// [ground, accent, accent, light]
const PALETTES: readonly (readonly [string, string, string, string])[] = [
    ['#1F2A44', '#E07A5F', '#81B29A', '#F2CC8F'], // dusk
    ['#0B3954', '#087E8B', '#FF5A5F', '#BFD7EA'], // harbour
    ['#264653', '#2A9D8F', '#F4A261', '#E9C46A'], // desert teal
    ['#22223B', '#9A8C98', '#C9ADA7', '#F2E9E4'], // lilac
    ['#003049', '#D62828', '#F77F00', '#FCBF49'], // signal
    ['#283618', '#606C38', '#DDA15E', '#FEFAE0'], // olive
    ['#03045E', '#0077B6', '#00B4D8', '#CAF0F8'], // deep sea
    ['#0D1B2A', '#415A77', '#E0A458', '#E0E1DD'], // slate & amber
    ['#3D2C2E', '#A26769', '#6D8A96', '#ECE2D0'], // clay
    ['#2B2D42', '#EF233C', '#8D99AE', '#EDF2F4'], // ink & red
    ['#14213D', '#FCA311', '#5C80BC', '#E5E5E5'], // navy & gold
    ['#3A0CA3', '#F72585', '#4CC9F0', '#F1E9FF'], // neon dusk
    ['#1B4332', '#52B788', '#D8F3DC', '#F4A259'], // fern
    ['#432818', '#BB9457', '#99582A', '#FFE6A7'], // walnut
    ['#2E1F27', '#854D27', '#DD7230', '#F4C95D'], // ember
    ['#073B4C', '#118AB2', '#EF476F', '#FFD166'], // pop
];

const MONO: readonly [string, string, string, string] = ['#1C1C1E', '#636366', '#AEAEB2', '#F2F2F7'];

/** FNV-1a; spreads similar ids (sequential, shared prefixes) apart. */
function hash32(str: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** mulberry32: a small seeded PRNG, deterministic everywhere. */
function rng(seed: number) {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
        range: (min: number, max: number) => min + next() * (max - min),
        pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
        /** The palette with its order shuffled, keeping the ground first or not. */
        shuffle: <T>(items: readonly T[]): T[] => {
            const out = [...items];
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        },
    };
}

const round = (n: number) => Math.round(n * 100) / 100;

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
    const rad = (d: number) => (d - 90) * Math.PI / 180;
    const x1 = cx + r * Math.cos(rad(startDeg));
    const y1 = cy + r * Math.sin(rad(startDeg));
    const x2 = cx + r * Math.cos(rad(startDeg + sweepDeg));
    const y2 = cy + r * Math.sin(rad(startDeg + sweepDeg));
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${round(x1)} ${round(y1)} A ${r} ${r} 0 ${large} 1 ${round(x2)} ${round(y2)}`;
}

/** Half disc of radius r centred on (cx, cy), flat side facing `angle`. */
function halfDiscPath(cx: number, cy: number, r: number, angle: number): string {
    const a = angle * Math.PI / 180;
    const x1 = cx + r * Math.cos(a), y1 = cy + r * Math.sin(a);
    const x2 = cx - r * Math.cos(a), y2 = cy - r * Math.sin(a);
    return `M ${round(x1)} ${round(y1)} A ${r} ${r} 0 0 1 ${round(x2)} ${round(y2)} Z`;
}

/** Quarter disc filling a square cell from one corner. */
function quarterPath(x: number, y: number, s: number, corner: 0 | 1 | 2 | 3): string {
    const pts = [
        [x, y, x + s, y, x, y + s],               // top-left
        [x + s, y, x + s, y + s, x, y],           // top-right
        [x + s, y + s, x, y + s, x + s, y],       // bottom-right
        [x, y + s, x, y, x + s, y + s],           // bottom-left
    ][corner];
    const [cx, cy, ax, ay, bx, by] = pts.map(round);
    return `M ${cx} ${cy} L ${ax} ${ay} A ${s} ${s} 0 0 1 ${bx} ${by} Z`;
}

function bauhaus(r: ReturnType<typeof rng>, p: string[]): AvatarArt {
    const [ground, a, b, light] = p;
    const shapes: AvatarShape[] = [];
    // Three flat shapes in opposite quadrants: an anchor, a half disc, a dot.
    const q = r.shuffle([[34, 34], [66, 34], [34, 66], [66, 66]]);
    const big = r.range(26, 32);
    if (r.next() < 0.5) {
        shapes.push({ kind: 'circle', cx: q[0][0], cy: q[0][1], r: round(big), fill: a });
    } else {
        shapes.push({ kind: 'rect', x: round(q[0][0] - big), y: round(q[0][1] - big), w: round(big * 2), h: round(big * 2), fill: a, rotate: r.pick([0, 45]), rx: 2 });
    }
    shapes.push({ kind: 'path', d: halfDiscPath(q[3][0], q[3][1], round(r.range(20, 26)), r.pick([0, 90, 180, 270])), fill: b });
    shapes.push({ kind: 'circle', cx: q[1][0], cy: q[1][1], r: round(r.range(8, 11)), fill: light });
    if (r.next() < 0.4) {
        // A short rule, kept clear of the centre.
        shapes.push({ kind: 'rect', x: round(q[2][0] - 14), y: round(q[2][1] - 2.5), w: 28, h: 5, fill: light, rotate: r.pick([0, 90]), rx: 2.5 });
    }
    return { background: ground, shapes, rotate: r.pick([0, 90, 180, 270]) };
}

function aurora(r: ReturnType<typeof rng>, p: string[]): AvatarArt {
    const [ground, a, b, light] = p;
    const shapes: AvatarShape[] = [];
    // A light ground with two saturated glows and one deep one in the corners:
    // overlapping mid-tones on a dark ground turn to mud, this does not.
    const corners = r.shuffle([[10, 12], [90, 14], [12, 90], [88, 88]]);
    const glows: [string, number, number][] = [[a, 1, 70], [b, 1, 66], [ground, 0.85, 52]];
    glows.forEach(([color, strength, radius], i) => {
        const [x, y] = corners[i];
        shapes.push({ kind: 'glow', cx: round(x + r.range(-6, 6)), cy: round(y + r.range(-6, 6)), r: round(radius + r.range(-6, 6)), color, strength });
    });
    return { background: light, shapes, rotate: 0 };
}

function mosaic(r: ReturnType<typeof rng>, p: string[]): AvatarArt {
    const s = 100 / 3;
    const shapes: AvatarShape[] = [];
    // Left and right columns mirror each other, so the grid reads as one mark.
    for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 2; col++) {
            const bg = r.pick(p);
            let fg = r.pick(p);
            if (fg === bg) fg = p[(p.indexOf(bg) + 1 + r.int(0, 2)) % p.length];
            const corner = r.int(0, 3) as 0 | 1 | 2 | 3;
            const kind = r.next();
            const cells: [number, 0 | 1 | 2 | 3][] = col === 0
                ? [[0, corner], [2, ([1, 0, 3, 2] as const)[corner]]]
                : [[1, corner]];
            for (const [c, k] of cells) {
                const x = c * s, y = row * s;
                shapes.push({ kind: 'rect', x: round(x), y: round(y), w: round(s + 0.5), h: round(s + 0.5), fill: bg });
                if (kind < 0.7) {
                    shapes.push({ kind: 'path', d: quarterPath(x, y, s, k), fill: fg });
                } else if (kind < 0.9) {
                    shapes.push({ kind: 'circle', cx: round(x + s / 2), cy: round(y + s / 2), r: round(s * 0.32), fill: fg });
                }
            }
        }
    }
    return { background: p[0], shapes, rotate: 0 };
}

function orbit(r: ReturnType<typeof rng>, p: string[]): AvatarArt {
    const [ground, a, b, light] = p;
    const shapes: AvatarShape[] = [];
    const radii = [36, 26, 16];
    [a, b, light].forEach((stroke, i) => {
        shapes.push({ kind: 'path', d: arcPath(50, 50, radii[i], r.range(0, 360), r.range(110, 290)), stroke, strokeWidth: 7 });
    });
    shapes.push({ kind: 'circle', cx: 50, cy: 50, r: 5, fill: r.pick([a, light]) });
    return { background: ground, shapes, rotate: 0 };
}

export function avatarArt(id: string, style: AvatarArtStyle, monochrome = false): AvatarArt {
    const r = rng(hash32(`${style}:${id}`));
    const palette = monochrome ? MONO : r.pick(PALETTES);
    // The ground stays first; the accents trade places for more variety.
    const [ground, ...rest] = palette;
    const p = [ground, ...r.shuffle(rest)];
    switch (style) {
        case 'bauhaus': return bauhaus(r, p);
        case 'aurora': return aurora(r, p);
        case 'mosaic': return mosaic(r, p);
        case 'orbit': return orbit(r, p);
    }
}

/** SVG markup for the same art (preview pages and tests). */
export function avatarArtSvg(art: AvatarArt, size: number, idPrefix: string, square = false): string {
    const defs: string[] = [];
    const body = art.shapes.map((sh, i) => {
        switch (sh.kind) {
            case 'rect': {
                const t = sh.rotate ? ` transform="rotate(${sh.rotate} ${round(sh.x + sh.w / 2)} ${round(sh.y + sh.h / 2)})"` : '';
                return `<rect x="${sh.x}" y="${sh.y}" width="${sh.w}" height="${sh.h}"${sh.rx ? ` rx="${sh.rx}"` : ''} fill="${sh.fill}"${sh.opacity !== undefined ? ` opacity="${sh.opacity}"` : ''}${t}/>`;
            }
            case 'circle':
                return `<circle cx="${sh.cx}" cy="${sh.cy}" r="${sh.r}" fill="${sh.fill}"${sh.opacity !== undefined ? ` opacity="${sh.opacity}"` : ''}/>`;
            case 'glow': {
                const gid = `${idPrefix}-g${i}`;
                defs.push(`<radialGradient id="${gid}" cx="${sh.cx}" cy="${sh.cy}" r="${sh.r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${sh.color}" stop-opacity="${sh.strength}"/><stop offset="1" stop-color="${sh.color}" stop-opacity="0"/></radialGradient>`);
                return `<circle cx="${sh.cx}" cy="${sh.cy}" r="${sh.r}" fill="url(#${gid})"/>`;
            }
            case 'path':
                return `<path d="${sh.d}" fill="${sh.fill ?? 'none'}"${sh.stroke ? ` stroke="${sh.stroke}" stroke-width="${sh.strokeWidth}" stroke-linecap="round"` : ''}${sh.opacity !== undefined ? ` opacity="${sh.opacity}"` : ''}/>`;
        }
    }).join('');
    const clip = `${idPrefix}-clip`;
    const shape = square ? `<rect width="100" height="100"/>` : `<circle cx="50" cy="50" r="50"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><defs><clipPath id="${clip}">${shape}</clipPath>${defs.join('')}</defs><g clip-path="url(#${clip})"><rect width="100" height="100" fill="${art.background}"/><g transform="rotate(${art.rotate} 50 50)">${body}</g></g></svg>`;
}
