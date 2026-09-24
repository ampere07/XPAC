import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, Eraser, Camera, Search, ChevronDown, ClipboardCheck, UserPlus, Info } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import { API_BASE_URL } from '../config/api';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import ModalUITemplate from './ui-modal/ModalUITemplate';

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
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [technicians, setTechnicians] = useState<User[]>([]);
  const [assignees, setAssignees] = useState<User[]>([]);
  const [categories, setCategories] = useState<{ id: number, category: string }[]>([]);
  const [userRole, setUserRole] = useState<number | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string>('');

  const sigCanvas = useRef<SignatureCanvas>(null);

  const [formData, setFormData] = useState({
    instructions: '',
    work_category: '',
    report_to: '',
    assign_to: '',
    remarks: '',
    work_status: 'Pending'
  });

  const [images, setImages] = useState({
    image_1: null as File | null,
    image_2: null as File | null,
    image_3: null as File | null,
    signature: null as File | null
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

  const [globalModal, setGlobalModal] = useState<{
    isOpen: boolean;
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
    title: string;
    message: string;
    percentage?: number;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: 'loading',
    title: '',
    message: ''
  });

  const [assignToSearch, setAssignToSearch] = useState('');
  const [isAssignToOpen, setIsAssignToOpen] = useState(false);

  const showGlobalModal = (
    type: 'loading' | 'success' | 'error' | 'confirm' | 'warning',
    title: string,
    message: string,
    onConfirm?: () => void,
    percentage?: number
  ) => {
    setGlobalModal({
      isOpen: true,
      type,
      title,
      message,
      onConfirm,
      percentage
    });
  };

  const closeGlobalModal = () => {
    setGlobalModal(prev => ({ ...prev, isOpen: false }));
  };

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') !== 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    setIsDarkMode(localStorage.getItem('theme') !== 'light');
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchPalette = async () => {
      const palette = await settingsColorPaletteService.getActive();
      setColorPalette(palette);
    };
    fetchPalette();

    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const parsed = JSON.parse(authData);
        setUserRole(parsed.role_id || parsed.roleId || null);
        setCurrentUserEmail(parsed.email_address || parsed.email || '');
      } catch (e) { }
    }
  }, []);

  useEffect(() => {
    const fetchTechnicians = async () => {
      if (!isOpen) return;
      try {
        const response = await userService.getUsersByRoleId([1, 2, 4, 5, 6, 7]);
        if (response.success && response.data) {
          const list = response.data
            .map((user: any) => ({
              email: user.email_address || user.email || '',
              name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username
            }))
            .filter((t: User) => t.name && t.email);
          setAssignees(list);
        }
      } catch (error) {
        setAssignees([]);
      }
    };
    const fetchCategories = async () => {
      if (!isOpen) return;
      try {
        const response = await fetch(`${API_BASE_URL}/work-categories`);
        const result = await response.json();
        if (result.success && result.data) {
          setCategories(result.data);
        }
      } catch (error) {
        setCategories([]);
      }
    };
    fetchTechnicians();
    fetchCategories();

    const convertGDriveUrl = (url?: string | null): string => {
      if (!url) return '';
      if (typeof url !== 'string') return '';
      if (url.includes('drive.google.com/file/d/')) {
        const parts = url.split('/d/');
        if (parts.length > 1) {
          const fileId = parts[1].split('/')[0];
          return `https://drive.google.com/uc?export=view&id=${fileId}`;
        }
      }
      return url;
    };

    if (isOpen) {
      if (isEditMode && workOrder) {
        setFormData({
          instructions: workOrder.instructions || '',
          work_category: workOrder.work_category || '',
          report_to: workOrder.report_to || '',
          assign_to: workOrder.assign_to || '',
          remarks: workOrder.remarks || '',
          work_status: workOrder.work_status || 'Pending'
        });
        setImagePreviews({
          image_1: convertGDriveUrl(workOrder.image_1),
          image_2: convertGDriveUrl(workOrder.image_2),
          image_3: convertGDriveUrl(workOrder.image_3),
          signature: convertGDriveUrl(workOrder.signature)
        });
      } else {
        setFormData({
          instructions: '',
          work_category: '',
          report_to: '',
          assign_to: '',
          remarks: '',
          work_status: 'Pending'
        });
        setImagePreviews({
          image_1: '',
          image_2: '',
          image_3: '',
          signature: ''
        });
      }
      setAssignToSearch('');
      setIsAssignToOpen(false);
    }
  }, [isOpen, isEditMode, workOrder]);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const handleImageUpload = (field: string, file: File) => {
    if (file) {
      setImages(prev => ({ ...prev, [field]: file }));
      setImagePreviews(prev => ({ ...prev, [field]: URL.createObjectURL(file) }));
    }
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.instructions.trim()) newErrors.instructions = 'Instructions required';
    if (!formData.work_category) newErrors.work_category = 'Category required';
    if (!formData.report_to.trim()) newErrors.report_to = 'Report To required';
    if (!formData.assign_to.trim()) newErrors.assign_to = 'Assigned to required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      showGlobalModal('warning', 'Validation Error', 'Please complete all required fields.');
      return;
    }

    setLoading(true);
    showGlobalModal('loading', 'Processing', isEditMode ? 'Updating work order...' : 'Creating work order...', undefined, 15);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 95) return 95;
        return prev + 5;
      });
    }, 200);

    try {
      const authData = localStorage.getItem('authData');
      const parsedUser = authData ? JSON.parse(authData) : null;
      const currentUserEmail = parsedUser ? (parsedUser.email_address || parsedUser.email || 'system') : 'system';

      let signatureFile = images.signature;

      if (!signatureFile && sigCanvas.current && !sigCanvas.current.isEmpty()) {
        const dataUrl = sigCanvas.current.getTrimmedCanvas().toDataURL('image/png');
        const blob = await (await fetch(dataUrl)).blob();
        signatureFile = new File([blob], 'signature.png', { type: 'image/png' });
      }

      const submitData = new FormData();
      submitData.append('instructions', formData.instructions);
      submitData.append('work_category', formData.work_category);
      submitData.append('report_to', formData.report_to);
      submitData.append('assign_to', formData.assign_to);
      submitData.append('remarks', formData.remarks);
      submitData.append('requested_by', currentUserEmail);

      if ((userRole !== 1 && userRole !== 7) || isEditMode) {
        submitData.append('work_status', formData.work_status);
      } else {
        submitData.append('work_status', 'Pending');
      }

      if (images.image_1) submitData.append('image_1', images.image_1);
      if (images.image_2) submitData.append('image_2', images.image_2);
      if (images.image_3) submitData.append('image_3', images.image_3);
      if (signatureFile) submitData.append('signature', signatureFile);

      if (isEditMode && workOrder?.id) {
        submitData.append('_method', 'PUT');
      }

      const url = isEditMode && workOrder?.id
        ? `${API_BASE_URL}/work-orders/${workOrder.id}`
        : `${API_BASE_URL}/work-orders`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: submitData
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || Object.values(data.errors || {}).join(', ') || 'Failed to process work order');
      }

      clearInterval(progressInterval);
      showGlobalModal('success', 'Success', isEditMode ? 'Work order updated successfully.' : 'Work order created successfully.', () => {
        onSave();
        if (onRefresh) onRefresh();
        onClose();
        closeGlobalModal();
      });

    } catch (error: any) {
      clearInterval(progressInterval);
      showGlobalModal('error', 'Error', error.message || 'Failed to process work order.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  const ImageUploadPreview = ({ field, label }: { field: 'image_1' | 'image_2' | 'image_3', label: string }) => (
    <div className="space-y-2">
      <label className={`block text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {label}
      </label>
      <div className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-all duration-300 group ${isDarkMode ? 'border-gray-700 bg-gray-800/50 hover:border-gray-600' : 'border-gray-200 bg-gray-50 hover:border-gray-300'}`}>
        {imagePreviews[field] ? (
          <div className="relative overflow-hidden rounded border border-gray-700">
            <img src={imagePreviews[field]} alt={label} className="w-full h-32 object-cover" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <button
                onClick={() => {
                  setImagePreviews(prev => ({ ...prev, [field]: '' }));
                  setImages(prev => ({ ...prev, [field]: null }));
                }}
                className="bg-red-500 text-white p-2 rounded-full hover:scale-110 active:scale-90 transition-all shadow-lg"
              >
                <Eraser size={16} />
              </button>
            </div>
          </div>
        ) : (
          <label className="cursor-pointer block py-4">
            <input type="file" accept="image/*" className="hidden" onChange={(e) => {
              if (e.target.files?.[0]) handleImageUpload(field, e.target.files[0]);
            }} />
            <div className="flex flex-col items-center gap-2">
              <Camera size={24} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
              <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Capture Image</span>
            </div>
          </label>
        )}
      </div>
    </div>
  );

  return (
    <>
      <ModalUITemplate
        isOpen={isOpen}
        onClose={handleClose}
        title={isEditMode ? 'Edit Work Order' : 'Assign Work Order'}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        loading={loading}
        loadingPercentage={loadingPercentage}
        maxWidth="max-w-3xl"
        primaryAction={{
          label: isEditMode ? 'Update Work Order' : 'Create Work Order',
          onClick: handleSave,
          disabled: loading
        }}
        secondaryActionLabel="Cancel"
        alertModal={{
          isOpen: globalModal.isOpen,
          type: globalModal.type as any,
          title: globalModal.title,
          message: globalModal.message,
          onConfirm: globalModal.onConfirm || closeGlobalModal,
          onCancel: closeGlobalModal
        }}
      >
        {(() => {
          const isAssignedToCurrentUser = Boolean(isEditMode && formData.assign_to && currentUserEmail && formData.assign_to.toLowerCase() === currentUserEmail.toLowerCase());

          return (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Work Category<span className="text-red-500 ml-1">*</span></label>
                  <div className="relative">
                    <select
                      value={formData.work_category}
                      onChange={(e) => handleInputChange('work_category', e.target.value)}
                      disabled={isAssignedToCurrentUser}
                      className={`w-full px-3 py-2 border rounded appearance-none transition-all duration-300 focus:outline-none focus:border-orange-500 ${errors.work_category ? 'border-red-500' : ''} ${isAssignedToCurrentUser ? 'opacity-50 cursor-not-allowed' : ''} ${isDarkMode
                        ? 'bg-gray-800 border-gray-700 text-white'
                        : 'bg-white border-gray-300 text-gray-900'}`}
                    >
                      <option value="">Select Category</option>
                      {categories.map(c => <option key={c.id} value={c.category}>{c.category}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30" size={16} />
                  </div>
                  {errors.work_category && <p className="mt-1 text-red-500 text-xs">{errors.work_category}</p>}
                </div>

                {((userRole !== 1 && userRole !== 7) || isEditMode) && (
                  <div>
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Work Status</label>
                    <div className="relative">
                      <select
                        value={formData.work_status}
                        onChange={(e) => handleInputChange('work_status', e.target.value)}
                        className={`w-full px-3 py-2 border rounded appearance-none transition-all duration-300 focus:outline-none focus:border-orange-500 ${isDarkMode
                          ? 'bg-gray-800 border-gray-700 text-white'
                          : 'bg-white border-gray-300 text-gray-900'}`}
                      >
                        <option value="Pending">Pending</option>
                        <option value="In Progress">In Progress</option>
                        <option value="Completed">Completed</option>
                        <option value="Failed">Failed</option>
                        <option value="Cancelled">Cancelled</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30" size={16} />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Instructions<span className="text-red-500 ml-1">*</span></label>
                <textarea
                  value={formData.instructions}
                  onChange={(e) => handleInputChange('instructions', e.target.value)}
                  rows={4}
                  disabled={isAssignedToCurrentUser}
                  className={`w-full px-3 py-2 border rounded transition-all duration-300 focus:outline-none focus:border-orange-500 resize-none ${errors.instructions ? 'border-red-500' : isAssignedToCurrentUser ? 'opacity-50' : (isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900')}`}
                  placeholder="Enter specific action steps..."
                />
                {errors.instructions && <p className="mt-1 text-red-500 text-xs">{errors.instructions}</p>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Report To<span className="text-red-500 ml-1">*</span></label>
                  <input
                    type="text"
                    value={formData.report_to}
                    onChange={(e) => handleInputChange('report_to', e.target.value)}
                    disabled={isAssignedToCurrentUser}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.report_to ? 'border-red-500' : (isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900')}`}
                    placeholder="Reporting Person/Dept"
                  />
                  {errors.report_to && <p className="mt-1 text-red-500 text-xs">{errors.report_to}</p>}
                </div>

                <div>
                  <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Assign To<span className="text-red-500 ml-1">*</span></label>
                  <div className="relative">
                    <div className={`flex items-center px-3 py-2 border rounded focus-within:border-orange-500 ${isAssignedToCurrentUser ? 'opacity-50' : (isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300')}`}>
                      <UserPlus size={16} className="mr-2 opacity-30" />
                      <input
                        type="text"
                        placeholder="Search Personnel..."
                        value={isAssignToOpen ? assignToSearch : (assignees.find(a => a.email === formData.assign_to)?.name || formData.assign_to || assignToSearch)}
                        onChange={(e) => {
                          setAssignToSearch(e.target.value);
                          if (!isAssignToOpen) setIsAssignToOpen(true);
                        }}
                        onFocus={() => !isAssignedToCurrentUser && setIsAssignToOpen(true)}
                        disabled={isAssignedToCurrentUser}
                        className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                      />
                      {!isAssignedToCurrentUser && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isAssignToOpen) {
                              setIsAssignToOpen(false);
                              setAssignToSearch('');
                            } else {
                              handleInputChange('assign_to', '');
                              setAssignToSearch('');
                            }
                          }}
                          className="ml-1"
                        >
                          {isAssignToOpen || formData.assign_to ? <Eraser size={14} className="opacity-40" /> : <ChevronDown size={14} className="opacity-40" />}
                        </button>
                      )}
                    </div>

                    {isAssignToOpen && !isAssignedToCurrentUser && (
                      <div className={`absolute left-0 right-0 top-full mt-1 z-[6000] rounded shadow-lg border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                        <div className="max-h-60 overflow-y-auto custom-scrollbar">
                          {assignees
                            .filter(a => a.name.toLowerCase().includes(assignToSearch.toLowerCase()) || a.email.toLowerCase().includes(assignToSearch.toLowerCase()))
                            .map((assignee) => (
                              <div
                                key={assignee.email}
                                className={`px-3 py-2 cursor-pointer transition-colors flex flex-col ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${formData.assign_to === assignee.email ? (isDarkMode ? 'bg-gray-700 text-orange-400' : 'bg-gray-50 text-orange-600') : ''}`}
                                onClick={() => {
                                  handleInputChange('assign_to', assignee.email);
                                  setAssignToSearch('');
                                  setIsAssignToOpen(false);
                                }}
                              >
                                <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{assignee.name}</span>
                                <span className={`text-xs opacity-50 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{assignee.email}</span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {errors.assign_to && <p className="mt-1 text-red-500 text-xs">{errors.assign_to}</p>}
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Remarks</label>
                <textarea
                  value={formData.remarks}
                  onChange={(e) => handleInputChange('remarks', e.target.value)}
                  rows={4}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                  placeholder="Additional observations..."
                />
              </div>

              {isEditMode && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <ImageUploadPreview field="image_1" label="Image 1" />
                    <ImageUploadPreview field="image_2" label="Image 2" />
                    <ImageUploadPreview field="image_3" label="Image 3" />
                  </div>

                  <div className="space-y-2">
                    <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Technician Signature
                    </label>
                    <div className={`border rounded overflow-hidden relative w-full h-60 transition-all duration-300 ${isDarkMode ? 'bg-white border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                      {imagePreviews.signature ? (
                        <div className="absolute inset-0 flex items-center justify-center p-6">
                          <img src={imagePreviews.signature} alt="Signature Preview" className="max-h-full max-w-full drop-shadow-xl" />
                          <button
                            onClick={() => {
                              setImagePreviews(prev => ({ ...prev, signature: '' }));
                              setImages(prev => ({ ...prev, signature: null }));
                            }}
                            className="absolute top-4 right-4 bg-red-500 text-white p-2 rounded-full shadow-lg hover:scale-110 active:scale-90 transition-all"
                          >
                            <Eraser size={16} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <SignatureCanvas
                            ref={sigCanvas}
                            penColor="black"
                            dotSize={1}
                            minWidth={2}
                            onEnd={() => { if (errors.signature) setErrors(prev => ({ ...prev, signature: '' })); }}
                            canvasProps={{ className: 'w-full h-full cursor-crosshair' }}
                          />
                          <div className="absolute top-4 right-4 flex gap-2">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleImageUpload('signature', file);
                              }}
                              className="hidden"
                              id="sigUploadInput"
                            />
                            <label
                              htmlFor="sigUploadInput"
                              className={`p-2 rounded shadow transition-all cursor-pointer bg-orange-500 text-white`}
                            >
                              <Camera size={16} />
                            </label>
                            <button
                              type="button"
                              onClick={() => sigCanvas.current?.clear()}
                              className={`p-2 rounded shadow transition-all ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-white text-gray-600 border'}`}
                            >
                              <Eraser size={16} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </ModalUITemplate>
    </>
  );
};

export default AssignWorkOrderModal;
