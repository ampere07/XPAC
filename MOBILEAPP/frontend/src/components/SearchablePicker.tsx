import React from 'react';
import { View, Text, TextInput, Pressable, Modal, StyleSheet, Keyboard } from 'react-native';
import { Search, X, Check, ChevronDown } from 'lucide-react-native';
import { FlashList as FlashListBase } from '@shopify/flash-list';
const FlashList: any = FlashListBase;

interface SearchablePickerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  data: any[];
  onSelect: (item: any) => void;
  renderItem?: ({ item }: { item: any }) => React.ReactElement;
  keyExtractor: (item: any, index: number) => string;
  searchValue: string;
  onSearchChange: (text: string) => void;
  placeholder?: string;
  isDarkMode?: boolean;
  activeColor?: string;
  itemTextKey?: string;
  selectedItemValue?: any;
  itemValueKey?: string;
}

export const SearchablePickerTrigger = ({ 
  label, 
  value, 
  onPress, 
  error, 
  isDarkMode, 
  placeholder = "Select...",
  required = false
}: {
  label: string;
  value: string;
  onPress: () => void;
  error?: string;
  isDarkMode?: boolean;
  placeholder?: string;
  required?: boolean;
}) => (
  <View style={styles.inputGroup}>
    <Text style={[styles.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
      {label} {required && <Text style={styles.required}>*</Text>}
    </Text>
    <Pressable
      onPress={onPress}
      style={[styles.searchContainer, {
        backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
        borderColor: error ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db'),
        height: 50,
      }]}
    >
      <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
      <Text style={{
        flex: 1,
        paddingHorizontal: 12,
        color: value ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#9ca3af' : '#6b7280'),
        fontSize: 16
      }}>
        {value || placeholder}
      </Text>
      <ChevronDown size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
    </Pressable>
    {error && <Text style={styles.errorText}>{error}</Text>}
  </View>
);

export const SearchablePicker = ({
  isOpen,
  onClose,
  title,
  data,
  onSelect,
  renderItem,
  keyExtractor,
  searchValue,
  onSearchChange,
  placeholder = "Search...",
  isDarkMode = false,
  activeColor = '#7c3aed',
  itemTextKey = 'label',
  selectedItemValue,
  itemValueKey = 'value'
}: SearchablePickerProps) => {

  const defaultRenderItem = ({ item }: { item: any }) => {
    const itemLabel = typeof item === 'string' ? item : item[itemTextKey];
    const itemValue = typeof item === 'string' ? item : item[itemValueKey];
    const isSelected = selectedItemValue === itemValue;

    return (
      <Pressable
        onPress={() => {
          onSelect(item);
          Keyboard.dismiss();
        }}
        style={({ pressed }) => [
          styles.miniModalItem,
          { backgroundColor: pressed ? (isDarkMode ? activeColor + '1A' : '#f3f4f6') : 'transparent' }
        ]}
      >
        <Text style={[styles.miniModalItemText, { 
          color: isSelected ? activeColor : (isDarkMode ? '#e5e7eb' : '#374151'), 
          fontWeight: isSelected ? '700' : 'bold', 
          flex: 1 
        }]}>
          {itemLabel}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal
      visible={isOpen}
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      onRequestClose={onClose}
    >
      <View style={styles.miniModalOverlay}>
        <View style={[styles.miniModalContent, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
          <View style={[styles.miniModalHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
            <Text style={[styles.miniModalTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>{title}</Text>
            <Pressable onPress={onClose} style={styles.miniModalClose}>
              <X size={24} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
            </Pressable>
          </View>

          {data.length >= 6 && (
            <View style={styles.miniModalSearchContainer}>
              <View style={[styles.searchContainer, {
                backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
                borderColor: isDarkMode ? '#374151' : '#e5e7eb'
              }]}>
                <Search size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                <TextInput
                  placeholder={placeholder}
                  value={searchValue}
                  onChangeText={onSearchChange}
                  placeholderTextColor={isDarkMode ? '#9CA3AF' : '#4B5563'}
                  autoFocus={true}
                  style={[styles.miniModalSearchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                />
                {searchValue.length > 0 && (
                  <Pressable onPress={() => onSearchChange('')}>
                    <X size={18} color={isDarkMode ? '#9CA3AF' : '#4B5563'} />
                  </Pressable>
                )}
              </View>
            </View>
          )}

          <View style={{ height: 350, width: '100%' }}>
            {/* @ts-ignore */}
            <FlashList
              data={data}
              keyExtractor={keyExtractor}
              renderItem={renderItem || (defaultRenderItem as any)}
              ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
              ListEmptyComponent={() => (
                <View style={styles.miniModalEmpty}>
                  <Text style={{ color: isDarkMode ? '#9CA3AF' : '#4B5563', fontSize: 16 }}>No results found</Text>
                </View>
              )}
              estimatedItemSize={60}
              contentContainerStyle={{ paddingHorizontal: 40, paddingBottom: 20 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  required: {
    color: '#ef4444',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 4,
  },
  miniModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  miniModalContent: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  miniModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  miniModalTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  miniModalClose: {
    padding: 4,
  },
  miniModalSearchContainer: {
    padding: 12,
  },
  miniModalSearchInput: {
    flex: 1,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  miniModalItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  miniModalItemText: {
    fontSize: 20,
    textAlign: 'left',
  },
  miniModalEmpty: {
    padding: 24,
    alignItems: 'center',
  },
});
