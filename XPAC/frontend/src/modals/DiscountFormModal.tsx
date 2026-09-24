import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronDown, Minus, Plus, Loader2 } from 'lucide-react';
import * as discountService from '../services/discountService';
import { userService } from '../services/userService';
import { getUserDisplayName } from '../utils/userDisplay';
import { useBillingStore } from '../store/billingStore';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface DiscountFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (formData: DiscountFormData) => void;
  customerData?: any;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
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

const DiscountFormModal: React.FC<DiscountFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  customerData
}) => {
  const getCurrentDateTime = () => {
    const now = new Date();
    return now.toISOString().slice(0, 16);
  };

  const [formData, setFormData] = useState<DiscountFormData>(() => ({
    accountNo: null,
    discountAmount: '0.00',
    remaining: '0.00',
    status: 'Pending',
    processedDate: getCurrentDateTime(),
    processedByUserId: null,
    approvedByUserId: null,
    remarks: ''
  }));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [users, setUsers] = useState<any[]>([]);
  const { billingRecords: billingAccounts, fetchBillingRecords } = useBillingStore();
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const accountDropdownRef = useRef<HTMLDivElement>(null);

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });


  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (accountDropdownRef.current && !accountDropdownRef.current.contains(event.target as Node)) {
        setIsAccountDropdownOpen(false);
        setAccountSearchQuery('');
      }
    };

    if (isAccountDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isAccountDropdownOpen]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
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
    if (customerData) {
      setFormData(prev => ({
        ...prev,
        accountNo: customerData.accountNo || null
      }));
    }
  }, [customerData]);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await userService.getAllUsers();
        if (response.success && response.data) {
          setUsers(response.data);

          const authData = localStorage.getItem('authData');
          if (authData) {
            const userData = JSON.parse(authData);
            const currentUser = response.data.find(
              (user: any) => user.email_address === userData.email || user.email === userData.email
            );
            if (currentUser) {
              setFormData(prev => ({
                ...prev,
                processedByUserId: currentUser.id
              }));
            }
          }
        }
      } catch (error) {
        console.error('Error fetching users:', error);
      }
    };

    const fetchBillingAccounts = async () => {
      fetchBillingRecords();
    };

    if (isOpen) {
      fetchUsers();
      fetchBillingAccounts();
    }
  }, [isOpen]);

  useEffect(() => {
    if (formData.status === 'Monthly') {
      if (!formData.remaining || parseFloat(formData.remaining) === parseFloat(formData.discountAmount)) {
        setFormData(prev => ({
          ...prev,
          remaining: '0'
        }));
      }
    } else {
      setFormData(prev => ({
        ...prev,
        remaining: '0'
      }));
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
    let newValue: number;

    if (operation === 'increase') {
      newValue = currentValue + increment;
    } else {
      newValue = Math.max(0, currentValue - increment);
    }

    setFormData(prev => ({
      ...prev,
      discountAmount: newValue.toFixed(2)
    }));
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

      const authData = localStorage.getItem('authData');
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
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      const result = await discountService.create(payload);

      clearInterval(progressInterval);
      setLoadingPercentage(100);
      await new Promise(resolve => setTimeout(resolve, 500));

      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'Discount created successfully!',
        onConfirm: () => {
          onSave(formData);
          onClose();
          setModal(prev => ({ ...prev, isOpen: false }));
        }
      });
    } catch (error) {
      console.error('Error creating discount:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to save discount',
        message: `Failed to save discount: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    onClose();
  };

  // Filter billing accounts based on search query
  const filteredBillingAccounts = billingAccounts.filter((account) => {
    const fullName = [
      account.firstName || '',
      account.middleInitial || '',
      account.lastName || ''
    ].filter(Boolean).join(' ');

    const addressParts = [
      account.address || '',
      account.barangay || '',
      account.city || '',
      account.region || ''
    ].filter(Boolean).join(', ');

    const accountNumber = account.accountNo || account.account_no || '';
    const searchText = `${accountNumber} ${fullName || account.customerName} ${addressParts}`.toLowerCase();

    return searchText.includes(accountSearchQuery.toLowerCase());
  });

  // Get selected account display text
  const getSelectedAccountText = () => {
    if (!formData.accountNo) return 'Select Account';

    const account = billingAccounts.find(
      (acc) => (acc.accountNo || acc.account_no) === formData.accountNo
    );

    if (!account) return formData.accountNo;

    const fullName = [
      account.firstName || '',
      account.middleInitial || '',
      account.lastName || ''
    ].filter(Boolean).join(' ');

    const addressParts = [
      account.address || '',
      account.barangay || '',
      account.city || '',
      account.region || ''
    ].filter(Boolean).join(', ');

    return `${formData.accountNo} | ${fullName || account.customerName} | ${addressParts}`;
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

      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-gray-100 border-gray-300'
            }`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Discounted Form</h2>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleCancel}
                className={`px-4 py-2 rounded text-sm ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
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
                className={isDarkMode ? 'text-gray-400 hover:text-white transition-colors' : 'text-gray-600 hover:text-gray-900 transition-colors'}
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Account No.<span className="text-red-500">*</span>
              </label>
              <div className="relative" ref={accountDropdownRef}>
                {/* Custom Searchable Dropdown */}
                <div
                  className={`w-full px-3 py-2 border rounded cursor-pointer ${errors.accountNo ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                  onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                >
                  <div className="flex items-center justify-between">
                    <span className={`truncate ${!formData.accountNo ? (isDarkMode ? 'text-gray-400' : 'text-gray-500') : ''
                      }`}>
                      {getSelectedAccountText()}
                    </span>
                    <ChevronDown className={`flex-shrink-0 ml-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`} size={20} />
                  </div>
                </div>

                {/* Dropdown Menu */}
                {isAccountDropdownOpen && (
                  <div className={`absolute z-50 w-full mt-1 border rounded shadow-lg max-h-80 overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
                    }`}>
                    {/* Search Input */}
                    <div className={`p-2 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                      }`}>
                      <input
                        type="text"
                        placeholder="Search accounts..."
                        value={accountSearchQuery}
                        onChange={(e) => setAccountSearchQuery(e.target.value)}
                        className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                          ? 'bg-gray-900 border-gray-600 text-white placeholder-gray-400'
                          : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
                          }`}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    </div>

                    {/* Options List */}
                    <div className="max-h-64 overflow-y-auto">
                      {filteredBillingAccounts.length > 0 ? (
                        filteredBillingAccounts.map((account) => {
                          const fullName = [
                            account.firstName || '',
                            account.middleInitial || '',
                            account.lastName || ''
                          ].filter(Boolean).join(' ');

                          const addressParts = [
                            account.address || '',
                            account.barangay || '',
                            account.city || '',
                            account.region || ''
                          ].filter(Boolean).join(', ');

                          const accountNumber = account.accountNo || account.account_no || '';
                          const displayText = `${accountNumber} | ${fullName || account.customerName} | ${addressParts}`;

                          return (
                            <div
                              key={account.id}
                              className={`px-3 py-2 cursor-pointer ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'
                                } ${formData.accountNo === accountNumber
                                  ? (isDarkMode ? 'bg-gray-700' : 'bg-gray-100')
                                  : ''
                                }`}
                              onClick={() => {
                                handleInputChange('accountNo', accountNumber);
                                setIsAccountDropdownOpen(false);
                                setAccountSearchQuery('');
                              }}
                              title={displayText}
                            >
                              <div className="text-sm">
                                <span className="text-red-400 font-medium">{accountNumber}</span>
                                <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                  {' | '}{fullName || account.customerName}
                                </span>
                              </div>
                              <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                                }`}>
                                {addressParts}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className={`px-3 py-4 text-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                          }`}>
                          No accounts found
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {errors.accountNo && <p className="text-red-500 text-xs mt-1">{errors.accountNo}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Discount Status
              </label>
              <div className="relative">
                <select
                  value={formData.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 cursor-pointer ${isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-white border-gray-300 text-gray-900'
                    }`}
                  style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' }}
                >
                  <option value="Pending" className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>Pending</option>
                  <option value="Unused" className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>Unused</option>
                  <option value="Permanent" className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>Permanent</option>
                  <option value="Monthly" className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>Monthly</option>
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Discount Amount<span className="text-red-500">*</span>
              </label>
              <div className="flex items-center">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={`₱ ${formData.discountAmount}`}
                    onChange={(e) => handleInputChange('discountAmount', e.target.value.replace('₱ ', '').replace(/[^0-9.]/g, ''))}
                    className={`w-full px-3 py-2 border rounded-l focus:outline-none focus:border-orange-500 ${errors.discountAmount ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      }`}
                  />
                </div>
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => handleDiscountAmountChange('decrease')}
                    className={`px-3 py-1 border border-l-0 text-sm ${isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-700'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900 border-gray-300'
                      }`}
                  >
                    <Minus size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDiscountAmountChange('increase')}
                    className={`px-3 py-1 border border-l-0 border-t-0 rounded-r text-sm ${isDarkMode
                      ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-700'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900 border-gray-300'
                      }`}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              {errors.discountAmount && <p className="text-red-500 text-xs mt-1">{errors.discountAmount}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Processed By<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.processedByUserId || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    handleInputChange('processedByUserId', value ? parseInt(value) : null);
                  }}
                  disabled
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 cursor-not-allowed opacity-60 ${errors.processedByUserId ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                  style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' }}
                >
                  <option value="" className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>Select Processor</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id} className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>
                      {getUserDisplayName(user, user?.email_address)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
              {errors.processedByUserId && <p className="text-red-500 text-xs mt-1">{errors.processedByUserId}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Approved By<span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={formData.approvedByUserId || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    handleInputChange('approvedByUserId', value ? parseInt(value) : null);
                  }}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 cursor-pointer ${errors.approvedByUserId ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                  style={{ WebkitAppearance: 'none', MozAppearance: 'none', appearance: 'none' }}
                >
                  <option value="" className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>Select Approver</option>
                  {users.filter(user => user.role_id === 1 || user.role_id === 7).map((user) => (
                    <option key={user.id} value={user.id} className={isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}>
                      {getUserDisplayName(user, user?.email_address)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-2.5 text-gray-400 pointer-events-none" size={20} />
              </div>
              {errors.approvedByUserId && <p className="text-red-500 text-xs mt-1">{errors.approvedByUserId}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Remarks
              </label>
              <textarea
                value={formData.remarks}
                onChange={(e) => handleInputChange('remarks', e.target.value)}
                rows={4}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white'
                  : 'bg-white border-gray-300 text-gray-900'
                  }`}
              />
            </div>
          </div>
        </div>
      </div>

      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[11000]">
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
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
    </>
  );
};

export default DiscountFormModal;
