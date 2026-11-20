import * as React from 'react';
import { Text, View, ScrollView } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';

/**
 * Native: no KaTeX, the LaTeX source in code style. The web build uses
 * MathView.web.tsx. (Original Happy ships the web client; this keeps the
 * shared markdown view compiling for native.)
 */
export function MathInline(props: { tex: string; display?: boolean }) {
    return <Text style={styles.inline}>{props.tex}</Text>;
}

export function MathBlock(props: { tex: string }) {
    return (
        <View style={styles.block}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Text style={styles.blockText}>{props.tex}</Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    inline: {
        ...Typography.mono(),
        color: theme.colors.text,
    },
    block: {
        marginVertical: 8,
        padding: 12,
        borderRadius: 8,
        backgroundColor: theme.colors.surfaceHighest,
    },
    blockText: {
        ...Typography.mono(),
        color: theme.colors.text,
        fontSize: 14,
    },
}));
