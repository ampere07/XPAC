import React, { useState, useEffect, useMemo, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronDown, Minus, Plus, Camera, Loader2 } from 'lucide-react';
import { transactionService } from '../services/transactionService';
import { getActiveImageSize, resizeImage, ImageSizeSetting } from '../services/imageSettingsService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import { User } from '../types/api';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import { planService, Plan } from '../services/planService';
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
  image: File | null;
  // Prepaid only: id of the plan this payment buys. Stays null for postpaid accounts, whose
  // plan field remains read-only.
  selectedPlanId: number | null;
  // Prepaid only: start the bought plan immediately, forfeiting the days left on the current
  // one, instead of queueing the switch for when the period lapses.
  activateNow: boolean;
}

/**
 * Transaction types, by account type.
 *
 * Mirrors Transaction::typesForGenerationType() on the backend, which validates every write
 * against the same rule — 'Top Up' and 'Recurring Fee' are mutually exclusive by account type,
 * and the other three are legal on both. The two lists must be kept in step; this one exists so
 * the dropdown never offers an option the server would reject, not as the enforcement.
 *
 * First entry is the type-specific one and is what a fresh form defaults to.
 */
const SHARED_TRANSACTION_TYPES = ['Service Charge', 'Installation Fee'];
const PREPAID_TRANSACTION_TYPES = ['Top Up', ...SHARED_TRANSACTION_TYPES];
const POSTPAID_TRANSACTION_TYPES = ['Recurring Fee', ...SHARED_TRANSACTION_TYPES];

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

  const [formData, setFormData] = useState<TransactionFormData>(() => {
    const authData = localStorage.getItem('authData');
    let userEmail = '';
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        userEmail = userData.email_address || userData.email || '';
      } catch (e) {
        console.error('Error parsing auth data:', e);
      }
    }

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
      // Corrected to 'Top Up' by the effect below once the account is known to be prepaid.
      // Initialised to the postpaid default because billingRecord is not reliably populated at
      // the point this initialiser runs.
      transactionType: 'Recurring Fee',
      remarks: '',
      image: null,
      selectedPlanId: null,
      activateNow: false
    };
  });

  // ── Prepaid plan selection ────────────────────────────────────────────────
  // Only a prepaid customer buys a plan with their payment, so only they get an editable plan
  // field. Postpaid keeps the existing read-only display.
  // Letters-only comparison so both the canonical 'Prepaid' and the older 'Pre Paid' resolve —
  // an account that has not been through the rename must still get the plan picker.
  const isPrepaid = String(billingRecord?.generationType ?? '').toLowerCase().replace(/[^a-z]/g, '') === 'prepaid';
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoadingPlans, setIsLoadingPlans] = useState<boolean>(false);

  // Types offerable for this account, plus — when editing — whatever the row already is.
  //
  // The stored type is kept even if it is no longer offered: 'Security Deposit' has been retired,
  // but a pending transaction recorded before that must still be editable, and correcting its OR
  // number must not silently convert it into a Recurring Fee. The backend applies the same
  // allowance (TransactionController::resolveTypeRule).
  const storedTransactionType: string | null = initialTransactionData?.transaction_type ?? null;
  const transactionTypes = useMemo(() => {
    const base = isPrepaid ? PREPAID_TRANSACTION_TYPES : POSTPAID_TRANSACTION_TYPES;

    return storedTransactionType && !base.includes(storedTransactionType)
      ? [...base, storedTransactionType]
      : base;
  }, [isPrepaid, storedTransactionType]);

  // 'Top Up' is the prepaid analogue of 'Recurring Fee'; only one of the two is ever valid, and
  // the backend rejects the wrong one. Two cases to correct once the account is known:
  //   - a fresh form initialised to the postpaid default before billingRecord arrived
  //   - editing a transaction whose stored type predates this split, or was recorded against an
  //     account whose generation_type has since been changed
  // Anything already in the list — including a retired type carried by the row being edited — is
  // left exactly as it is.
  useEffect(() => {
    if (!isOpen) return;

    setFormData(prev => {
      if (transactionTypes.includes(prev.transactionType)) return prev;

      return { ...prev, transactionType: transactionTypes[0] };
    });
  }, [isOpen, transactionTypes]);

  // Mirrors the backend's extractPlanName(): first token, before any ' - ' or space. Used to
  // work out which plan the account is currently on so it can be preselected.
  const extractPlanName = (raw?: string | null): string => {
    if (!raw) return '';
    let value = String(raw);
    if (value.includes(' - ')) value = value.split(' - ')[0].trim();
    if (value.includes(' ')) return value.split(' ')[0].trim();
    return value.trim();
  };

  // Only a plan CHANGE can be activated early — activating "now" on the plan already in force
  // would forfeit the customer's remaining days and buy them nothing. The backend applies the
  // same rule independently (PrepaidPlanChangeService::isGenuineSwitch), so this drives the UI
  // rather than being the guarantee.
  const currentPlanId = plans.find(p => p.name === extractPlanName(billingRecord?.plan))?.id ?? null;
  const isPlanSwitch = formData.selectedPlanId !== null && formData.selectedPlanId !== currentPlanId;

  // A plan is bought by a TOP UP and nothing else. A prepaid Service Charge, Installation Fee or
  // Security Deposit pays for something other than service time and must not move the customer's
  // plan — the backend enforces the same via Transaction::grantsService(), which is what actually
  // stops it. Postpaid never gets a picker at all; its plan field stays read-only.
  const showPlanPicker = isPrepaid && formData.transactionType === 'Top Up';
  const showActivateNow = showPlanPicker && isPlanSwitch;

  // Keep the flag honest when the selection stops being a switch — otherwise a box ticked while
  // plan B was selected would still be sent after the user reverted to their current plan.
  useEffect(() => {
    if (!showActivateNow && formData.activateNow) {
      setFormData(prev => ({ ...prev, activateNow: false }));
    }
  }, [showActivateNow, formData.activateNow]);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [activeImageSize, setActiveImageSize] = useState<ImageSizeSetting | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
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

  // Load plans and preselect the account's current one, but only for prepaid customers —
  // postpaid never sees a picker so there is nothing to fetch.
  useEffect(() => {
    if (!isOpen || !isPrepaid) return;
    let cancelled = false;

    (async () => {
      setIsLoadingPlans(true);
      try {
        const fetched = await planService.getAllPlans();
        if (cancelled) return;
        const usable = fetched.filter(p => Number(p.price) > 0);
        setPlans(usable);

        // Preselect the plan the customer will actually be on next. A queued switch wins over
        // the plan currently in force — otherwise staff would be shown (and would charge) the
        // outgoing plan's price for a period that will be served on the new one.
        setFormData(prev => {
          if (prev.selectedPlanId) return prev;
          const queued = billingRecord?.pendingPlanId
            ? usable.find(p => p.id === Number(billingRecord.pendingPlanId))
            : undefined;
          const preselect = queued ?? usable.find(p => p.name === extractPlanName(prev.plan));
          if (!preselect) return prev;

          // Prefill the amount with the preselected plan's price so the cashier does not
          // have to look it up. Only when the field is still empty: editing an existing
          // transaction loads its real received_payment, and that must not be overwritten
          // by the plan price.
          const shouldPrefillAmount = !prev.receivedPayment.trim();

          return {
            ...prev,
            selectedPlanId: preselect.id,
            plan: preselect.name,
            ...(shouldPrefillAmount
              ? { receivedPayment: Number(preselect.price ?? 0).toFixed(2) }
              : {}),
          };
        });
      } finally {
        if (!cancelled) setIsLoadingPlans(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, isPrepaid]);

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
      const authData = localStorage.getItem('authData');
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          const userEmail = userData.email_address || userData.email || '';
          if (userEmail) {
            setFormData(prev => ({ ...prev, processedBy: userEmail }));
          }
        } catch (e) {
          console.error('Error refreshing auth data:', e);
        }
      }
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

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      let processedFile = file;
      const originalSize = (file.size / 1024 / 1024).toFixed(2);

      if (activeImageSize && activeImageSize.image_size_value < 100) {
        try {
          const resizedFile = await resizeImage(file, activeImageSize.image_size_value);

          if (resizedFile.size < file.size) {
            processedFile = resizedFile;
          }
        } catch (resizeError) {
          processedFile = file;
        }
      }

      setFormData(prev => ({ ...prev, image: processedFile }));

      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }

      const previewUrl = URL.createObjectURL(processedFile);
      setImagePreview(previewUrl);

      if (errors.image) {
        setErrors(prev => ({ ...prev, image: '' }));
      }
    } catch (error) {
      setFormData(prev => ({ ...prev, image: file }));

      if (imagePreview && imagePreview.startsWith('blob:')) {
        URL.revokeObjectURL(imagePreview);
      }

      const previewUrl = URL.createObjectURL(file);
      setImagePreview(previewUrl);

      if (errors.image) {
        setErrors(prev => ({ ...prev, image: '' }));
      }
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.accountNo.trim()) newErrors.accountNo = 'Account No. is required';
    if (!formData.plan.trim()) newErrors.plan = 'Plan is required';
    // Prepaid buys a plan with the payment, so the choice must be explicit — the field is
    // preselected to the current plan, so this only fires if staff blank it out.
    if (showPlanPicker && !formData.selectedPlanId) newErrors.plan = 'Select the plan this payment is for';
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
          imageFormData.append('payment_proof_image', formData.image, formData.image.name);

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

      const authData = localStorage.getItem('authData');
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
        // Prepaid only. Never sent for postpaid, so their plan can't be changed by a payment —
        // the backend rejects both fields outright on a postpaid account.
        ...(showPlanPicker && formData.selectedPlanId ? { selected_plan_id: formData.selectedPlanId } : {}),
        ...(showActivateNow ? { activate_now: formData.activateNow } : {}),
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      };

      setUploadProgress(80);
      const result = isEdit 
        ? await transactionService.updateTransaction(initialTransactionData.id, payload)
        : await transactionService.createTransaction(payload);
      setUploadProgress(100);

      if (result.success) {
        // Both recurring types settle the account and so wait for approval; 'Top Up' is simply
        // the prepaid name for the same thing.
        const needsApproval = formData.transactionType === 'Recurring Fee'
          || formData.transactionType === 'Top Up';
        setModal({
          isOpen: true,
          type: 'success',
          title: isEdit ? 'Success' : (needsApproval ? 'Pending Approval' : 'Success'),
          message: isEdit
            ? 'Transaction updated successfully!'
            : (needsApproval
              ? `${formData.transactionType} transaction has been submitted successfully.`
                + '\n\nThis transaction requires approval before the account balance is updated.'
                + ' Please approve it in the Transaction List.'
                + (formData.activateNow
                  ? '\n\nOn approval the new plan starts immediately and any remaining days on the'
                    + ' current plan are forfeited.'
                  : '')
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

  return createPortal(
    // Portalled to body and raised above the mobile panel roots (`fixed inset-0
    // z-[9999]` in CustomerDetails / TransactionListDetails). When this drawer is
    // rendered as a SIBLING of such a panel — as TransactionListDetails does — a
    // z-50 root simply loses to z-[9999] and the drawer never appears in phone
    // view. Same reasoning as the two overlays at the bottom of this file, which
    // sit higher still so they can cover this drawer.
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-[10010]">
      <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
        }`}>
        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'
          }`}>
          <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{isEdit ? 'Edit Transaction' : 'Transactions Form'}</h2>
          <div className="flex items-center space-x-3">
            <button
              onClick={handleCancel}
              className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-300 hover:bg-gray-400 text-gray-900'
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

        {/* Form Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">


          {/* Account No */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Account No.<span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                value={formData.accountNo}
                onChange={(e) => handleInputChange('accountNo', e.target.value)}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${errors.accountNo ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              >
                <option value={billingRecord?.applicationId || ''}>{billingRecord?.applicationId || ''} | {billingRecord?.customerName || ''} | {billingRecord?.address || ''}</option>
              </select>
              <ChevronDown className="absolute right-3 top-2.5 text-gray-400" size={20} />
            </div>
            {errors.accountNo && <p className="text-red-500 text-xs mt-1">{errors.accountNo}</p>}
          </div>

          {/* Full Name */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Full Name
            </label>
            <input
              type="text"
              value={formData.fullName}
              readOnly
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 cursor-not-allowed opacity-75 ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-600'
                }`}
            />
          </div>

          {/* Contact No */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              ContactNo
            </label>
            <input
              type="text"
              value={formData.contactNo}
              readOnly
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 cursor-not-allowed opacity-75 ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-600'
                }`}
            />
          </div>

          {/* Plan — editable for PREPAID accounts (they are buying a plan with this payment),
              read-only for postpaid, which is the existing behaviour. */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Plan<span className="text-red-500">*</span>
            </label>

            {showPlanPicker ? (
              <>
                <div className="relative">
                  <select
                    value={formData.selectedPlanId ?? ''}
                    disabled={isLoadingPlans || plans.length === 0}
                    onChange={(e) => {
                      const planId = e.target.value ? Number(e.target.value) : null;
                      const picked = plans.find(p => p.id === planId);
                      setFormData(prev => ({
                        ...prev,
                        selectedPlanId: planId,
                        // Keep `plan` in sync so the existing required-field validation passes
                        // and the label shown elsewhere stays truthful.
                        plan: picked ? picked.name : prev.plan,
                        // Prepaid payments buy a plan, so the amount due IS that plan's price.
                        // Overwritten on an explicit plan change (unlike the initial preselect,
                        // which never clobbers an existing value) because after deliberately
                        // switching plan, the previous plan's price is simply the wrong figure.
                        // Still editable — partial payments and adjustments remain possible.
                        ...(picked ? { receivedPayment: Number(picked.price ?? 0).toFixed(2) } : {}),
                      }));
                      if (errors.plan) setErrors(prev => ({ ...prev, plan: '' }));
                      if (picked && errors.receivedPayment) {
                        setErrors(prev => ({ ...prev, receivedPayment: '' }));
                      }
                    }}
                    className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${errors.plan ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                      } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                      } ${(isLoadingPlans || plans.length === 0) ? 'opacity-60 cursor-not-allowed' : ''}`}
                  >
                    <option value="">
                      {isLoadingPlans ? 'Loading plans…' : (plans.length === 0 ? 'No plans available' : 'Select a plan')}
                    </option>
                    {plans.map(plan => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name} — ₱{Number(plan.price ?? 0).toFixed(2)}
                        {plan.name === extractPlanName(billingRecord?.plan) ? '  (current)' : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-2.5 text-gray-400" size={20} />
                </div>
                {billingRecord?.pendingPlanId ? (
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-amber-400' : 'text-amber-600'}`}>
                    A plan change is already scheduled
                    {billingRecord?.pendingPlanEffectiveAt ? ` for ${String(billingRecord.pendingPlanEffectiveAt).split(' ')[0]}` : ''}
                    {' '}— it is preselected above, so this payment is charged at that plan's price.
                    Choosing the plan currently in force instead will cancel the scheduled change.
                  </p>
                ) : (
                  <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Prepaid account — selecting a different plan schedules the switch for when the
                    current prepaid period ends. If the period has already lapsed it applies on approval.
                  </p>
                )}

                {/* Activate Now — only offered when the selection is a genuine switch, since
                    activating the plan already in force would forfeit the customer's remaining
                    days for nothing. Hidden (and reset) otherwise. */}
                {showActivateNow && (
                  <div className="mt-3">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.activateNow}
                        onChange={(e) => setFormData(prev => ({ ...prev, activateNow: e.target.checked }))}
                        className="mt-0.5 h-4 w-4 cursor-pointer accent-orange-500"
                      />
                      <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        Activate Now
                      </span>
                    </label>

                    {formData.activateNow ? (
                      <div className={`mt-2 rounded border px-3 py-2 text-xs ${isDarkMode
                        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                        : 'border-amber-400 bg-amber-50 text-amber-700'
                        }`}>
                        <strong>Warning:</strong> on approval the new plan starts immediately and the
                        prepaid period is reset to 30 days from the payment date. Any days remaining on
                        the current plan are forfeited and cannot be restored. Any scheduled plan change
                        is cancelled.
                      </div>
                    ) : (
                      <p className={`text-xs mt-1 ml-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        Leave unticked to keep the current plan until the period ends, then switch
                        automatically. The customer keeps the days they already paid for.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <input
                type="text"
                value={formData.plan}
                readOnly
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 cursor-not-allowed opacity-75 ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-gray-100 border-gray-300 text-gray-600'
                  }`}
              />
            )}
            {errors.plan && <p className="text-red-500 text-xs mt-1">{errors.plan}</p>}
          </div>

          {/* Account Balance */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Account Balance<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={`₱ ${formData.accountBalance}`}
              readOnly
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 cursor-not-allowed opacity-75 ${errors.accountBalance ? 'border-red-500' : isDarkMode ? 'border-gray-600 bg-gray-700 text-gray-300' : 'border-gray-300 bg-gray-100 text-gray-600'
                }`}
            />
            {errors.accountBalance && <p className="text-red-500 text-xs mt-1">{errors.accountBalance}</p>}
          </div>

          {/* Payment Date */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Payment Date<span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type="date"
                value={formData.paymentDate}
                onChange={(e) => handleInputChange('paymentDate', e.target.value)}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.paymentDate ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              />
              <Calendar className={`absolute right-3 top-2.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`} size={20} />
            </div>
            {errors.paymentDate && <p className="text-red-500 text-xs mt-1">{errors.paymentDate}</p>}
          </div>

          {/* Received Payment */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Received Payment<span className="text-red-500">*</span>
            </label>
            <div className="flex items-center">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={`₱ ${formData.receivedPayment}`}
                  onChange={(e) => {
                    const val = e.target.value.replace('₱ ', '');
                    if (val === '' || /^\d*\.?\d*$/.test(val)) {
                      handleInputChange('receivedPayment', val);
                    }
                  }}
                  className={`w-full px-3 py-2 border rounded-l focus:outline-none focus:border-orange-500 ${errors.receivedPayment ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                    }`}
                />
              </div>
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => handleReceivedPaymentChange('increase')}
                  className={`px-3 py-1 border text-sm transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-700' : 'bg-gray-200 hover:bg-gray-300 text-gray-900 border-gray-300'
                    } border-l-0`}
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => handleReceivedPaymentChange('decrease')}
                  className={`px-3 py-1 border rounded-r text-sm transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white border-gray-700' : 'bg-gray-200 hover:bg-gray-300 text-gray-900 border-gray-300'
                    } border-l-0 border-t-0`}
                >
                  <Minus size={16} />
                </button>
              </div>
            </div>
            {errors.receivedPayment && <p className="text-red-500 text-xs mt-1">{errors.receivedPayment}</p>}
          </div>

          {/* Processed By */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Processed By<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.processedBy}
              readOnly
              className={`w-full px-3 py-2 border rounded focus:outline-none cursor-not-allowed opacity-75 ${errors.processedBy ? 'border-red-500' : isDarkMode ? 'border-gray-700 bg-gray-700 text-gray-300' : 'border-gray-300 bg-gray-100 text-gray-600'
                }`}
            />
            {errors.processedBy && <p className="text-red-500 text-xs mt-1">{errors.processedBy}</p>}
          </div>

          {/* Payment Method */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Payment Method<span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <select
                value={formData.paymentMethod}
                onChange={(e) => handleInputChange('paymentMethod', e.target.value)}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 appearance-none ${errors.paymentMethod ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                  }`}
              >
                <option value="">Select Payment Method</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.payment_method}>
                    {method.payment_method}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-2.5 text-gray-400" size={20} />
            </div>
            {errors.paymentMethod && <p className="text-red-500 text-xs mt-1">{errors.paymentMethod}</p>}
          </div>

          {/* Reference No */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Reference No.<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.referenceNo}
              onChange={(e) => handleInputChange('referenceNo', e.target.value)}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.referenceNo ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
            />
            {errors.referenceNo && <p className="text-red-500 text-xs mt-1">{errors.referenceNo}</p>}
          </div>

          {/* OR No */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              OR No.<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.orNo}
              onChange={(e) => handleInputChange('orNo', e.target.value)}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 ${errors.orNo ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                } ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'
                }`}
            />
            {errors.orNo && <p className="text-red-500 text-xs mt-1">{errors.orNo}</p>}
          </div>

          {/* Transaction Type */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Transaction Type<span className="text-red-500">*</span>
            </label>
            {/* Three columns for the three offered types. A retired type carried by a row being
                edited becomes a fourth and simply wraps to the next line. */}
            <div className="grid grid-cols-3 gap-2">
              {transactionTypes.map((type) => {
                const isSelected = formData.transactionType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleTransactionTypeChange(type)}
                    className={`px-4 py-2 rounded text-sm font-medium transition-colors ${isSelected
                      ? 'text-white'
                      : isDarkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    style={isSelected ? {
                      backgroundColor: colorPalette?.primary || '#7c3aed'
                    } : undefined}
                    onMouseEnter={(e) => {
                      if (isSelected && colorPalette?.accent) {
                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (isSelected && colorPalette?.primary) {
                        e.currentTarget.style.backgroundColor = colorPalette.primary;
                      }
                    }}
                  >
                    {type}
                  </button>
                );
              })}
            </div>

            {/* Only reachable when EDITING a transaction recorded before Security Deposit was
                retired — it is no longer in either dropdown. Kept so such a row still explains
                itself, and because the backend still handles the value exactly this way. */}
            {formData.transactionType === 'Security Deposit' && (
              <p className="text-orange-500 text-xs mt-2">
                Note: Security deposits do not affect the account balance or invoices.
                This type is no longer available for new transactions.
              </p>
            )}
            {errors.transactionType && <p className="text-red-500 text-xs mt-1">{errors.transactionType}</p>}
          </div>

          {/* Remarks */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Remarks
            </label>
            <textarea
              value={formData.remarks}
              onChange={(e) => handleInputChange('remarks', e.target.value)}
              rows={3}
              className={`w-full px-3 py-2 border rounded focus:outline-none focus:border-orange-500 resize-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
                }`}
            />
          </div>

          {/* Image Upload */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              Payment Proof Image
            </label>
            <div className={`relative w-full border rounded overflow-hidden cursor-pointer ${isDarkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-750' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'
              } ${imagePreview ? 'h-auto' : 'h-48'}`}>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              {imagePreview ? (
                <div className="relative w-full">
                  <img
                    src={imagePreview}
                    alt="Payment Proof"
                    className="w-full h-auto object-contain block"
                  />
                  <div className="absolute bottom-2 right-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center pointer-events-none shadow-md z-20">
                    <Camera className="mr-1" size={14} />Uploaded
                  </div>
                </div>
              ) : (
                <div className={`w-full h-full flex flex-col items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                  }`}>
                  <Camera size={32} />
                  <span className="text-sm mt-2">Click to upload payment proof</span>
                  {formData.image && (
                    <p className={`mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'
                      }`}>
                      Selected: {formData.image.name}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/*
        Both overlays are rendered into document.body via a portal instead of
        inline here.

        On mobile, CustomerDetails (this modal's parent) switches its root to
        `fixed inset-0 z-[9999] overflow-hidden`. That establishes a stacking
        context AND a clipping box around everything inside it, so an overlay
        nested in here is confined to that context no matter how high its own
        z-index is — the confirm dialog at z-[60] lost that fight and never
        appeared in mobile view. Portalling to body puts both overlays outside
        every app container, which is the only placement that cannot be trapped
        by an ancestor's stacking context, overflow, or transform.
      */}
      {loading && createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-70 z-[10040] flex items-center justify-center">
          <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            <Loader2
              className="w-20 h-20 animate-spin"
              style={{ color: colorPalette?.primary || '#7c3aed' }}
            />
            <div className="text-center">
              <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>{uploadProgress}%</p>
            </div>
          </div>
        </div>,
        document.body
      )}

      {modal.isOpen && createPortal(
        // Above the loading overlay: if both are ever up at once the dialog must
        // win, otherwise the user is left staring at a spinner they cannot dismiss.
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10050] p-4">
          <div className={`border rounded-lg p-6 sm:p-8 max-w-md w-full max-h-[90dvh] overflow-y-auto ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
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
        </div>,
        document.body
      )}
    </div>,
    document.body
  );
});

export default TransactionFormModal;
