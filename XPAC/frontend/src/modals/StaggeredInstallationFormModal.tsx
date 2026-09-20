import React, { useState, useEffect, useRef } from 'react';
import { X, Calendar, ChevronDown, Loader2 } from 'lucide-react';
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

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
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

const StaggeredInstallationFormModal: React.FC<StaggeredInstallationFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  customerData
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const getCurrentDate = () => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  };

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
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}${month}${day}${hours}${minutes}${seconds}${milliseconds}`;
  };

  const [formData, setFormData] = useState<StaggeredInstallationFormData>(() => ({
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
    city: customerData?.city || ''
  }));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [users, setUsers] = useState<Array<{ id: number; email: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });
  const { billingRecords: billingAccounts, fetchBillingRecords } = useBillingStore();
  const [isAccountDropdownOpen, setIsAccountDropdownOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const accountDropdownRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        setLoadingUsers(true);
        const response = await userService.getAllUsers();
        if (response.data) {
          const userList = response.data.map((user: any) => ({
            id: user.id,
            email: user.email_address
          }));
          setUsers(userList);
        }
      } catch (error) {
        console.error('Failed to fetch users:', error);
      } finally {
        setLoadingUsers(false);
      }
    };

    const getCurrentUser = () => {
      const authData = localStorage.getItem('authData');
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          const userEmail = userData.email;
          if (userEmail) {
            setFormData(prev => ({
              ...prev,
              userEmail,
              modifiedBy: userEmail
            }));
          }
        } catch (error) {
          console.error('Failed to parse auth data:', error);
        }
      }
    };

    const fetchBillingAccounts = async () => {
      fetchBillingRecords();
    };

    if (isOpen) {
      fetchUsers();
      getCurrentUser();
      fetchBillingAccounts();
    }
  }, [isOpen]);

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
        city: customerData.city || ''
      }));
    }
  }, [customerData]);

  useEffect(() => {
    const staggeredBalance = parseFloat(formData.staggeredBalance) || 0;
    const monthsToPay = parseInt(formData.monthsToPay) || 1;
    const monthlyPayment = monthsToPay > 0 ? staggeredBalance / monthsToPay : 0;

    setFormData(prev => ({
      ...prev,
      monthlyPayment: monthlyPayment.toFixed(2)
    }));
  }, [formData.staggeredBalance, formData.monthsToPay]);

  const handleInputChange = (field: keyof StaggeredInstallationFormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.accountNo.trim()) newErrors.accountNo = 'Account No. is required';
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
        remarks: formData.remarks || ''
      };

      const result = await staggeredInstallationService.create(payload);

      if (result.success) {
        clearInterval(progressInterval);
        setLoadingPercentage(100);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Staggered Installation created successfully!',
          onConfirm: () => {
            onSave(formData);
            onClose();
            setModal(prev => ({ ...prev, isOpen: false }));
          }
        });
      } else {
        clearInterval(progressInterval);
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Failed to create staggered installation',
          message: result.message || 'An unknown error occurred'
        });
      }
    } catch (error) {
      clearInterval(progressInterval);
      console.error('Error creating staggered installation:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Failed to save staggered installation',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      setLoading(false);
      setLoadingPercentage(0);
    }
  };

  const handleCancel = () => {
    onClose();
  };

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
          <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
            <Loader2
              className="w-20 h-20 animate-spin"
              style={{ color: colorPalette?.primary || '#7c3aed' }}
            />
            <div className="text-center">
              <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{loadingPercentage}%</p>
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Staggered Installation Form</h2>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleCancel}
                className={`px-4 py-2 rounded text-sm text-white ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-400 hover:bg-gray-500'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
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
                {loading ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={onClose}
                className={`transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                Account No.<span className="text-red-500">*</span>
              </label>
              <div className="relative" ref={accountDropdownRef}>
                <div
                  className={`w-full px-3 py-2 border rounded cursor-pointer ${errors.accountNo ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'} ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'}`}
                  onClick={() => setIsAccountDropdownOpen(!isAccountDropdownOpen)}
                >
                  <div className="flex items-center justify-between">
                    <span className={`truncate ${!formData.accountNo ? (isDarkMode ? 'text-gray-400' : 'text-gray-500') : ''}`}>
                      {getSelectedAccountText()}
                    </span>
                    <ChevronDown className={`flex-shrink-0 ml-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} size={20} />
                  </div>
                </div>

                {isAccountDropdownOpen && (
                  <div className={`absolute z-50 w-full mt-1 border rounded shadow-lg max-h-80 overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}>
                    <div className={`p-2 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                      <input
                        type="text"
                        placeholder="Search accounts..."
                        value={accountSearchQuery}
                        onChange={(e) => setAccountSearchQuery(e.target.value)}
                        className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-900 border-gray-600 text-white placeholder-gray-400' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'}`}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    </div>

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
                              className={`px-3 py-2 cursor-pointer ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${formData.accountNo === accountNumber ? (isDarkMode ? 'bg-gray-700' : 'bg-gray-100') : ''}`}
                              onClick={() => {
                                handleInputChange('accountNo', accountNumber);
                                setIsAccountDropdownOpen(false);
                                setAccountSearchQuery('');
                                setFormData(prev => ({
                                  ...prev,
                                  accountNo: accountNumber,
                                  fullName: fullName || account.customerName || '',
                                  contactNo: account.contactNumber || '',
                                  emailAddress: account.emailAddress || '',
                                  address: addressParts,
                                  plan: account.plan || '',
                                  barangay: account.barangay || '',
                                  city: account.city || ''
                                }));
                              }}
                              title={displayText}
                            >
                              <div className="text-sm">
                                <span className="text-red-400 font-medium">{accountNumber}</span>
                                <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                  {' | '}{fullName || account.customerName}
                                </span>
                              </div>
                              <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>{addressParts}</div>
                            </div>
                          );
                        })
                      ) : (
                        <div className={`px-3 py-4 text-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>No accounts found</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              {errors.accountNo && <p className="text-red-500 text-xs mt-1">{errors.accountNo}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Full Name</label>
              <input
                type="text"
                value={formData.fullName}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Contact Number</label>
              <input
                type="text"
                value={formData.contactNo}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Email Address</label>
              <input
                type="email"
                value={formData.emailAddress}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Address</label>
              <input
                type="text"
                value={formData.address}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Plan</label>
              <input
                type="text"
                value={formData.plan}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Staggered Install No.</label>
              <input
                type="text"
                value={formData.staggeredInstallNo}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Staggered Date</label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.staggeredDate}
                  onChange={(e) => handleInputChange('staggeredDate', e.target.value)}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                />
                <Calendar className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Staggered Balance</label>
              <input
                type="text"
                value={`₱ ${formData.staggeredBalance}`}
                onChange={(e) => handleInputChange('staggeredBalance', e.target.value.replace('₱ ', '').replace(/[^0-9.]/g, ''))}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Months to Pay</label>
              <input
                type="number"
                min="0"
                value={formData.monthsToPay}
                onChange={(e) => handleInputChange('monthsToPay', e.target.value)}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Monthly Payment</label>
              <input
                type="text"
                value={`₱ ${formData.monthlyPayment}`}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-400' : 'bg-gray-100 border-gray-300 text-gray-500'}`}
              />
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Automatically calculated based on Total Balance and Months to Pay</p>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Modified By</label>
              <div className="relative">
                <select
                  value={formData.modifiedBy}
                  onChange={(e) => handleInputChange('modifiedBy', e.target.value)}
                  disabled={loadingUsers}
                  className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
                >
                  <option value="">Select user...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.email}>
                      {user.email}
                    </option>
                  ))}
                </select>
                <ChevronDown className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} size={20} />
              </div>
              {loadingUsers && <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading users...</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Modified Date</label>
              <div className="relative">
                <input
                  type="text"
                  value={formData.modifiedDate}
                  readOnly
                  className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
                />
                <Calendar className={`absolute right-3 top-2.5 pointer-events-none ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} size={20} />
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>User Email</label>
              <input
                type="email"
                value={formData.userEmail}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Remarks</label>
              <textarea
                value={formData.remarks}
                onChange={(e) => handleInputChange('remarks', e.target.value)}
                rows={3}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Barangay</label>
              <input
                type="text"
                value={formData.barangay}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>City</label>
              <input
                type="text"
                value={formData.city}
                readOnly
                className={`w-full px-3 py-2 border rounded cursor-not-allowed ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modal Feedback System */}
      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
            {modal.type === 'loading' ? (
              <div className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="animate-spin rounded-full h-16 w-16 border-b-4" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
                </div>
                <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{modal.title}</h3>
                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{modal.message}</p>
              </div>
            ) : (
              <>
                <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{modal.title}</h3>
                <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{modal.message}</p>
                <div className="flex items-center justify-end gap-3">
                  {modal.type === 'confirm' ? (
                    <>
                      <button
                        onClick={modal.onCancel}
                        className={`px-4 py-2 rounded transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-900'}`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={modal.onConfirm}
                        className="px-4 py-2 text-white rounded transition-colors"
                        style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
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
                      style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
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

      <style>{`
        input[type=number]::-webkit-inner-spin-button, 
        input[type=number]::-webkit-outer-spin-button { 
          -webkit-appearance: none; 
          margin: 0; 
        }
      `}</style>
    </>
  );
};

export default StaggeredInstallationFormModal;
