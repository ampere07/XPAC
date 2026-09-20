import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { X, ChevronDown } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { staggeredInstallationService } from '../services/staggeredInstallationService';
import { userService } from '../services/userService';
import { useBillingStore } from '../store/billingStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface StaggeredInstallationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: StaggeredInstallationFormData) => void;
  customerData?: any;
}

interface StaggeredInstallationFormData {
  accountNo: string;
  fullName: string;
  contactNo: string;
  emailAddress: string;
  address: string;
  plan: string;
  staggeredInstallNo: string;
  staggeredDate: string;
  staggeredBalance: string;
  monthsToPay: string;
  monthlyPayment: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  remarks: string;
  barangay: string;
  city: string;
}

const getCurrentDate = () => new Date().toISOString().slice(0, 10);

const getCurrentDateTime = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  const displayHours = now.getHours() % 12 || 12;
  return `${month}/${day}/${year} ${String(displayHours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
};

const generateStaggeredInstallNo = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  return `${year}${month}${day}${hours}${minutes}${seconds}${ms}`;
};

const makeInitialForm = (customerData?: any): StaggeredInstallationFormData => ({
  accountNo: customerData?.accountNo || '',
  fullName: customerData?.fullName || '',
  contactNo: customerData?.contactNo || '',
  emailAddress: customerData?.emailAddress || '',
  address: customerData?.address || '',
  plan: customerData?.plan || '',
  staggeredInstallNo: generateStaggeredInstallNo(),
  staggeredDate: getCurrentDate(),
  staggeredBalance: '0.00',
  monthsToPay: '0',
  monthlyPayment: '0.00',
  modifiedBy: '',
  modifiedDate: getCurrentDateTime(),
  userEmail: '',
  remarks: '',
  barangay: customerData?.barangay || '',
  city: customerData?.city || '',
});

const StaggeredInstallationFormModal: React.FC<StaggeredInstallationFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  customerData,
}) => {
  const isDarkMode = false;
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [formData, setFormData] = useState<StaggeredInstallationFormData>(() => makeInitialForm(customerData));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [users, setUsers] = useState<Array<{ id: number; email: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [modalInfo, setModalInfo] = useState<{ visible: boolean; type: string; title: string; message: string; onConfirm?: () => void; onCancel?: () => void }>({
    visible: false, type: 'info', title: '', message: '',
  });
  const { billingRecords: billingAccounts, fetchBillingRecords } = useBillingStore();
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');

  const primary = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // Reset form
    setFormData(makeInitialForm(customerData));
    setErrors({});

    // Fetch users
    const fetchUsers = async () => {
      try {
        setLoadingUsers(true);
        const response = await userService.getAllUsers();
        if (response.data) {
          setUsers(response.data.map((u: any) => ({ id: u.id, email: u.email_address })));
        }
      } catch (err) {
        console.error('Failed to fetch users:', err);
      } finally {
        setLoadingUsers(false);
      }
    };

    // Get current user
    const getCurrentUser = async () => {
      const raw = await AsyncStorage.getItem('authData');
      if (raw) {
        try {
          const userData = JSON.parse(raw);
          const userEmail = userData.email;
          if (userEmail) {
            setFormData(prev => ({ ...prev, userEmail, modifiedBy: userEmail }));
          }
        } catch {}
      }
    };

    fetchUsers();
    getCurrentUser();
    fetchBillingRecords();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (customerData) {
      setFormData(prev => ({
        ...prev,
        accountNo: customerData.accountNo || '',
        fullName: customerData.fullName || '',
        contactNo: customerData.contactNo || '',
        emailAddress: customerData.emailAddress || '',
        address: customerData.address || '',
        plan: customerData.plan || '',
        barangay: customerData.barangay || '',
        city: customerData.city || '',
      }));
    }
  }, [customerData]);

  // Auto-calculate monthly payment
  useEffect(() => {
    const balance = parseFloat(formData.staggeredBalance) || 0;
    const months = parseInt(formData.monthsToPay) || 1;
    const monthly = months > 0 ? balance / months : 0;
    setFormData(prev => ({ ...prev, monthlyPayment: monthly.toFixed(2) }));
  }, [formData.staggeredBalance, formData.monthsToPay]);

  const handleInput = (field: keyof StaggeredInstallationFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.accountNo.trim()) newErrors.accountNo = 'Account No. is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      setModalInfo({ visible: true, type: 'warning', title: 'Validation Error', message: 'Please fill in all required fields before saving.' });
      return;
    }
    setLoading(true);
    setLoadingPercentage(0);
    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 99) return 99;
        if (prev >= 90) return prev + 1;
        if (prev >= 70) return prev + 2;
        return prev + 5;
      });
    }, 300);
    try {
      const payload = {
        account_no: formData.accountNo,
        staggered_install_no: formData.staggeredInstallNo,
        staggered_date: formData.staggeredDate,
        staggered_balance: parseFloat(formData.staggeredBalance) || 0,
        months_to_pay: parseInt(formData.monthsToPay) || 0,
        monthly_payment: parseFloat(formData.monthlyPayment) || 0,
        modified_by: formData.modifiedBy,
        modified_date: formData.modifiedDate,
        created_at: formData.modifiedDate,
        user_email: formData.userEmail,
        remarks: formData.remarks || '',
      };
      const result = await staggeredInstallationService.create(payload);
      clearInterval(progressInterval);
      setLoadingPercentage(100);
      if (result.success) {
        setModalInfo({
          visible: true, type: 'success', title: 'Success',
          message: 'Staggered Installation created successfully!',
          onConfirm: () => {
            setModalInfo(prev => ({ ...prev, visible: false }));
            onSave(formData);
            onClose();
          },
        });
      } else {
        setModalInfo({ visible: true, type: 'error', title: 'Error', message: result.message || 'An unknown error occurred' });
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setModalInfo({ visible: true, type: 'error', title: 'Error', message: err.message || 'Unknown error' });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const filteredBillingAccounts = billingAccounts.filter((account) => {
    const fullName = [account.firstName || '', account.middleInitial || '', account.lastName || ''].filter(Boolean).join(' ');
    const addressParts = [account.address || '', account.barangay || '', account.city || '', account.region || ''].filter(Boolean).join(', ');
    const accountNumber = (account as any).accountNo || (account as any).account_no || '';
    const searchText = `${accountNumber} ${fullName || account.customerName} ${addressParts}`.toLowerCase();
    return searchText.includes(accountSearchQuery.toLowerCase());
  });

  const getSelectedAccountText = () => {
    if (!formData.accountNo) return 'Select Account';
    const account = billingAccounts.find(acc => ((acc as any).accountNo || (acc as any).account_no) === formData.accountNo);
    if (!account) return formData.accountNo;
    const fullName = [account.firstName || '', (account as any).middleInitial || '', account.lastName || ''].filter(Boolean).join(' ');
    const addressParts = [account.address || '', account.barangay || '', account.city || '', account.region || ''].filter(Boolean).join(', ');
    return `${formData.accountNo} | ${fullName || account.customerName} | ${addressParts}`;
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

  const readonlyInputStyle = {
    ...inputStyle,
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
  };

  const labelStyle = { fontSize: 14, fontWeight: '500' as const, color: '#374151', marginBottom: 6 };

  if (!isOpen) return null;

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      {/* Loading overlay */}
      {loading && (
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 32, alignItems: 'center' }}>
            <ActivityIndicator size="large" color={primary} />
            <Text style={{ marginTop: 16, fontSize: 28, fontWeight: 'bold', color: '#111827' }}>
              {loadingPercentage}%
            </Text>
          </View>
        </View>
      )}

      <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
        {/* Header */}
        <View style={{
          paddingTop: 60,
          paddingHorizontal: 16,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
          backgroundColor: '#f3f4f6',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <Text style={{ fontSize: 18, fontWeight: '600', color: '#111827' }}>Staggered Installation Form</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ backgroundColor: '#9ca3af', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6 }}
            >
              <Text style={{ color: '#ffffff', fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={loading}
              style={{ backgroundColor: primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 6, opacity: loading ? 0.5 : 1 }}
            >
              <Text style={{ color: '#ffffff', fontSize: 13 }}>{loading ? 'Saving...' : 'Save'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose}>
              <X size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
          {/* Account No. */}
          <View>
            <Text style={labelStyle}>
              Account No.<Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <TouchableOpacity
              onPress={() => setIsAccountDropdownOpen(true)}
              style={{
                ...inputStyle,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderColor: errors.accountNo ? '#ef4444' : '#d1d5db',
              }}
            >
              <Text style={{ flex: 1, color: formData.accountNo ? '#111827' : '#9ca3af', fontSize: 14 }} numberOfLines={1}>
                {getSelectedAccountText()}
              </Text>
              <ChevronDown size={18} color="#6b7280" />
            </TouchableOpacity>
            {errors.accountNo ? <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{errors.accountNo}</Text> : null}
          </View>

          <View>
            <Text style={labelStyle}>Full Name</Text>
            <TextInput style={readonlyInputStyle} value={formData.fullName} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>Contact Number</Text>
            <TextInput style={readonlyInputStyle} value={formData.contactNo} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>Email Address</Text>
            <TextInput style={readonlyInputStyle} value={formData.emailAddress} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>Address</Text>
            <TextInput style={readonlyInputStyle} value={formData.address} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>Plan</Text>
            <TextInput style={readonlyInputStyle} value={formData.plan} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>Staggered Install No.</Text>
            <TextInput style={readonlyInputStyle} value={formData.staggeredInstallNo} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>Staggered Date</Text>
            <TextInput
              style={inputStyle}
              value={formData.staggeredDate}
              onChangeText={v => handleInput('staggeredDate', v)}
              placeholder="YYYY-MM-DD"
            />
          </View>

          <View>
            <Text style={labelStyle}>Staggered Balance</Text>
            <TextInput
              style={inputStyle}
              value={`₱ ${formData.staggeredBalance}`}
              onChangeText={v => handleInput('staggeredBalance', v.replace('₱ ', '').replace(/[^0-9.]/g, ''))}
              keyboardType="decimal-pad"
            />
          </View>

          <View>
            <Text style={labelStyle}>Months to Pay</Text>
            <TextInput
              style={inputStyle}
              value={formData.monthsToPay}
              onChangeText={v => handleInput('monthsToPay', v.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
            />
          </View>

          <View>
            <Text style={labelStyle}>Monthly Payment</Text>
            <TextInput style={readonlyInputStyle} value={`₱ ${formData.monthlyPayment}`} editable={false} />
            <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              Automatically calculated based on Total Balance and Months to Pay
            </Text>
          </View>

          <View>
            <Text style={labelStyle}>Modified By</Text>
            <TouchableOpacity
              onPress={() => {
                // Simple: show users as a picker-like dropdown handled inline
              }}
              style={{ ...inputStyle, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <Text style={{ color: formData.modifiedBy ? '#111827' : '#9ca3af', fontSize: 14, flex: 1 }}>
                {formData.modifiedBy || (loadingUsers ? 'Loading users...' : 'Select user...')}
              </Text>
              <ChevronDown size={18} color="#6b7280" />
            </TouchableOpacity>
            {users.length > 0 && (
              <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 6, marginTop: 4, maxHeight: 150 }}>
                <FlatList
                  data={users}
                  keyExtractor={item => String(item.id)}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      onPress={() => handleInput('modifiedBy', item.email)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 8,
                        backgroundColor: formData.modifiedBy === item.email ? '#f3f4f6' : '#ffffff',
                        borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
                      }}
                    >
                      <Text style={{ fontSize: 13, color: '#111827' }}>{item.email}</Text>
                    </TouchableOpacity>
                  )}
                  nestedScrollEnabled
                />
              </View>
            )}
          </View>

          <View>
            <Text style={labelStyle}>Modified Date</Text>
            <TextInput style={readonlyInputStyle} value={formData.modifiedDate} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>User Email</Text>
            <TextInput style={readonlyInputStyle} value={formData.userEmail} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>Remarks</Text>
            <TextInput
              style={{ ...inputStyle, height: 80, textAlignVertical: 'top' }}
              value={formData.remarks}
              onChangeText={v => handleInput('remarks', v)}
              multiline
              numberOfLines={3}
            />
          </View>

          <View>
            <Text style={labelStyle}>Barangay</Text>
            <TextInput style={readonlyInputStyle} value={formData.barangay} editable={false} />
          </View>

          <View>
            <Text style={labelStyle}>City</Text>
            <TextInput style={readonlyInputStyle} value={formData.city} editable={false} />
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      </View>

      {/* Account dropdown modal */}
      <Modal visible={isAccountDropdownOpen} transparent animationType="fade" onRequestClose={() => setIsAccountDropdownOpen(false)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
          activeOpacity={1}
          onPress={() => { setIsAccountDropdownOpen(false); setAccountSearchQuery(''); }}
        >
          <View style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: '#ffffff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
            maxHeight: '80%', overflow: 'hidden',
          }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
              <TextInput
                style={{ ...inputStyle, marginBottom: 0 }}
                placeholder="Search accounts..."
                value={accountSearchQuery}
                onChangeText={setAccountSearchQuery}
                autoFocus
              />
            </View>
            <FlatList
              data={filteredBillingAccounts}
              keyExtractor={item => String(item.id)}
              renderItem={({ item }) => {
                const fullName = [(item as any).firstName || '', (item as any).middleInitial || '', (item as any).lastName || ''].filter(Boolean).join(' ');
                const addressParts = [item.address || '', item.barangay || '', item.city || '', item.region || ''].filter(Boolean).join(', ');
                const accountNumber = (item as any).accountNo || (item as any).account_no || '';
                return (
                  <TouchableOpacity
                    onPress={() => {
                      setFormData(prev => ({
                        ...prev,
                        accountNo: accountNumber,
                        fullName: fullName || item.customerName || '',
                        contactNo: item.contactNumber || '',
                        emailAddress: item.emailAddress || '',
                        address: addressParts,
                        plan: item.plan || '',
                        barangay: item.barangay || '',
                        city: item.city || '',
                      }));
                      setErrors(prev => ({ ...prev, accountNo: '' }));
                      setIsAccountDropdownOpen(false);
                      setAccountSearchQuery('');
                    }}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: '#f3f4f6',
                      backgroundColor: formData.accountNo === accountNumber ? '#f9fafb' : '#ffffff',
                    }}
                  >
                    <Text style={{ fontSize: 13 }}>
                      <Text style={{ color: '#f87171', fontWeight: '500' }}>{accountNumber}</Text>
                      <Text style={{ color: '#374151' }}> | {fullName || item.customerName}</Text>
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }} numberOfLines={1}>{addressParts}</Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={{ textAlign: 'center', color: '#6b7280', padding: 20 }}>No accounts found</Text>
              }
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Feedback modal */}
      {modalInfo.visible && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setModalInfo(prev => ({ ...prev, visible: false }))}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <View style={{ backgroundColor: '#ffffff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 400 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 12 }}>{modalInfo.title}</Text>
              <Text style={{ color: '#374151', marginBottom: 20 }}>{modalInfo.message}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                {modalInfo.type === 'confirm' && (
                  <TouchableOpacity
                    onPress={modalInfo.onCancel}
                    style={{ backgroundColor: '#e5e7eb', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 }}
                  >
                    <Text style={{ color: '#374151' }}>Cancel</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={modalInfo.onConfirm || (() => setModalInfo(prev => ({ ...prev, visible: false })))}
                  style={{ backgroundColor: primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 }}
                >
                  <Text style={{ color: '#ffffff' }}>{modalInfo.type === 'confirm' ? 'Confirm' : 'OK'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
};

export default StaggeredInstallationFormModal;
