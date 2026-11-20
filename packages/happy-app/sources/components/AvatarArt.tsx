import * as React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { avatarArt, type AvatarArtStyle } from '@/utils/avatarArt';

interface AvatarArtProps {
    id: string;
    style: AvatarArtStyle;
    size?: number;
    square?: boolean;
    monochrome?: boolean;
}

let instance = 0;

/** Generated session avatar; see utils/avatarArt.ts for the four styles. */
export const AvatarArtView = React.memo(({ id, style, size = 48, square, monochrome }: AvatarArtProps) => {
    const art = React.useMemo(() => avatarArt(id, style, !!monochrome), [id, style, monochrome]);
    // SVG ids are document-global on web; keep gradient ids per instance.
    const prefix = React.useMemo(() => `avatar-art-${++instance}`, []);

    return (
        <View style={{ width: size, height: size, borderRadius: square ? 0 : size / 2, overflow: 'hidden' }}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
                <Defs>
                    {art.shapes.map((shape, i) => shape.kind === 'glow' ? (
                        <RadialGradient key={i} id={`${prefix}-g${i}`} cx={shape.cx} cy={shape.cy} r={shape.r} gradientUnits="userSpaceOnUse">
                            <Stop offset="0" stopColor={shape.color} stopOpacity={shape.strength} />
                            <Stop offset="1" stopColor={shape.color} stopOpacity={0} />
                        </RadialGradient>
                    ) : null)}
                </Defs>
                <Rect width={100} height={100} fill={art.background} />
                <G rotation={art.rotate} origin="50, 50">
                    {art.shapes.map((shape, i) => {
                        switch (shape.kind) {
                            case 'rect':
                                return (
                                    <Rect
                                        key={i}
                                        x={shape.x}
                                        y={shape.y}
                                        width={shape.w}
                                        height={shape.h}
                                        rx={shape.rx}
                                        fill={shape.fill}
                                        opacity={shape.opacity}
                                        rotation={shape.rotate}
                                        origin={`${shape.x + shape.w / 2}, ${shape.y + shape.h / 2}`}
                                    />
                                );
                            case 'circle':
                                return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} opacity={shape.opacity} />;
                            case 'glow':
                                return <Circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={`url(#${prefix}-g${i})`} />;
                            case 'path':
                                return (
                                    <Path
                                        key={i}
                                        d={shape.d}
                                        fill={shape.fill ?? 'none'}
                                        stroke={shape.stroke}
                                        strokeWidth={shape.strokeWidth}
                                        strokeLinecap={shape.stroke ? 'round' : undefined}
                                        opacity={shape.opacity}
                                    />
                                );
                        }
                    })}
                </G>
            </Svg>
        </View>
    );
});
