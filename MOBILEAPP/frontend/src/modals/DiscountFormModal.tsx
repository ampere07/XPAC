import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { X, ChevronDown, Minus, Plus } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as discountService from '../services/discountService';
import { userService } from '../services/userService';
import { getUserDisplayName } from '../utils/userDisplay';
import { useBillingStore } from '../store/billingStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const isDarkMode = false;

interface DiscountFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: DiscountFormData) => void;
  customerData?: any;
}

interface DiscountFormData {
  accountNo: string | null;
  discountAmount: string;
  remaining: string;
  status: string;
  processedDate: string;
  processedByUserId: number | null;
  approvedByUserId: number | null;
  remarks: string;
}

const getCurrentDateTime = () => {
  const now = new Date();
  return now.toISOString().slice(0, 16);
};

const DiscountFormModal: React.FC<DiscountFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  customerData,
}) => {
  const [formData, setFormData] = useState<DiscountFormData>({
    accountNo: null,
    discountAmount: '0.00',
    remaining: '0.00',
    status: 'Pending',
    processedDate: getCurrentDateTime(),
    processedByUserId: null,
    approvedByUserId: null,
    remarks: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [users, setUsers] = useState<any[]>([]);
  const { billingRecords: billingAccounts, fetchBillingRecords } = useBillingStore();
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [isAccountPickerOpen, setIsAccountPickerOpen] = useState(false);

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    if (customerData) {
      setFormData(prev => ({ ...prev, accountNo: customerData.accountNo || null }));
    }
  }, [customerData]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await userService.getAllUsers();
        if (response.success && response.data) {
          setUsers(response.data);
          const authData = await AsyncStorage.getItem('authData');
          if (authData) {
            const userData = JSON.parse(authData);
            const currentUser = response.data.find(
              (user: any) =>
                user.email_address === userData.email || user.email === userData.email
            );
            if (currentUser) {
              setFormData(prev => ({ ...prev, processedByUserId: currentUser.id }));
            }
          }
        }
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };

    if (isOpen) {
      fetchUsers();
      fetchBillingRecords();
    }
  }, [isOpen]);

  useEffect(() => {
    if (formData.status !== 'Monthly') {
      setFormData(prev => ({ ...prev, remaining: '0' }));
    }
  }, [formData.status]);

  const handleInputChange = (field: keyof DiscountFormData, value: string | number | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleDiscountAmountChange = (operation: 'increase' | 'decrease') => {
    const currentValue = parseFloat(formData.discountAmount) || 0;
    const increment = 0.01;
    const newValue =
      operation === 'increase' ? currentValue + increment : Math.max(0, currentValue - increment);
    setFormData(prev => ({ ...prev, discountAmount: newValue.toFixed(2) }));
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.accountNo) newErrors.accountNo = 'Account No. is required';
    if (!formData.discountAmount.trim()) newErrors.discountAmount = 'Discount Amount is required';
    if (!formData.processedByUserId) newErrors.processedByUserId = 'Processed By is required';
    if (!formData.approvedByUserId) newErrors.approvedByUserId = 'Approved By is required';

    const discountAmount = parseFloat(formData.discountAmount);
    if (isNaN(discountAmount) || discountAmount <= 0) {
      newErrors.discountAmount = 'Discount Amount must be greater than 0';
    }

    if (formData.status === 'Monthly') {
      const remaining = parseInt(formData.remaining);
      if (isNaN(remaining) || remaining <= 0) {
        newErrors.remaining = 'Remaining cycles must be greater than 0 for Monthly discounts';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      Alert.alert('Validation Error', 'Please fill in all required fields before saving.');
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);

    try {
      const progressInterval = setInterval(() => {
        setLoadingPercentage(prev => {
          if (prev >= 99) return 99;
          if (prev >= 90) return prev + 1;
          if (prev >= 70) return prev + 2;
          return prev + 5;
        });
      }, 300);

      const authData = await AsyncStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;

      const payload: discountService.DiscountData = {
        account_no: formData.accountNo!,
        discount_amount: parseFloat(formData.discountAmount) || 0,
        remaining: parseInt(formData.remaining) || 0,
        status: formData.status as 'Pending' | 'Unused' | 'Used' | 'Permanent' | 'Monthly',
        processed_date: formData.processedDate,
        processed_by_user_id: formData.processedByUserId!,
        approved_by_user_id: formData.approvedByUserId!,
        remarks: formData.remarks || '',
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
      };

      await discountService.create(payload);

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      Alert.alert('Success', 'Discount created successfully!', [
        {
          text: 'OK',
          onPress: () => {
            onSave(formData);
            onClose();
          },
        },
      ]);
    } catch (error) {
      console.error('Error creating discount:', error);
      Alert.alert(
        'Error',
        `Failed to save discount: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const filteredBillingAccounts = billingAccounts.filter(account => {
    const fullName = [
      account.firstName || '',
      account.middleInitial || '',
      account.lastName || '',
    ]
      .filter(Boolean)
      .join(' ');
    const addressParts = [
      account.address || '',
      (account as any).barangay || '',
      (account as any).city || '',
      (account as any).region || '',
    ]
      .filter(Boolean)
      .join(', ');
    const accountNumber = account.accountNo || (account as any).account_no || '';
    const searchText =
      `${accountNumber} ${fullName || account.customerName} ${addressParts}`.toLowerCase();
    return searchText.includes(accountSearchQuery.toLowerCase());
  });

  const getSelectedAccountText = () => {
    if (!formData.accountNo) return 'Select Account';
    const account = billingAccounts.find(
      acc => (acc.accountNo || (acc as any).account_no) === formData.accountNo
    );
    if (!account) return formData.accountNo;
    const fullName = [
      account.firstName || '',
      account.middleInitial || '',
      account.lastName || '',
    ]
      .filter(Boolean)
      .join(' ');
    const addressParts = [
      account.address || '',
      (account as any).barangay || '',
      (account as any).city || '',
      (account as any).region || '',
    ]
      .filter(Boolean)
      .join(', ');
    return `${formData.accountNo} | ${fullName || account.customerName} | ${addressParts}`;
  };

  const approverUsers = users.filter(u => u.role_id === 1 || u.role_id === 7);

  const labelStyle = {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#374151',
    marginBottom: 6,
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#ffffff',
  };

  const errorTextStyle = { color: '#ef4444', fontSize: 11, marginTop: 3 };

  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} animationType="slide" transparent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ height: '95%', backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden' }}>
          {/* Loading overlay */}
          {loading && (
            <View
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 999,
                backgroundColor: 'rgba(0,0,0,0.7)',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <View
                style={{
                  backgroundColor: '#ffffff',
                  borderRadius: 12,
                  padding: 32,
                  alignItems: 'center',
                  minWidth: 200,
                }}
              >
                <ActivityIndicator size="large" color={primary} />
                <Text style={{ fontSize: 32, fontWeight: '700', color: '#111827', marginTop: 16 }}>
                  {loadingPercentage}%
                </Text>
              </View>
            </View>
          )}

          {/* Header */}
          <View
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottomWidth: 1,
              borderBottomColor: '#e5e7eb',
              backgroundColor: '#f9fafb',
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>
              Discounted Form
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity
                onPress={onClose}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 6,
                  backgroundColor: '#e5e7eb',
                }}
              >
                <Text style={{ color: '#111827', fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSave}
                disabled={loading}
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  borderRadius: 6,
                  backgroundColor: primary,
                  opacity: loading ? 0.5 : 1,
                }}
              >
                <Text style={{ color: '#ffffff', fontSize: 14, fontWeight: '500' }}>
                  {loading ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <X size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 20 }}>
            {/* Account No */}
            <View>
              <Text style={labelStyle}>
                Account No.<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <TouchableOpacity
                onPress={() => setIsAccountPickerOpen(true)}
                style={[
                  inputStyle,
                  {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderColor: errors.accountNo ? '#ef4444' : '#d1d5db',
                  },
                ]}
              >
                <Text
                  style={{
                    color: formData.accountNo ? '#111827' : '#9ca3af',
                    fontSize: 14,
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {getSelectedAccountText()}
                </Text>
                <ChevronDown size={18} color="#6b7280" />
              </TouchableOpacity>
              {errors.accountNo ? <Text style={errorTextStyle}>{errors.accountNo}</Text> : null}
            </View>

            {/* Account Picker Modal */}
            <Modal visible={isAccountPickerOpen} animationType="slide" transparent>
              <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
                <View style={{ height: '70%', backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
                  <View
                    style={{
                      padding: 16,
                      borderBottomWidth: 1,
                      borderBottomColor: '#e5e7eb',
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '600', color: '#111827' }}>
                      Select Account
                    </Text>
                    <TouchableOpacity onPress={() => { setIsAccountPickerOpen(false); setAccountSearchQuery(''); }}>
                      <X size={20} color="#6b7280" />
                    </TouchableOpacity>
                  </View>
                  <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                    <TextInput
                      placeholder="Search accounts..."
                      placeholderTextColor="#9ca3af"
                      value={accountSearchQuery}
                      onChangeText={setAccountSearchQuery}
                      style={[inputStyle, { marginBottom: 0 }]}
                      autoFocus
                    />
                  </View>
                  <ScrollView>
                    {filteredBillingAccounts.length > 0 ? (
                      filteredBillingAccounts.map(account => {
                        const fullName = [
                          account.firstName || '',
                          account.middleInitial || '',
                          account.lastName || '',
                        ]
                          .filter(Boolean)
                          .join(' ');
                        const addressParts = [
                          account.address || '',
                          (account as any).barangay || '',
                          (account as any).city || '',
                          (account as any).region || '',
                        ]
                          .filter(Boolean)
                          .join(', ');
                        const accountNumber = account.accountNo || (account as any).account_no || '';
                        return (
                          <TouchableOpacity
                            key={account.id}
                            onPress={() => {
                              handleInputChange('accountNo', accountNumber);
                              setIsAccountPickerOpen(false);
                              setAccountSearchQuery('');
                            }}
                            style={{
                              padding: 12,
                              borderBottomWidth: 1,
                              borderBottomColor: '#f3f4f6',
                              backgroundColor:
                                formData.accountNo === accountNumber ? '#f3f4f6' : '#ffffff',
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: '500', color: '#ef4444' }}>
                              {accountNumber}
                              <Text style={{ color: '#374151', fontWeight: '400' }}>
                                {' | '}
                                {fullName || account.customerName}
                              </Text>
                            </Text>
                            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }} numberOfLines={1}>
                              {addressParts}
                            </Text>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <Text style={{ padding: 20, textAlign: 'center', color: '#6b7280' }}>
                        No accounts found
                      </Text>
                    )}
                  </ScrollView>
                </View>
              </View>
            </Modal>

            {/* Discount Status */}
            <View>
              <Text style={labelStyle}>Discount Status</Text>
              <View style={[inputStyle, { padding: 0 }]}>
                <Picker
                  selectedValue={formData.status}
                  onValueChange={val => handleInputChange('status', val)}
                  style={{ color: '#111827' }}
                >
                  {['Pending', 'Unused', 'Permanent', 'Monthly'].map(s => (
                    <Picker.Item key={s} label={s} value={s} />
                  ))}
                </Picker>
              </View>
            </View>

            {/* Discount Amount */}
            <View>
              <Text style={labelStyle}>
                Discount Amount<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TextInput
                  style={[
                    inputStyle,
                    {
                      flex: 1,
                      borderRightWidth: 0,
                      borderTopRightRadius: 0,
                      borderBottomRightRadius: 0,
                      borderColor: errors.discountAmount ? '#ef4444' : '#d1d5db',
                    },
                  ]}
                  value={`₱ ${formData.discountAmount}`}
                  onChangeText={val =>
                    handleInputChange(
                      'discountAmount',
                      val.replace('₱ ', '').replace(/[^0-9.]/g, '')
                    )
                  }
                  keyboardType="decimal-pad"
                  placeholderTextColor="#9ca3af"
                />
                <View style={{ borderWidth: 1, borderColor: '#d1d5db', borderTopRightRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden' }}>
                  <TouchableOpacity
                    onPress={() => handleDiscountAmountChange('decrease')}
                    style={{ padding: 10, backgroundColor: '#f3f4f6', borderBottomWidth: 1, borderBottomColor: '#d1d5db' }}
                  >
                    <Minus size={14} color="#374151" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDiscountAmountChange('increase')}
                    style={{ padding: 10, backgroundColor: '#f3f4f6' }}
                  >
                    <Plus size={14} color="#374151" />
                  </TouchableOpacity>
                </View>
              </View>
              {errors.discountAmount ? <Text style={errorTextStyle}>{errors.discountAmount}</Text> : null}
            </View>

            {/* Remaining (Monthly only) */}
            {formData.status === 'Monthly' && (
              <View>
                <Text style={labelStyle}>Remaining Cycles</Text>
                <TextInput
                  style={[
                    inputStyle,
                    { borderColor: errors.remaining ? '#ef4444' : '#d1d5db' },
                  ]}
                  value={formData.remaining}
                  onChangeText={val =>
                    handleInputChange('remaining', val.replace(/[^0-9]/g, ''))
                  }
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor="#9ca3af"
                />
                {errors.remaining ? <Text style={errorTextStyle}>{errors.remaining}</Text> : null}
              </View>
            )}

            {/* Processed By (disabled) */}
            <View>
              <Text style={labelStyle}>
                Processed By<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <View style={[inputStyle, { padding: 0, opacity: 0.6 }]}>
                <Picker
                  selectedValue={formData.processedByUserId ?? ''}
                  enabled={false}
                  style={{ color: '#111827' }}
                >
                  <Picker.Item label="Select Processor" value="" />
                  {users.map(user => (
                    <Picker.Item
                      key={user.id}
                      label={getUserDisplayName(user, user?.email_address)}
                      value={user.id}
                    />
                  ))}
                </Picker>
              </View>
              {errors.processedByUserId ? (
                <Text style={errorTextStyle}>{errors.processedByUserId}</Text>
              ) : null}
            </View>

            {/* Approved By */}
            <View>
              <Text style={labelStyle}>
                Approved By<Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <View style={[inputStyle, { padding: 0, borderColor: errors.approvedByUserId ? '#ef4444' : '#d1d5db' }]}>
                <Picker
                  selectedValue={formData.approvedByUserId ?? ''}
                  onValueChange={val =>
                    handleInputChange('approvedByUserId', val ? parseInt(String(val)) : null)
                  }
                  style={{ color: '#111827' }}
                >
                  <Picker.Item label="Select Approver" value="" />
                  {approverUsers.map(user => (
                    <Picker.Item
                      key={user.id}
                      label={getUserDisplayName(user, user?.email_address)}
                      value={user.id}
                    />
                  ))}
                </Picker>
              </View>
              {errors.approvedByUserId ? (
                <Text style={errorTextStyle}>{errors.approvedByUserId}</Text>
              ) : null}
            </View>

            {/* Remarks */}
            <View>
              <Text style={labelStyle}>Remarks</Text>
              <TextInput
                style={[inputStyle, { height: 100, textAlignVertical: 'top' }]}
                value={formData.remarks}
                onChangeText={val => handleInputChange('remarks', val)}
                multiline
                numberOfLines={4}
                placeholder="Enter remarks..."
                placeholderTextColor="#9ca3af"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default DiscountFormModal;
