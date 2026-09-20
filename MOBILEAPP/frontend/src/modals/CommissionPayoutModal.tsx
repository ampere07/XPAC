import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { Camera, X } from 'lucide-react-native';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';
import apiClient from '../config/api';
import { transactionService } from '../services/transactionService';

interface CommissionPayoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agentId?: number;
  agentName?: string;
}

interface PayoutFormData {
  agent_id: number | string;
  ref_number: string;
  total_amount: string;
  remarks: string;
  proof_of_payment: string;
}

interface AgentJobOrdersData {
  job_order_ids: number[];
  job_orders_data?: { id: number; customer_name: string }[];
  commission_rate: number;
  total_amount: number;
  count: number;
}

interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

const generateRefNumber = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const toDateString = (d: Date | null): string => {
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const CommissionPayoutForm: React.FC<CommissionPayoutModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  agentId,
  agentName,
}) => {
  const { isDarkMode } = useModalTheme();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentName] = useState<string>(agentName || '');
  const [selectedAgentId] = useState<number | string>(agentId || '');

  // Job orders state
  const [jobOrdersData, setJobOrdersData] = useState<AgentJobOrdersData | null>(null);
  const [jobOrdersLoading, setJobOrdersLoading] = useState(false);

  // Date range filter for Job Orders
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  // Image upload state
  const [image, setImage] = useState<PickedImage | null>(null);

  const [formData, setFormData] = useState<PayoutFormData>({
    agent_id: agentId || '',
    ref_number: '',
    total_amount: '',
    remarks: '',
    proof_of_payment: '',
  });

  // Fetch job orders whenever the resolved agent / date range changes
  const fetchJobOrders = async (
    resolvedAgentId: number | string,
    resolvedAgentName: string,
    start?: string,
    end?: string,
  ) => {
    if (!resolvedAgentId && !resolvedAgentName) {
      setJobOrdersData(null);
      return;
    }
    setJobOrdersLoading(true);
    try {
      const params = new URLSearchParams();
      if (resolvedAgentId) params.append('agent_id', String(resolvedAgentId));
      if (resolvedAgentName) params.append('agent_name', resolvedAgentName);
      if (start) params.append('start_date', start);
      if (end) params.append('end_date', end);

      const res = await apiClient.get(`/commissions/agent-job-orders?${params.toString()}`);
      if ((res.data as any).success) {
        const data = (res.data as any).data as AgentJobOrdersData;
        setJobOrdersData(data);
        setFormData((prev) => ({
          ...prev,
          total_amount: data.total_amount > 0 ? String(data.total_amount) : '',
        }));
      } else {
        setJobOrdersData(null);
      }
    } catch {
      setJobOrdersData(null);
    } finally {
      setJobOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setStartDate(null);
      setEndDate(null);
      setFormData({
        agent_id: agentId || '',
        ref_number: generateRefNumber(),
        total_amount: '',
        remarks: '',
        proof_of_payment: '',
      });
      setImage(null);
      setError(null);
      setJobOrdersData(null);

      if (agentId || agentName) {
        fetchJobOrders(agentId || '', agentName || '', '', '');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, agentId, agentName]);

  useEffect(() => {
    if (isOpen && (selectedAgentId || selectedAgentName)) {
      fetchJobOrders(selectedAgentId, selectedAgentName, toDateString(startDate), toDateString(endDate));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate]);

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Permission to access photos is required.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const name = asset.fileName || asset.uri.split('/').pop() || `proof_${Date.now()}.jpg`;
        setImage({
          uri: asset.uri,
          name,
          type: asset.mimeType || 'image/jpeg',
        });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to pick image');
    }
  };

  const handleRemoveImage = () => {
    setImage(null);
    setFormData((prev) => ({ ...prev, proof_of_payment: '' }));
  };

  const handleSave = async () => {
    if (
      !formData.agent_id ||
      !formData.ref_number ||
      !formData.total_amount ||
      !formData.remarks ||
      !image
    ) {
      setError('Agent, reference number, amount, proof of payment, and remarks are required.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      let proofUrl = formData.proof_of_payment;

      // Upload image if selected
      if (image) {
        const imageFormData = new FormData();
        imageFormData.append('folder_name', `commission-payout - ${selectedAgentName}`);
        imageFormData.append(
          'payment_proof_image',
          {
            uri: image.uri,
            name: image.name,
            type: image.type,
          } as any,
          image.name,
        );

        const uploadResponse = await transactionService.uploadTransactionImage(imageFormData);
        if (uploadResponse.success && uploadResponse.data?.payment_proof_image_url) {
          proofUrl = uploadResponse.data.payment_proof_image_url;
        } else {
          setError('Failed to upload proof of payment image.');
          setLoading(false);
          return;
        }
      }

      const authRaw = await AsyncStorage.getItem('authData');
      const currentUser = authRaw ? JSON.parse(authRaw) : null;

      const payload = {
        ...formData,
        proof_of_payment: proofUrl,
        type: 'commission',
        job_order_ids: jobOrdersData?.job_order_ids ?? [],
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
      };
      const response = await apiClient.post('/commissions/history', payload);

      if ((response.data as any).success) {
        onSuccess();
        onClose();
      } else {
        const msg = (response.data as any).message || 'Failed to record payment';
        const backendErr = (response.data as any).error ? ` (${(response.data as any).error})` : '';
        setError(msg + backendErr);
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'An error occurred';
      const backendErr = err.response?.data?.error ? ` (${err.response.data.error})` : '';
      setError(msg + backendErr);
    } finally {
      setLoading(false);
    }
  };

  const labelColor = isDarkMode ? '#d1d5db' : '#374151';
  const mutedColor = isDarkMode ? '#6b7280' : '#9ca3af';
  const inputBg = isDarkMode ? '#1f2937' : '#ffffff';
  const inputBorder = isDarkMode ? '#374151' : '#d1d5db';
  const inputText = isDarkMode ? '#ffffff' : '#111827';

  const inputStyle = {
    width: '100%' as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: inputBorder,
    backgroundColor: inputBg,
    color: inputText,
    fontSize: 14,
  };

  const jobOrderIdsBadges = jobOrdersData?.job_order_ids ?? [];

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={onClose}
      title={selectedAgentName ? `Record Payout — ${selectedAgentName}` : 'New Payout'}
      loading={loading}
      maxWidth="max-w-lg"
      closeOnOutsideClick={false}
      isDarkMode={isDarkMode}
      primaryAction={{
        label: 'Save',
        onClick: handleSave,
        disabled:
          loading ||
          !jobOrdersData?.job_order_ids ||
          jobOrdersData.job_order_ids.length === 0 ||
          !formData.remarks ||
          !image,
      }}
    >
      <View style={{ gap: 20 }}>
        {/* Error Banner */}
        {error ? (
          <View
            style={{
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: isDarkMode ? 'rgba(153,27,27,0.5)' : '#fecaca',
              backgroundColor: isDarkMode ? 'rgba(127,29,29,0.2)' : '#fef2f2',
            }}
          >
            <Text style={{ fontSize: 14, color: isDarkMode ? '#f87171' : '#dc2626' }}>{error}</Text>
          </View>
        ) : null}

        {/* Reference Number */}
        <View>
          <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
            Reference Number <Text style={{ color: '#ef4444' }}>*</Text>
          </Text>
          <TextInput
            value={formData.ref_number}
            editable={false}
            style={{ ...inputStyle, opacity: 0.75 }}
          />
        </View>

        {/* Date Range Filter */}
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
              Start Date
            </Text>
            <TouchableOpacity onPress={() => setShowStartPicker(true)} style={inputStyle}>
              <Text style={{ color: startDate ? inputText : mutedColor, fontSize: 14 }}>
                {startDate ? toDateString(startDate) : 'Select date'}
              </Text>
            </TouchableOpacity>
            {showStartPicker && (
              <DateTimePicker
                value={startDate || new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_event, date) => {
                  setShowStartPicker(false);
                  if (date) setStartDate(date);
                }}
              />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
              End Date
            </Text>
            <TouchableOpacity onPress={() => setShowEndPicker(true)} style={inputStyle}>
              <Text style={{ color: endDate ? inputText : mutedColor, fontSize: 14 }}>
                {endDate ? toDateString(endDate) : 'Select date'}
              </Text>
            </TouchableOpacity>
            {showEndPicker && (
              <DateTimePicker
                value={endDate || new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_event, date) => {
                  setShowEndPicker(false);
                  if (date) setEndDate(date);
                }}
              />
            )}
          </View>
        </View>

        {/* Job Orders referred by this agent */}
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
              Job Orders Referred by Agent
            </Text>
            {jobOrdersLoading ? (
              <ActivityIndicator size="small" color={mutedColor} />
            ) : jobOrdersData ? (
              <View
                style={{
                  backgroundColor: isDarkMode ? 'rgba(30,58,138,0.4)' : '#dbeafe',
                  borderRadius: 999,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '600', color: isDarkMode ? '#93c5fd' : '#1d4ed8' }}>
                  {jobOrdersData.count} JO{jobOrdersData.count !== 1 ? 's' : ''}
                  {jobOrdersData.commission_rate > 0
                    ? ` · ₱${Number(jobOrdersData.commission_rate).toLocaleString()} each`
                    : ''}
                </Text>
              </View>
            ) : null}
          </View>

          <View
            style={{
              width: '100%',
              minHeight: 80,
              maxHeight: 160,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: isDarkMode ? '#374151' : '#e5e7eb',
              backgroundColor: isDarkMode ? '#111827' : '#f9fafb',
            }}
          >
            {jobOrdersLoading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={mutedColor} />
                <Text style={{ fontSize: 12, color: mutedColor }}>Loading job orders...</Text>
              </View>
            ) : !formData.agent_id && !selectedAgentName ? (
              <Text style={{ fontSize: 12, fontStyle: 'italic', color: mutedColor }}>
                Select an agent to see their referred job orders.
              </Text>
            ) : jobOrderIdsBadges.length === 0 ? (
              <Text style={{ fontSize: 12, fontStyle: 'italic', color: mutedColor }}>
                No completed job orders found for this agent.
              </Text>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {jobOrdersData?.job_orders_data
                  ? jobOrdersData.job_orders_data.map((jo) => (
                      <View
                        key={jo.id}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 4,
                          backgroundColor: isDarkMode ? '#374151' : '#ffffff',
                          borderWidth: isDarkMode ? 0 : 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '500', color: isDarkMode ? '#e5e7eb' : '#374151' }}>
                          {jo.customer_name}
                        </Text>
                      </View>
                    ))
                  : jobOrderIdsBadges.map((id) => (
                      <View
                        key={id}
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 2,
                          borderRadius: 4,
                          backgroundColor: isDarkMode ? '#374151' : '#ffffff',
                          borderWidth: isDarkMode ? 0 : 1,
                          borderColor: '#d1d5db',
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '500', color: isDarkMode ? '#e5e7eb' : '#374151' }}>
                          #{id}
                        </Text>
                      </View>
                    ))}
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11, marginTop: 4, color: mutedColor }}>
            Completed job orders where this agent is listed as the referrer. Read-only.
          </Text>
        </View>

        {/* Total Amount — auto-calculated but editable */}
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '500', color: labelColor }}>
              Total Amount <Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            {jobOrdersData && jobOrdersData.commission_rate > 0 ? (
              <Text style={{ fontSize: 11, color: mutedColor }}>
                {jobOrdersData.count} × ₱{Number(jobOrdersData.commission_rate).toLocaleString()} = ₱
                {Number(jobOrdersData.total_amount).toLocaleString()}
              </Text>
            ) : null}
          </View>
          <TextInput
            value={formData.total_amount}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, total_amount: text }))}
            keyboardType="numeric"
            placeholder="0.00"
            placeholderTextColor={mutedColor}
            style={inputStyle}
          />
          {jobOrdersData && jobOrdersData.commission_rate > 0 ? (
            <Text style={{ fontSize: 11, marginTop: 4, color: mutedColor }}>
              Auto-calculated from job order count × commission rate. You may adjust if needed.
            </Text>
          ) : null}
        </View>

        {/* Proof of Payment — Image Upload */}
        <View>
          <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
            Proof of Payment <Text style={{ color: '#ef4444' }}>*</Text>
          </Text>
          <TouchableOpacity
            onPress={handlePickImage}
            activeOpacity={0.8}
            style={{
              width: '100%',
              borderWidth: 2,
              borderStyle: 'dashed',
              borderRadius: 8,
              borderColor: isDarkMode ? '#374151' : '#d1d5db',
              backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb',
              overflow: 'hidden',
              minHeight: image ? undefined : 160,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {image ? (
              <View style={{ width: '100%' }}>
                <Image
                  source={{ uri: image.uri }}
                  style={{ width: '100%', height: 200, resizeMode: 'contain' }}
                />
                <TouchableOpacity
                  onPress={handleRemoveImage}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    backgroundColor: '#ef4444',
                    borderRadius: 999,
                    padding: 4,
                  }}
                >
                  <X size={14} color="#ffffff" />
                </TouchableOpacity>
                <View
                  style={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    backgroundColor: '#22c55e',
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 4,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Camera size={12} color="#ffffff" />
                  <Text style={{ color: '#ffffff', fontSize: 12 }}>Selected</Text>
                </View>
              </View>
            ) : (
              <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
                <Camera size={28} color={mutedColor} />
                <Text style={{ fontSize: 14, fontWeight: '500', color: mutedColor }}>
                  Tap to upload payment proof
                </Text>
                <Text style={{ fontSize: 12, color: mutedColor, opacity: 0.6 }}>
                  PNG, JPG, JPEG accepted
                </Text>
              </View>
            )}
          </TouchableOpacity>
          <Text style={{ fontSize: 11, marginTop: 6, color: mutedColor }}>
            Image will be saved to Google Drive automatically
          </Text>
        </View>

        {/* Remarks */}
        <View>
          <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
            Remarks <Text style={{ color: '#ef4444' }}>*</Text>
          </Text>
          <TextInput
            value={formData.remarks}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, remarks: text }))}
            multiline
            placeholder="Any additional details..."
            placeholderTextColor={mutedColor}
            style={{ ...inputStyle, minHeight: 90, textAlignVertical: 'top' }}
          />
        </View>
      </View>
    </ModalUITemplate>
  );
};

const CommissionPayoutModal: React.FC<CommissionPayoutModalProps> = (props) => {
  return <CommissionPayoutForm {...props} />;
};

export default CommissionPayoutModal;
