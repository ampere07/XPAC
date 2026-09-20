import React, { useEffect, useState } from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { ColorPalette, settingsColorPaletteService } from '../services/settingsColorPaletteService';

interface IdleWarningModalProps {
    visible: boolean;
    onStayLoggedIn: () => void;
    onLogout: () => void;
    countdown: number;
}

const IdleWarningModal: React.FC<IdleWarningModalProps> = ({ visible, onStayLoggedIn, onLogout, countdown }) => {
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };

        if (visible) {
            fetchColorPalette();
        }
    }, [visible]);

    if (!visible) return null;

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            statusBarTranslucent={true}
            onRequestClose={onStayLoggedIn}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalContent}>
                    <View style={styles.iconContainer}>
                        <AlertTriangle size={48} color="#ef4444" />
                    </View>
                    <Text style={styles.title}>Are you still there?</Text>
                    <Text style={styles.description}>
                        You have been idle for a while. For your security, you will be automatically logged out in <Text style={{fontWeight: 'bold'}}>{countdown} minutes</Text>.
                    </Text>
                    
                    <View style={styles.buttonContainer}>
                        <TouchableOpacity 
                            style={[styles.button, styles.stayButton, { backgroundColor: colorPalette?.primary || '#3b82f6' }]} 
                            onPress={onStayLoggedIn}
                        >
                            <Text style={styles.stayButtonText}>Stay Logged In</Text>
                        </TouchableOpacity>
                        
                        <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={onLogout}>
                            <Text style={styles.logoutButtonText}>Log Out Now</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: 20
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        width: '100%',
        maxWidth: 400,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
        elevation: 5
    },
    iconContainer: {
        marginBottom: 16,
        padding: 16,
        backgroundColor: '#fee2e2',
        borderRadius: 50
    },
    title: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 8
    },
    description: {
        fontSize: 16,
        color: '#4b5563',
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 24
    },
    buttonContainer: {
        width: '100%',
        gap: 12
    },
    button: {
        width: '100%',
        paddingVertical: 14,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center'
    },
    stayButton: {
        backgroundColor: '#3b82f6'
    },
    stayButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold'
    },
    logoutButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#d1d5db'
    },
    logoutButtonText: {
        color: '#4b5563',
        fontSize: 16,
        fontWeight: '600'
    }
});

export default IdleWarningModal;
