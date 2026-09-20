import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ConfirmationModalProps {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  isOpen: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  isOpen
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const theme = await AsyncStorage.getItem('theme');
        setIsDarkMode(theme === 'dark' || theme === null);

        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };

    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)'
      }}>
        <View style={{
          width: '90%',
          maxWidth: 400,
          padding: 24,
          borderRadius: 8,
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          shadowColor: "#000",
          shadowOffset: {
            width: 0,
            height: 2,
          },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 5,
        }}>
          <Text style={{
            fontSize: 20,
            fontWeight: '600',
            marginBottom: 16,
            color: isDarkMode ? '#ffffff' : '#111827'
          }}>
            {title}
          </Text>

          <Text style={{
            fontSize: 16,
            marginBottom: 32,
            color: isDarkMode ? '#d1d5db' : '#4b5563',
            lineHeight: 24
          }}>
            {message}
          </Text>

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
            <TouchableOpacity
              onPress={onCancel}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 4,
                backgroundColor: isDarkMode ? '#374151' : '#e5e7eb'
              }}
            >
              <Text style={{
                fontWeight: '500',
                color: isDarkMode ? '#e5e7eb' : '#374151'
              }}>
                {cancelText}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onConfirm}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 4,
                backgroundColor: colorPalette?.primary || '#7c3aed',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Text style={{ fontWeight: '500', color: '#ffffff' }}>
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ConfirmationModal;