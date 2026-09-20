import React from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { Check } from 'lucide-react-native';
import { standardPageStyles as s, STANDARD_COLORS } from './standardPageStyles';

export interface StatusOption {
  label: string;
  value: string;
}

interface StatusFilterModalProps {
  visible: boolean;
  onClose: () => void;
  options: StatusOption[];
  selected: string;
  onSelect: (value: string) => void;
  title?: string;
  primaryColor?: string;
}

/**
 * Reusable "Filter by Status" modal, identical to JobOrder.tsx's.
 * Provide your own `options` for page-specific status vocabularies.
 */
const StatusFilterModal: React.FC<StatusFilterModalProps> = ({
  visible,
  onClose,
  options,
  selected,
  onSelect,
  title = 'Filter by Status',
  primaryColor = STANDARD_COLORS.primary,
}) => {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.statusModalOverlay} onPress={onClose}>
        <View style={s.statusModalContent}>
          <View style={s.statusModalHeader}>
            <Text style={s.statusModalTitle}>{title}</Text>
          </View>
          {options.map((item) => (
            <Pressable
              key={item.value}
              style={s.statusItem}
              onPress={() => {
                onSelect(item.value);
                onClose();
              }}
            >
              <Text style={[s.statusItemText, selected === item.value && { color: primaryColor, fontWeight: '700' }]}>
                {item.label}
              </Text>
              {selected === item.value && <Check size={18} color={primaryColor} />}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
};

export default StatusFilterModal;
