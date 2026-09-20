import React from 'react';
import { View, Text, Modal, StyleSheet, TouchableOpacity } from 'react-native';
import { LogIn } from 'lucide-react-native';
import { ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Shown when the server has rejected the app's credential.
 *
 * This was a copy of the web component — `<div>`, `className`, `onClick` — carried
 * over with the rest of the port and never rewritten, so it could not have rendered
 * on a phone: React Native has no host component called `div`, and mounting one
 * throws. It was only ever mounted behind a condition that never became true
 * (DashboardCustomer tested an error message for the substring '401', which the
 * context never put there), which is why the crash was never seen. Now that a 401
 * actually raises SESSION_EXPIRED_EVENT, this has to be real React Native.
 *
 * Built from the same primitives as IdleWarningModal, the other modal that
 * interrupts a session, so the two read alike when they appear.
 */
interface SessionExpiredModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  colorPalette?: ColorPalette | null;
}

const SessionExpiredModal: React.FC<SessionExpiredModalProps> = ({ isOpen, onConfirm, colorPalette }) => {
  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      // Deliberately the same action as the button: there is nothing usable behind
      // this, so dismissing it with the hardware back button must still sign out
      // rather than return the customer to a dashboard that cannot load.
      onRequestClose={onConfirm}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <LogIn size={40} color={colorPalette?.primary || '#2563eb'} />
          </View>
          <Text style={styles.title}>Session Expired</Text>
          <Text style={styles.description}>
            Please sign in again to continue.
          </Text>

          <TouchableOpacity
            style={[styles.button, { backgroundColor: colorPalette?.primary || '#2563eb' }]}
            onPress={onConfirm}
          >
            <Text style={styles.buttonText}>Re-login</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 20
  },
  content: {
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
    backgroundColor: '#dbeafe',
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
  button: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold'
  }
});

export default SessionExpiredModal;
