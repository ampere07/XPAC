import React, { useState, useEffect, useRef } from 'react';
import { X, Settings, Edit2, Trash2, Loader2, UserCheck, UserMinus, DollarSign } from 'lucide-react';
import { User as UserType } from '../types/api';
import { ColorPalette } from '../services/settingsColorPaletteService';
import { userService } from '../services/userService';
import { useUserStore } from '../store/userStore';

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface UserDetailsProps {
  user: UserType;
  onClose: () => void;
  onEdit?: (user: UserType) => void;
  /** Whether the viewer may delete this user. Users Management decides. */
  canDelete?: boolean;
  isMobile: boolean;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
}

const UserDetails: React.FC<UserDetailsProps> = ({
  user,
  onClose,
  onEdit,
  canDelete = true,
  isMobile,
  isDarkMode,
  colorPalette
}) => {
  const [localIsMobile, setLocalIsMobile] = useState<boolean>(window.innerWidth < 768);
  useEffect(() => {
    const handleResize = () => {
      setLocalIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const activeIsMobile = isMobile || localIsMobile;

  const [detailsWidth, setDetailsWidth] = useState<number>(800);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(0);

  const [showFieldSettings, setShowFieldSettings] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  const { users, removeUser, updateUser: updateStoreUser } = useUserStore();
  const displayUser = users.find(u => u.id === user.id) || user;

  const isAgent = displayUser.role_id === 4 || displayUser.role?.id === 4 || displayUser.role?.role_name?.toLowerCase() === 'agent';

  const [isEditingCommission, setIsEditingCommission] = useState(false);
  const [commissionInput, setCommissionInput] = useState('');
  const [commissionSaving, setCommissionSaving] = useState(false);

  const getFullName = (u: UserType): string => {
    const parts = [u.first_name, u.middle_initial, u.last_name].filter(Boolean);
    return parts.join(' ');
  };

  const FIELD_VISIBILITY_KEY = 'userDetailsFieldVisibility';
  const FIELD_ORDER_KEY = 'userDetailsFieldOrder';

  const defaultFields = [
    'fullName',
    'username',
    'email',
    'contactNumber',
    'role',
    'organization',
    'activeStatus',
    'memberSince',
    ...(isAgent ? ['commissionRate', 'quota', 'incentiveValue'] : [])
  ];

  const [fieldVisibility, setFieldVisibility] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(FIELD_VISIBILITY_KEY);
    const defaults = defaultFields.reduce((acc: Record<string, boolean>, field) => ({ ...acc, [field]: true }), {});
    if (saved) return { ...defaults, ...JSON.parse(saved) };
    return defaults;
  });

  const [fieldOrder, setFieldOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem(FIELD_ORDER_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure all current defaultFields are present
      defaultFields.forEach(f => {
        if (!parsed.includes(f)) parsed.push(f);
      });
      return parsed;
    }
    return defaultFields;
  });

  useEffect(() => {
    localStorage.setItem(FIELD_VISIBILITY_KEY, JSON.stringify(fieldVisibility));
  }, [fieldVisibility]);

  useEffect(() => {
    localStorage.setItem(FIELD_ORDER_KEY, JSON.stringify(fieldOrder));
  }, [fieldOrder]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const diff = startXRef.current - e.clientX;
      const newWidth = Math.max(600, Math.min(1200, startWidthRef.current + diff));
      setDetailsWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    startXRef.current = e.clientX;
    startWidthRef.current = detailsWidth;
  };

  const getFieldLabel = (fieldKey: string): string => {
    const labels: Record<string, string> = {
      fullName: 'Full Name',
      username: 'Username',
      email: 'Email Address',
      contactNumber: 'Contact Number',
      role: 'System Role',
      organization: 'Organization',
      activeStatus: 'Account Status',
      memberSince: 'Member Since',
      commissionRate: 'Commission Rate',
      quota: 'Quota',
      incentiveValue: 'Incentive Value'
    };
    return labels[fieldKey] || fieldKey;
  };

  const toggleFieldVisibility = (field: string) => {
    setFieldVisibility(prev => ({ ...prev, [field]: !prev[field] }));
  };

  const selectAllFields = () => {
    const allVisible = defaultFields.reduce((acc: Record<string, boolean>, field: string) => ({ ...acc, [field]: true }), {});
    setFieldVisibility(allVisible);
  };

  const deselectAllFields = () => {
    const allHidden = defaultFields.reduce((acc: Record<string, boolean>, field: string) => ({ ...acc, [field]: false }), {});
    setFieldVisibility(allHidden);
  };

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (dropIndex: number) => {
    if (draggedIndex === null) return;
    const newOrder = [...fieldOrder];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setFieldOrder(newOrder);
    setDraggedIndex(null);
  };
  const handleDragEnd = () => setDraggedIndex(null);
  const resetFieldSettings = () => {
    setFieldOrder(defaultFields);
    selectAllFields();
  };

  const handleToggleActive = () => {
    const isDeactivating = displayUser.active !== false;
    setModal({
      isOpen: true,
      type: 'confirm',
      title: isDeactivating ? 'Deactivate User' : 'Activate User',
      message: `Are you sure you want to ${isDeactivating ? 'deactivate' : 'activate'} user "${getFullName(displayUser)}"?`,
      onConfirm: performToggleActive,
      onCancel: () => setModal(prev => ({ ...prev, isOpen: false }))
    });
  };

  const performToggleActive = async () => {
    setModal(prev => ({ ...prev, isOpen: false }));
    setLoading(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 99) return 99;
        return prev + 5;
      });
    }, 100);

    try {
      const newActiveStatus = !displayUser.active;
      const res = await userService.updateUser(displayUser.id, { active: newActiveStatus });
      
      clearInterval(progressInterval);
      setLoadingPercentage(100);
      
      if (res.success && res.data) {
        updateStoreUser(res.data);
        
        setTimeout(() => {
          setLoading(false);
          setModal({
            isOpen: true,
            type: 'success',
            title: 'Status Updated',
            message: `User "${getFullName(displayUser)}" has been ${newActiveStatus ? 'activated' : 'deactivated'}.`,
            onConfirm: () => setModal(prev => ({ ...prev, isOpen: false }))
          });
        }, 500);
      } else {
        setLoading(false);
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Update Failed',
          message: res.message || 'Failed to update user status'
        });
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: err.message || 'Error updating user status'
      });
    }
  };

  const handleDeleteConfirm = async () => {
    setModal(prev => ({ ...prev, isOpen: false }));
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
      const res = await userService.deleteUser(user.id);
      
      clearInterval(progressInterval);
      setLoadingPercentage(100);
      
      if (res.success) {
        removeUser(user.id);
        
        setTimeout(() => {
          setLoading(false);
          setModal({
            isOpen: true,
            type: 'success',
            title: 'Deleted Successfully',
            message: `User "${getFullName(user)}" has been deleted.`,
            onConfirm: () => {
              setModal(prev => ({ ...prev, isOpen: false }));
              onClose(); // Close details view after deletion
            }
          });
        }, 500);
      } else {
        setLoading(false);
        setModal({
          isOpen: true,
          type: 'error',
          title: 'Delete Failed',
          message: res.message || 'Failed to delete user'
        });
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: err.message || 'Error deleting user'
      });
    }
  };

  const renderFieldContent = (fieldKey: string) => {
    if (!fieldVisibility[fieldKey]) return null;

    const baseFieldClass = `flex border-b pb-4 ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`;
    const labelClass = `w-40 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`;
    const valueClass = `flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`;

    switch (fieldKey) {
      case 'fullName':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Full Name:</div>
            <div className={valueClass}>{getFullName(displayUser) || 'N/A'}</div>
          </div>
        );
      case 'username':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Username:</div>
            <div className={valueClass}>{displayUser.username || 'N/A'}</div>
          </div>
        );
      case 'email':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Email Address:</div>
            <div className={valueClass}>{displayUser.email_address || 'N/A'}</div>
          </div>
        );
      case 'contactNumber':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Contact Number:</div>
            <div className={valueClass}>{displayUser.contact_number || 'N/A'}</div>
          </div>
        );
      case 'role':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>System Role:</div>
            <div className={valueClass}>{displayUser.role?.role_name || 'N/A'}</div>
          </div>
        );
      case 'organization':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Organization:</div>
            <div className={valueClass}>{displayUser.organization?.organization_name || 'N/A'}</div>
          </div>
        );
      case 'activeStatus':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Account Status:</div>
            <div className={valueClass}>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                displayUser.active !== false 
                  ? (isDarkMode ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700')
                  : (isDarkMode ? 'bg-red-500/20 text-red-400' : 'bg-red-100 text-red-700')
              }`}>
                {displayUser.active !== false ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        );
      case 'memberSince':
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Member Since:</div>
            <div className={valueClass}>{displayUser.created_at ? (() => {
              const date = new Date(displayUser.created_at);
              if (isNaN(date.getTime())) return displayUser.created_at;
              const mm = String(date.getMonth() + 1).padStart(2, '0');
              const dd = String(date.getDate()).padStart(2, '0');
              const yyyy = date.getFullYear();
              return `${mm}/${dd}/${yyyy}`;
            })() : 'N/A'}</div>
          </div>
        );
      case 'commissionRate':
        if (!isAgent) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Commission Rate:</div>
            <div className={valueClass}>
              {displayUser.agent_balance?.commission !== undefined && displayUser.agent_balance?.commission !== null
                ? `₱${Number(displayUser.agent_balance.commission).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                : '₱0.00'}
            </div>
          </div>
        );
      case 'quota':
        if (!isAgent) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Quota:</div>
            {/* A count of completed referrals per incentive batch, not an amount. */}
            <div className={valueClass}>
              {(() => {
                const quota = Number(displayUser.agent_balance?.quota ?? 0);
                if (!quota) return 'Not set';
                return `${quota.toLocaleString()} ${quota === 1 ? 'referral' : 'referrals'}`;
              })()}
            </div>
          </div>
        );
      case 'incentiveValue':
        if (!isAgent) return null;
        return (
          <div className={baseFieldClass}>
            <div className={labelClass}>Incentive Value:</div>
            <div className={valueClass}>
              {displayUser.agent_balance?.incentives_value !== undefined && displayUser.agent_balance?.incentives_value !== null
                ? `₱${Number(displayUser.agent_balance.incentives_value).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                : '₱0.00'}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

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
          <div className={`border rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
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
                        onClick={() => setModal(prev => ({ ...prev, isOpen: false }))}
                        className={`px-4 py-2 rounded transition-colors ${isDarkMode
                          ? 'bg-gray-700 hover:bg-gray-600 text-white'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                          }`}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (modal.onConfirm) {
                            modal.onConfirm();
                          } else {
                            handleDeleteConfirm();
                          }
                        }}
                        className="px-4 py-2 text-white rounded transition-colors shadow-lg active:scale-95"
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
                          setModal(prev => ({ ...prev, isOpen: false }));
                        }
                      }}
                      className="px-4 py-2 text-white rounded transition-colors shadow-lg active:scale-95"
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

      {isEditingCommission && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className={`border rounded-lg p-6 max-w-sm w-full mx-4 shadow-2xl ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-200 text-gray-900'
            }`}>
            <h3 className="text-lg font-semibold mb-4">Update Commission Rate</h3>
            <p className={`text-xs mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Set the default commission rate for agent {getFullName(displayUser)}.
            </p>
            <div className="mb-6 relative">
              <span className="absolute left-3 top-2.5 text-gray-400">₱</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={commissionInput}
                onChange={(e) => setCommissionInput(e.target.value)}
                placeholder="0.00"
                className={`w-full pl-7 pr-4 py-2 border rounded focus:outline-none transition-colors ${
                  isDarkMode ? 'bg-gray-750 border-gray-650 text-white focus:border-blue-500' : 'bg-white border-gray-300 text-gray-900 focus:border-blue-500'
                }`}
                disabled={commissionSaving}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setIsEditingCommission(false)}
                className={`px-4 py-2 rounded transition-colors text-sm font-medium ${
                  isDarkMode ? 'bg-gray-750 hover:bg-gray-700 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
                disabled={commissionSaving}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  setCommissionSaving(true);
                  try {
                    const commissionVal = parseFloat(commissionInput);
                    const res = await userService.updateUser(displayUser.id, {
                      commission: isNaN(commissionVal) ? 0 : commissionVal
                    });
                    if (res.success && res.data) {
                      updateStoreUser(res.data);
                      setIsEditingCommission(false);
                      setModal({
                        isOpen: true,
                        type: 'success',
                        title: 'Success',
                        message: 'Commission rate updated successfully.'
                      });
                    } else {
                      setModal({
                        isOpen: true,
                        type: 'error',
                        title: 'Error',
                        message: res.message || 'Failed to update commission rate.'
                      });
                    }
                  } catch (err: any) {
                    setModal({
                      isOpen: true,
                      type: 'error',
                      title: 'Error',
                      message: err.message || 'Error updating commission rate.'
                    });
                  } finally {
                    setCommissionSaving(false);
                  }
                }}
                className="px-4 py-2 text-white rounded transition-colors shadow-lg active:scale-95 text-sm font-medium flex items-center gap-2"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                disabled={commissionSaving}
              >
                {commissionSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`${
          activeIsMobile
            ? 'fixed inset-0 z-[9999] w-screen h-[100dvh] max-h-[100dvh]'
            : 'h-full flex flex-col overflow-hidden md:border-l relative w-full md:w-auto transition-all duration-300'
        } flex flex-col overflow-hidden relative ${isDarkMode ? 'bg-gray-950 border-white border-opacity-30' : 'bg-gray-50 border-gray-300'}`}
        style={!activeIsMobile && window.innerWidth >= 768 ? { width: `${detailsWidth}px` } : undefined}
      >
        {!activeIsMobile && (
          <div
            className={`hidden md:block absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors z-50 ${isDarkMode ? 'hover:bg-orange-500' : 'hover:bg-orange-600'}`}
            onMouseDown={handleMouseDownResize}
          />
        )}

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className={`flex-shrink-0 p-3 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
            <div className="flex-1 min-w-0 pr-4">
              <h2 className={`truncate text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{getFullName(displayUser)}</h2>
            </div>

            <div className="flex items-center space-x-2 flex-shrink-0 ml-auto">
              <button
                onClick={handleToggleActive}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 active:scale-95 shadow-sm"
                style={{ 
                  backgroundColor: displayUser.active !== false 
                    ? (colorPalette?.accent || '#f59e0b') 
                    : (colorPalette?.primary || '#10b981') 
                }}
              >
                {displayUser.active !== false ? (
                  <>
                    <UserMinus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Deactivate</span>
                  </>
                ) : (
                  <>
                    <UserCheck className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Activate</span>
                  </>
                )}
              </button>
              {isAgent && (
                <button
                  onClick={() => {
                    setCommissionInput(
                      displayUser.agent_balance?.commission !== undefined && displayUser.agent_balance?.commission !== null
                        ? String(displayUser.agent_balance.commission)
                        : ''
                    );
                    setIsEditingCommission(true);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 active:scale-95 shadow-sm"
                  style={{ backgroundColor: colorPalette?.accent || '#f59e0b' }}
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Commission Rate</span>
                </button>
              )}
              {onEdit && (
                <button
                  onClick={() => onEdit(displayUser)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-opacity hover:opacity-90 active:scale-95 shadow-sm"
                  style={{ backgroundColor: colorPalette?.primary || '#3b82f6' }}
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Edit</span>
                </button>
              )}
              {canDelete && (
              <button
                onClick={() => {
                  setModal({
                    isOpen: true,
                    type: 'confirm',
                    title: 'Delete User',
                    message: `Are you sure you want to delete user "${getFullName(displayUser)}"?`,
                    onConfirm: handleDeleteConfirm,
                    onCancel: () => setModal(prev => ({ ...prev, isOpen: false }))
                  });
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all active:scale-95 shadow-sm ${isDarkMode ? 'border-red-500/50 text-red-500 hover:bg-red-500/10' : 'border-red-200 text-red-600 hover:bg-red-50'}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Delete</span>
              </button>
              )}

              <div className="relative">
                <button
                  onClick={() => setShowFieldSettings(!showFieldSettings)}
                  className={isDarkMode ? 'hover:text-white text-gray-400 p-1.5' : 'hover:text-gray-900 text-gray-600 p-1.5'}
                  title="Field Settings"
                >
                  <Settings size={16} />
                </button>
                {showFieldSettings && (
                  <div className={`absolute right-0 mt-2 w-80 rounded-lg shadow-2xl border z-50 max-h-96 overflow-y-auto ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
                    <div className={`px-4 py-3 border-b flex items-center justify-between ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                      <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Field Visibility & Order</h3>
                      <div className="flex items-center space-x-2">
                        <button onClick={selectAllFields} className="text-blue-600 hover:text-blue-700 text-xs">Show All</button>
                        <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                        <button onClick={deselectAllFields} className="text-blue-600 hover:text-blue-700 text-xs">Hide All</button>
                        <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>|</span>
                        <button onClick={resetFieldSettings} className="text-blue-600 hover:text-blue-700 text-xs">Reset</button>
                      </div>
                    </div>
                    <div className="p-2">
                      <div className={`text-xs mb-2 px-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Drag to reorder fields</div>
                      {fieldOrder.map((fieldKey, index) => (
                        <div
                          key={fieldKey}
                          draggable
                          onDragStart={() => handleDragStart(index)}
                          onDragOver={handleDragOver}
                          onDrop={() => handleDrop(index)}
                          onDragEnd={handleDragEnd}
                          className={`flex items-center space-x-2 px-2 py-1.5 rounded cursor-move transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} ${draggedIndex === index ? (isDarkMode ? 'bg-gray-600' : 'bg-gray-200') : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={fieldVisibility[fieldKey]}
                            onChange={() => toggleFieldVisibility(fieldKey)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>☰</span>
                          <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{getFieldLabel(fieldKey)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-100 text-gray-600 hover:text-gray-900'}`}
                aria-label="Close"
              >
                <X size={18} />
              </button>

            </div>
          </div>

          <div className={`flex-1 min-h-0 overflow-y-auto w-full relative ${activeIsMobile ? 'pb-24' : ''}`}>
            <div className={`max-w-2xl mx-auto py-6 px-4 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
              <div className="space-y-4">
                {fieldOrder.map((fieldKey) => (
                  <React.Fragment key={fieldKey}>
                    {renderFieldContent(fieldKey)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default UserDetails;
