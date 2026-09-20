import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';

interface LocationItem {
  id: number;
  name: string;
  type: 'city' | 'region' | 'borough' | 'location';
  parentId?: number;
  parentName?: string;
  cityId?: number;
  regionId?: number;
  boroughId?: number;
}

interface EditLocationModalProps {
  isOpen: boolean;
  location: LocationItem | null;
  allLocations?: LocationItem[];
  onClose: () => void;
  onEdit: (location: LocationItem) => void;
  onDelete: (location: LocationItem) => void;
  onSelectLocation?: (location: LocationItem) => void;
}

const typeLabel = (type: string): string =>
  ({ city: 'City', region: 'Region', borough: 'Barangay', location: 'Location' } as Record<string, string>)[type] || type;

const parentLabel = (type: string): string =>
  ({ city: 'Region', borough: 'City', location: 'Barangay' } as Record<string, string>)[type] || 'Parent';

const EditLocationModal: React.FC<EditLocationModalProps> = ({ isOpen, location, onClose, onEdit }) => {
  const [editedName, setEditedName] = useState('');

  useEffect(() => {
    if (location && isOpen) {
      setEditedName(location.name);
    }
  }, [location, isOpen]);

  const handleSave = () => {
    if (!location) return;
    onEdit({ ...location, name: editedName });
  };

  return (
    <ModalUITemplate
      isOpen={isOpen && !!location}
      onClose={onClose}
      title={location ? `Edit ${typeLabel(location.type)}` : 'Edit Location'}
      primaryAction={{ label: 'Save', onClick: handleSave }}
      secondaryActionLabel="Cancel"
    >
      {location && <EditLocationContent location={location} editedName={editedName} setEditedName={setEditedName} />}
    </ModalUITemplate>
  );
};

const EditLocationContent: React.FC<{
  location: LocationItem;
  editedName: string;
  setEditedName: (v: string) => void;
}> = ({ location, editedName, setEditedName }) => {
  const { isDarkMode, colorPalette } = useModalTheme();
  const [isFocused, setIsFocused] = useState(false);

  const labelColor = isDarkMode ? '#d1d5db' : '#374151';
  const readOnlyStyle = {
    width: '100%' as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 6,
    opacity: 0.6,
    borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  };

  const ReadOnly: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>{label}</Text>
      <TextInput value={value} editable={false} style={readOnlyStyle} />
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
          Name<Text style={{ color: '#ef4444' }}> *</Text>
        </Text>
        <TextInput
          value={editedName}
          onChangeText={setEditedName}
          placeholder="Enter name"
          placeholderTextColor="#9ca3af"
          autoFocus
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            width: '100%',
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderWidth: 1,
            borderRadius: 6,
            borderColor: isFocused ? (colorPalette?.primary || '#7c3aed') : (isDarkMode ? '#374151' : '#d1d5db'),
            color: isDarkMode ? '#ffffff' : '#111827',
          }}
        />
      </View>

      <ReadOnly label="Type" value={typeLabel(location.type)} />
      {location.type !== 'region' && !!location.parentName && (
        <ReadOnly label={parentLabel(location.type)} value={location.parentName} />
      )}
      <ReadOnly label="ID" value={String(location.id)} />
    </View>
  );
};

export default EditLocationModal;
