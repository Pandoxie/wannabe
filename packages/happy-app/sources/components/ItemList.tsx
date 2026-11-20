import * as React from 'react';
import { 
    ScrollView, 
    View, 
    StyleProp, 
    ViewStyle,
    Platform,
    ScrollViewProps
} from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export interface ItemListProps extends ScrollViewProps {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    containerStyle?: StyleProp<ViewStyle>;
    insetGrouped?: boolean;
}

const stylesheet = StyleSheet.create((theme, runtime) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.groupped.background,
    },
    contentContainer: {
        paddingBottom: Platform.select({ ios: 34, default: 16 }),
        paddingTop: 0,
    },
}));

export const ItemList = React.memo<ItemListProps>((props) => {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    
    const {
        children,
        style,
        containerStyle,
        insetGrouped = true,
        ...scrollViewProps
    } = props;

    const isIOS = Platform.OS === 'ios';
    const isWeb = Platform.OS === 'web';
    
    const backgroundColor = theme.colors.groupped.background;

    return (
        <ScrollView 
            style={[
                styles.container,
                { backgroundColor },
                style
            ]}
            contentContainerStyle={[
                styles.contentContainer,
                containerStyle
            ]}
            showsVerticalScrollIndicator={scrollViewProps.showsVerticalScrollIndicator !== undefined 
                ? scrollViewProps.showsVerticalScrollIndicator 
                : true}
            contentInsetAdjustmentBehavior={(isIOS && !isWeb) ? 'automatic' : undefined}
            // Web: always reserve the scrollbar's space (theme.css), so a page
            // that only becomes scrollable after loading (Account) does not
            // shift sideways, and short and long pages line up.
            {...(isWeb ? { dataSet: { itemList: 'true' } } : {})}
            {...scrollViewProps}
        >
            {children}
        </ScrollView>
    );
});

export const ItemListStatic = React.memo<Omit<ItemListProps, keyof ScrollViewProps> & {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    containerStyle?: StyleProp<ViewStyle>;
    insetGrouped?: boolean;
}>((props) => {
    const { theme } = useUnistyles();
    
    const {
        children,
        style,
        containerStyle,
        insetGrouped = true
    } = props;

    const isIOS = Platform.OS === 'ios';
    const isWeb = Platform.OS === 'web';
    
    const backgroundColor = theme.colors.groupped.background;

    return (
        <View 
            style={[
                { backgroundColor },
                style
            ]}
        >
            <View style={containerStyle}>
                {children}
            </View>
        </View>
    );
});
