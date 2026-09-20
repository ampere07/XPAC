import React, { useState, useEffect, useRef, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar, ChevronDown, ChevronLeft, Minus, Plus, Camera, X } from 'lucide-react-native';
import { transactionService } from '../services/transactionService';
import { getActiveImageSize, ImageSizeSetting } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import { User } from '../types/api';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import { API_BASE_URL } from '../config/api';

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface TransactionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: TransactionFormData) => void;
  billingRecord?: any;
  initialTransactionData?: any;
}

interface TransactionFormData {
  accountNo: string;
  fullName: string;
  contactNo: string;
  plan: string;
  accountBalance: string;
  paymentDate: string;
  receivedPayment: string;
  processedBy: string;
  paymentMethod: string;
  referenceNo: string;
  orNo: string;
  transactionType: string;
  remarks: string;
  image: { uri: string; name: string; type: string } | null;
}

const TransactionFormModal: React.FC<TransactionFormModalProps> = memo(({
  isOpen,
  onClose,
  onSave,
  billingRecord,
  initialTransactionData
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [processors, setProcessors] = useState<User[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [isEdit, setIsEdit] = useState<boolean>(false);

  const getCurrentDate = () => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  };

  // Auth lives in AsyncStorage on RN, so processedBy is filled in by the effect below.
  const [formData, setFormData] = useState<TransactionFormData>(() => {
    const userEmail = '';

    return {
      accountNo: billingRecord?.applicationId || '',
      fullName: billingRecord?.customerName || '',
      contactNo: billingRecord?.contactNumber || '',
      plan: billingRecord?.plan || '',
      accountBalance: billingRecord?.accountBalance?.toString() || '0.00',
      paymentDate: getCurrentDate(),
      receivedPayment: '',
      processedBy: userEmail,
      paymentMethod: '',
      referenceNo: '',
      orNo: '',
      transactionType: 'Recurring Fee',
      remarks: '',
      image: null
    };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPaymentMethodPicker, setShowPaymentMethodPicker] = useState(false);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  // RN has no document/MutationObserver — read the stored theme once on mount.
  useEffect(() => {
    AsyncStorage.getItem('theme')
      .then((theme) => setIsDarkMode(theme === 'dark' || theme === null))
      .catch(() => { });
  }, []);

  useEffect(() => {
    const fetchColorPalette = async () => {
      const palette = await settingsColorPaletteService.getActive();
      setColorPalette(palette);
    };
    fetchColorPalette();
  }, []);

  useEffect(() => {
    const fetchProcessors = async () => {
      try {
        const response = await userService.getUsersByRoleId(1);
        if (response.success && response.data) {
          setProcessors(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch processors:', error);
      }
    };

    if (isOpen) {
      fetchProcessors();
      setIsEdit(!!initialTransactionData);
    }
  }, [isOpen, initialTransactionData]);

  useEffect(() => {
    const fetchPaymentMethods = async () => {
      try {
        const response = await paymentMethodService.getAll();
        if (response.success && response.data) {
          setPaymentMethods(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch payment methods:', error);
      }
    };

    if (isOpen) {
      fetchPaymentMethods();
    }
  }, [isOpen]);

  useEffect(() => {
    const fetchImageSizeSettings = async () => {
      if (isOpen) {
        try {
          const settings = await getActiveImageSize();
          setActiveImageSize(settings);
        } catch (error) {
          setActiveImageSize(null);
        }
      }
    };

    fetchImageSizeSettings();

    // Refresh processedBy from authData when modal opens
    if (isOpen) {
      AsyncStorage.getItem('authData')
        .then((authData) => {
          if (!authData) return;
          const userData = JSON.parse(authData);
          const userEmail = userData.email_address || userData.email || '';
          if (userEmail) setFormData((prev) => ({ ...prev, processedBy: userEmail }));
        })
        .catch((e) => console.error('Error refreshing auth data:', e));
    }
  }, [isOpen]);

  const getProxiedImageUrl = (url: string) => {
    if (!url) return '';
    if (url.includes('drive.google.com')) {
      return `${API_BASE_URL}/proxy/image?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  useEffect(() => {
    if (!isOpen) {
      setImagePreview(prev => {
        if (prev && prev.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
        }
        return null;
      });
      setFormData(prev => ({ ...prev, image: null }));
    }
  }, [isOpen]);

  const lastAccountIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen && billingRecord) {
      const currentAccountId = billingRecord.applicationId || billingRecord.accountNo || '';
      
      // Only initialize if we haven't initialized for this account yet while the modal is open
      if (lastAccountIdRef.current !== currentAccountId) {
        setFormData(prev => ({
          ...prev,
          accountNo: billingRecord.applicationId || '',
          fullName: billingRecord.customerName || '',
          contactNo: billingRecord.contactNumber || '',
          plan: billingRecord.plan || '',
          accountBalance: billingRecord.accountBalance?.toString() || '0.00',
          ...(initialTransactionData ? {
            paymentDate: initialTransactionData.payment_date ? initialTransactionData.payment_date.split(' ')[0] : prev.paymentDate,
            receivedPayment: initialTransactionData.received_payment ? initialTransactionData.received_payment.toString() : prev.receivedPayment,
            paymentMethod: initialTransactionData.payment_method_info?.payment_method || initialTransactionData.payment_method || prev.paymentMethod,
            referenceNo: initialTransactionData.reference_no || prev.referenceNo,
            orNo: initialTransactionData.or_no || prev.orNo,
            transactionType: initialTransactionData.transaction_type || prev.transactionType,
            remarks: initialTransactionData.remarks || prev.remarks
          } : {})
        }));

        setImagePreview(prev => {
          if (prev && prev.startsWith('blob:')) return prev;
          return initialTransactionData?.image_url 
            ? getProxiedImageUrl(initialTransactionData.image_url) 
            : null;
        });

        lastAccountIdRef.current = currentAccountId;
      }
    } else if (!isOpen) {
      // Reset the ref when modal closes so it re-initializes next time it opens
      lastAccountIdRef.current = null;
    }
  }, [isOpen, billingRecord, initialTransactionData]);

  const handleInputChange = (field: keyof TransactionFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleReceivedPaymentChange = (operation: 'increase' | 'decrease') => {
    const currentValue = parseFloat(formData.receivedPayment) || 0;
    const increment = 0.01;
    let newValue: number;

    if (operation === 'increase') {
      newValue = currentValue + increment;
    } else {
      newValue = Math.max(0, currentValue - increment);
    }

    setFormData(prev => ({
      ...prev,
      receivedPayment: newValue.toFixed(2)
    }));
  };

  const handleTransactionTypeChange = (type: string) => {
    setFormData(prev => ({ ...prev, transactionType: type }));
  };

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setModal({
          isOpen: true,
          type: 'warning',
          title: 'Permission Needed',
          message: 'Permission to access photos is required to attach payment proof.',
        });
        return;
      }

      // The web build resized via canvas; here the picker's quality setting stands in,
      // scaled from the same configured image-size setting.
      const quality = activeImageSize && activeImageSize.image_size_value < 100
        ? Math.max(0.3, activeImageSize.image_size_value / 100)
        : 0.8;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      const name = asset.fileName || asset.uri.split('/').pop() || `payment_proof_${Date.now()}.jpg`;
      setFormData((prev) => ({
        ...prev,
        image: { uri: asset.uri, name, type: asset.mimeType || 'image/jpeg' },
      }));
      setImagePreview(asset.uri);
    } catch (e: any) {
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: e?.message || 'Failed to pick image',
      });
    }
  };

  const handleRemoveImage = () => {
    setFormData((prev) => ({ ...prev, image: null }));
    setImagePreview(null);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.accountNo.trim()) newErrors.accountNo = 'Account No. is required';
    if (!formData.plan.trim()) newErrors.plan = 'Plan is required';
    if (!formData.accountBalance.trim()) newErrors.accountBalance = 'Account Balance is required';
    if (!formData.paymentDate.trim()) newErrors.paymentDate = 'Payment Date is required';
    if (!formData.receivedPayment.trim()) newErrors.receivedPayment = 'Received Payment is required';
    if (!formData.processedBy.trim()) newErrors.processedBy = 'Processed By is required';
    if (!formData.paymentMethod.trim()) newErrors.paymentMethod = 'Payment Method is required';
    if (!formData.referenceNo.trim()) newErrors.referenceNo = 'Reference No. is required';
    if (!formData.orNo.trim()) newErrors.orNo = 'OR No. is required';
    if (!formData.transactionType.trim()) newErrors.transactionType = 'Transaction Type is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    const isValid = validateForm();

    if (!isValid) {
      setModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Please fill in all required fields before saving.'
      });
      return;
    }

    setLoading(true);
    try {
      let imageUrl = undefined;

      if (formData.image) {
        setUploadProgress(10);
        try {
          const imageFormData = new FormData();
          const folderName = `transactionform - ${formData.fullName}`;
          imageFormData.append('folder_name', folderName);
          imageFormData.append(
            'payment_proof_image',
            { uri: formData.image.uri, name: formData.image.name, type: formData.image.type } as any,
            formData.image.name,
          );

          const uploadResponse = await transactionService.uploadTransactionImage(imageFormData);

          if (uploadResponse.success && uploadResponse.data?.payment_proof_image_url) {
            imageUrl = uploadResponse.data.payment_proof_image_url;
            setUploadProgress(60);
          }
        } catch (uploadError: any) {
          setModal({
            isOpen: true,
            type: 'error',
            title: 'Upload Failed',
            message: `Failed to upload image: ${uploadError.message}`
          });
          setLoading(false);
          return;
        }
      }

      const authData = await AsyncStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;

      const payload = {
        account_no: formData.accountNo || undefined,
        transaction_type: formData.transactionType,
        received_payment: parseFloat(formData.receivedPayment) || 0,
        payment_date: formData.paymentDate,
        date_processed: new Date().toISOString(),
        processed_by_user: formData.processedBy,
        payment_method: formData.paymentMethod,
        reference_no: formData.referenceNo,
        or_no: formData.orNo,
        remarks: formData.remarks || '',
        status: 'Pending',
        image_url: imageUrl,
        created_by_user: formData.processedBy,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      setUploadProgress(80);
      const result = isEdit 
        ? await (transactionService as any).updateTransaction(initialTransactionData.id, payload)
        : await transactionService.createTransaction(payload);
      setUploadProgress(100);

      if (result.success) {
        const isRecurringFee = formData.transactionType === 'Recurring Fee';
        setModal({
          isOpen: true,
          type: 'success',
          title: isEdit ? 'Success' : (isRecurringFee ? 'Pending Approval' : 'Success'),
          message: isEdit 
            ? 'Transaction updated successfully!'
            : (isRecurringFee
              ? 'Recurring Fee transaction has been submitted successfully.\n\nThis transaction requires approval before the account balance is updated. Please approve it in the Transaction List.'
              : 'Transaction created successfully!'),
          onConfirm: () => {
            onSave(formData);
            onClose();
            setModal(prev => ({ ...prev, isOpen: false }));
          }
        });
      } else {
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: `Failed to create transaction: ${result.message}`
        });
      }
    } catch (error) {
      console.error('Error creating transaction:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to save transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoading(false);
      setUploadProgress(0);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  if (!isOpen) return null;

  const activeColor = colorPalette?.primary || '#7c3aed';

  const renderInput = (
    field: keyof TransactionFormData,
    label: string,
    required: boolean = false,
    options: { readOnly?: boolean; multiline?: boolean; keyboardType?: any; prefix?: string; onChange?: (t: string) => void } = {}
  ) => (
    <View style={tf.fieldGroup} key={String(field)}>
      <Text style={tf.label}>
        {label}{required && <Text style={tf.required}>*</Text>}
      </Text>
      <View
        style={[tf.input, {
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: options.readOnly ? '#f3f4f6' : '#ffffff',
          borderColor: errors[field as string] ? '#ef4444' : '#d1d5db',
          minHeight: options.multiline ? 84 : 44,
          paddingVertical: options.multiline ? 8 : 0,
        }]}
      >
        {!!options.prefix && <Text style={{ color: '#4b5563', marginRight: 6 }}>{options.prefix}</Text>}
        <TextInput
          value={String((formData as any)[field] ?? '')}
          onChangeText={options.onChange || ((text) => handleInputChange(field as any, text))}
          editable={!options.readOnly}
          multiline={options.multiline}
          keyboardType={options.keyboardType}
          textAlignVertical={options.multiline ? 'top' : 'center'}
          placeholderTextColor="#9ca3af"
          style={{ flex: 1, fontSize: 14, color: options.readOnly ? '#6b7280' : '#111827', padding: 0 }}
        />
      </View>
      {errors[field as string] ? <Text style={tf.errorText}>{errors[field as string]}</Text> : null}
    </View>
  );

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={handleCancel}>
      <View style={tf.container}>
        {/* Header */}
        <View style={tf.header}>
          <Pressable onPress={handleCancel} disabled={loading} style={tf.headerBack}>
            <ChevronLeft size={26} color={activeColor} />
          </Pressable>
          <Text style={tf.headerTitle} numberOfLines={1}>
            {isEdit ? 'Edit Transaction' : 'Transactions Form'}
          </Text>
          <Pressable
            onPress={handleSave}
            disabled={loading}
            style={[tf.saveBtn, { backgroundColor: loading ? '#9ca3af' : activeColor }]}
          >
            {loading
              ? <ActivityIndicator size="small" color="#ffffff" />
              : <Text style={tf.saveBtnText}>Save</Text>}
          </Pressable>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={tf.body} keyboardShouldPersistTaps="handled">
            {/* Account No — fixed to the record this form was opened from */}
            <View style={tf.fieldGroup}>
              <Text style={tf.label}>Account No.<Text style={tf.required}>*</Text></Text>
              <View style={[tf.input, { backgroundColor: '#f3f4f6', borderColor: errors.accountNo ? '#ef4444' : '#d1d5db', justifyContent: 'center', minHeight: 44 }]}>
                <Text style={{ fontSize: 14, color: '#6b7280' }} numberOfLines={1}>
                  {[billingRecord?.applicationId, billingRecord?.customerName, billingRecord?.address].filter(Boolean).join(' | ') || '-'}
                </Text>
              </View>
              {errors.accountNo ? <Text style={tf.errorText}>{errors.accountNo}</Text> : null}
            </View>

            {renderInput('fullName', 'Full Name', false, { readOnly: true })}
            {renderInput('contactNo', 'Contact No.', false, { readOnly: true })}
            {renderInput('plan', 'Plan', false, { readOnly: true })}
            {renderInput('accountBalance', 'Account Balance', false, { readOnly: true, prefix: '₱' })}

            {/* Payment Date */}
            <View style={tf.fieldGroup}>
              <Text style={tf.label}>Payment Date<Text style={tf.required}>*</Text></Text>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                style={[tf.input, {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: 44,
                  borderColor: errors.paymentDate ? '#ef4444' : '#d1d5db',
                }]}
              >
                <Text style={{ fontSize: 14, color: formData.paymentDate ? '#111827' : '#9ca3af' }}>
                  {formData.paymentDate || 'Select date'}
                </Text>
                <Calendar size={18} color="#6b7280" />
              </Pressable>
              {errors.paymentDate ? <Text style={tf.errorText}>{errors.paymentDate}</Text> : null}
            </View>

            {/* Received Payment with steppers */}
            <View style={tf.fieldGroup}>
              <Text style={tf.label}>Received Payment<Text style={tf.required}>*</Text></Text>
              <View
                style={[tf.input, {
                  flexDirection: 'row',
                  alignItems: 'center',
                  minHeight: 44,
                  paddingVertical: 0,
                  paddingRight: 0,
                  borderColor: errors.receivedPayment ? '#ef4444' : '#d1d5db',
                }]}
              >
                <Text style={{ color: '#4b5563', marginRight: 6 }}>₱</Text>
                <TextInput
                  value={String(formData.receivedPayment ?? '')}
                  onChangeText={(text) => {
                    if (text === '' || /^\d*\.?\d*$/.test(text)) handleInputChange('receivedPayment', text);
                  }}
                  keyboardType="decimal-pad"
                  style={{ flex: 1, fontSize: 14, color: '#111827', padding: 0 }}
                />
                <Pressable onPress={() => handleReceivedPaymentChange('decrease')} style={tf.stepperBtn}>
                  <Minus size={16} color="#4b5563" />
                </Pressable>
                <Pressable onPress={() => handleReceivedPaymentChange('increase')} style={tf.stepperBtn}>
                  <Plus size={16} color="#4b5563" />
                </Pressable>
              </View>
              {errors.receivedPayment ? <Text style={tf.errorText}>{errors.receivedPayment}</Text> : null}
            </View>

            {renderInput('processedBy', 'Processed By', false, { readOnly: true })}

            {/* Payment Method */}
            <View style={tf.fieldGroup}>
              <Text style={tf.label}>Payment Method<Text style={tf.required}>*</Text></Text>
              <Pressable
                onPress={() => setShowPaymentMethodPicker(true)}
                style={[tf.input, {
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  minHeight: 44,
                  borderColor: errors.paymentMethod ? '#ef4444' : '#d1d5db',
                }]}
              >
                <Text style={{ fontSize: 14, color: formData.paymentMethod ? '#111827' : '#9ca3af' }}>
                  {formData.paymentMethod || 'Select Payment Method'}
                </Text>
                <ChevronDown size={18} color="#6b7280" />
              </Pressable>
              {errors.paymentMethod ? <Text style={tf.errorText}>{errors.paymentMethod}</Text> : null}
            </View>

            {renderInput('referenceNo', 'Reference No.')}
            {renderInput('orNo', 'OR No.')}

            {/* Transaction Type */}
            <View style={tf.fieldGroup}>
              <Text style={tf.label}>Transaction Type<Text style={tf.required}>*</Text></Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {['Recurring Fee', 'Installation Fee', 'Security Deposit'].map((type) => {
                  const isSelected = formData.transactionType === type;
                  return (
                    <Pressable
                      key={type}
                      onPress={() => handleTransactionTypeChange(type)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        borderRadius: 8,
                        backgroundColor: isSelected ? activeColor : '#e5e7eb',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: isSelected ? '#ffffff' : '#374151' }}>
                        {type}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {errors.transactionType ? <Text style={tf.errorText}>{errors.transactionType}</Text> : null}
            </View>

            {renderInput('remarks', 'Remarks', false, { multiline: true })}

            {/* Payment proof */}
            <View style={tf.fieldGroup}>
              <Text style={tf.label}>Payment Proof Image</Text>
              {imagePreview ? (
                <View style={{ gap: 8 }}>
                  <Image source={{ uri: imagePreview }} style={tf.preview} resizeMode="cover" />
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={handlePickImage} style={[tf.imageBtn, { borderColor: activeColor }]}>
                      <Text style={{ color: activeColor, fontWeight: '600', fontSize: 13 }}>Replace</Text>
                    </Pressable>
                    <Pressable onPress={handleRemoveImage} style={[tf.imageBtn, { borderColor: '#ef4444' }]}>
                      <Text style={{ color: '#ef4444', fontWeight: '600', fontSize: 13 }}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={handlePickImage} style={tf.imageDrop}>
                  <Camera size={32} color="#9ca3af" />
                  <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Tap to select an image</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={formData.paymentDate ? new Date(`${formData.paymentDate}T00:00:00`) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(event, date) => {
            setShowDatePicker(false);
            if (event?.type !== 'set' || !date) return;
            const pad = (n: number) => String(n).padStart(2, '0');
            handleInputChange('paymentDate', `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
          }}
        />
      )}

      {/* Payment method picker */}
      <Modal
        visible={showPaymentMethodPicker}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShowPaymentMethodPicker(false)}
      >
        <View style={tf.sheetOverlay}>
          <View style={tf.sheet}>
            <View style={tf.sheetHeader}>
              <Text style={tf.sheetTitle}>Select Payment Method</Text>
              <Pressable onPress={() => setShowPaymentMethodPicker(false)} hitSlop={8}>
                <X size={22} color="#4b5563" />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {paymentMethods.map((method) => {
                const selected = formData.paymentMethod === method.payment_method;
                return (
                  <Pressable
                    key={method.id}
                    onPress={() => {
                      handleInputChange('paymentMethod', method.payment_method);
                      setShowPaymentMethodPicker(false);
                    }}
                    style={tf.sheetRow}
                  >
                    <Text style={{ fontSize: 14, color: selected ? activeColor : '#374151', fontWeight: selected ? '600' : '400' }}>
                      {method.payment_method}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Status / progress dialog */}
      <Modal visible={modal.isOpen || loading} transparent animationType="fade" statusBarTranslucent>
        <View style={tf.statusOverlay}>
          <View style={tf.statusCard}>
            {loading || modal.type === 'loading' ? (
              <View style={{ alignItems: 'center', gap: 16 }}>
                <ActivityIndicator size="large" color={activeColor} />
                <Text style={tf.statusPercent}>{Math.round(uploadProgress)}%</Text>
              </View>
            ) : (
              <>
                <Text style={tf.statusTitle}>{modal.title}</Text>
                <Text style={tf.statusMessage}>{modal.message}</Text>
                <View style={tf.statusActions}>
                  {modal.type === 'confirm' ? (
                    <>
                      <Pressable onPress={modal.onCancel} style={tf.statusCancelBtn}>
                        <Text style={{ color: '#374151', fontWeight: '500' }}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={modal.onConfirm} style={[tf.statusOkBtn, { backgroundColor: activeColor }]}>
                        <Text style={tf.statusOkText}>Confirm</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Pressable
                      onPress={() => {
                        if (modal.onConfirm) modal.onConfirm();
                        else setModal({ ...modal, isOpen: false });
                      }}
                      style={[tf.statusOkBtn, { backgroundColor: activeColor }]}
                    >
                      <Text style={tf.statusOkText}>OK</Text>
                    </Pressable>
                  )}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </Modal>
  );
});

const tf = StyleSheet.create({
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
  headerBack: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '600', color: '#111827' },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, minWidth: 72, alignItems: 'center' },
  saveBtnText: { color: '#ffffff', fontWeight: '600' },
  body: { padding: 16, paddingBottom: 80 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '500', color: '#374151', marginBottom: 6 },
  required: { color: '#ef4444' },
  input: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, fontSize: 14 },
  stepperBtn: { paddingHorizontal: 14, paddingVertical: 12, borderLeftWidth: 1, borderLeftColor: '#d1d5db' },
  errorText: { color: '#ef4444', fontSize: 11, marginTop: 4 },
  preview: { width: '100%', height: 200, borderRadius: 8, backgroundColor: '#e5e7eb' },
  imageBtn: { flex: 1, paddingVertical: 10, borderRadius: 6, borderWidth: 1, alignItems: 'center' },
  imageDrop: {
    height: 160,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#ffffff', borderRadius: 12, maxHeight: '75%', overflow: 'hidden' },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  sheetRow: { paddingHorizontal: 16, paddingVertical: 12 },
  statusOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  statusCard: { width: '100%', maxWidth: 420, borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', backgroundColor: '#ffffff', padding: 24, gap: 12 },
  statusTitle: { fontSize: 17, fontWeight: '600', color: '#111827' },
  statusMessage: { fontSize: 14, lineHeight: 20, color: '#374151' },
  statusPercent: { fontSize: 34, fontWeight: '700', color: '#111827' },
  statusActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  statusCancelBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db' },
  statusOkBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 6 },
  statusOkText: { color: '#ffffff', fontWeight: '600' },
});

export default TransactionFormModal;
