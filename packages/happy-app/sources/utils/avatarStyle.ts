// The `avatarStyle` setting syncs between app versions (and the upstream iOS
// app) as a free string, so every read goes through a normalizer instead of
// trusting the stored value.
//
// Original Happy replaced upstream's styles (brutalist, pixelated, gradient)
// with its own generated set; an old value shows the default. Upstream iOS
// does not know these names and shows its own default there.

import { AVATAR_ART_STYLES, type AvatarArtStyle } from './avatarArt';

export const AVATAR_STYLES = AVATAR_ART_STYLES;
export type AvatarStyle = AvatarArtStyle;

export const DEFAULT_AVATAR_STYLE: AvatarStyle = 'orbit';

export function normalizeAvatarStyle(value: string | null | undefined): AvatarStyle {
    return (AVATAR_STYLES as readonly string[]).includes(value ?? '')
        ? value as AvatarStyle
        : DEFAULT_AVATAR_STYLE;
}
