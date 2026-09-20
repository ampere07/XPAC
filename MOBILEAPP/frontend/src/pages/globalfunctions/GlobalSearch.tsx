import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { ColorPalette } from '../../services/settingsColorPaletteService';

interface GlobalSearchProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  placeholder?: string;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({
  searchQuery,
  setSearchQuery,
  isDarkMode,
  colorPalette,
  placeholder = 'Search records...',
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const bg = isDarkMode ? '#1f2937' : '#ffffff';
  const textColor = isDarkMode ? '#ffffff' : '#111827';
  const iconColor = isFocused ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9ca3af' : '#6b7280');
  const borderColor = isFocused ? primaryColor : (isDarkMode ? '#374151' : '#d1d5db');

  return (
    <View
      style={{
        flex: 1,
        height: 38,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: bg,
        borderWidth: isFocused ? 1.5 : 1,
        borderColor,
        paddingHorizontal: 10,
      }}
    >
      <Search size={16} color={iconColor} />
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={isDarkMode ? '#9ca3af' : '#9ca3af'}
        value={searchQuery}
        onChangeText={setSearchQuery}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        style={{
          flex: 1,
          marginLeft: 8,
          paddingVertical: 0,
          fontSize: 14,
          color: textColor,
        }}
      />
      {searchQuery.length > 0 && (
        <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={16} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
        </TouchableOpacity>
      )}
    </View>
  );
};

export default GlobalSearch;
