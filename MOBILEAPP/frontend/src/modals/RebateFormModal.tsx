import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Dimensions,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { X, Minus, Plus, ChevronDown, Search } from 'lucide-react-native';
import * as massRebateService from '../services/massRebateService';
import * as lcpnapService from '../services/lcpnapService';
import * as lcpService from '../services/lcpService';
import { barangayService, Barangay } from '../services/barangayService';
import { userService } from '../services/userService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';

interface RebateFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type RebateType = 'lcpnap' | 'lcp' | 'barangay' | null;

const isDarkMode = false;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const RebateFormModal: React.FC<RebateFormModalProps> = ({ isOpen, onClose, onSave }) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resultModal, setResultModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message: string;
    onConfirm?: () => void;
  }>({ isOpen: false, type: 'success', title: '', message: '' });

  const [formData, setFormData] = useState({
    numberOfDays: 0,
    rebateType: null as RebateType,
    selectedId: null as number | null,
    month: '',
    status: 'Pending',
    createdBy: '',
    approvedBy: '',
  });

  const [lcpnapList, setLcpnapList] = useState<lcpnapService.LCPNAP[]>([]);
  const [lcpList, setLcpList] = useState<lcpService.LCP[]>([]);
  const [barangayList, setBarangayList] = useState<Barangay[]>([]);
  const [usersList, setUsersList] = useState<Array<{ email: string }>>([]);

  // Searchable dropdown state
  const [lcpnapSearch, setLcpnapSearch] = useState('');
  const [isLcpnapOpen, setIsLcpnapOpen] = useState(false);
  const [lcpSearch, setLcpSearch] = useState('');
  const [isLcpOpen, setIsLcpOpen] = useState(false);
  const [barangaySearch, setBarangaySearch] = useState('');
  const [isBarangayOpen, setIsBarangayOpen] = useState(false);
  const [isMonthOpen, setIsMonthOpen] = useState(false);
  const [isApproverOpen, setIsApproverOpen] = useState(false);
  const [approverSearch, setApproverSearch] = useState('');

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;
  const primaryColor = colorPalette?.primary || '#7c3aed';

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(p => setColorPalette(p))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadInitialData();
      loadAllData();
    }
  }, [isOpen]);

  const loadInitialData = async () => {
    try {
      const authDataStr = await AsyncStorage.getItem('authData');
      if (authDataStr) {
        const userData = JSON.parse(authDataStr);
        const email = userData.email || userData.user?.email || 'unknown@example.com';
        setFormData(prev => ({ ...prev, createdBy: email, status: 'Pending' }));
      }
    } catch (e) {
      console.error('Error loading auth data:', e);
    }
  };

  const loadAllData = async () => {
    try {
      const [lcpnapResponse, lcpResponse, barangayResponse, usersResponse] = await Promise.all([
        lcpnapService.getAllLCPNAPs(),
        lcpService.getAllLCPs(),
        barangayService.getAll(),
        userService.getAllUsers(),
      ]);

      if (lcpnapResponse.success) setLcpnapList(lcpnapResponse.data);
      if (lcpResponse.success) setLcpList(lcpResponse.data);
      if (barangayResponse.success) setBarangayList(barangayResponse.data);
      if (usersResponse.success && usersResponse.data) {
        const users = usersResponse.data.map((user: any) => ({
          email: user.email_address || user.username || 'No email',
        }));
        setUsersList(users);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleNumberChange = (operation: 'increase' | 'decrease') => {
    const currentValue = formData.numberOfDays;
    const newValue = operation === 'increase' ? currentValue + 1 : Math.max(0, currentValue - 1);
    setFormData(prev => ({ ...prev, numberOfDays: newValue }));
  };

  const handleRebateTypeChange = (type: RebateType) => {
    setFormData(prev => ({ ...prev, rebateType: type, selectedId: null }));
    setErrors(prev => ({ ...prev, rebateType: '', selectedId: '' }));
    setLcpnapSearch('');
    setLcpSearch('');
    setBarangaySearch('');
    setIsLcpnapOpen(false);
    setIsLcpOpen(false);
    setIsBarangayOpen(false);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (formData.numberOfDays <= 0) newErrors.numberOfDays = 'Number of Days must be greater than 0';
    if (!formData.rebateType) newErrors.rebateType = 'Please select a rebate type';
    if (formData.rebateType && !formData.selectedId) newErrors.selectedId = 'Please select an item';
    if (!formData.month) newErrors.month = 'Please select a month';
    if (!formData.approvedBy || formData.approvedBy.trim() === '') newErrors.approvedBy = 'Approved By is required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      setResultModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Please fill in all required fields correctly.',
      });
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);

    try {
      setLoadingPercentage(20);

      let selectedRebateName = '';
      if (formData.rebateType === 'lcpnap') {
        const selected = lcpnapList.find(item => item.id === formData.selectedId);
        selectedRebateName = selected?.lcpnap_name || '';
      } else if (formData.rebateType === 'lcp') {
        const selected = lcpList.find(item => item.id === formData.selectedId);
        selectedRebateName = selected?.lcp_name || '';
      } else if (formData.rebateType === 'barangay') {
        const selected = barangayList.find(item => item.id === formData.selectedId);
        selectedRebateName = selected?.barangay || '';
      }

      const authDataStr = await AsyncStorage.getItem('authData');
      const currentUser = authDataStr ? JSON.parse(authDataStr) : null;

      const payload: massRebateService.MassRebateData = {
        number_of_dates: formData.numberOfDays,
        rebate_type: formData.rebateType as any,
        selected_rebate: selectedRebateName,
        month: formData.month,
        status: 'Pending',
        created_by: formData.createdBy,
        modified_by: formData.approvedBy,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
      };

      setLoadingPercentage(50);
      await massRebateService.create(payload);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setResultModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Rebate created successfully!',
        onConfirm: () => {
          onSave();
          onClose();
          setResultModal(prev => ({ ...prev, isOpen: false }));
          resetForm();
        },
      });
    } catch (error) {
      console.error('Error creating rebate:', error);
      setResultModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to save rebate: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const resetForm = () => {
    setFormData({
      numberOfDays: 0,
      rebateType: null,
      selectedId: null,
      month: '',
      status: 'Pending',
      createdBy: '',
      approvedBy: '',
    });
    setErrors({});
    setLcpnapSearch('');
    setLcpSearch('');
    setBarangaySearch('');
    setApproverSearch('');
  };

  const handleCancel = () => {
    resetForm();
    onClose();
  };

  const getSelectedLcpnapName = () => lcpnapList.find(i => i.id === formData.selectedId)?.lcpnap_name || '';
  const getSelectedLcpName = () => lcpList.find(i => i.id === formData.selectedId)?.lcp_name || '';
  const getSelectedBarangayName = () => barangayList.find(i => i.id === formData.selectedId)?.barangay || '';

  const filteredLcpnap = lcpnapList.filter(item =>
    item.lcpnap_name.toLowerCase().includes(lcpnapSearch.toLowerCase())
  );
  const filteredLcp = lcpList.filter(item =>
    item.lcp_name.toLowerCase().includes(lcpSearch.toLowerCase())
  );
  const filteredBarangay = barangayList.filter(item =>
    item.barangay.toLowerCase().includes(barangaySearch.toLowerCase())
  );
  const filteredApprovers = usersList.filter(u =>
    u.email.toLowerCase().includes(approverSearch.toLowerCase())
  );

  const inputStyle = {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#ffffff',
  };

  const errorInputBorder = { borderColor: '#ef4444' };

  const labelStyle = {
    fontSize: 13,
    fontWeight: '500' as const,
    color: '#374151',
    marginBottom: 6,
  };

  const errorStyle = { fontSize: 11, color: '#ef4444', marginTop: 4 };

  const typeButtonStyle = (active: boolean) => ({
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: active ? primaryColor : '#d1d5db',
    backgroundColor: active ? primaryColor : '#ffffff',
    alignItems: 'center' as const,
  });

  const SearchableDropdown = ({
    label,
    placeholder,
    searchValue,
    onSearchChange,
    isOpen,
    onToggle,
    selectedName,
    onClear,
    items,
    onSelect,
    error,
    selectedId,
    getItemLabel,
    getItemId,
  }: {
    label: string;
    placeholder: string;
    searchValue: string;
    onSearchChange: (v: string) => void;
    isOpen: boolean;
    onToggle: () => void;
    selectedName: string;
    onClear: () => void;
    items: any[];
    onSelect: (id: number) => void;
    error?: string;
    selectedId: number | null;
    getItemLabel: (item: any) => string;
    getItemId: (item: any) => number;
  }) => (
    <View style={{ marginBottom: 16 }}>
      <Text style={labelStyle}>{label}<Text style={{ color: '#ef4444' }}>*</Text></Text>
      <TouchableOpacity
        onPress={onToggle}
        style={[inputStyle, error ? errorInputBorder : {}, {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }]}
      >
        <Text style={{ flex: 1, fontSize: 14, color: selectedName ? '#111827' : '#9ca3af' }} numberOfLines={1}>
          {selectedName || placeholder}
        </Text>
        {selectedId ? (
          <TouchableOpacity onPress={onClear} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={16} color="#9ca3af" />
          </TouchableOpacity>
        ) : (
          <ChevronDown size={16} color="#9ca3af" />
        )}
      </TouchableOpacity>
      {error ? <Text style={errorStyle}>{error}</Text> : null}

      {isOpen && (
        <View style={{
          borderWidth: 1,
          borderColor: '#e5e7eb',
          borderRadius: 6,
          backgroundColor: '#ffffff',
          marginTop: 4,
          maxHeight: 200,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.12,
          shadowRadius: 4,
          elevation: 4,
          zIndex: 100,
        }}>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 10,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: '#e5e7eb',
          }}>
            <Search size={14} color="#9ca3af" />
            <TextInput
              value={searchValue}
              onChangeText={onSearchChange}
              placeholder="Search..."
              placeholderTextColor="#9ca3af"
              style={{
                flex: 1,
                marginLeft: 8,
                fontSize: 13,
                color: '#111827',
                paddingVertical: 2,
              }}
              autoFocus
            />
          </View>
          <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
            {items.length === 0 ? (
              <Text style={{ padding: 12, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
                No results found
              </Text>
            ) : (
              items.map((item) => (
                <TouchableOpacity
                  key={getItemId(item)}
                  onPress={() => {
                    onSelect(getItemId(item));
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: selectedId === getItemId(item) ? '#f3e8ff' : '#ffffff',
                    borderBottomWidth: 1,
                    borderBottomColor: '#f3f4f6',
                  }}
                >
                  <Text style={{
                    fontSize: 13,
                    color: selectedId === getItemId(item) ? primaryColor : '#111827',
                  }}>
                    {getItemLabel(item)}
                  </Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );

  if (!isOpen) return null;

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent={false}
      onRequestClose={handleCancel}
    >
      <View style={{ flex: 1, backgroundColor: '#ffffff', paddingTop: isTablet ? 16 : 60 }}>
        <LoadingModalGlobal
          isOpen={loading}
          type="loading"
          title="Saving Rebate"
          message="Please wait..."
          loadingPercentage={loadingPercentage}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
        />

        {/* Result Modal */}
        <Modal
          visible={resultModal.isOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setResultModal(prev => ({ ...prev, isOpen: false }))}
        >
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}>
            <View style={{
              backgroundColor: '#ffffff',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 380,
              borderWidth: 1,
              borderColor: '#e5e7eb',
            }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827', marginBottom: 10 }}>
                {resultModal.title}
              </Text>
              <Text style={{ fontSize: 14, color: '#374151', marginBottom: 20 }}>
                {resultModal.message}
              </Text>
              <View style={{ alignItems: 'flex-end' }}>
                <TouchableOpacity
                  onPress={() => {
                    if (resultModal.onConfirm) {
                      resultModal.onConfirm();
                    } else {
                      setResultModal(prev => ({ ...prev, isOpen: false }));
                    }
                  }}
                  style={{
                    backgroundColor: primaryColor,
                    paddingHorizontal: 20,
                    paddingVertical: 8,
                    borderRadius: 6,
                  }}
                >
                  <Text style={{ color: '#ffffff', fontWeight: '600' }}>OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Header */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: '#f3f4f6',
          borderBottomWidth: 1,
          borderBottomColor: '#e5e7eb',
        }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: '#111827' }}>
            Rebate Form
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity
              onPress={handleCancel}
              style={{
                backgroundColor: '#9ca3af',
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 6,
              }}
            >
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '500' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              disabled={loading}
              style={{
                backgroundColor: loading ? '#9ca3af' : primaryColor,
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 6,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {loading && <ActivityIndicator size="small" color="#ffffff" />}
              <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '500' }}>
                {loading ? 'Saving...' : 'Save'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={22} color="#6b7280" />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Number of Days */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>
              Number of Days<Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput
                value={String(formData.numberOfDays)}
                onChangeText={(v) => handleInputChange('numberOfDays', parseInt(v) || 0)}
                keyboardType="numeric"
                style={[inputStyle, { flex: 1, borderRightWidth: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0 }, errors.numberOfDays ? errorInputBorder : {}]}
              />
              <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderLeftWidth: 0, borderTopRightRadius: 6, borderBottomRightRadius: 6, overflow: 'hidden' }}>
                <TouchableOpacity
                  onPress={() => handleNumberChange('decrease')}
                  style={{ backgroundColor: '#e5e7eb', paddingHorizontal: 14, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#d1d5db', alignItems: 'center' }}
                >
                  <Minus size={14} color="#374151" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleNumberChange('increase')}
                  style={{ backgroundColor: '#e5e7eb', paddingHorizontal: 14, paddingVertical: 6, alignItems: 'center' }}
                >
                  <Plus size={14} color="#374151" />
                </TouchableOpacity>
              </View>
            </View>
            {errors.numberOfDays ? <Text style={errorStyle}>{errors.numberOfDays}</Text> : null}
          </View>

          {/* Rebate Type */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>
              Rebate Type<Text style={{ color: '#ef4444' }}>*</Text>
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['lcpnap', 'lcp', 'barangay'] as RebateType[]).map((type) => (
                <TouchableOpacity
                  key={type!}
                  onPress={() => handleRebateTypeChange(type)}
                  style={typeButtonStyle(formData.rebateType === type)}
                >
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '500',
                    color: formData.rebateType === type ? '#ffffff' : '#374151',
                  }}>
                    {type === 'lcpnap' ? 'LCPNAP' : type === 'lcp' ? 'LCP' : 'Barangay'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {errors.rebateType ? <Text style={errorStyle}>{errors.rebateType}</Text> : null}
          </View>

          {/* Conditional dropdowns */}
          {formData.rebateType === 'lcpnap' && (
            <SearchableDropdown
              label="Select LCPNAP"
              placeholder="Type to search LCP-NAP..."
              searchValue={lcpnapSearch}
              onSearchChange={setLcpnapSearch}
              isOpen={isLcpnapOpen}
              onToggle={() => setIsLcpnapOpen(v => !v)}
              selectedName={getSelectedLcpnapName()}
              onClear={() => { handleInputChange('selectedId', null); setLcpnapSearch(''); }}
              items={filteredLcpnap}
              onSelect={(id) => { handleInputChange('selectedId', id); setIsLcpnapOpen(false); setLcpnapSearch(''); }}
              error={errors.selectedId}
              selectedId={formData.selectedId}
              getItemLabel={(item) => item.lcpnap_name}
              getItemId={(item) => item.id}
            />
          )}

          {formData.rebateType === 'lcp' && (
            <SearchableDropdown
              label="Select LCP"
              placeholder="Type to search LCP..."
              searchValue={lcpSearch}
              onSearchChange={setLcpSearch}
              isOpen={isLcpOpen}
              onToggle={() => setIsLcpOpen(v => !v)}
              selectedName={getSelectedLcpName()}
              onClear={() => { handleInputChange('selectedId', null); setLcpSearch(''); }}
              items={filteredLcp}
              onSelect={(id) => { handleInputChange('selectedId', id); setIsLcpOpen(false); setLcpSearch(''); }}
              error={errors.selectedId}
              selectedId={formData.selectedId}
              getItemLabel={(item) => item.lcp_name}
              getItemId={(item) => item.id}
            />
          )}

          {formData.rebateType === 'barangay' && (
            <SearchableDropdown
              label="Select Barangay"
              placeholder="Type to search Barangay..."
              searchValue={barangaySearch}
              onSearchChange={setBarangaySearch}
              isOpen={isBarangayOpen}
              onToggle={() => setIsBarangayOpen(v => !v)}
              selectedName={getSelectedBarangayName()}
              onClear={() => { handleInputChange('selectedId', null); setBarangaySearch(''); }}
              items={filteredBarangay}
              onSelect={(id) => { handleInputChange('selectedId', id); setIsBarangayOpen(false); setBarangaySearch(''); }}
              error={errors.selectedId}
              selectedId={formData.selectedId}
              getItemLabel={(item) => item.barangay}
              getItemId={(item) => item.id}
            />
          )}

          {/* Month picker */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>Month<Text style={{ color: '#ef4444' }}>*</Text></Text>
            <TouchableOpacity
              onPress={() => setIsMonthOpen(v => !v)}
              style={[inputStyle, errors.month ? errorInputBorder : {}, {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }]}
            >
              <Text style={{ fontSize: 14, color: formData.month ? '#111827' : '#9ca3af' }}>
                {formData.month || 'Select Month'}
              </Text>
              <ChevronDown size={16} color="#9ca3af" />
            </TouchableOpacity>
            {errors.month ? <Text style={errorStyle}>{errors.month}</Text> : null}
            {isMonthOpen && (
              <View style={{
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 6,
                backgroundColor: '#ffffff',
                marginTop: 4,
                maxHeight: 200,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 4,
                elevation: 4,
              }}>
                <ScrollView nestedScrollEnabled>
                  {MONTHS.map((month) => (
                    <TouchableOpacity
                      key={month}
                      onPress={() => {
                        handleInputChange('month', month);
                        setIsMonthOpen(false);
                      }}
                      style={{
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: formData.month === month ? '#f3e8ff' : '#ffffff',
                        borderBottomWidth: 1,
                        borderBottomColor: '#f3f4f6',
                      }}
                    >
                      <Text style={{
                        fontSize: 14,
                        color: formData.month === month ? primaryColor : '#111827',
                        fontWeight: formData.month === month ? '600' : '400',
                      }}>
                        {month}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Status (read-only) */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>Status</Text>
            <View style={[inputStyle, { backgroundColor: '#f9fafb' }]}>
              <Text style={{ fontSize: 14, color: '#6b7280' }}>{formData.status}</Text>
            </View>
            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              Default status is Pending when creating a new rebate
            </Text>
          </View>

          {/* Created By (read-only) */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>Created By</Text>
            <View style={[inputStyle, { backgroundColor: '#f9fafb' }]}>
              <Text style={{ fontSize: 14, color: '#6b7280' }}>{formData.createdBy || 'Loading...'}</Text>
            </View>
          </View>

          {/* Approved By searchable dropdown */}
          <View style={{ marginBottom: 16 }}>
            <Text style={labelStyle}>Approved By<Text style={{ color: '#ef4444' }}>*</Text></Text>
            <TouchableOpacity
              onPress={() => setIsApproverOpen(v => !v)}
              style={[inputStyle, errors.approvedBy ? errorInputBorder : {}, {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }]}
            >
              <Text style={{ fontSize: 14, color: formData.approvedBy ? '#111827' : '#9ca3af' }} numberOfLines={1}>
                {formData.approvedBy || 'Select Approver'}
              </Text>
              <ChevronDown size={16} color="#9ca3af" />
            </TouchableOpacity>
            {errors.approvedBy ? <Text style={errorStyle}>{errors.approvedBy}</Text> : null}
            {isApproverOpen && (
              <View style={{
                borderWidth: 1,
                borderColor: '#e5e7eb',
                borderRadius: 6,
                backgroundColor: '#ffffff',
                marginTop: 4,
                maxHeight: 220,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.12,
                shadowRadius: 4,
                elevation: 4,
              }}>
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: '#e5e7eb',
                }}>
                  <Search size={14} color="#9ca3af" />
                  <TextInput
                    value={approverSearch}
                    onChangeText={setApproverSearch}
                    placeholder="Search approver..."
                    placeholderTextColor="#9ca3af"
                    style={{
                      flex: 1,
                      marginLeft: 8,
                      fontSize: 13,
                      color: '#111827',
                      paddingVertical: 2,
                    }}
                    autoFocus
                  />
                </View>
                <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                  {filteredApprovers.length === 0 ? (
                    <Text style={{ padding: 12, color: '#9ca3af', fontSize: 13, textAlign: 'center' }}>
                      No approvers found
                    </Text>
                  ) : (
                    filteredApprovers.map((user, index) => (
                      <TouchableOpacity
                        key={index}
                        onPress={() => {
                          handleInputChange('approvedBy', user.email);
                          setIsApproverOpen(false);
                          setApproverSearch('');
                        }}
                        style={{
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                          backgroundColor: formData.approvedBy === user.email ? '#f3e8ff' : '#ffffff',
                          borderBottomWidth: 1,
                          borderBottomColor: '#f3f4f6',
                        }}
                      >
                        <Text style={{
                          fontSize: 13,
                          color: formData.approvedBy === user.email ? primaryColor : '#111827',
                        }}>
                          {user.email}
                        </Text>
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              </View>
            )}
            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
              Select the person who will approve this rebate
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
};

export default RebateFormModal;
