import React, { useEffect, useState } from 'react';
import { View, Text, Modal, Pressable, Animated, PanResponder, StyleSheet, useWindowDimensions, Image, ScrollView } from 'react-native';
import { ColorPalette, settingsColorPaletteService } from '../services/settingsColorPaletteService';
import { formUIService } from '../services/formUIService';
import { version } from '../../package.json';

interface AboutAppModalProps {
    visible: boolean;
    onClose: () => void;
}

const AboutAppModal: React.FC<AboutAppModalProps> = ({ visible, onClose }) => {
    const { width } = useWindowDimensions();
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [logoUrl, setLogoUrl] = useState<string | null>(null);
    const pan = React.useRef(new Animated.ValueXY()).current;

    const convertGoogleDriveUrl = (url: string): string => {
        if (!url) return '';
        const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || '';
        return `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
    };

    useEffect(() => {
        const initialize = async () => {
            try {
                const [palette, config] = await Promise.all([
                    settingsColorPaletteService.getActive(),
                    formUIService.getConfig()
                ]);
                setColorPalette(palette);
                if (config && config.logo_url) {
                    setLogoUrl(convertGoogleDriveUrl(config.logo_url));
                }
            } catch (err) {
                console.error('Failed to initialize AboutAppModal:', err);
            }
        };

        initialize();
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
                    </View>

                    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                        <View style={styles.contentContainer}>
                            {/* Logo Section */}
                            <View style={styles.logoContainer}>
                                {logoUrl ? (
                                    <Image
                                        source={{ uri: logoUrl }}
                                        style={styles.logoImage}
                                        resizeMode="contain"
                                    />
                                ) : (
                                    <View style={[styles.logoPlaceholder, { backgroundColor: colorPalette?.primary || '#ef4444' }]}>
                                        <Text style={styles.logoPlaceholderText}>ATSS</Text>
                                    </View>
                                )}
                            </View>

                            {/* Main Content */}
                            <View style={styles.textSection}>
                                <Text style={[styles.mainTitle, { color: colorPalette?.primary || '#ef4444' }]}>
                                    Quality Internet Speed
                                </Text>
                                <Text style={styles.versionText}>Version {version}</Text>
                                <Text style={styles.mainDescription}>
                                    Get ready to upgrade your internet experience with ATSS Telecommunication Services. Enjoy lightning-fast fiber connectivity for homes and businesses. Experience the reliability and speed you deserve. Discover our high-speed internet solutions now!
                                </Text>
                            </View>

                            <View style={styles.divider} />

                            {/* Bottom Content */}
                            <View style={[styles.bottomBox, { backgroundColor: (colorPalette?.primary || '#ef4444') + '10' }]}>
                                <Text style={styles.bottomText}>
                                    We deliver high-speed internet connectivity using fiber optic to serve the last mile.
                                </Text>
                            </View>

                        </View>
                        <View style={styles.spacer} />
                    </ScrollView>
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
        maxHeight: '85%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -15 },
        shadowOpacity: 0.1,
        shadowRadius: 40,
        elevation: 30
    },
    modalHeader: {
        paddingHorizontal: 24,
        paddingVertical: 16,
        alignItems: 'center'
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
    scrollContent: {
        flexGrow: 1,
    },
    contentContainer: {
        padding: 24,
        alignItems: 'center'
    },
    logoContainer: {
        marginBottom: 24,
        alignItems: 'center',
        padding: 10,
    },
    logoImage: {
        height: 80,
        width: 180,
    },
    logoPlaceholder: {
        width: 120,
        height: 60,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoPlaceholderText: {
        color: '#ffffff',
        fontSize: 24,
        fontWeight: 'bold',
    },
    textSection: {
        alignItems: 'center',
        marginBottom: 24,
    },
    mainTitle: {
        fontSize: 22,
        fontWeight: '800',
        marginBottom: 8,
        textAlign: 'center',
    },
    versionText: {
        fontSize: 14,
        color: '#9ca3af',
        marginBottom: 16,
        fontWeight: '600',
    },
    mainDescription: {
        fontSize: 15,
        color: '#4b5563',
        textAlign: 'center',
        lineHeight: 24,
    },
    divider: {
        width: '60%',
        height: 1,
        backgroundColor: '#e5e7eb',
        marginVertical: 24,
    },
    bottomBox: {
        padding: 20,
        borderRadius: 20,
        width: '100%',
        marginBottom: 32,
    },
    bottomText: {
        fontSize: 16,
        color: '#374151',
        textAlign: 'center',
        fontWeight: '600',
        lineHeight: 24,
    },
    closeBtn: {
        paddingVertical: 14,
        borderRadius: 50,
        width: '100%',
        alignItems: 'center'
    },
    closeBtnText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16
    },
    spacer: {
        height: 60
    },
});

export default AboutAppModal;
