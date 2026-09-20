import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ApprovalConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

const ApprovalConfirmationModal: React.FC<ApprovalConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  loading = false
}) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const theme = await AsyncStorage.getItem('theme');
        setIsDarkMode(theme === 'dark');

        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };

    // Load settings when component mounts or when modal opens
    loadSettings();
  }, [isOpen]);

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
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
          <View style={{ padding: 24 }}>
            <Text style={{
              fontSize: 20,
              fontWeight: '600',
              marginBottom: 16,
              color: isDarkMode ? '#ffffff' : '#111827'
            }}>
              Confirm
            </Text>

            <Text style={{
              fontSize: 16,
              marginBottom: 32,
              color: isDarkMode ? '#d1d5db' : '#374151',
              lineHeight: 24
            }}>
              Are you sure you want to approve this job order?
            </Text>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
              <TouchableOpacity
                onPress={onClose}
                disabled={loading}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 4,
                  backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
                  opacity: loading ? 0.5 : 1
                }}
              >
                <Text style={{
                  fontWeight: '500',
                  color: isDarkMode ? '#e5e7eb' : '#374151'
                }}>
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onConfirm}
                disabled={loading}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 4,
                  backgroundColor: colorPalette?.primary || '#7c3aed',
                  opacity: loading ? 0.5 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {loading && (
                  <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                )}
                <Text style={{ fontWeight: '500', color: '#ffffff' }}>
                  {loading ? 'Processing...' : 'Approve'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ApprovalConfirmationModal;
