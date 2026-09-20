import React, { useState, useEffect } from 'react';
import apiClient from '../config/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { usePageActions } from '../hooks/usePageActions';

interface RadiusConfigData {
  id: number;
  ssl_type: string;
  ip: string;
  port: string;
  username: string;
  password: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  is_online?: boolean;
  latency?: number;
  public_ip?: string;
  loss?: number;
  anti_radi?: number;
  checked_at?: string;
}

interface RadiusConfigResponse {
  success: boolean;
  data: RadiusConfigData[];
  count: number;
  message?: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const RadiusConfig: React.FC = () => {
  // Add, Edit and Delete are granted separately. The same keys the API
  // demands, so a control is only drawn when the request behind it would
  // succeed.
  const actions = usePageActions('radius-config');

  const [radiusConfigs, setRadiusConfigs] = useState<RadiusConfigData[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<Record<number, boolean>>({});
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [nextUpdateIn, setNextUpdateIn] = useState<number>(60);

  const [formData, setFormData] = useState({
    ssl_type: '',
    ip: '',
    port: '',
    username: '',
    password: ''
  });

  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  // Safe delete modal state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [idToDelete, setIdToDelete] = useState<number | null>(null);
  const [confirmInput, setConfirmInput] = useState('');

  const fetchRadiusConfigs = async (isSilent: boolean = false) => {
    try {
      if (!isSilent) setLoading(true);
      const response = await apiClient.get<RadiusConfigResponse>('/radius-config');
      if (response.data.success && response.data.data) {
        setRadiusConfigs(response.data.data);
        setLastUpdate(new Date());
        setNextUpdateIn(60);
      } else {
        setRadiusConfigs([]);
      }
    } catch (error) {
      console.error('Error fetching radius configs:', error);
      setRadiusConfigs([]);
    } finally {
      if (!isSilent) setLoading(false);
    }
  };

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
    fetchRadiusConfigs();
    
    // Set up polling for latest data every 2 minutes (120,000 ms)
    const pollingInterval = setInterval(() => {
      fetchRadiusConfigs(true);
    }, 120000);

    // Set up countdown timer
    const timerInterval = setInterval(() => {
      setNextUpdateIn(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      clearInterval(pollingInterval);
      clearInterval(timerInterval);
    };
  }, []);

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const resetForm = () => {
    setFormData({
      ssl_type: '',
      ip: '',
      port: '',
      username: '',
      password: ''
    });
  };

  const handleStartCreate = () => {
    if (!actions.canCreate) return;
    resetForm();
    setIsCreating(true);
  };

  const handleStartEdit = (config: RadiusConfigData) => {
    if (!actions.canEdit) return;
    setFormData({
      ssl_type: config.ssl_type || '',
      ip: config.ip || '',
      port: config.port || '',
      username: config.username || '',
      password: config.password || ''
    });
    setEditingId(config.id);
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      const authData = localStorage.getItem('authData');
      let userEmail = '';
      if (authData) {
        try {
          const userData = JSON.parse(authData);
          userEmail = userData.email || userData.user?.email || '';
        } catch (error) {
          console.error('Error parsing auth data:', error);
        }
      }

      const payload = {
        ...formData,
        updated_by: userEmail
      };

      if (isCreating) {
        await apiClient.post('/radius-config', payload);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'RADIUS configuration created successfully'
        });
        setIsCreating(false);
      } else if (editingId !== null) {
        await apiClient.put(`/radius-config/${editingId}`, payload);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'RADIUS configuration updated successfully'
        });
        setEditingId(null);
      }

      await fetchRadiusConfigs();
      resetForm();
      setShowPassword({});
    } catch (error: any) {
      console.error('Error saving radius config:', error);
      const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || 'Unknown error occurred';
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to save: ${errorMessage}`
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (id: number) => {
    if (!actions.canDelete) return;
    setIdToDelete(id);
    setConfirmInput('');
    setIsDeleteModalOpen(true);
  };

  const executeDelete = async () => {
    if (confirmInput.toLowerCase() !== 'confirm' || !idToDelete) return;

    try {
      setIsDeleteModalOpen(false);
      setLoading(true);
      await apiClient.delete(`/radius-config/${idToDelete}`);
      setModal({
        isOpen: true,
        type: 'success',
        title: 'Success',
        message: 'RADIUS configuration deleted successfully'
      });
      await fetchRadiusConfigs();
    } catch (error: any) {
      console.error('Error deleting radius config:', error);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: `Failed to delete: ${error.response?.data?.message || error.message}`
      });
    } finally {
      setLoading(false);
      setIdToDelete(null);
      setConfirmInput('');
    }
  };

  const handleCancel = () => {
    resetForm();
    setIsCreating(false);
    setEditingId(null);
    setShowPassword({});
  };

  const togglePasswordVisibility = (id: number) => {
    setShowPassword(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const canCreateNew = radiusConfigs.length < 2;

  return (
    <div className={`p-4 min-h-full ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
      }`}>
      <div className={`mb-4 pb-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
        }`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className={`text-xl font-semibold mb-1 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>
              RADIUS Configuration
            </h2>
          </div>
          {actions.canCreate && canCreateNew && !isCreating && editingId === null && (
            <button
              onClick={handleStartCreate}
              className="px-3 py-1.5 text-white text-sm rounded transition-colors"
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
              Create New
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {loading && radiusConfigs.length === 0 && !isCreating ? (
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
          </div>
        ) : (
          <>
            {radiusConfigs.map((config) => (
              <div key={config.id} className={`rounded p-4 border ${isDarkMode
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-white border-gray-300'
                }`}>
                {editingId === config.id ? (
                  <div className="space-y-3">
                    <h3 className={`text-base font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>Edit Configuration #{config.id}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                          Connection Type
                        </label>
                        <select
                          value={formData.ssl_type}
                          onChange={(e) => handleInputChange('ssl_type', e.target.value)}
                          className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                              ? 'bg-gray-700 border-gray-600 text-white'
                              : 'bg-white border-gray-300 text-gray-900'
                            }`}
                          disabled={loading}
                        >
                          <option value="">Select Connection Type</option>
                          <option value="https">HTTPS</option>
                          <option value="http">HTTP</option>
                        </select>
                      </div>

                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                          IP Address
                        </label>
                        <input
                          type="text"
                          value={formData.ip}
                          onChange={(e) => handleInputChange('ip', e.target.value)}
                          placeholder="e.g., 192.168.1.1"
                          className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                              ? 'bg-gray-700 border-gray-600 text-white'
                              : 'bg-white border-gray-300 text-gray-900'
                            }`}
                          disabled={loading}
                        />
                      </div>

                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                          Port
                        </label>
                        <input
                          type="text"
                          value={formData.port}
                          onChange={(e) => handleInputChange('port', e.target.value)}
                          placeholder="e.g., 1812"
                          className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                              ? 'bg-gray-700 border-gray-600 text-white'
                              : 'bg-white border-gray-300 text-gray-900'
                            }`}
                          disabled={loading}
                        />
                      </div>

                      <div>
                        <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                          Username
                        </label>
                        <input
                          type="text"
                          value={formData.username}
                          onChange={(e) => handleInputChange('username', e.target.value)}
                          placeholder="Enter username"
                          className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                              ? 'bg-gray-700 border-gray-600 text-white'
                              : 'bg-white border-gray-300 text-gray-900'
                            }`}
                          disabled={loading}
                        />
                      </div>

                      <div className="md:col-span-2">
                        <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                          }`}>
                          Password
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword[config.id] ? 'text' : 'password'}
                            value={formData.password}
                            onChange={(e) => handleInputChange('password', e.target.value)}
                            placeholder="Enter password"
                            className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                                ? 'bg-gray-700 border-gray-600 text-white'
                                : 'bg-white border-gray-300 text-gray-900'
                              }`}
                            disabled={loading}
                          />
                          <button
                            type="button"
                            onClick={() => togglePasswordVisibility(config.id)}
                            className={`absolute right-2 top-1/2 transform -translate-y-1/2 text-xs ${isDarkMode
                                ? 'text-gray-400 hover:text-gray-300'
                                : 'text-gray-600 hover:text-gray-800'
                              }`}
                          >
                            {showPassword[config.id] ? 'Hide' : 'Show'}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-3 py-1.5 text-sm disabled:opacity-50 text-white rounded transition-colors"
                        style={{
                          backgroundColor: loading ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                        }}
                        onMouseEnter={(e) => {
                          if (!loading && colorPalette?.accent) {
                            e.currentTarget.style.backgroundColor = colorPalette.accent;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!loading) {
                            e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                          }
                        }}
                      >
                        Update
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={loading}
                        className={`px-3 py-1.5 text-sm disabled:opacity-50 rounded transition-colors ${isDarkMode
                            ? 'bg-gray-700 hover:bg-gray-600 text-white'
                            : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                          }`}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <h3 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>Configuration #{config.id}</h3>
                        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          config.is_online 
                            ? (isDarkMode ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-green-50 text-green-600 border-green-200')
                            : (isDarkMode ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-red-50 text-red-600 border-red-200')
                        }`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${config.is_online ? 'bg-green-500' : 'bg-red-500'}`}></div>
                          {config.is_online ? 'ONLINE' : 'OFFLINE'}
                        </div>
                        <span className={`text-[10px] font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          Last Sync: {new Date(config.updated_at).toLocaleString('en-US', {
                            month: '2-digit',
                            day: '2-digit',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true
                          }).replace(',', '')}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {actions.canEdit && (
                        <button
                          onClick={() => handleStartEdit(config)}
                          className={`px-3 py-1 text-sm rounded transition-colors ${isDarkMode
                              ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-900'
                              : 'text-blue-600 hover:text-blue-700 hover:bg-blue-100'
                            }`}
                        >
                          Edit
                        </button>
                        )}
                        {actions.canDelete && (
                        <button
                          onClick={() => handleDelete(config.id)}
                          className={`px-3 py-1 text-sm rounded transition-colors ${isDarkMode
                              ? 'text-red-400 hover:text-red-300 hover:bg-red-900'
                              : 'text-red-600 hover:text-red-700 hover:bg-red-100'
                            }`}
                        >
                          Delete
                        </button>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {/* Existing fields ... */}
                      <div className={`p-2.5 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                        }`}>
                        <p className={`text-xs mb-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Connection Type</p>
                        <p className={`font-medium text-sm uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>{config.ssl_type || 'Not set'}</p>
                      </div>
                      <div className={`p-2.5 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                        }`}>
                        <p className={`text-xs mb-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>IP Address</p>
                        <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>{config.ip || 'Not set'}</p>
                      </div>
                      <div className={`p-2.5 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                        }`}>
                        <p className={`text-xs mb-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Port</p>
                        <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>{config.port || 'Not set'}</p>
                      </div>
                      <div className={`p-2.5 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                        }`}>
                        <p className={`text-xs mb-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Username</p>
                        <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>{config.username || 'Not set'}</p>
                      </div>
                      <div className={`p-2.5 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                        }`}>
                        <p className={`text-xs mb-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Password</p>
                        <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>
                          {showPassword[config.id] ? config.password : '••••••••'}
                        </p>
                        <button
                          onClick={() => togglePasswordVisibility(config.id)}
                          className={`text-xs ${isDarkMode
                              ? 'text-orange-400 hover:text-orange-300'
                              : 'text-orange-600 hover:text-orange-700'
                            }`}
                        >
                          {showPassword[config.id] ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <div className={`p-2.5 rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                        }`}>
                        <p className={`text-xs mb-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>Last Updated Info</p>
                        <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'
                          }`}>{config.updated_by || 'Unknown'}</p>
                        <p className={`text-[10px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          {new Date(config.updated_at).toLocaleString('en-US', {
                            month: '2-digit',
                            day: '2-digit',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true
                          }).replace(',', '')}
                        </p>
                      </div>
                    </div>

                    {/* Logs Container */}
                    <div className={`mt-4 pt-3 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <h4 className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Connection Metrics</h4>
                          {config.checked_at && (
                            <span className={`text-[9px] font-mono ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                              Audit: {config.checked_at.split(' ')[1]}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${config.is_online ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        </div>
                      </div>
                      <div className={`grid grid-cols-2 md:grid-cols-5 gap-2 p-3 rounded-lg ${isDarkMode ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
                        <div>
                          <p className={`text-[10px] mb-0.5 font-semibold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>ANTI-RADI</p>
                          <p className={`font-mono text-xs ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}>{config.anti_radi ?? 1}</p>
                        </div>
                        <div>
                          <p className={`text-[10px] mb-0.5 font-semibold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>PUBLIC IP</p>
                          <p className={`font-mono text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{config.public_ip || config.ip || '0.0.0.0'}</p>
                        </div>
                        <div>
                          <p className={`text-[10px] mb-0.5 font-semibold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>PING</p>
                          <p className={`font-mono text-xs ${config.is_online ? (isDarkMode ? 'text-green-400' : 'text-green-600') : (isDarkMode ? 'text-red-400' : 'text-red-600')}`}>
                            {config.is_online ? `${config.latency}ms` : 'TIMEOUT'}
                          </p>
                        </div>
                        <div>
                          <p className={`text-[10px] mb-0.5 font-semibold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>LOSS</p>
                          <p className={`font-mono text-xs ${config.is_online ? (isDarkMode ? 'text-green-400' : 'text-green-600') : (isDarkMode ? 'text-red-400' : 'text-red-600')}`}>
                            {config.loss ?? (config.is_online ? '0%' : '100%')}{typeof config.loss === 'number' ? '%' : ''}
                          </p>
                        </div>
                        <div>
                          <p className={`text-[10px] mb-0.5 font-semibold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>API PORT</p>
                          <p className={`font-mono text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{config.port || '8728'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isCreating && (
              <div className={`rounded p-4 border ${isDarkMode
                  ? 'bg-gray-800 border-gray-700'
                  : 'bg-white border-gray-300'
                }`}>
                <h3 className={`text-base font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>Create New Configuration</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                        Connection Type
                      </label>
                      <select
                        value={formData.ssl_type}
                        onChange={(e) => handleInputChange('ssl_type', e.target.value)}
                        className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                            ? 'bg-gray-700 border-gray-600 text-white'
                            : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        disabled={loading}
                      >
                        <option value="">Select Connection Type</option>
                        <option value="https">HTTPS</option>
                        <option value="http">HTTP</option>
                      </select>
                    </div>

                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                        IP Address
                      </label>
                      <input
                        type="text"
                        value={formData.ip}
                        onChange={(e) => handleInputChange('ip', e.target.value)}
                        placeholder="e.g., 192.168.1.1"
                        className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                            ? 'bg-gray-700 border-gray-600 text-white'
                            : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        disabled={loading}
                      />
                    </div>

                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                        Port
                      </label>
                      <input
                        type="text"
                        value={formData.port}
                        onChange={(e) => handleInputChange('port', e.target.value)}
                        placeholder="e.g., 1812"
                        className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                            ? 'bg-gray-700 border-gray-600 text-white'
                            : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        disabled={loading}
                      />
                    </div>

                    <div>
                      <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                        Username
                      </label>
                      <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => handleInputChange('username', e.target.value)}
                        placeholder="Enter username"
                        className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                            ? 'bg-gray-700 border-gray-600 text-white'
                            : 'bg-white border-gray-300 text-gray-900'
                          }`}
                        disabled={loading}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                        }`}>
                        Password
                      </label>
                      <div className="relative">
                        <input
                          type={showPassword[0] ? 'text' : 'password'}
                          value={formData.password}
                          onChange={(e) => handleInputChange('password', e.target.value)}
                          placeholder="Enter password"
                          className={`w-full px-3 py-1.5 text-sm rounded focus:outline-none focus:border-orange-500 ${isDarkMode
                              ? 'bg-gray-700 border-gray-600 text-white'
                              : 'bg-white border-gray-300 text-gray-900'
                            }`}
                          disabled={loading}
                        />
                        <button
                          type="button"
                          onClick={() => togglePasswordVisibility(0)}
                          className={`absolute right-2 top-1/2 transform -translate-y-1/2 text-xs ${isDarkMode
                              ? 'text-gray-400 hover:text-gray-300'
                              : 'text-gray-600 hover:text-gray-800'
                            }`}
                        >
                          {showPassword[0] ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSave}
                      disabled={loading}
                      className="px-3 py-1.5 text-sm disabled:opacity-50 text-white rounded transition-colors"
                      style={{
                        backgroundColor: loading ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                      }}
                      onMouseEnter={(e) => {
                        if (!loading && colorPalette?.accent) {
                          e.currentTarget.style.backgroundColor = colorPalette.accent;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!loading) {
                          e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                        }
                      }}
                    >
                      Create
                    </button>
                    <button
                      onClick={handleCancel}
                      disabled={loading}
                      className={`px-3 py-1.5 text-sm disabled:opacity-50 rounded transition-colors ${isDarkMode
                          ? 'bg-gray-700 hover:bg-gray-600 text-white'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                        }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {radiusConfigs.length === 0 && !isCreating && (
              <div className={`text-center py-8 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}>
                <p className="text-base mb-1">No RADIUS configurations found</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Safe Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className={`border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl transform transition-all ${isDarkMode
            ? 'bg-gray-900 border-gray-700'
            : 'bg-white border-gray-100'
            }`}>
            <div className="mb-4">
              <h3 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Sensitive Operation
              </h3>
            </div>

            <p className={`text-sm mb-4 leading-relaxed ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              This will permanently delete the RADIUS configuration. This action cannot be undone.
              Please type <span className="font-bold text-red-500">confirm</span> to proceed.
            </p>

            <div className="mb-6">
              <input
                type="text"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder="Type 'confirm' here..."
                className={`w-full px-4 py-2.5 rounded-lg border text-sm transition-all outline-none ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white focus:border-red-500/50 focus:ring-4 focus:ring-red-500/10'
                  : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-red-500 focus:ring-4 focus:ring-red-500/5'
                  }`}
                autoFocus
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setIsDeleteModalOpen(false);
                  setConfirmInput('');
                  setIdToDelete(null);
                }}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors ${isDarkMode
                  ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={executeDelete}
                disabled={confirmInput.toLowerCase() !== 'confirm'}
                style={{
                  backgroundColor: confirmInput.toLowerCase() === 'confirm' 
                    ? (colorPalette?.primary || '#ef4444') 
                    : undefined
                }}
                onMouseEnter={(e) => {
                  if (confirmInput.toLowerCase() === 'confirm' && colorPalette?.accent) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (confirmInput.toLowerCase() === 'confirm') {
                    e.currentTarget.style.backgroundColor = colorPalette?.primary || '#ef4444';
                  }
                }}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition-all duration-200 ${confirmInput.toLowerCase() === 'confirm'
                  ? 'shadow-lg shadow-red-500/20 active:scale-[0.98]'
                  : 'bg-gray-400 cursor-not-allowed opacity-50'
                  }`}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {modal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className={`border rounded-lg p-4 max-w-md w-full mx-4 ${isDarkMode
              ? 'bg-gray-900 border-gray-700'
              : 'bg-white border-gray-300'
            }`}>
            <h3 className={`text-base font-semibold mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{modal.title}</h3>
            <p className={`text-sm mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>{modal.message}</p>
            <div className="flex items-center justify-end gap-2">
              {modal.type === 'confirm' ? (
                <>
                  <button
                    onClick={modal.onCancel}
                    className={`px-3 py-1.5 text-sm rounded transition-colors ${isDarkMode
                        ? 'bg-gray-700 hover:bg-gray-600 text-white'
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={modal.onConfirm}
                    className="px-3 py-1.5 text-sm text-white rounded transition-colors"
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
                  onClick={() => setModal({ ...modal, isOpen: false })}
                  className="px-3 py-1.5 text-sm text-white rounded transition-colors"
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
          </div>
        </div>
      )}
    </div>
  );
};

export default RadiusConfig;
