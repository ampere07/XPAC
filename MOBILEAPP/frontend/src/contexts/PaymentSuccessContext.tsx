import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { CheckCircle } from 'lucide-react-native';

interface PaymentSuccessContextType {
    showPaymentSuccess: () => void;
}

const PaymentSuccessContext = createContext<PaymentSuccessContextType>({
    showPaymentSuccess: () => { },
});

export const usePaymentSuccess = () => useContext(PaymentSuccessContext);

export const PaymentSuccessProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [visible, setVisible] = useState(false);

    const showPaymentSuccess = useCallback(() => {
        setVisible(true);
    }, []);

    const handleClose = useCallback(() => {
        setVisible(false);
    }, []);

    return (
        <PaymentSuccessContext.Provider value={{ showPaymentSuccess }}>
            {children}

            {/* Global Payment Success Modal — lives OUTSIDE all page components */}
            <Modal
                visible={visible}
                transparent={true}
                animationType="slide"
                statusBarTranslucent={true}
                onRequestClose={() => { }} // Must close via button only
            >
                <View style={styles.overlay}>
                    <View style={styles.sheet}>
                        {/* Handle bar */}
                        <View style={styles.handleBar} />

                        {/* Title */}
                        <Text style={styles.title}>Payment Successful!</Text>

                        {/* Icon */}
                        <View style={styles.iconCircle}>
                            <CheckCircle size={48} color="#16a34a" />
                        </View>

                        {/* Description */}
                        <Text style={styles.description}>
                            Thank you! Your payment has been processed successfully. Your balance will be updated shortly.
                        </Text>

                        {/* Close Button */}
                        <Pressable
                            onPress={handleClose}
                            style={styles.btn}
                        >
                            <Text style={styles.btnText}>Great!</Text>
                        </Pressable>

                        <View style={{ height: 32 }} />
                    </View>
                </View>
            </Modal>
        </PaymentSuccessContext.Provider>
    );
};

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.4)',
    },
    sheet: {
        backgroundColor: '#ffffff',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        paddingHorizontal: 24,
        paddingTop: 16,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -15 },
        shadowOpacity: 0.3,
        shadowRadius: 15,
        elevation: 20,
    },
    handleBar: {
        width: 40,
        height: 4,
        backgroundColor: '#e5e7eb',
        borderRadius: 2,
        marginBottom: 16,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
        color: '#111827',
        marginBottom: 24,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#dcfce7',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 24,
    },
    description: {
        fontSize: 15,
        color: '#4b5563',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 32,
    },
    btn: {
        paddingVertical: 16,
        borderRadius: 16,
        width: '100%',
        alignItems: 'center',
        backgroundColor: '#ef4444',
    },
    btnText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16,
    },
});
