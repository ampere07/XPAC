import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { Search, ChevronDown, X } from 'lucide-react-native';

export interface GroupedOption {
  label: string;
  options: any[];
}

interface SearchableFieldProps {
  label: string;
  placeholder?: string;
  value: string;
  onSelect: (value: string, option?: any) => void;
  options?: any[];
  groupedOptions?: GroupedOption[];
  optionLabelKey: string;
  isDarkMode: boolean;
  error?: string;
  icon?: React.ReactNode;
  colorPalette?: any;
  required?: boolean;
  isHeaderSelectable?: boolean;
  emptyMessage?: string;
}

/**
 * RN port of the web searchable dropdown. The web build rendered an absolutely
 * positioned list under the input; on touch that is unusable inside a scroll view, so
 * the list opens in a modal sheet instead. Props and selection semantics are unchanged.
 */
const SearchableField: React.FC<SearchableFieldProps> = ({
  label,
  placeholder = 'Search...',
  value,
  onSelect,
  options = [],
  groupedOptions,
  optionLabelKey,
  isDarkMode,
  error,
  icon,
  colorPalette,
  required,
  isHeaderSelectable = false,
  emptyMessage
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const activeColor = colorPalette?.primary || '#f97316';

  const getFilteredOptions = () => {
    if (groupedOptions) {
      return groupedOptions.map(group => {
        const labelMatches = (group.label || '').toLowerCase().includes(searchTerm.toLowerCase());
        const filteredOptions = group.options.filter(option =>
          (option[optionLabelKey] || '').toLowerCase().includes(searchTerm.toLowerCase())
        );

        return {
          ...group,
          options: labelMatches ? group.options : filteredOptions,
          isLabelMatch: labelMatches
        };
      }).filter(group => group.options.length > 0 || group.isLabelMatch);
    }

    return options.filter(option =>
      (option[optionLabelKey] || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const filteredData = getFilteredOptions();
  const hasResults = groupedOptions
    ? (filteredData as any[]).some(g => g.options.length > 0 || g.isLabelMatch)
    : (filteredData as any[]).length > 0;

  const close = () => {
    setIsOpen(false);
    setSearchTerm('');
  };

  const pick = (optionValue: string, option?: any) => {
    onSelect(optionValue, option);
    close();
  };

  const optionRow = (option: any, key: string, indented: boolean) => {
    const selected = value === option[optionLabelKey];
    return (
      <Pressable
        key={key}
        onPress={() => pick(option[optionLabelKey], option)}
        style={({ pressed }) => [
          sf.optionRow,
          indented && sf.optionRowIndented,
          { backgroundColor: pressed ? (isDarkMode ? '#374151' : '#f3f4f6') : 'transparent' }
        ]}
      >
        <Text style={[sf.optionText, {
          color: selected ? activeColor : (isDarkMode ? '#e5e7eb' : '#374151'),
          fontWeight: selected ? '600' : '400'
        }]}>
          {option[optionLabelKey]}
        </Text>
        {selected && <View style={[sf.selectedDot, { backgroundColor: activeColor }]} />}
      </Pressable>
    );
  };

  return (
    <View style={sf.container}>
      <Text style={[sf.label, { color: isDarkMode ? '#d1d5db' : '#374151' }]}>
        {label}{required && <Text style={sf.required}>*</Text>}
      </Text>

      <Pressable
        onPress={() => setIsOpen(true)}
        style={[sf.trigger, {
          backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
          borderColor: error ? '#ef4444' : (isDarkMode ? '#374151' : '#d1d5db')
        }]}
      >
        {icon || <Search size={16} color={isDarkMode ? '#9ca3af' : '#6b7280'} />}
        <Text
          style={[sf.triggerText, { color: value ? (isDarkMode ? '#ffffff' : '#111827') : (isDarkMode ? '#6b7280' : '#9ca3af') }]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
        <ChevronDown size={18} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
      </Pressable>

      {error ? <Text style={sf.errorText}>{error}</Text> : null}

      <Modal visible={isOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <View style={sf.overlay}>
          <View style={[sf.sheet, { backgroundColor: isDarkMode ? '#1f2937' : '#ffffff' }]}>
            <View style={[sf.sheetHeader, { borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb' }]}>
              <Text style={[sf.sheetTitle, { color: isDarkMode ? '#ffffff' : '#111827' }]}>{label}</Text>
              <Pressable onPress={close} hitSlop={8}>
                <X size={22} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
              </Pressable>
            </View>

            <View style={[sf.searchBox, {
              backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
              borderColor: isDarkMode ? '#374151' : '#e5e7eb'
            }]}>
              <Search size={16} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
              <TextInput
                value={searchTerm}
                onChangeText={setSearchTerm}
                placeholder={placeholder}
                placeholderTextColor={isDarkMode ? '#6b7280' : '#9ca3af'}
                style={[sf.searchInput, { color: isDarkMode ? '#ffffff' : '#111827' }]}
                autoFocus
              />
            </View>

            <ScrollView style={sf.list} keyboardShouldPersistTaps="handled">
              {hasResults ? (
                groupedOptions ? (
                  (filteredData as GroupedOption[]).map((group, gIdx) => (
                    <View key={gIdx}>
                      <Pressable
                        disabled={!isHeaderSelectable}
                        onPress={() => { if (isHeaderSelectable) pick(group.label); }}
                        style={[sf.groupHeader, { backgroundColor: isDarkMode ? '#111827' : '#f9fafb' }]}
                      >
                        <Text style={[sf.groupHeaderText, {
                          color: isHeaderSelectable && value === group.label ? activeColor : (isDarkMode ? '#6b7280' : '#9ca3af')
                        }]}>
                          {group.label}
                        </Text>
                      </Pressable>
                      {group.options.map((option, oIdx) => optionRow(option, `${gIdx}-${oIdx}`, true))}
                    </View>
                  ))
                ) : (
                  (filteredData as any[]).map((option, idx) => optionRow(option, String(option.id || idx), false))
                )
              ) : (
                <Text style={[sf.emptyText, { color: isDarkMode ? '#6b7280' : '#9ca3af' }]}>
                  {emptyMessage && (!groupedOptions?.length && !options?.length)
                    ? emptyMessage
                    : (searchTerm ? `No results found for "${searchTerm}"` : (emptyMessage || 'No data available'))}
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const sf = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '500', marginBottom: 6 },
  required: { color: '#ef4444' },
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  triggerText: { flex: 1, fontSize: 14 },
  errorText: { color: '#ef4444', fontSize: 11, marginTop: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 },
  sheet: { borderRadius: 12, maxHeight: '75%', overflow: 'hidden' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  list: { maxHeight: 360 },
  groupHeader: { paddingHorizontal: 16, paddingVertical: 6 },
  groupHeaderText: { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionRowIndented: { paddingLeft: 28 },
  optionText: { fontSize: 14, flex: 1 },
  selectedDot: { width: 6, height: 6, borderRadius: 3 },
  emptyText: { fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingVertical: 32 },
});

export default SearchableField;
