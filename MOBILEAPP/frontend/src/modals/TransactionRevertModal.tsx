// Transaction Revert Form, ported from ATSS2_0/frontend/src/modals/TransactionRevertModal.tsx.
//
// Same request, same validation, same success state. What changes is the shell: a
// full-screen RN Modal with the actions in the header rather than a right-hand
// drawer, and the progress readout as an overlay rather than a fixed div.
//
// The web version tracks the theme through localStorage and a MutationObserver.
// Neither exists in React Native and the rest of this app renders light, so this
// follows the other ported modals and drops the dark branch instead of shipping a
// half-wired one.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, X } from 'lucide-react-native';
import { transactionRevertService } from '../services/transactionRevertService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface TransactionRevertModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactionId: number | string;
  onSuccess?: () => void;
}

const TransactionRevertModal: React.FC<TransactionRevertModalProps> = ({
  isOpen,
  onClose,
  transactionId,
  onSuccess,
}) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(
    () => settingsColorPaletteService.getActiveSync()
  );
  const [requestedBy, setRequestedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const accent = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch(err => console.error('Failed to fetch color palette:', err));
  }, []);

  // Stamp the request with the signed-in user, and clear whatever the previous
  // open left behind. AsyncStorage is async, so unlike the web version this fills
  // in a beat after the form appears — the field is read-only either way.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    AsyncStorage.getItem('authData')
      .then(raw => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw);
        setRequestedBy(parsed.email_address || parsed.email || parsed.username || '');
      })
      .catch(err => console.error('Error getting user email:', err));

    setRemarks('');
    setReason('');
    setError(null);
    setShowSuccess(false);
    setLoadingPercentage(0);

    return () => { cancelled = true; };
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);
    setError(null);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => (prev >= 95 ? 95 : prev + 5));
    }, 100);

    try {
      const result = await transactionRevertService.createRevertRequest({
        transaction_id: Number(transactionId),
        remarks: remarks.trim() || undefined,
        reason: reason.trim(),
        requested_by: requestedBy,
        updated_by: requestedBy,
        status: 'pending',
      });

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      await new Promise(resolve => setTimeout(resolve, 300));

      if (result.success) {
        setShowSuccess(true);
        setLoading(false);
        onSuccess?.();
      } else {
        setError(result.message || 'Failed to submit revert request.');
        setLoading(false);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setError(err.message || 'Failed to submit revert request.');
      setLoading(false);
    }
  }, [reason, remarks, requestedBy, transactionId, onSuccess]);

  const submitDisabled = loading || !reason.trim() || showSuccess;

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      <View style={rv.container}>
        <View style={rv.header}>
          <Text style={rv.headerTitle} numberOfLines={1}>Transaction Revert Form</Text>

          <View style={rv.headerActions}>
            {!showSuccess && (
              <>
                <Pressable onPress={onClose} disabled={loading} style={rv.cancelBtn}>
                  <Text style={rv.cancelBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSubmit}
                  disabled={submitDisabled}
                  style={[rv.submitBtn, { backgroundColor: submitDisabled ? '#c4b5fd' : accent }]}
                >
                  <Text style={rv.submitBtnText}>{loading ? 'Submitting...' : 'Submit'}</Text>
                </Pressable>
              </>
            )}
            <Pressable onPress={onClose} style={rv.closeBtn} accessibilityLabel="Close">
              <X size={24} color="#4b5563" />
            </Pressable>
          </View>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={rv.flex1}
        >
          {showSuccess ? (
            <ScrollView contentContainerStyle={rv.successBody}>
              <View style={rv.successBadge}>
                <Check size={48} color="#22c55e" strokeWidth={3} />
              </View>

              <Text style={rv.successTitle}>Request Submitted!</Text>
              <Text style={rv.successText}>
                Your revert request for Transaction{' '}
                <Text style={rv.successId}>#{transactionId}</Text> has been successfully sent.
              </Text>

              <View style={rv.statusPill}>
                <Text style={rv.statusPillText}>
                  Status: <Text style={rv.statusPillStrong}>PENDING REVIEW</Text>
                </Text>
              </View>

              <Pressable onPress={onClose} style={[rv.doneBtn, { backgroundColor: accent }]}>
                <Text style={rv.doneBtnText}>Close</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={rv.body} keyboardShouldPersistTaps="handled">
              <View style={rv.fieldGroup}>
                <Text style={rv.label}>Requested By</Text>
                <View style={[rv.input, rv.inputReadOnly]}>
                  <Text style={rv.readOnlyText} numberOfLines={1}>{requestedBy || '-'}</Text>
                </View>
              </View>

              <View style={rv.fieldGroup}>
                <Text style={rv.label}>Remarks (Optional)</Text>
                <TextInput
                  value={remarks}
                  onChangeText={setRemarks}
                  placeholder="Add any additional notes..."
                  placeholderTextColor="#9ca3af"
                  style={[rv.input, rv.inputText]}
                  editable={!loading}
                />
              </View>

              <View style={rv.fieldGroup}>
                <Text style={rv.label}>
                  Reason for Revert<Text style={rv.required}> *</Text>
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={text => { setReason(text); if (error) setError(null); }}
                  placeholder="Detailed reason for this revert request..."
                  placeholderTextColor="#9ca3af"
                  multiline
                  numberOfLines={5}
                  textAlignVertical="top"
                  style={[rv.input, rv.inputText, rv.textarea, error ? rv.inputError : null]}
                  editable={!loading}
                />
                {error ? <Text style={rv.errorText}>{error}</Text> : null}
              </View>
            </ScrollView>
          )}
        </KeyboardAvoidingView>

        {loading && !showSuccess && (
          <View style={rv.loadingOverlay}>
            <View style={rv.loadingCard}>
              <ActivityIndicator size="large" color={accent} />
              <Text style={rv.loadingPercent}>{loadingPercentage}%</Text>
              <Text style={rv.loadingLabel}>Submitting request...</Text>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
};

const rv = StyleSheet.create({
  flex1: { flex: 1 },
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: '#111827' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#e5e7eb',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  submitBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, minWidth: 82, alignItems: 'center' },
  submitBtnText: { fontSize: 13, fontWeight: '600', color: '#ffffff' },
  closeBtn: { padding: 4 },

  body: { padding: 16, paddingBottom: 80 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  required: { color: '#ef4444' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    minHeight: 46,
    justifyContent: 'center',
  },
  inputText: { fontSize: 14, color: '#111827' },
  inputReadOnly: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb' },
  readOnlyText: { fontSize: 14, color: '#6b7280' },
  textarea: { minHeight: 130, paddingTop: 12 },
  inputError: { borderColor: '#ef4444' },
  errorText: { color: '#ef4444', fontSize: 11, marginTop: 4, fontWeight: '500' },

  successBody: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
  successBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(34,197,94,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: { fontSize: 26, fontWeight: '700', color: '#111827', textAlign: 'center' },
  successText: { fontSize: 16, lineHeight: 24, color: '#4b5563', textAlign: 'center' },
  successId: { color: '#f97316', fontWeight: '700' },
  statusPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fefce8' },
  statusPillText: { fontSize: 13, color: '#a16207' },
  statusPillStrong: { fontWeight: '700' },
  doneBtn: { paddingHorizontal: 48, paddingVertical: 14, borderRadius: 10, marginTop: 4 },
  doneBtnText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingCard: {
    minWidth: 260,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    gap: 14,
  },
  loadingPercent: { fontSize: 34, fontWeight: '700', color: '#111827' },
  loadingLabel: { fontSize: 13, color: '#6b7280' },
});

export default TransactionRevertModal;
