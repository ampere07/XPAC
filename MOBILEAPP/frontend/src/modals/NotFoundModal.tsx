import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface NotFoundModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: string;
}

const NotFoundModal: React.FC<NotFoundModalProps> = ({ isOpen, onClose, message }) => {
  const isDarkMode = false;
  const [colorPalette, setColorPalette] = React.useState<ColorPalette | null>(null);

  React.useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(p => setColorPalette(p))
      .catch(() => {});
  }, []);

  const primaryColor = colorPalette?.primary || '#7c3aed';

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}>
        <View style={{
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 360,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
          elevation: 8,
        }}>
          <Text style={{
            fontSize: 18,
            fontWeight: '600',
            color: isDarkMode ? '#ffffff' : '#111827',
            textAlign: 'center',
            marginBottom: 8,
          }}>
            Not Found
          </Text>
          <Text style={{
            fontSize: 14,
            color: isDarkMode ? '#d1d5db' : '#4b5563',
            textAlign: 'center',
            marginBottom: 20,
          }}>
            {message}
          </Text>
          <View style={{ alignItems: 'flex-end' }}>
            <TouchableOpacity
              onPress={onClose}
              style={{
                backgroundColor: primaryColor,
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 6,
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '500' }}>
                Continue
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default NotFoundModal;
