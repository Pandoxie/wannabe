import * as React from 'react';
import { Text } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

/**
 * Original Happy: an agent CLI on a machine — not found / installed / logged in /
 * not logged in, from the CLI's `cliAvailability` and `cliAuth` metadata
 * (`loggedIn` undefined: an older CLI that does not report it).
 */
export function CliStatus({ installed, loggedIn }: { installed: boolean; loggedIn?: boolean | null }) {
    const { theme } = useUnistyles();
    const label = !installed ? t('machine.cliNotFound')
        : loggedIn === true ? t('machine.cliLoggedIn')
        : loggedIn === false ? t('machine.cliNotLoggedIn')
        : t('machine.cliInstalled');
    const color = !installed ? theme.colors.textSecondary
        : loggedIn === false ? '#FF9500'
        : '#34C759';
    return <Text style={{ color, fontSize: 14 }}>{label}</Text>;
}
