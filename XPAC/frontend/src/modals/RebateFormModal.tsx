import React, { useState, useEffect } from 'react';
import { X, Minus, Plus, ChevronDown, Search, Loader2 } from 'lucide-react';
import * as massRebateService from '../services/massRebateService';
import * as lcpnapService from '../services/lcpnapService';
import * as lcpService from '../services/lcpService';
import { barangayService, Barangay } from '../services/barangayService';
import { userService } from '../services/userService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface RebateFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
}

type RebateType = 'lcpnap' | 'lcp' | 'barangay' | null;

const RebateFormModal: React.FC<RebateFormModalProps> = ({
  isOpen,
  onClose,
  onSave
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const getUserEmail = () => {
    try {
      const authData = localStorage.getItem('authData');
      if (authData) {
        const userData = JSON.parse(authData);
        return userData.email || userData.user?.email || 'unknown@example.com';
      }
      return 'unknown@example.com';
    } catch (error) {
      console.error('Error getting user email:', error);
      return 'unknown@example.com';
    }
  };

  const [formData, setFormData] = useState({
    numberOfDays: 0,
    rebateType: null as RebateType,
    selectedId: null as number | null,
    month: '',
    status: 'Pending',
    createdBy: getUserEmail(),
    approvedBy: '',
    modifiedBy: null as string | null
  });

  const [lcpnapList, setLcpnapList] = useState<lcpnapService.LCPNAP[]>([]);
  const [lcpList, setLcpList] = useState<lcpService.LCP[]>([]);
  const [barangayList, setBarangayList] = useState<Barangay[]>([]);
  const [usersList, setUsersList] = useState<Array<{ email: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });
  const [lcpnapSearch, setLcpnapSearch] = useState('');
  const [isLcpnapOpen, setIsLcpnapOpen] = useState(false);
  const [lcpSearch, setLcpSearch] = useState('');
  const [isLcpOpen, setIsLcpOpen] = useState(false);
  const [barangaySearch, setBarangaySearch] = useState('');
  const [isBarangayOpen, setIsBarangayOpen] = useState(false);

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
    if (isOpen) {
      setFormData(prev => ({
        ...prev,
        createdBy: getUserEmail(),
        status: 'Pending'
      }));
      loadAllData();
    }
  }, [isOpen]);

  const loadAllData = async () => {
    try {
      const [lcpnapResponse, lcpResponse, barangayResponse, usersResponse] = await Promise.all([
        lcpnapService.getAllLCPNAPs(),
        lcpService.getAllLCPs(),
        barangayService.getAll(),
        userService.getAllUsers()
      ]);

      if (lcpnapResponse.success) {
        setLcpnapList(lcpnapResponse.data);
      }

      if (lcpResponse.success) {
        setLcpList(lcpResponse.data);
      }

      if (barangayResponse.success) {
        setBarangayList(barangayResponse.data);
      }

      if (usersResponse.success && usersResponse.data) {
        const users = usersResponse.data.map((user: any) => ({
          email: user.email_address || user.username || 'No email'
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
    let newValue: number;

    if (operation === 'increase') {
      newValue = currentValue + 1;
    } else {
      newValue = Math.max(0, currentValue - 1);
    }

    setFormData(prev => ({ ...prev, numberOfDays: newValue }));
  };

  const handleRebateTypeChange = (type: RebateType) => {
    setFormData(prev => ({ ...prev, rebateType: type, selectedId: null }));
    if (errors.rebateType) {
      setErrors(prev => ({ ...prev, rebateType: '' }));
    }
    if (errors.selectedId) {
      setErrors(prev => ({ ...prev, selectedId: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (formData.numberOfDays <= 0) {
      newErrors.numberOfDays = 'Number of Days must be greater than 0';
    }

    if (!formData.rebateType) {
      newErrors.rebateType = 'Please select a rebate type';
    }

    if (formData.rebateType && !formData.selectedId) {
      newErrors.selectedId = 'Please select an item from the dropdown';
    }

    if (!formData.month) {
      newErrors.month = 'Please select a month';
    }

    if (!formData.approvedBy || formData.approvedBy.trim() === '') {
      newErrors.approvedBy = 'Approved By is required';
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
        message: 'Please fill in all required fields correctly.'
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

      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;

      const payload: massRebateService.MassRebateData = {
        number_of_dates: formData.numberOfDays,
        rebate_type: formData.rebateType as 'lcpnap' | 'lcp' | 'barangay' as any,
        selected_rebate: selectedRebateName,
        month: formData.month,
        status: 'Pending',
        created_by: formData.createdBy,
        modified_by: formData.approvedBy,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      setLoadingPercentage(50);
      await massRebateService.create(payload);

      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Rebate created successfully!',
        onConfirm: () => {
          onSave();
          onClose();
          setModal(prev => ({ ...prev, isOpen: false }));
        }
      });
    } catch (error) {
      console.error('Error creating rebate:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to save rebate: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    setFormData({
      numberOfDays: 0,
      rebateType: null,
      selectedId: null,
      month: '',
      status: 'Pending',
      createdBy: getUserEmail(),
      approvedBy: '',
      modifiedBy: null
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
              }`}>Rebate Form</h2>
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
                className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center transition-colors"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent && !loading) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
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
              <button
                onClick={onClose}
                className={`transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Number of Days<span className="text-red-500">*</span>
              </label>
              <div className="flex items-center">
                <input
                  type="number"
                  value={formData.numberOfDays}
                  onChange={(e) => handleInputChange('numberOfDays', parseInt(e.target.value) || 0)}
                  className={`flex-1 px-3 py-2 border rounded-l focus:outline-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    } ${errors.numberOfDays ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                  style={{
                    borderColor: errors.numberOfDays ? '#ef4444' : (colorPalette && formData.numberOfDays > 0 ? colorPalette.primary : '')
                  }}
                />
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => handleNumberChange('decrease')}
                    className={`px-3 py-1 text-white border border-l-0 ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 border-gray-700' : 'bg-gray-300 hover:bg-gray-400 border-gray-300'
                      }`}
                  >
                    <Minus size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNumberChange('increase')}
                    className={`px-3 py-1 text-white border border-l-0 border-t-0 rounded-r ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 border-gray-700' : 'bg-gray-300 hover:bg-gray-400 border-gray-300'
                      }`}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              {errors.numberOfDays && <p className="text-red-500 text-xs mt-1">{errors.numberOfDays}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Rebate Type<span className="text-red-500">*</span>
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleRebateTypeChange('lcpnap')}
                  className={`flex-1 px-4 py-2 rounded border transition-colors ${formData.rebateType === 'lcpnap'
                    ? 'text-white'
                    : isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}
                  style={formData.rebateType === 'lcpnap' ? {
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    borderColor: colorPalette?.primary || '#7c3aed'
                  } : {}}
                >
                  LCPNAP
                </button>
                <button
                  type="button"
                  onClick={() => handleRebateTypeChange('lcp')}
                  className={`flex-1 px-4 py-2 rounded border transition-colors ${formData.rebateType === 'lcp'
                    ? 'text-white'
                    : isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}
                  style={formData.rebateType === 'lcp' ? {
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    borderColor: colorPalette?.primary || '#7c3aed'
                  } : {}}
                >
                  LCP
                </button>
                <button
                  type="button"
                  onClick={() => handleRebateTypeChange('barangay')}
                  className={`flex-1 px-4 py-2 rounded border transition-colors ${formData.rebateType === 'barangay'
                    ? 'text-white'
                    : isDarkMode
                      ? 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-600'
                      : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400'
                    }`}
                  style={formData.rebateType === 'barangay' ? {
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    borderColor: colorPalette?.primary || '#7c3aed'
                  } : {}}
                >
                  Barangay
                </button>
              </div>
              {errors.rebateType && <p className="text-red-500 text-xs mt-1">{errors.rebateType}</p>}
            </div>

            {formData.rebateType === 'lcpnap' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Select LCPNAP<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                    } ${errors.selectedId ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
                    <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                    <input
                      type="text"
                      placeholder="Type to search LCP-NAP..."
                      value={isLcpnapOpen ? lcpnapSearch : (lcpnapList.find(i => i.id === formData.selectedId)?.lcpnap_name || lcpnapSearch)}
                      onChange={(e) => {
                        setLcpnapSearch(e.target.value);
                        if (!isLcpnapOpen) setIsLcpnapOpen(true);
                      }}
                      onFocus={() => setIsLcpnapOpen(true)}
                      className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (isLcpnapOpen) {
                          setIsLcpnapOpen(false);
                          setLcpnapSearch('');
                        } else {
                          handleInputChange('selectedId', null);
                          setLcpnapSearch('');
                        }
                      }}
                      className="ml-2"
                    >
                      {isLcpnapOpen || formData.selectedId ? (
                        <X size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                      ) : (
                        <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                      )}
                    </button>
                  </div>

                  {isLcpnapOpen && (
                    <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                      <div className="max-h-60 overflow-y-auto custom-scrollbar">
                        {lcpnapList
                          .filter(item => item.lcpnap_name.toLowerCase().includes(lcpnapSearch.toLowerCase()))
                          .map((item) => (
                            <div
                              key={item.id}
                              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'} ${formData.selectedId === item.id ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                              onClick={() => {
                                handleInputChange('selectedId', item.id);
                                setLcpnapSearch('');
                                setIsLcpnapOpen(false);
                              }}
                            >
                              {item.lcpnap_name}
                            </div>
                          ))}
                        {lcpnapList.filter(item => item.lcpnap_name.toLowerCase().includes(lcpnapSearch.toLowerCase())).length === 0 && (
                          <div className={`px-4 py-8 text-center text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            No results for "{lcpnapSearch}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {isLcpnapOpen && (
                    <div className="fixed inset-0 z-40 bg-transparent" onClick={() => { setIsLcpnapOpen(false); setLcpnapSearch(''); }} />
                  )}
                </div>
                {errors.selectedId && <p className="text-red-500 text-xs mt-1">{errors.selectedId}</p>}
              </div>
            )}

            {formData.rebateType === 'lcp' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Select LCP<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                    } ${errors.selectedId ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
                    <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                    <input
                      type="text"
                      placeholder="Type to search LCP..."
                      value={isLcpOpen ? lcpSearch : (lcpList.find(i => i.id === formData.selectedId)?.lcp_name || lcpSearch)}
                      onChange={(e) => {
                        setLcpSearch(e.target.value);
                        if (!isLcpOpen) setIsLcpOpen(true);
                      }}
                      onFocus={() => setIsLcpOpen(true)}
                      className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (isLcpOpen) {
                          setIsLcpOpen(false);
                          setLcpSearch('');
                        } else {
                          handleInputChange('selectedId', null);
                          setLcpSearch('');
                        }
                      }}
                      className="ml-2"
                    >
                      {isLcpOpen || formData.selectedId ? (
                        <X size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                      ) : (
                        <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                      )}
                    </button>
                  </div>

                  {isLcpOpen && (
                    <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                      <div className="max-h-60 overflow-y-auto custom-scrollbar">
                        {lcpList
                          .filter(item => item.lcp_name.toLowerCase().includes(lcpSearch.toLowerCase()))
                          .map((item) => (
                            <div
                              key={item.id}
                              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'} ${formData.selectedId === item.id ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                              onClick={() => {
                                handleInputChange('selectedId', item.id);
                                setLcpSearch('');
                                setIsLcpOpen(false);
                              }}
                            >
                              {item.lcp_name}
                            </div>
                          ))}
                        {lcpList.filter(item => item.lcp_name.toLowerCase().includes(lcpSearch.toLowerCase())).length === 0 && (
                          <div className={`px-4 py-8 text-center text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            No results for "{lcpSearch}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {isLcpOpen && (
                    <div className="fixed inset-0 z-40 bg-transparent" onClick={() => { setIsLcpOpen(false); setLcpSearch(''); }} />
                  )}
                </div>
                {errors.selectedId && <p className="text-red-500 text-xs mt-1">{errors.selectedId}</p>}
              </div>
            )}

            {formData.rebateType === 'barangay' && (
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Select Barangay<span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className={`flex items-center px-3 py-2 border rounded transition-colors ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                    } ${errors.selectedId ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
                    <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
                    <input
                      type="text"
                      placeholder="Type to search Barangay..."
                      value={isBarangayOpen ? barangaySearch : (barangayList.find(i => i.id === formData.selectedId)?.barangay || barangaySearch)}
                      onChange={(e) => {
                        setBarangaySearch(e.target.value);
                        if (!isBarangayOpen) setIsBarangayOpen(true);
                      }}
                      onFocus={() => setIsBarangayOpen(true)}
                      className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (isBarangayOpen) {
                          setIsBarangayOpen(false);
                          setBarangaySearch('');
                        } else {
                          handleInputChange('selectedId', null);
                          setBarangaySearch('');
                        }
                      }}
                      className="ml-2"
                    >
                      {isBarangayOpen || formData.selectedId ? (
                        <X size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                      ) : (
                        <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                      )}
                    </button>
                  </div>

                  {isBarangayOpen && (
                    <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                      <div className="max-h-60 overflow-y-auto custom-scrollbar">
                        {barangayList
                          .filter(item => item.barangay.toLowerCase().includes(barangaySearch.toLowerCase()))
                          .map((item) => (
                            <div
                              key={item.id}
                              className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'} ${formData.selectedId === item.id ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                              onClick={() => {
                                handleInputChange('selectedId', item.id);
                                setBarangaySearch('');
                                setIsBarangayOpen(false);
                              }}
                            >
                              {item.barangay}
                            </div>
                          ))}
                        {barangayList.filter(item => item.barangay.toLowerCase().includes(barangaySearch.toLowerCase())).length === 0 && (
                          <div className={`px-4 py-8 text-center text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                            No results for "{barangaySearch}"
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {isBarangayOpen && (
                    <div className="fixed inset-0 z-40 bg-transparent" onClick={() => { setIsBarangayOpen(false); setBarangaySearch(''); }} />
                  )}
                </div>
                {errors.selectedId && <p className="text-red-500 text-xs mt-1">{errors.selectedId}</p>}
              </div>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Month<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.month}
                  onChange={(e) => handleInputChange('month', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none appearance-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    } ${errors.month ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}
                  style={{
                    borderColor: errors.month ? '#ef4444' : (colorPalette && formData.month ? colorPalette.primary : '')
                  }}
                >
                  <option value="">Select Month</option>
                  <option value="January">January</option>
                  <option value="February">February</option>
                  <option value="March">March</option>
                  <option value="April">April</option>
                  <option value="May">May</option>
                  <option value="June">June</option>
                  <option value="July">July</option>
                  <option value="August">August</option>
                  <option value="September">September</option>
                  <option value="October">October</option>
                  <option value="November">November</option>
                  <option value="December">December</option>
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
              {errors.month && <p className="text-red-500 text-xs mt-1">{errors.month}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Status
              </label>
              <input
                type="text"
                value={formData.status}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'
                  }`}
              />
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                }`}>Default status is Pending when creating a new rebate</p>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Created By
              </label>
              <input
                type="text"
                value={formData.createdBy}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'
                  }`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Approved By<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.approvedBy}
                  onChange={(e) => handleInputChange('approvedBy', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none appearance-none ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    } ${errors.approvedBy ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    }`}
                  style={{
                    borderColor: errors.approvedBy ? '#ef4444' : (colorPalette && formData.approvedBy ? colorPalette.primary : '')
                  }}
                >
                  <option value="">Select Approver</option>
                  {usersList.map((user, index) => (
                    <option key={index} value={user.email}>
                      {user.email}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
              {errors.approvedBy && (
                <p className="text-red-500 text-xs mt-1">{errors.approvedBy}</p>
              )}
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-600'
                }`}>
                Select the person who will approve this rebate
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default RebateFormModal;
