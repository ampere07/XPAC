import React from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    useWindowDimensions
} from 'react-native';

interface AutoTimeOutWarningModalProps {
    visible: boolean;
    onClose: () => void;
    userData: any;
}

const AutoTimeOutWarningModal: React.FC<AutoTimeOutWarningModalProps> = ({ visible, onClose, userData }) => {
    const { width } = useWindowDimensions();

    // Check if the user is a technician
    const role = (userData?.role || '').toLowerCase();
    const roleId = Number(userData?.role_id);
    const isTechnician = role === 'technician' || roleId === 2;

    if (!isTechnician) return null;

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            statusBarTranslucent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={styles.modalBackdrop} />
                <View style={[styles.modalCard, { width: width > 400 ? 360 : '85%' }]}>
                    <Text style={styles.modalTitle}>Time-Out Reminder</Text>
                    <Text style={styles.modalDescription}>
                        You need to time out your account before leaving the office.
                    </Text>
                    <Pressable 
                        style={({ pressed }) => [
                            styles.okButton,
                            { opacity: pressed ? 0.8 : 1 }
                        ]} 
                        onPress={onClose}
                    >
                        <Text style={styles.okButtonText}>OK</Text>
                    </Pressable>
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
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    modalBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    modalCard: {
        backgroundColor: '#ffffff',
        borderRadius: 20,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
        elevation: 10,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 12,
        textAlign: 'center',
    },
    modalDescription: {
        fontSize: 14,
        color: '#4b5563',
        textAlign: 'center',
        lineHeight: 20,
        marginBottom: 24,
    },
    okButton: {
        backgroundColor: '#ef4444',
        paddingVertical: 10,
        paddingHorizontal: 24,
        borderRadius: 10,
        width: '100%',
        alignItems: 'center',
    },
    okButtonText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 14,
    },
});

export default AutoTimeOutWarningModal;
