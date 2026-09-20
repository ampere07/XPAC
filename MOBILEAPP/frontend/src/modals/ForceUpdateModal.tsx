import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    Modal,
    StyleSheet,
    TouchableOpacity,
    Linking,
    Platform,
    Image,
    Dimensions
} from 'react-native';
import { Download, AlertCircle } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ForceUpdateModalProps {
    visible: boolean;
    onUpdate?: () => void;
    playstoreUrl: string;
    latestVersion: string;
    isForce?: boolean;
    onClose?: () => void;
}

const { width } = Dimensions.get('window');

const ForceUpdateModal: React.FC<ForceUpdateModalProps> = ({
    visible,
    playstoreUrl,
    latestVersion,
    isForce = true,
    onClose
}) => {
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(() => settingsColorPaletteService.getActiveSync());

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette in ForceUpdateModal:', err);
            }
        };
        fetchColorPalette();
    }, []);

    const primaryColor = colorPalette?.primary || '#7c3aed';
    const secondaryColor = colorPalette?.secondary || '#8e55f1ff';

    const handleUpdate = () => {
        Linking.openURL(playstoreUrl).catch(err => console.error("Couldn't load page", err));
    };

    return (
        <Modal
            transparent
            visible={visible}
            animationType="fade"
        >
            <View style={styles.overlay}>
                <View style={styles.modalContainer}>
                    <LinearGradient
                        colors={[secondaryColor, primaryColor]}
                        style={styles.headerGradient}
                    >
                        <View style={styles.iconContainer}>
                            <Download size={48} color="#fff" strokeWidth={1.5} />
                        </View>
                    </LinearGradient>

                    <View style={styles.content}>
                        <Text style={styles.title}>Update Available!</Text>
                        <Text style={styles.version}>Version {latestVersion}</Text>

                        <Text style={styles.description}>
                            {isForce
                                ? "A critical update is required to continue using the app. Please update to the latest version to enjoy new features and security improvements."
                                : "A new version of ATSS is available. We recommend updating now to get the best experience."}
                        </Text>

                        <TouchableOpacity
                            style={styles.updateButton}
                            onPress={handleUpdate}
                            activeOpacity={0.8}
                        >
                            <LinearGradient
                                colors={[primaryColor, secondaryColor]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 0 }}
                                style={styles.buttonGradient}
                            >
                                <Text style={styles.updateButtonText}>Update Now</Text>
                            </LinearGradient>
                        </TouchableOpacity>

                        {!isForce && onClose && (
                            <TouchableOpacity
                                style={styles.laterButton}
                                onPress={onClose}
                            >
                                <Text style={styles.laterButtonText}>Maybe Later</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {isForce && (
                        <View style={styles.footer}>
                            <AlertCircle size={14} color="#64748b" />
                            <Text style={styles.footerText}>Required for app stability</Text>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContainer: {
        width: width * 0.85,
        backgroundColor: '#fff',
        borderRadius: 24,
        overflow: 'hidden',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 15,
    },
    headerGradient: {
        height: 140,
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconContainer: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        padding: 24,
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        color: '#1e293b',
        marginBottom: 4,
        textAlign: 'center',
    },
    version: {
        fontSize: 16,
        color: '#3b82f6',
        fontWeight: '600',
        marginBottom: 16,
    },
    description: {
        fontSize: 15,
        color: '#64748b',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
    },
    updateButton: {
        width: '100%',
        height: 54,
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 12,
    },
    buttonGradient: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    updateButtonText: {
        color: '#fff',
        fontSize: 17,
        fontWeight: '700',
    },
    laterButton: {
        padding: 12,
    },
    laterButtonText: {
        color: '#94a3b8',
        fontSize: 15,
        fontWeight: '600',
    },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 20,
        gap: 6,
    },
    footerText: {
        fontSize: 12,
        color: '#94a3b8',
        fontStyle: 'italic',
    }
});

export default ForceUpdateModal;
