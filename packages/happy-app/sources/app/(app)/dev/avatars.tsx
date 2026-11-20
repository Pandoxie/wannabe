import * as React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { AvatarArtView } from '@/components/AvatarArt';
import { AVATAR_STYLES } from '@/utils/avatarStyle';

const IDS = Array.from({ length: 12 }, (_, i) => `session-${i}-${(i * 7919).toString(36)}`);

/** All generated avatar styles at list, header and settings sizes. */
export default function AvatarsDemo() {
    const { theme } = useUnistyles();
    return (
        <ScrollView style={{ flex: 1, backgroundColor: theme.colors.groupped.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>
            {AVATAR_STYLES.map((style) => (
                <View key={style} style={{ gap: 8 }}>
                    <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>{style}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        {IDS.map((id) => <AvatarArtView key={id} id={id} style={style} size={48} />)}
                        <AvatarArtView id={IDS[0]} style={style} size={48} monochrome />
                        <AvatarArtView id={IDS[1]} style={style} size={24} />
                        <AvatarArtView id={IDS[2]} style={style} size={90} />
                    </View>
                </View>
            ))}
        </ScrollView>
    );
}
