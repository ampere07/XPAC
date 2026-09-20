import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { X, Zap, ChevronDown, CheckCircle, XCircle } from 'lucide-react-native';
import apiClient from '../config/api';
import { getBillingRecords, BillingRecord } from '../services/billingService';

interface GenerateBillingModalProps {
  isOpen: boolean;
  onClose: () => void;
  colorPalette?: { primary: string; secondary?: string; accent?: string } | null;
  isDarkMode?: boolean;
}

interface AlertState {
  show: boolean;
  type: 'success' | 'error';
  title: string;
  message: string;
}

const generateCustomBilling = async (
  accountNo: string,
  serviceCharge: number
): Promise<{ success: boolean; message: string; data?: any }> => {
  try {
    const response = await apiClient.post<any>('/billing-generation/generate-custom', {
      account_no: accountNo,
      service_charge: serviceCharge,
    });
    return response.data;
  } catch (error: any) {
    const message =
      error?.response?.data?.message || error?.message || 'Failed to generate custom billing';
    return { success: false, message };
  }
};

const GenerateBillingModal: React.FC<GenerateBillingModalProps> = ({
  isOpen,
  onClose,
  colorPalette,
}) => {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [accounts, setAccounts] = useState<BillingRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedAccountNo, setSelectedAccountNo] = useState('');
  const [serviceCharge, setServiceCharge] = useState('0.00');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingPct, setLoadingPct] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [alert, setAlert] = useState<AlertState>({ show: false, type: 'success', title: '', message: '' });

  const primary = colorPalette?.primary || '#7c3aed';

  // Forced light-mode colors
  const bg = '#ffffff';
  const surface = '#f9fafb';
  const border = '#e5e7eb';
  const text = '#111827';
  const subtext = '#6b7280';
  const inputBg = '#ffffff';

  useEffect(() => {
    if (!isOpen) return;
    setLoadingAccounts(true);

    const fetchAllAccounts = async () => {
      const allRecords: BillingRecord[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const { data, hasMore: more } = await getBillingRecords(page, 500);
        allRecords.push(...data);
        hasMore = more;
        page++;
      }

      setAccounts(allRecords);
    };

    fetchAllAccounts()
      .catch(console.error)
      .finally(() => setLoadingAccounts(false));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedAccountNo('');
      setServiceCharge('0.00');
      setDropdownOpen(false);
      setSearchQuery('');
      setAlert({ show: false, type: 'success', title: '', message: '' });
      setLoadingPct(0);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }
  }, [isOpen]);

  const filteredAccounts = accounts.filter((a) => {
    const q = searchQuery.toLowerCase();
    return (
      a.customerName?.toLowerCase().includes(q) ||
      a.accountNo?.toLowerCase().includes(q) ||
      a.account_no?.toLowerCase().includes(q)
    );
  });

  const selectedAccount = accounts.find(
    (a) => (a.accountNo || a.account_no) === selectedAccountNo
  );

  const handleServiceChargeChange = (val: string) => {
    const cleaned = val.replace(/[^0-9.]/g, '');
    setServiceCharge(cleaned);
  };

  const handleServiceChargeBlur = () => {
    const num = parseFloat(serviceCharge) || 0;
    setServiceCharge(num.toFixed(2));
  };

  const startProgress = () => {
    setLoadingPct(0);
    progressIntervalRef.current = setInterval(() => {
      setLoadingPct((prev) => {
        if (prev >= 90) return Math.min(99, prev + 0.5);
        return Math.min(90, prev + 8);
      });
    }, 300);
  };

  const finishProgress = (success: boolean) => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setLoadingPct(success ? 100 : 0);
  };

  const handleGenerate = async () => {
    if (!selectedAccountNo) {
      setAlert({
        show: true,
        type: 'error',
        title: 'Validation Error',
        message: 'Please select a customer account.',
      });
      return;
    }

    setIsGenerating(true);
    setAlert({ show: false, type: 'success', title: '', message: '' });
    startProgress();

    const charge = parseFloat(serviceCharge) || 0;

    try {
      const result = await generateCustomBilling(selectedAccountNo, charge);
      finishProgress(result.success);

      if (result.success) {
        const data = result.data || {};
        const soaId = data.soa?.id ? `#${data.soa.id}` : '';
        const invId = data.invoice?.id ? `#${data.invoice.id}` : '';
        const emailStatus = data.notifications?.email_queued ? 'Email queued' : 'Email not sent';
        const smsStatus = data.notifications?.sms_sent ? 'SMS sent' : 'SMS not sent';
        const chargeNote = charge > 0 ? `\nService Charge Applied: PHP ${charge.toFixed(2)}` : '';

        setAlert({
          show: true,
          type: 'success',
          title: 'Billing Generated Successfully!',
          message: `Customer: ${data.customer_name || selectedAccountNo}${chargeNote}\nSOA ${soaId} & Invoice ${invId} created.\n${emailStatus} - ${smsStatus}`,
        });
      } else {
        setAlert({
          show: true,
          type: 'error',
          title: 'Generation Failed',
          message: result.message || 'An unexpected error occurred.',
        });
      }
    } catch (err: any) {
      finishProgress(false);
      setAlert({ show: true, type: 'error', title: 'Error', message: err?.message || 'Unexpected error occurred.' });
    } finally {
      setTimeout(() => setIsGenerating(false), 400);
    }
  };

  const chargeNum = parseFloat(serviceCharge) || 0;

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: bg,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '94%',
            paddingBottom: isTablet ? 16 : 24,
          }}
        >
          {/* Header */}
          <View
            style={{
              padding: 20,
              borderBottomWidth: 1,
              borderBottomColor: border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${primary}20`,
                }}
              >
                <Zap size={22} color={primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', fontSize: 18, color: text }}>Generate Billing</Text>
                <Text style={{ fontSize: 13, color: subtext }}>Manual custom billing generation</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (!isGenerating) onClose();
              }}
              disabled={isGenerating}
              style={{ padding: 8, borderRadius: 8, backgroundColor: `${border}80` }}
            >
              <X size={18} color={subtext} />
            </TouchableOpacity>
          </View>

          {/* Body */}
          <ScrollView style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingVertical: 20 }}>
            {alert.show && (
              <View
                style={{
                  marginBottom: 20,
                  borderRadius: 12,
                  padding: 16,
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 12,
                  backgroundColor: alert.type === 'success' ? '#ecfdf5' : '#fef2f2',
                  borderWidth: 1,
                  borderColor: alert.type === 'success' ? '#10b981' : '#ef4444',
                }}
              >
                {alert.type === 'success' ? (
                  <CheckCircle size={20} color="#10b981" />
                ) : (
                  <XCircle size={20} color="#ef4444" />
                )}
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontWeight: '600',
                      fontSize: 14,
                      color: alert.type === 'success' ? '#059669' : '#dc2626',
                    }}
                  >
                    {alert.title}
                  </Text>
                  <Text style={{ fontSize: 12, marginTop: 4, color: subtext }}>{alert.message}</Text>
                </View>
              </View>
            )}

            {/* Customer selector */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: text, marginBottom: 8 }}>
                Customer Account <Text style={{ color: '#ef4444' }}>*</Text>
              </Text>
              <TouchableOpacity
                onPress={() => !loadingAccounts && !isGenerating && setDropdownOpen((p) => !p)}
                disabled={loadingAccounts || isGenerating}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderRadius: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: inputBg,
                  borderWidth: 1.5,
                  borderColor: dropdownOpen ? primary : border,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, fontSize: 14, color: selectedAccount ? text : subtext }}
                >
                  {loadingAccounts
                    ? 'Loading accounts...'
                    : selectedAccount
                    ? `${selectedAccount.customerName} - ${selectedAccount.accountNo || selectedAccount.account_no}`
                    : 'Select a customer...'}
                </Text>
                {loadingAccounts ? (
                  <ActivityIndicator size="small" color={primary} />
                ) : (
                  <ChevronDown size={16} color={subtext} />
                )}
              </TouchableOpacity>

              {dropdownOpen && (
                <View
                  style={{
                    marginTop: 6,
                    borderRadius: 12,
                    overflow: 'hidden',
                    backgroundColor: surface,
                    borderWidth: 1.5,
                    borderColor: `${primary}80`,
                  }}
                >
                  <View style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: border }}>
                    <TextInput
                      placeholder="Search by name or account no..."
                      placeholderTextColor={subtext}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCapitalize="none"
                      style={{
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        backgroundColor: inputBg,
                        borderWidth: 1,
                        borderColor: border,
                        color: text,
                        fontSize: 14,
                      }}
                    />
                  </View>
                  <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                    {filteredAccounts.length === 0 ? (
                      <Text style={{ paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, color: subtext }}>
                        No accounts found
                      </Text>
                    ) : (
                      filteredAccounts.map((account) => {
                        const accNo = account.accountNo || account.account_no || '';
                        const isSelected = accNo === selectedAccountNo;
                        return (
                          <TouchableOpacity
                            key={accNo}
                            onPress={() => {
                              setSelectedAccountNo(accNo);
                              setDropdownOpen(false);
                              setSearchQuery('');
                            }}
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              paddingHorizontal: 16,
                              paddingVertical: 12,
                              backgroundColor: isSelected ? `${primary}20` : 'transparent',
                              borderLeftWidth: 3,
                              borderLeftColor: isSelected ? primary : 'transparent',
                            }}
                          >
                            <Text numberOfLines={1} style={{ fontWeight: '500', color: text, flex: 1 }}>
                              {account.customerName}
                            </Text>
                            <Text style={{ fontSize: 12, marginLeft: 8, color: subtext }}>{accNo}</Text>
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                </View>
              )}

              {selectedAccount && (
                <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 12, color: subtext }}>Plan:</Text>
                  <Text style={{ fontSize: 12, color: primary }}>
                    {selectedAccount.plan || (selectedAccount as any).desiredPlan || 'N/A'}
                  </Text>
                  <Text style={{ fontSize: 12, color: subtext, marginLeft: 12 }}>Status:</Text>
                  <Text style={{ fontSize: 12, color: '#10b981' }}>{selectedAccount.billingStatus || 'Active'}</Text>
                </View>
              )}
            </View>

            {/* Service Charge */}
            <View style={{ marginBottom: 24 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: text, marginBottom: 8 }}>
                Service Charge <Text style={{ fontWeight: '400', fontSize: 12, color: subtext }}>(optional - PHP)</Text>
              </Text>
              <TextInput
                value={serviceCharge}
                onChangeText={handleServiceChargeChange}
                onFocus={() => {
                  if (serviceCharge === '0.00') setServiceCharge('');
                }}
                onBlur={handleServiceChargeBlur}
                editable={!isGenerating}
                keyboardType="decimal-pad"
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  fontSize: 14,
                  borderRadius: 12,
                  backgroundColor: inputBg,
                  borderWidth: 1.5,
                  borderColor: chargeNum > 0 ? primary : border,
                  color: text,
                }}
              />
              <Text style={{ fontSize: 12, marginTop: 8, color: subtext }}>
                {chargeNum > 0
                  ? `PHP ${chargeNum.toFixed(2)} will be added as a service charge to this billing cycle.`
                  : 'Leave at 0.00 to generate billing without an additional service charge.'}
              </Text>
            </View>

            {/* Info box */}
            <View
              style={{
                borderRadius: 12,
                padding: 16,
                backgroundColor: `${primary}10`,
                borderWidth: 1,
                borderColor: `${primary}30`,
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: '600', marginBottom: 4, color: primary }}>
                What will happen?
              </Text>
              <Text style={{ fontSize: 12, color: subtext, lineHeight: 18 }}>
                {'• A Statement of Account (SOA) will be generated\n'}
                {'• An Invoice will be generated for the selected account\n'}
                {'• PDFs will be saved to Google Drive automatically\n'}
                {'• Email & SMS notifications will be sent immediately'}
              </Text>
              {chargeNum > 0 && (
                <Text style={{ fontSize: 12, color: primary, marginTop: 2 }}>
                  {`• PHP ${chargeNum.toFixed(2)} service charge will be applied to the SOA`}
                </Text>
              )}
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={{ paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: border }}>
            {isGenerating && (
              <View style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: '500', color: subtext }}>Generating billing...</Text>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: primary }}>{Math.round(loadingPct)}%</Text>
                </View>
                <View style={{ width: '100%', height: 6, borderRadius: 999, overflow: 'hidden', backgroundColor: `${primary}20` }}>
                  <View style={{ height: '100%', borderRadius: 999, width: `${loadingPct}%`, backgroundColor: primary }} />
                </View>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={onClose}
                disabled={isGenerating}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: `${border}80`,
                  borderWidth: 1,
                  borderColor: border,
                  alignItems: 'center',
                  opacity: isGenerating ? 0.5 : 1,
                }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: text }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleGenerate}
                disabled={isGenerating || !selectedAccountNo}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                  backgroundColor: isGenerating || !selectedAccountNo ? `${primary}60` : primary,
                }}
              >
                {isGenerating ? (
                  <>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#ffffff' }}>Generating...</Text>
                  </>
                ) : (
                  <>
                    <Zap size={16} color="#ffffff" />
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#ffffff' }}>Generate Billing</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

export default GenerateBillingModal;
