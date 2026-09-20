import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  Image,
  Platform,
  StyleSheet,
  useWindowDimensions,
  KeyboardAvoidingView,
  Pressable
} from 'react-native';
import * as ExpoFileSystem from 'expo-file-system/legacy';
import { Picker } from '@react-native-picker/picker';
import { X, Camera, ImageIcon, Trash2, ChevronDown, CheckCircle, AlertCircle, XCircle, Loader2, Search } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import apiClient, { API_BASE_URL } from '../config/api';
import ImagePreview from '../components/ImagePreview';
import { formatToGMT8MySQL } from '../utils/dateUtils';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { authFetch } from '../config/api';

dayjs.extend(utc);
dayjs.extend(timezone);

// Removed global Dimensions usage

interface AssignWorkOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  onRefresh?: () => void;
  isEditMode?: boolean;
  workOrder?: any;
}

interface User {
  email: string;
  name: string;
}

const AssignWorkOrderModal: React.FC<AssignWorkOrderModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onRefresh,
  isEditMode = false,
  workOrder
}) => {
  const isDarkMode = false; // Forced light mode as per user request
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [assignees, setAssignees] = useState<User[]>([]);
  const [categories, setCategories] = useState<{ id: number, category: string }[]>([]);
  const [userRole, setUserRole] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const hasInitializedEditRef = useRef(false);

  const sigCanvas = useRef<SignatureViewRef>(null);

  const [formData, setFormData] = useState({
    instructions: '',
    work_category: '',
    report_to: '',
    assign_to: '',
    remarks: '',
    work_status: 'Pending'
  });

  const [images, setImages] = useState({
    image_1: null as any,
    image_2: null as any,
    image_3: null as any,
    signature: null as any
  });

  const [imagePreviews, setImagePreviews] = useState({
    image_1: '',
    image_2: '',
    image_3: '',
    signature: ''
  });

  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isDrawingSignature, setIsDrawingSignature] = useState(false);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const isAssignedToMe = useMemo(() => {
    const assignTo = formData.assign_to?.toLowerCase().trim();
    if (!assignTo) return false;
    return (userEmail?.toLowerCase().trim() === assignTo) || (userName?.toLowerCase().trim() === assignTo);
  }, [formData.assign_to, userEmail, userName]);

  useEffect(() => {
    const init = async () => {
      const palette = await settingsColorPaletteService.getActive();
      if (palette) setColorPalette(palette);

      const authData = await AsyncStorage.getItem('authData');
      if (authData) {
        try {
          const parsed = JSON.parse(authData);
          setUserRole(parsed.role_id || parsed.roleId || null);
          setUserEmail(parsed.email_address || parsed.email || null);
          setUserName(parsed.full_name || `${parsed.first_name || ''} ${parsed.last_name || ''}`.trim() || parsed.username || null);
        } catch (e) {
          console.error('Failed to parse authData', e);
        }
      }
    };
    if (isOpen) init();
  }, [isOpen]);

  useEffect(() => {
    const fetchDropdownData = async () => {
      if (!isOpen) return;

      try {
        const rolesToFetch = [1, 2, 4, 5, 6];
        const allUsers: User[] = [];

        for (const roleId of rolesToFetch) {
          try {
            const response = await userService.getUsersByRoleId(roleId);
            if (response.success && Array.isArray(response.data)) {
              response.data.forEach((user: any) => {
                const email = user.email_address || user.email || '';
                const name = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;
                if (email && name) {
                  allUsers.push({ email, name });
                }
              });
            }
          } catch (err) {
            console.error(`Failed to fetch users for role ${roleId}`, err);
          }
        }

        // Remove duplicates by email
        const uniqueUsers = Array.from(new Map(allUsers.map(u => [u.email.toLowerCase(), u])).values());
        setAssignees(uniqueUsers);
      } catch (error) {
        console.error('Error in fetchDropdownData:', error);
      }
    };
    const fetchCategories = async () => {
      if (!isOpen) return;
      try {
        const response = await authFetch(`${API_BASE_URL}/work-categories`);
        const result = await response.json();
        if (result.success && result.data) {
          setCategories(result.data);
        }
      } catch (error) {
        setCategories([]);
      }
    };
    fetchDropdownData();
    fetchCategories();

    if (isOpen) {
      if (isEditMode && workOrder) {
        hasInitializedEditRef.current = false;
      } else {
        setFormData({
          instructions: '',
          work_category: '',
          report_to: '',
          assign_to: '',
          remarks: '',
          work_status: 'Pending'
        });
        hasInitializedEditRef.current = false;
      }
      setImagePreviews({ image_1: '', image_2: '', image_3: '', signature: '' });
      setImages({ image_1: null, image_2: null, image_3: null, signature: null });
    }
  }, [isOpen, isEditMode, workOrder]);

  // Handle prepopulating Assign To dynamically after assignees resolve
  useEffect(() => {
    if (isOpen && isEditMode && workOrder && !hasInitializedEditRef.current) {
      hasInitializedEditRef.current = true;
      setFormData({
        instructions: workOrder.instructions || '',
        work_category: workOrder.work_category || '',
        report_to: workOrder.report_to || '',
        assign_to: workOrder.assign_to || '',
        remarks: workOrder.remarks || '',
        work_status: workOrder.work_status || 'Pending'
      });
    }
  }, [isOpen, isEditMode, workOrder]);

  const handleInputChange = useCallback((field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => {
      if (prev[field]) {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      }
      return prev;
    });
  }, []);

  const handleImageUpload = useCallback((field: string, file: any) => {
    if (file) {
      setImages(prev => ({ ...prev, [field]: file }));
      setImagePreviews(prev => ({ ...prev, [field]: file.uri }));
    } else {
      setImages(prev => ({ ...prev, [field]: null }));
      setImagePreviews(prev => ({ ...prev, [field]: '' }));
    }
    setErrors(prev => {
      if (prev[field]) {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      }
      return prev;
    });
  }, []);

  const handleSignature = useCallback(async (signature: string) => {
    setIsDrawingSignature(false);
    setScrollEnabled(true);
    try {
      const path = `${ExpoFileSystem.cacheDirectory}signature_${Date.now()}.png`;
      const base64Code = signature.replace('data:image/png;base64,', '');
      await ExpoFileSystem.writeAsStringAsync(path, base64Code, {
        encoding: ExpoFileSystem.EncodingType.Base64,
      });

      const sigFile = {
        uri: path,
        name: `signature_${Date.now()}.png`,
        type: 'image/png',
        size: base64Code.length * 0.75
      };
      setImages(prev => ({ ...prev, signature: sigFile }));
      setImagePreviews(prev => ({ ...prev, signature: path }));
    } catch (e) {
      console.error('Error handling signature:', e);
      Alert.alert('Error', 'Failed to save signature');
    }
  }, []);

  const validateForm = useCallback(() => {
    const newErrors: Record<string, string> = {};
    const requiredFields: (keyof typeof formData)[] = ['instructions', 'work_category', 'report_to', 'assign_to'];

    requiredFields.forEach(field => {
      if (!formData[field]?.trim()) {
        newErrors[field] = `${field.replace('_', ' ')} is required`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSave = useCallback(async () => {
    if (!validateForm()) {
      Alert.alert('Missing Info', 'Please fill in all required fields.');
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => prev >= 90 ? prev : prev + 5);
    }, 200);

    try {
      const authData = await AsyncStorage.getItem('authData');
      const parsedUser = authData ? JSON.parse(authData) : null;
      const currentUserEmail = parsedUser ? (parsedUser.email_address || parsedUser.email || 'system') : 'system';

      const url = isEditMode && workOrder?.id
        ? `/work-orders/${workOrder.id}`
        : `/work-orders`;

      // Step 1: Save the core data first
      const formDataToSend: Record<string, any> = {
        instructions: formData.instructions,
        report_to: formData.report_to,
        assign_to: formData.assign_to,
        remarks: formData.remarks,
        work_category: formData.work_category,
        requested_by: currentUserEmail,
        updated_by: currentUserEmail,
      };

      const finalStatus = ((userRole !== 1 && userRole !== 7) || isEditMode || (userEmail && formData.assign_to === userEmail)) 
        ? formData.work_status 
        : 'Pending';

      formDataToSend.work_status = finalStatus;

      const manilaNow = dayjs().tz('Asia/Manila').add(8, 'hour').format('YYYY-MM-DD HH:mm:ss');
      if (finalStatus === 'In Progress' && !workOrder?.start_time) {
        formDataToSend.start_time = manilaNow;
      } else if (['Completed', 'Cancelled', 'Failed'].includes(finalStatus)) {
        if (!workOrder?.end_time) {
          formDataToSend.end_time = manilaNow;
        }
      }

      if (isEditMode && workOrder?.id) {
        formDataToSend._method = 'PUT';
      }

      console.log('[SAVE DEBUG] Step 1: Saving core data to:', url);
      const response = await apiClient.post(url, formDataToSend);
      const savedWorkOrder = response.data.data;
      const workOrderId = savedWorkOrder?.id;

      if (!workOrderId) {
        throw new Error('Failed to retrieve Work Order ID after save.');
      }

      // Step 2: Upload images if any exist
      const hasImages = !!(images.image_1 || images.image_2 || images.image_3 || images.signature);

      if (hasImages) {
        setLoadingPercentage(40);
        console.log('[SAVE DEBUG] Step 2: Preparing images for upload...');

        const imageFormData = new FormData();
        imageFormData.append('folder_name', `WorkOrder_${workOrderId}`);

        const appendFile = (field: string, file: any) => {
          if (file && file.uri) {
            const name = file.name || `${field}_${Date.now()}.jpg`;
            imageFormData.append(field, {
              uri: file.uri,
              name: name,
              type: file.type || 'image/jpeg'
            } as any, name); // Using 3 arguments for better RN compatibility
          }
        };

        appendFile('image_1', images.image_1);
        appendFile('image_2', images.image_2);
        appendFile('image_3', images.image_3);
        appendFile('signature', images.signature);

        try {
          console.log(`[SAVE DEBUG] Sending images to: /work-orders/${workOrderId}/upload-images`);
          const uploadResponse = await apiClient.post(`/work-orders/${workOrderId}/upload-images`, imageFormData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            }
          });

          if (uploadResponse.data.success) {
            console.log('[SAVE DEBUG] Images uploaded successfully');
          }
        } catch (uploadError: any) {
          console.error('[SAVE ERROR] Image Upload failed:', uploadError.response?.data || uploadError.message);
          Alert.alert('Warning', 'Work order saved, but some images failed to upload.');
        }
      }

      if (progressInterval) clearInterval(progressInterval);
      setLoadingPercentage(100);

      setTimeout(() => {
        if (onSave) onSave();
        if (onRefresh) onRefresh();
        onClose();
      }, 500);

    } catch (error: any) {
      if (progressInterval) clearInterval(progressInterval);
      Alert.alert('Error', error.response?.data?.message || error.message || 'An error occurred');
    } finally {
      setTimeout(() => {
        setLoading(false);
        setLoadingPercentage(0);
      }, 800);
    }
  }, [formData, images, isEditMode, workOrder, userRole, userEmail, onClose, onSave, onRefresh]);


  // Render Helpers
  const renderError = useCallback((field: string) => {
    if (!errors[field]) return null;
    return (
      <View style={st.errorContainer}>
        <View style={[st.errorIcon, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}>
          <Text style={st.errorIconText}>!</Text>
        </View>
        <Text style={[st.errorText, { color: colorPalette?.primary || '#7c3aed' }]}>{errors[field]}</Text>
      </View>
    );
  }, [errors, colorPalette]);

  return (
    <Modal visible={isOpen} animationType="slide" transparent={true} onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={st.modalOverlay}>
          <View style={[st.modalContainer, { backgroundColor: '#ffffff' }]}>
            {/* Loading Overlay Removed */}

            {/* Header */}
            <View style={[st.header, {
              backgroundColor: '#ffffff',
              borderBottomColor: '#e5e7eb',
            }]}>
              <Text style={[st.headerTitle, { color: '#111827' }]}>
                {isEditMode ? 'Edit Work Order' : 'New Work Order'}
              </Text>
              <View style={st.headerActions}>
                <TouchableOpacity
                  onPress={loading ? undefined : onClose}
                  disabled={loading}
                  style={[st.cancelButton, {
                    borderColor: '#d1d5db',
                    opacity: loading ? 0.5 : 1
                  }]}
                >
                  <Text style={[st.cancelButtonText, { color: '#374151' }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={loading}
                  style={[st.submitButton, {
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    opacity: loading ? 0.5 : 1
                  }]}
                >
                  <Text style={st.submitButtonText}>{loading ? 'Saving..' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              scrollEnabled={scrollEnabled}
              style={st.scrollView}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={st.scrollViewContent}
            >
              <View style={st.inputGroup}>
                <Text style={[st.label, { color: '#374151' }]}>Instructions <Text style={st.required}>*</Text></Text>
                <TextInput
                  value={formData.instructions}
                  onChangeText={(text) => handleInputChange('instructions', text)}
                  placeholder="Enter detailed instructions"
                  placeholderTextColor="#9ca3af"
                  editable={!isAssignedToMe}
                  style={[st.textInput, {
                    borderColor: errors.instructions ? '#ef4444' : '#e5e7eb',
                    backgroundColor: isAssignedToMe ? '#f3f4f6' : '#ffffff',
                    color: isAssignedToMe ? '#6b7280' : '#111827',
                    opacity: isAssignedToMe ? 0.8 : 1
                  }]}
                />
                {renderError('instructions')}
              </View>

              <View style={st.inputGroup}>
                <Text style={[st.label, { color: '#374151' }]}>Work Category <Text style={st.required}>*</Text></Text>
                <View style={[st.pickerContainer, {
                  backgroundColor: isAssignedToMe ? '#f3f4f6' : '#ffffff',
                  borderColor: errors.work_category ? '#ef4444' : '#e5e7eb',
                  opacity: isAssignedToMe ? 0.8 : 1
                }]}>
                  <Picker
                    selectedValue={formData.work_category}
                    onValueChange={(val) => handleInputChange('work_category', val)}
                    style={{ color: isAssignedToMe ? '#6b7280' : 'black' }}
                    dropdownIconColor="black"
                    enabled={!isAssignedToMe}
                  >
                    <Picker.Item label={formData.work_category || "Select Category"} value={formData.work_category || ""} />
                    {categories.filter(c => c.category !== formData.work_category).map(c => (
                      <Picker.Item key={c.id} label={c.category} value={c.category} />
                    ))}
                  </Picker>
                </View>
                {renderError('work_category')}
              </View>

              <View style={st.inputGroup}>
                <Text style={[st.label, { color: '#374151' }]}>Report To <Text style={st.required}>*</Text></Text>
                <TextInput
                  value={formData.report_to}
                  onChangeText={(text) => handleInputChange('report_to', text)}
                  placeholder="Person name"
                  placeholderTextColor="#9ca3af"
                  editable={!isAssignedToMe}
                  style={[st.textInput, {
                    borderColor: errors.report_to ? '#ef4444' : '#e5e7eb',
                    backgroundColor: isAssignedToMe ? '#f3f4f6' : '#ffffff',
                    color: isAssignedToMe ? '#6b7280' : '#111827',
                    opacity: isAssignedToMe ? 0.8 : 1
                  }]}
                />
                {renderError('report_to')}
              </View>

              <View style={st.inputGroup}>
                <Text style={[st.label, { color: '#374151' }]}>Assign To <Text style={st.required}>*</Text></Text>
                <View style={[st.pickerContainer, {
                  backgroundColor: isAssignedToMe ? '#f3f4f6' : '#ffffff',
                  borderColor: errors.assign_to ? '#ef4444' : '#e5e7eb',
                  opacity: isAssignedToMe ? 0.8 : 1
                }]}>
                  <Picker
                    selectedValue={formData.assign_to}
                    onValueChange={(val) => handleInputChange('assign_to', val)}
                    style={{ color: isAssignedToMe ? '#6b7280' : 'black' }}
                    dropdownIconColor="black"
                    enabled={!isAssignedToMe}
                  >
                    <Picker.Item label="Select User" value="" />
                    {assignees.map(t => (
                      <Picker.Item key={t.email} label={t.email} value={t.email} />
                    ))}
                    {formData.assign_to && !assignees.some(t => t.email === formData.assign_to) && (
                      <Picker.Item label={formData.assign_to} value={formData.assign_to} />
                    )}
                  </Picker>
                </View>
                {renderError('assign_to')}
              </View>

              {((userRole !== 1 && userRole !== 7) || isEditMode || (userEmail && formData.assign_to === userEmail)) && (
                <View style={st.inputGroup}>
                  <Text style={[st.label, { color: '#374151' }]}>Work Status</Text>
                  <View style={[st.pickerContainer, {
                    backgroundColor: '#ffffff',
                    borderColor: '#e5e7eb'
                  }]}>
                    <Picker
                      selectedValue={formData.work_status}
                      onValueChange={(val) => handleInputChange('work_status', val)}
                      style={{ color: 'black' }}
                      dropdownIconColor="black"
                    >
                      <Picker.Item label="Pending" value="Pending" />
                      <Picker.Item label="In Progress" value="In Progress" />
                      <Picker.Item label="Completed" value="Completed" />
                      <Picker.Item label="Cancelled" value="Cancelled" />
                    </Picker>
                  </View>
                </View>
              )}

              <View style={st.inputGroup}>
                <Text style={[st.label, { color: '#374151' }]}>Remarks</Text>
                <TextInput
                  value={formData.remarks}
                  onChangeText={(text) => handleInputChange('remarks', text)}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  placeholder="Internal notes..."
                  placeholderTextColor="#9ca3af"
                  style={[st.textInput, st.textArea, {
                    borderColor: '#e5e7eb',
                    backgroundColor: '#ffffff',
                    color: '#111827'
                  }]}
                />
              </View>

              {(isEditMode || (userEmail && formData.assign_to === userEmail)) && (
                <>
                  {(['image_1', 'image_2', 'image_3'] as const).map((field, index) => (
                    <ImagePreview
                      key={field}
                      label={`Project Photo ${index + 1}`}
                      imageUrl={imagePreviews[field]}
                      onUpload={(file) => handleImageUpload(field, file)}
                      error={errors[field]}
                      isDarkMode={isDarkMode}
                      colorPrimary={colorPalette?.primary}
                    />
                  ))}

                  <View style={st.inputGroup}>
                    <Text style={[st.label, { color: '#374151' }]}>Client Signature</Text>
                    {!isDrawingSignature ? (
                      <View>
                        <Pressable
                          onPress={() => setIsDrawingSignature(true)}
                          style={[st.signatureContainer, {
                            borderColor: errors.signature ? '#ef4444' : '#e5e7eb',
                            backgroundColor: '#f9fafb'
                          }]}
                        >
                          {imagePreviews.signature ? (
                            <Image
                              source={{ uri: imagePreviews.signature }}
                              style={{ width: '100%', height: '100%', resizeMode: 'contain' }}
                            />
                          ) : (
                            <View style={st.signaturePlaceholder}>
                              <View style={[st.signatureIconCircle, { backgroundColor: (colorPalette?.primary || '#7c3aed') + '20' }]}>
                                <Camera size={24} color={colorPalette?.primary || '#7c3aed'} />
                              </View>
                              <Text style={{ color: '#6b7280' }}>Tap to Draw Signature</Text>
                            </View>
                          )}
                        </Pressable>
                        {imagePreviews.signature && (
                          <View style={st.signatureActions}>
                            <Pressable
                              onPress={() => {
                                setImagePreviews(prev => ({ ...prev, signature: '' }));
                                setImages(prev => ({ ...prev, signature: null }));
                              }}
                              style={st.removeButton}
                            >
                              <X size={16} color="#ef4444" />
                              <Text style={st.removeButtonText}>Remove</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => setIsDrawingSignature(true)}
                              style={[st.redrawButton, { backgroundColor: colorPalette?.primary || '#7c3aed' }]}
                            >
                              <Text style={st.redrawButtonText}>Redraw</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    ) : (
                      <View style={[st.signatureCanvasContainer, { borderColor: '#d1d5db' }]}>
                        <SignatureScreen
                          ref={sigCanvas}
                          onOK={handleSignature}
                          onBegin={() => setScrollEnabled(false)}
                          onEnd={() => setScrollEnabled(true)}
                          onEmpty={() => Alert.alert('Empty', 'Please provide a signature before saving')}
                          webStyle={signatureStyle}
                          autoClear={false}
                          descriptionText="Sign above"
                          clearText="Clear"
                          confirmText="Save"
                        />
                        <TouchableOpacity
                          onPress={() => {
                            setIsDrawingSignature(false);
                            setScrollEnabled(true);
                          }}
                          style={st.signatureCloseButton}
                        >
                          <X size={20} color="#000" />
                        </TouchableOpacity>
                      </View>
                    )}
                    {errors.signature && (
                      <Text style={[st.errorText, { color: '#ef4444', marginTop: 4 }]}>{errors.signature}</Text>
                    )}
                  </View>
                </>
              )}
              <View style={st.bottomSpacer} />
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const signatureStyle = `
  .m-signature-pad--footer { display: flex; flex-direction: row; justify-content: space-between; margin-top: 10px; }
  .m-signature-pad--body { border: 1px solid #ccc; }
`;

const st = StyleSheet.create({
  container: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    height: '90%',
    width: '100%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
  },
  loadingTitle: {
    marginTop: 16,
    fontSize: 24,
    fontWeight: 'bold',
  },
  loadingSubTitle: {
    marginTop: 8,
    fontSize: 14,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cancelButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 8,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  submitButton: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 8,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    padding: 24,
    paddingBottom: 40,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 8,
  },
  required: {
    color: '#ef4444',
  },
  textInput: {
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
    fontSize: 15,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  pickerContainer: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  flexHalf: {
    flex: 1,
  },
  dashedBox: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 24,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relativeFull: {
    position: 'relative',
    width: '100%',
    height: '100%',
  },
  previewImg: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  deleteBtn: {
    position: 'absolute',
    top: -12,
    right: -12,
    backgroundColor: '#ef4444',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  uploadActions: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  uploadBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 100,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  uploadBtnText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  errorIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  errorIconText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 12,
  },
  sigWrapper: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    height: 300,
    backgroundColor: '#ffffff',
  },
  sigPreview: {
    flex: 1,
    position: 'relative',
  },
  sigImg: {
    width: '100%',
    height: '100%',
  },
  sigTrashBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: '#EF4444',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  flexOne: {
    flex: 1,
  },
  hintText: {
    fontSize: 12,
    marginTop: 8,
    fontStyle: 'italic',
  },
  bottomSpacer: {
    height: 40,
  },
  signatureContainer: {
    height: 192,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  signaturePlaceholder: {
    alignItems: 'center',
  },
  signatureIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  signatureActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#ef4444',
    fontSize: 12,
    marginLeft: 4,
  },
  redrawButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  redrawButtonText: {
    color: '#ffffff',
    fontSize: 12,
  },
  signatureCanvasContainer: {
    height: 320,
    borderWidth: 1,
    backgroundColor: '#ffffff',
    marginBottom: 8,
    overflow: 'hidden',
    borderRadius: 16,
  },
  signatureCloseButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    padding: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 9999,
    zIndex: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  }
});

export default AssignWorkOrderModal;
