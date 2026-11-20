import { Dimensions, Platform, type DimensionValue } from 'react-native';
import { getDeviceType } from '@/utils/responsive';
import { isRunningOnMac } from '@/utils/platform';

// Calculate max width based on device type
function getMaxWidth(): number {
    const deviceType = getDeviceType();
    
    // For phones, use the max dimension (width or height)
    if (deviceType === 'phone' && Platform.OS !== 'web') {
        const { width, height } = Dimensions.get('window');
        return Math.max(width, height);
    }

    if (isRunningOnMac()) {
        return Number.POSITIVE_INFINITY;
    }
    
    // For tablets and web, use 700px
    return 800;
}

// Calculate max width based on device type
function getMaxLayoutWidth(): number {
    const deviceType = getDeviceType();
    
    // For phones, use the max dimension (width or height)
    if (deviceType === 'phone' && Platform.OS !== 'web') {
        const { width, height } = Dimensions.get('window');
        return Math.max(width, height);
    }

    if (isRunningOnMac()) {
        return 1400;
    }
    
    // For tablets and web, use 700px
    return 800;
}

// The chat column (messages, composer, diff and file panes). On web it
// follows the space left between the two sidebars instead of stopping at
// 800px; `contentGutter` keeps it off the panel edges. The gutter is a
// percentage, so it is relative to the chat column's own width (CSS padding
// and margin percentages resolve against the containing block's width): about
// 40px next to a 1000px column, 64px next to 1600px.
function getContentMaxWidth(): number | undefined {
    return Platform.OS === 'web' ? undefined : getMaxLayoutWidth();
}

// Settings and other grouped lists. On web they grow with the window instead
// of stopping at 800px, up to a width where rows still read as one line.
function getSettingsMaxWidth(): number {
    return Platform.OS === 'web' ? 1120 : getMaxLayoutWidth();
}

export const layout = {
    maxWidth: getMaxLayoutWidth(),
    settingsMaxWidth: getSettingsMaxWidth(),
    headerMaxWidth: getMaxWidth(),
    contentMaxWidth: getContentMaxWidth(),
    contentGutter: (Platform.OS === 'web' ? '4%' : 0) as DimensionValue,
}