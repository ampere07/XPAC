import React from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { AlertTriangle, Trash2, X } from 'lucide-react-native';

export interface ConfirmDeleteDetail {
  label: string;
  value: string;
}

interface ConfirmDeleteModalProps {
  visible: boolean;
  title: string;
  description: string;
  details: ConfirmDeleteDetail[];
  warning?: string;
  error?: string;
  isDeleting: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  visible,
  title,
  description,
  details,
  warning,
  error,
  isDeleting,
  confirmLabel,
  onCancel,
  onConfirm,
}) => {
  const cancel = () => {
    if (!isDeleting) onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }}>
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 12,
            padding: 24,
            width: '88%',
            borderWidth: 1,
            borderColor: '#e5e7eb',
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
              <View style={{ padding: 8, borderRadius: 999, backgroundColor: '#fee2e2' }}>
                <Trash2 size={18} color="#ef4444" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>{title}</Text>
            </View>
            <TouchableOpacity onPress={cancel} disabled={isDeleting} accessibilityLabel="Close">
              <X size={20} color="#6b7280" />
            </TouchableOpacity>
          </View>

          <Text style={{ color: '#374151', marginBottom: 16 }}>{description}</Text>

          <View
            style={{
              backgroundColor: '#f9fafb',
              borderRadius: 8,
              padding: 16,
              borderWidth: 1,
              borderColor: '#e5e7eb',
              marginBottom: 16,
              gap: 8,
            }}
          >
            {details.map(({ label, value }) => (
              <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ color: '#6b7280', fontSize: 13 }}>{label}</Text>
                <Text style={{ color: '#111827', fontSize: 13, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
              </View>
            ))}
          </View>

          {warning ? (
            <View
              style={{
                flexDirection: 'row',
                gap: 8,
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: '#fcd34d',
                backgroundColor: '#fffbeb',
                marginBottom: 16,
              }}
            >
              <AlertTriangle size={16} color="#92400e" />
              <Text style={{ flex: 1, fontSize: 13, color: '#92400e' }}>{warning}</Text>
            </View>
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={{ color: '#dc2626', fontSize: 13, marginBottom: 16 }}>
              {error}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity
              onPress={cancel}
              disabled={isDeleting}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: '#e5e7eb',
                alignItems: 'center',
                opacity: isDeleting ? 0.5 : 1,
              }}
            >
              <Text style={{ color: '#111827', fontWeight: '500' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onConfirm}
              disabled={isDeleting}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 8,
                backgroundColor: isDeleting ? '#4b5563' : '#dc2626',
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
                opacity: isDeleting ? 0.7 : 1,
              }}
            >
              {isDeleting ? <ActivityIndicator size="small" color="#ffffff" /> : <Trash2 size={16} color="#ffffff" />}
              <Text style={{ color: '#ffffff', fontWeight: '500' }}>{isDeleting ? 'Deleting...' : confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default ConfirmDeleteModal;
