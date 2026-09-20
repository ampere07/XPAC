import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { X, XCircle } from 'lucide-react-native';

interface AddColorPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (palette: ColorPaletteData) => Promise<void>;
  colorPalette?: { primary?: string; secondary?: string; accent?: string } | null;
}

interface ColorPaletteData {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
}

const AddColorPaletteModal: React.FC<AddColorPaletteModalProps> = ({
  isOpen,
  onClose,
  onSave,
  colorPalette,
}) => {
  const isDarkMode = false;
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [paletteName, setPaletteName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7c3aed');
  const [accentColor, setAccentColor] = useState('#7c3aed');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const primary = colorPalette?.primary || '#7c3aed';

  const validateHexColor = (color: string): boolean => {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!paletteName.trim()) {
      newErrors.name = 'Palette name is required';
    }
    if (!validateHexColor(primaryColor)) {
      newErrors.primary = 'Invalid hex color';
    }
    if (!validateHexColor(accentColor)) {
      newErrors.accent = 'Invalid hex color';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setIsLoading(true);
    setShowError(false);
    setErrorMessage('');

    const newPalette: ColorPaletteData = {
      id: `custom_${Date.now()}`,
      name: paletteName,
      primary: primaryColor,
      secondary: '#1f2937',
      accent: accentColor,
    };

    try {
      await onSave(newPalette);
      setIsLoading(false);
      handleClose();
    } catch (error) {
      setIsLoading(false);
      setShowError(true);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create color palette');
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setPaletteName('');
    setPrimaryColor('#7c3aed');
    setAccentColor('#7c3aed');
    setErrors({});
    setShowError(false);
    setErrorMessage('');
    onClose();
  };

  const colors = {
    bg: '#ffffff',
    surface: '#f9fafb',
    border: '#e5e7eb',
    text: '#111827',
    subtext: '#6b7280',
    label: '#374151',
    inputBg: '#ffffff',
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={handleClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'flex-end',
        }}
      >
        <View
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '92%',
            paddingBottom: isTablet ? 16 : 24,
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: colors.text }}>
              Add Custom Palette
            </Text>
            <TouchableOpacity onPress={handleClose} disabled={isLoading}>
              <X size={24} color={colors.subtext} />
            </TouchableOpacity>
          </View>

          <ScrollView style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingVertical: 20 }}>
            {showError && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: '#fca5a5',
                  backgroundColor: '#fef2f2',
                  marginBottom: 16,
                }}
              >
                <XCircle size={20} color="#dc2626" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '600', color: '#991b1b' }}>Error</Text>
                  <Text style={{ fontSize: 13, color: '#b91c1c', marginTop: 2 }}>{errorMessage}</Text>
                </View>
              </View>
            )}

            {/* Palette Name */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.label, marginBottom: 8 }}>
                Palette Name *
              </Text>
              <TextInput
                value={paletteName}
                onChangeText={(t) => {
                  setPaletteName(t);
                  if (errors.name) setErrors({ ...errors, name: '' });
                }}
                placeholder="Enter palette name"
                placeholderTextColor={colors.subtext}
                editable={!isLoading}
                style={{
                  width: '100%',
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: errors.name ? '#ef4444' : colors.border,
                  backgroundColor: colors.inputBg,
                  color: colors.text,
                }}
              />
              {errors.name ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors.name}</Text>
              ) : null}
            </View>

            {/* Primary Color */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.label, marginBottom: 8 }}>
                Primary Color *
              </Text>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <TextInput
                  value={primaryColor}
                  onChangeText={(t) => {
                    setPrimaryColor(t);
                    if (errors.primary) setErrors({ ...errors, primary: '' });
                  }}
                  placeholder="#7c3aed"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  editable={!isLoading}
                  style={{
                    flex: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderRadius: 8,
                    borderColor: errors.primary ? '#ef4444' : colors.border,
                    backgroundColor: colors.inputBg,
                    color: colors.text,
                  }}
                />
                <View
                  style={{
                    width: 44,
                    height: 40,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: validateHexColor(primaryColor) ? primaryColor : colors.surface,
                  }}
                />
              </View>
              {errors.primary ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors.primary}</Text>
              ) : null}
            </View>

            {/* Accent Color */}
            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.label, marginBottom: 8 }}>
                Accent Color *
              </Text>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <TextInput
                  value={accentColor}
                  onChangeText={(t) => {
                    setAccentColor(t);
                    if (errors.accent) setErrors({ ...errors, accent: '' });
                  }}
                  placeholder="#7c3aed"
                  placeholderTextColor={colors.subtext}
                  autoCapitalize="none"
                  editable={!isLoading}
                  style={{
                    flex: 1,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderRadius: 8,
                    borderColor: errors.accent ? '#ef4444' : colors.border,
                    backgroundColor: colors.inputBg,
                    color: colors.text,
                  }}
                />
                <View
                  style={{
                    width: 44,
                    height: 40,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: validateHexColor(accentColor) ? accentColor : colors.surface,
                  }}
                />
              </View>
              {errors.accent ? (
                <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors.accent}</Text>
              ) : null}
            </View>

            {/* Preview */}
            <View style={{ paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ fontSize: 14, fontWeight: '500', color: colors.label, marginBottom: 12 }}>
                Preview
              </Text>
              <View
                style={{
                  padding: 16,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  flexDirection: 'row',
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <View
                    style={{
                      height: 56,
                      borderRadius: 8,
                      backgroundColor: validateHexColor(primaryColor) ? primaryColor : colors.border,
                    }}
                  />
                  <Text style={{ fontSize: 12, marginTop: 8, textAlign: 'center', color: colors.subtext }}>
                    Primary
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View
                    style={{
                      height: 56,
                      borderRadius: 8,
                      backgroundColor: validateHexColor(accentColor) ? accentColor : colors.border,
                    }}
                  />
                  <Text style={{ fontSize: 12, marginTop: 8, textAlign: 'center', color: colors.subtext }}>
                    Accent
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Footer */}
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              paddingHorizontal: 20,
              paddingTop: 16,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <TouchableOpacity
              onPress={handleClose}
              disabled={isLoading}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={isLoading}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 8,
                backgroundColor: primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              {isLoading && <ActivityIndicator size="small" color="#ffffff" />}
              <Text style={{ color: '#ffffff', fontWeight: '600' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default AddColorPaletteModal;
