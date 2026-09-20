import React, { useEffect } from 'react';
import { View, Text, Modal, Pressable, Animated, PanResponder, StyleSheet, useWindowDimensions } from 'react-native';
import { Bell } from 'lucide-react-native';
import { ColorPalette, settingsColorPaletteService } from '../services/settingsColorPaletteService';

interface NotificationModalProps {
    visible: boolean;
    onClose: () => void;
}

const NotificationModal: React.FC<NotificationModalProps> = ({ visible, onClose }) => {
    const { width } = useWindowDimensions();
    const [colorPalette, setColorPalette] = React.useState<ColorPalette | null>(null);
    const pan = React.useRef(new Animated.ValueXY()).current;

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };

        fetchColorPalette();
    }, []);

    // Reset pan position when modal opens
    useEffect(() => {
        if (visible) {
            pan.setValue({ x: 0, y: 0 });
        }
    }, [visible]);

    const panResponder = React.useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return Math.abs(gestureState.dy) > 10;
            },
            onPanResponderMove: (_, gestureState) => {
                if (gestureState.dy > 0) {
                    pan.setValue({ x: 0, y: gestureState.dy });
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                if (gestureState.dy > 120) {
                    Animated.timing(pan, {
                        toValue: { x: 0, y: 1000 },
                        duration: 250,
                        useNativeDriver: true,
                    }).start(onClose);
                } else {
                    Animated.spring(pan, {
                        toValue: { x: 0, y: 0 },
                        useNativeDriver: true,
                        bounciness: 0,
                        speed: 10
                    }).start();
                }
            },
        })
    ).current;

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="slide"
            statusBarTranslucent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <Pressable style={styles.modalBackdrop} onPress={onClose} />
                <Animated.View style={[styles.modalSheet, { transform: [{ translateY: pan.y }] }]}>
                    <View {...panResponder.panHandlers} style={styles.modalHeader}>
                        <Pressable onPress={onClose} style={styles.modalHandleBtn}>
                            <View style={styles.modalHandle} />
                        </Pressable>
                        <Text style={styles.modalTitle}>Notifications</Text>
                    </View>

                    <View style={styles.modalContent}>
                        <View style={styles.underConstructionBox}>
                            <View style={[styles.iconCircle, { backgroundColor: (colorPalette?.primary || '#ef4444') + '15' }]}>
                                <Bell size={32} color={colorPalette?.primary || '#ef4444'} />
                            </View>
                            <Text style={styles.constructionLabel}>Under Construction</Text>
                            <Text style={styles.constructionDesc}>
                                We're working hard to bring you this feature. Stay tuned!
                            </Text>
                        </View>


                        <View style={styles.spacer} />
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'transparent' },
    modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    modalSheet: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 40,
        borderTopRightRadius: 40,
        width: '100%',
        maxHeight: '90%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -15 },
        shadowOpacity: 0.1,
        shadowRadius: 40,
        elevation: 30
    },
    modalHeader: {
        paddingHorizontal: 24,
        paddingVertical: 16,
        alignItems: 'center',
        backgroundColor: 'transparent'
    },
    modalHandleBtn: {
        width: '100%',
        alignItems: 'center',
        paddingVertical: 8
    },
    modalHandle: {
        width: '20%',
        height: 3,
        backgroundColor: '#d1d5db',
        borderRadius: 2,
        marginBottom: 8
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827'
    },
    modalContent: {
        padding: 24,
        alignItems: 'center'
    },
    underConstructionBox: {
        alignItems: 'center',
        marginBottom: 32,
        padding: 20
    },
    iconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16
    },
    constructionLabel: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 8
    },
    constructionDesc: {
        fontSize: 14,
        color: '#6b7280',
        textAlign: 'center',
        lineHeight: 20
    },
    primaryBtn: {
        paddingVertical: 14,
        borderRadius: 50,
        width: '60%',
        alignItems: 'center'
    },
    primaryBtnText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16
    },
    spacer: {
        height: 40
    },
});

export default NotificationModal;
