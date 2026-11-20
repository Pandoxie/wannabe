import * as React from 'react';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { CliStatus } from '@/components/CliStatus';
import { t } from '@/text';

// Original Happy: the machine page's CLI rows in every state, for rendering checks.
export default function CliStatusDemo() {
    return (
        <ItemList>
            <ItemGroup title={t('machine.cliAvailability')}>
                <Item title="Claude" showChevron={false} rightElement={<CliStatus installed loggedIn={true} />} />
                <Item title="Codex" showChevron={false} rightElement={<CliStatus installed loggedIn={false} />} />
                <Item title="Claude (older CLI)" showChevron={false} rightElement={<CliStatus installed />} />
                <Item title="Codex (not installed)" showChevron={false} rightElement={<CliStatus installed={false} loggedIn={null} />} />
            </ItemGroup>
        </ItemList>
    );
}
