import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronDown, CheckCircle, Loader2 } from 'lucide-react';
import * as serviceOrderService from '../services/serviceOrderService';
import * as concernService from '../services/concernService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface SORequestFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  customerData?: {
    accountNo: string;
    dateInstalled: string;
    fullName: string;
    contactNumber: string;
    plan: string;
    username: string;
    emailAddress?: string;
  };
}

const SORequestFormModal: React.FC<SORequestFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  customerData
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const getUserEmail = () => {
    try {
      const authData = localStorage.getItem('authData');
      if (authData) {
        const userData = JSON.parse(authData);
        const email = userData.email || userData.user?.email;
        if (email) return email;
      }
      throw new Error('User email not found. Please log in again.');
    } catch (error) {
      console.error('Error getting user email:', error);
      if (error instanceof Error && error.message.includes('User email not found')) {
        throw error;
      }
      throw new Error('Failed to resolve user email.');
    }
  };

  const generateTicketId = () => {
    const randomDigits = Math.floor(1000000 + Math.random() * 9000000);
    return randomDigits.toString();
  };

  const [formData, setFormData] = useState({
    ticketId: '',
    accountNo: '',
    dateInstalled: '',
    fullName: '',
    contactNumber: '',
    plan: '',

    username: '',
    concern: '',
    concernRemarks: '',
    accountEmail: '',
    status: 'unused'
  });

  const [concerns, setConcerns] = useState<concernService.Concern[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchColorPalette = async () => {
      const palette = await settingsColorPaletteService.getActive();
      setColorPalette(palette);
    };
    fetchColorPalette();
  }, []);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // Only initialize when transitioning from closed -> open
      wasOpenRef.current = true;
      setFormData({
        ticketId: generateTicketId(),
        accountNo: customerData?.accountNo || '',
        dateInstalled: customerData?.dateInstalled || '',
        fullName: customerData?.fullName || '',
        contactNumber: customerData?.contactNumber || '',
        plan: customerData?.plan || '',
        username: customerData?.username || '',
        accountEmail: customerData?.emailAddress || '',
        concern: '',
        concernRemarks: '',
        status: 'unused'
      });
      loadData();
    }

    if (!isOpen) {
      // Reset the flag when modal closes so next open triggers initialization again
      wasOpenRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadData = async () => {
    try {
      const concernsResponse = await concernService.concernService.getAllConcerns();
      setConcerns(concernsResponse || []);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.accountNo) {
      newErrors.accountNo = 'Account No. is required';
    }

    if (!formData.dateInstalled) {
      newErrors.dateInstalled = 'Date Installed is required';
    }

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full Name is required';
    }

    if (!formData.contactNumber.trim()) {
      newErrors.contactNumber = 'Contact Number is required';
    }

    if (!formData.plan) {
      newErrors.plan = 'Plan is required';
    }



    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    }

    if (!formData.concern) {
      newErrors.concern = 'Concern is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      setModal({
        isOpen: true,
        type: 'warning',
        title: 'Validation Error',
        message: 'Please fill in all required fields before saving.'
      });
      return;
    }

    setLoading(true);
    setLoadingPercentage(0);

    try {
      setLoadingPercentage(20);

      // Get current time in GMT+8
      const now = new Date();
      const gmt8Offset = 8 * 60 * 60 * 1000; 
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const gmt8Date = new Date(utc + gmt8Offset);
      
      const pad = (num: number) => num.toString().padStart(2, '0');
      const formattedTimestamp = `${gmt8Date.getFullYear()}-${pad(gmt8Date.getMonth() + 1)}-${pad(gmt8Date.getDate())} ${pad(gmt8Date.getHours())}:${pad(gmt8Date.getMinutes())}:${pad(gmt8Date.getSeconds())}`;

      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;

      const payload: any = {
        ticket_id: formData.ticketId,
        account_no: formData.accountNo,
        timestamp: formattedTimestamp,
        support_status: 'In Progress',
        concern: formData.concern,
        concern_remarks: formData.concernRemarks,
        priority_level: 'Medium',
        requested_by: getUserEmail(),
        visit_status: '',
        created_by_user: getUserEmail(),
        status: 'unused',
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      setLoadingPercentage(50);
      await serviceOrderService.createServiceOrder(payload);

      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'SO Request created successfully!',
        onConfirm: () => {
          onSave();
          handleCancel();
          setModal({ ...modal, isOpen: false });
        }
      });
    } catch (error: any) {
      const backendMessage = error.response?.data?.message || error.response?.data?.error;
      const errorDetails = error.response?.data?.errors ? JSON.stringify(error.response.data.errors) : '';
      
      console.error('Error creating SO request:', error, error.response?.data);
      
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to Save',
        message: backendMessage ? `${backendMessage} ${errorDetails}`.trim() : `Failed to save SO request: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    setFormData({
      ticketId: '',
      accountNo: '',
      dateInstalled: '',
      fullName: '',
      contactNumber: '',
      plan: '',

      username: '',
      accountEmail: '',
      concern: '',
      concernRemarks: '',
      status: 'unused'
    });
    setErrors({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
          <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            <Loader2
              className="w-20 h-20 animate-spin"
              style={{ color: colorPalette?.primary || '#7c3aed' }}
            />
            <div className="text-center">
              <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{loadingPercentage}%</p>
            </div>
          </div>
        </div>
      )}

      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
            }`}>
            {modal.type === 'loading' ? (
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-4" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
                </div>
                <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{modal.title}</h3>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`}>{modal.message}</p>
              </div>
            ) : (
              <>
                <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>{modal.title}</h3>
                <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>{modal.message}</p>
                <div className="flex items-center justify-end gap-3">
                  {modal.type === 'confirm' ? (
                    <>
                      <button
                        onClick={modal.onCancel}
                        className={`px-4 py-2 rounded transition-colors ${isDarkMode
                          ? 'bg-gray-700 hover:bg-gray-600 text-white'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                          }`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={modal.onConfirm}
                        className="px-4 py-2 text-white rounded transition-colors"
                        style={{
                          backgroundColor: colorPalette?.primary || '#7c3aed'
                        }}
                        onMouseEnter={(e) => {
                          if (colorPalette?.accent) {
                            e.currentTarget.style.backgroundColor = colorPalette.accent;
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                        }}
                      >
                        Confirm
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        if (modal.onConfirm) {
                          modal.onConfirm();
                        } else {
                          setModal({ ...modal, isOpen: false });
                        }
                      }}
                      className="px-4 py-2 text-white rounded transition-colors"
                      style={{
                        backgroundColor: colorPalette?.primary || '#7c3aed'
                      }}
                      onMouseEnter={(e) => {
                        if (colorPalette?.accent) {
                          e.currentTarget.style.backgroundColor = colorPalette.accent;
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                      }}
                    >
                      OK
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
            }`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>SO Request</h2>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleCancel}
                className={`px-4 py-2 rounded text-sm text-white ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-400 hover:bg-gray-500'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent && !loading) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (colorPalette?.primary) {
                    e.currentTarget.style.backgroundColor = colorPalette.primary;
                  }
                }}
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Saving...
                  </>
                ) : (
                  'Save'
                )}
              </button>

            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Ticket ID<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.ticketId}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'
                  }`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Account No.<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.accountNo}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-red-400' : 'bg-gray-100 text-red-600'
                  } ${errors.accountNo ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  }`}
              />
              {errors.accountNo && <p className="text-red-500 text-xs mt-1">{errors.accountNo}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Date Installed<span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={formData.dateInstalled}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.dateInstalled ? 'border-red-500' : ''
                  }`}
              />
              {errors.dateInstalled && <p className="text-red-500 text-xs mt-1">{errors.dateInstalled}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Full Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => handleInputChange('fullName', e.target.value)}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.fullName ? 'border-red-500' : ''
                  }`}
              />
              {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Contact Number<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.contactNumber}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.contactNumber ? 'border-red-500' : ''
                  }`}
              />
              {errors.contactNumber && <p className="text-red-500 text-xs mt-1">{errors.contactNumber}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Plan<span className="text-red-500">*</span>
              </label>
              <div className={`px-3 py-2 border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'
                }`}>
                {formData.plan || 'No plan'}
              </div>
              {errors.plan && <p className="text-red-500 text-xs mt-1">{errors.plan}</p>}
            </div>



            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Username<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.username}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-500 border-gray-300'
                  } ${errors.username ? 'border-red-500' : ''
                  }`}
              />
              {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Concern<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.concern}
                  onChange={(e) => handleInputChange('concern', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-red-500 appearance-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    } ${errors.concern ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    }`}
                >
                  <option value="">Select Concern</option>
                  {concerns.map(concern => (
                    <option key={concern.id} value={concern.concern_name}>
                      {concern.concern_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                  }`} size={20} />
              </div>
              {errors.concern && <p className="text-red-500 text-xs mt-1">{errors.concern}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Concern Remarks<span className="text-red-500">*</span>
              </label>
              <textarea
                value={formData.concernRemarks}
                onChange={(e) => handleInputChange('concernRemarks', e.target.value)}
                rows={4}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-red-500 resize-none ${isDarkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-300'
                  }`}
                placeholder="Enter concern details..."
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default SORequestFormModal;
