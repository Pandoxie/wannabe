import * as React from 'react';
import { View } from 'react-native';
import { PathPickerContent } from '../new/index';

// Original Happy: the new-session path picker with a fake machine, for rendering checks.
const TREE: Record<string, string[]> = {
    '/home/demo': ['code', 'Documents', '.config', 'happy-original', 'happy-fleet'],
    '/home/demo/code': ['alpha', 'beta', 'happy'],
};

export default function PathPickerDemo() {
    const [value, setValue] = React.useState('~/');
    return (
        <View style={{ flex: 1, padding: 16, maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            <PathPickerContent
                title="Project"
                items={[{ key: '~/happy-original', label: '~/happy-original' }]}
                value={value}
                selectedProjectKey={null}
                homeDir="/home/demo"
                onChangeValue={setValue}
                onSelectProject={() => {}}
                listDirectories={async (path) => TREE[path.replace(/\/+$/, '')] ?? []}
            />
        </View>
    );
}
