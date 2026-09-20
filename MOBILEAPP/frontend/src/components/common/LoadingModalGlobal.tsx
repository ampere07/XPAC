import React from 'react';
import { View, Text, Modal, TouchableOpacity, ActivityIndicator } from 'react-native';
import { ColorPalette } from '../../services/settingsColorPaletteService';

interface LoadingModalGlobalProps {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  loadingPercentage?: number;
  onConfirm?: () => void;
  onCancel?: () => void;
  colorPalette?: ColorPalette | null;
  isDarkMode: boolean;
}

const LoadingModalGlobal: React.FC<LoadingModalGlobalProps> = ({
  isOpen,
  type,
  title,
  message,
  loadingPercentage = 0,
  onConfirm,
  onCancel,
  colorPalette,
  isDarkMode,
}) => {
  const primaryColor = colorPalette?.primary || '#7c3aed';
  const cardBg = isDarkMode ? '#1f2937' : '#ffffff';
  const titleColor = isDarkMode ? '#ffffff' : '#111827';
  const messageColor = isDarkMode ? '#d1d5db' : '#374151';

  if (type === 'loading') {
    return (
      <Modal visible={isOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ borderRadius: 12, padding: 32, alignItems: 'center', minWidth: 320, backgroundColor: cardBg }}>
            <ActivityIndicator size="large" color={primaryColor} style={{ marginBottom: 24 }} />
            <Text style={{ fontSize: 36, fontWeight: 'bold', color: titleColor }}>{loadingPercentage}%</Text>
            <Text style={{ marginTop: 8, color: isDarkMode ? '#9ca3af' : '#4b5563', textAlign: 'center' }}>{message}</Text>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={isOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <View style={{
          borderWidth: 1,
          borderColor: isDarkMode ? '#374151' : '#e5e7eb',
          borderRadius: 12,
          padding: 32,
          maxWidth: 448,
          width: '100%',
          backgroundColor: cardBg,
        }}>
          <Text style={{ fontSize: 20, fontWeight: 'bold', marginBottom: 16, color: titleColor }}>{title}</Text>
          <Text style={{ marginBottom: 32, lineHeight: 22, color: messageColor }}>{message}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            {type === 'confirm' && (
              <TouchableOpacity
                onPress={onCancel}
                style={{ paddingHorizontal: 24, paddingVertical: 8, borderRadius: 6, backgroundColor: isDarkMode ? '#374151' : '#f3f4f6' }}
              >
                <Text style={{ fontWeight: '500', color: isDarkMode ? '#d1d5db' : '#374151' }}>Cancel</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={onConfirm}
              style={{ paddingHorizontal: 32, paddingVertical: 10, borderRadius: 6, backgroundColor: primaryColor }}
            >
              <Text style={{ color: '#ffffff', fontWeight: '600', letterSpacing: 0.5 }}>{type === 'confirm' ? 'Confirm' : 'OK'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default LoadingModalGlobal;
