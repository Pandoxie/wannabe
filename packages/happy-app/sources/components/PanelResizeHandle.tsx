import * as React from 'react';
import { Platform, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

/**
 * A draggable vertical edge for a desktop side panel (web only).
 *
 * Place it absolutely over the boundary between the panel and the chat. It
 * reports widths live while dragging (once per animation frame) so the
 * caller can keep them in local state, and once more on release so the caller
 * can persist the final value. Double-click resets to the automatic width.
 *
 * `direction` says which way widens the panel: +1 when the panel is on the
 * left (drag right to widen), -1 when it is on the right.
 */
export const PanelResizeHandle = React.memo((props: {
    width: number;
    direction: 1 | -1;
    onResize: (width: number) => void;
    onResizeEnd: (width: number) => void;
    onReset?: () => void;
    style?: any;
    accessibilityLabel?: string;
}) => {
    const { theme } = useUnistyles();
    const ref = React.useRef<View>(null);
    const [hovered, setHovered] = React.useState(false);
    const [dragging, setDragging] = React.useState(false);

    // Read the latest props from the DOM listeners without re-binding them.
    const propsRef = React.useRef(props);
    propsRef.current = props;

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const node = ref.current as unknown as HTMLElement | null;
        if (!node || typeof node.addEventListener !== 'function') return;

        let startX = 0;
        let startWidth = 0;
        let lastWidth = 0;
        let frame: number | null = null;
        let activePointer: number | null = null;
        const previousBody = { cursor: '', userSelect: '' };

        const widthAt = (clientX: number) => startWidth + propsRef.current.direction * (clientX - startX);

        const onPointerMove = (event: PointerEvent) => {
            if (event.pointerId !== activePointer) return;
            lastWidth = widthAt(event.clientX);
            if (frame !== null) return;
            frame = requestAnimationFrame(() => {
                frame = null;
                propsRef.current.onResize(lastWidth);
            });
        };

        const finish = (event: PointerEvent) => {
            if (event.pointerId !== activePointer) return;
            activePointer = null;
            if (frame !== null) {
                cancelAnimationFrame(frame);
                frame = null;
            }
            node.releasePointerCapture?.(event.pointerId);
            node.removeEventListener('pointermove', onPointerMove);
            node.removeEventListener('pointerup', finish);
            node.removeEventListener('pointercancel', finish);
            document.body.style.cursor = previousBody.cursor;
            document.body.style.userSelect = previousBody.userSelect;
            setDragging(false);
            propsRef.current.onResizeEnd(lastWidth);
        };

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0 || activePointer !== null) return;
            event.preventDefault();
            activePointer = event.pointerId;
            startX = event.clientX;
            startWidth = propsRef.current.width;
            lastWidth = startWidth;
            node.setPointerCapture?.(event.pointerId);
            node.addEventListener('pointermove', onPointerMove);
            node.addEventListener('pointerup', finish);
            node.addEventListener('pointercancel', finish);
            previousBody.cursor = document.body.style.cursor;
            previousBody.userSelect = document.body.style.userSelect;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            setDragging(true);
        };

        const onDoubleClick = () => propsRef.current.onReset?.();
        const onEnter = () => setHovered(true);
        const onLeave = () => setHovered(false);

        node.addEventListener('pointerdown', onPointerDown);
        node.addEventListener('dblclick', onDoubleClick);
        node.addEventListener('pointerenter', onEnter);
        node.addEventListener('pointerleave', onLeave);
        return () => {
            node.removeEventListener('pointerdown', onPointerDown);
            node.removeEventListener('dblclick', onDoubleClick);
            node.removeEventListener('pointerenter', onEnter);
            node.removeEventListener('pointerleave', onLeave);
            node.removeEventListener('pointermove', onPointerMove);
            node.removeEventListener('pointerup', finish);
            node.removeEventListener('pointercancel', finish);
            if (frame !== null) cancelAnimationFrame(frame);
            if (activePointer !== null) {
                document.body.style.cursor = previousBody.cursor;
                document.body.style.userSelect = previousBody.userSelect;
            }
        };
    }, []);

    if (Platform.OS !== 'web') {
        return null;
    }

    const active = hovered || dragging;
    return (
        <View
            ref={ref}
            accessibilityRole="adjustable"
            accessibilityLabel={props.accessibilityLabel}
            style={[
                {
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    width: 9,
                    zIndex: 1200,
                    alignItems: 'center',
                    cursor: 'col-resize',
                    touchAction: 'none',
                } as any,
                props.style,
            ]}
        >
            <View
                pointerEvents="none"
                style={{
                    width: dragging ? 3 : 2,
                    height: '100%',
                    backgroundColor: active ? theme.colors.textLink : 'transparent',
                    opacity: dragging ? 0.9 : 0.5,
                }}
            />
        </View>
    );
});
