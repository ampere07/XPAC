import React, { useState, useEffect } from 'react';
import { Palette, Plus, Image, Loader2, CheckCircle, XCircle, Zap } from 'lucide-react';
import AddColorPaletteModal from '../modals/AddColorPaletteModal';
import GenerateBillingModal from '../modals/GenerateBillingModal';
import { settingsImageSizeService, ImageSize } from '../services/settingsImageSizeService';
import { settingsColorPaletteService, ColorPalette as DbColorPalette } from '../services/settingsColorPaletteService';
import { userSettingsService } from '../services/userSettingsService';
import { systemConfigService } from '../services/systemConfigService';

interface ColorPalette {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
}

interface ModalConfig {
  isOpen: boolean;
  type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

const Settings: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState<boolean>(true);
  const [showAddPaletteModal, setShowAddPaletteModal] = useState<boolean>(false);
  const [dbPalettes, setDbPalettes] = useState<DbColorPalette[]>([]);
  const [imageSizes, setImageSizes] = useState<ImageSize[]>([]);
  const [activeImageSizeId, setActiveImageSizeId] = useState<number | null>(null);
  const [selectedImageSizeId, setSelectedImageSizeId] = useState<number | null>(null);
  const [isEditingImageSize, setIsEditingImageSize] = useState<boolean>(false);
  const [isSavingImageSize, setIsSavingImageSize] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<DbColorPalette | null>(null);
  const [userRoleId, setUserRoleId] = useState<number | null>(null);
  const [userRoleName, setUserRoleName] = useState<string>('');
  const [showGenerateBillingModal, setShowGenerateBillingModal] = useState<boolean>(false);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [loadingPercentage, setLoadingPercentage] = useState(0);
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    type: 'success',
    title: '',
    message: ''
  });

  const convertGoogleDriveUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('blob:')) return url;
    const apiUrl = process.env.REACT_APP_API_BASE_URL;
    return `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
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

    const handlePaletteUpdate = () => {
      fetchColorPalette();
    };

    window.addEventListener('palette-updated', handlePaletteUpdate);
    window.addEventListener('storage', handlePaletteUpdate);

    return () => {
      window.removeEventListener('palette-updated', handlePaletteUpdate);
      window.removeEventListener('storage', handlePaletteUpdate);
    };
  }, []);

  useEffect(() => {
    const loadLogo = async () => {
      try {
        const url = await systemConfigService.getLogo();
        setLogoUrl(url);
      } catch (error) {
        console.error('Failed to load logo:', error);
      }
    };

    loadLogo();
  }, []);

  useEffect(() => {
    return () => {
      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
      }
    };
  }, [logoPreviewUrl]);

  useEffect(() => {
    const loadUserPreferences = async () => {
      setIsLoadingPreferences(true);
      try {
        const authData = localStorage.getItem('authData');
        console.log('[Settings] Loading preferences, authData:', authData);

        if (authData) {
          const userData = JSON.parse(authData);
          // User ID is at root level, not under user property
          const userId = userData.id;
          setUserRoleId(userData.role_id || null);
          setUserRoleName(userData.role || '');
          console.log('[Settings] User ID:', userId);

          if (userId) {
            console.log('[Settings] Fetching dark mode from API...');
            const response = await userSettingsService.getDarkMode(userId);
            console.log('[Settings] API response:', response);

            if (response.success && response.data) {
              const darkmodeValue = response.data.darkmode;
              const isDark = darkmodeValue === 'active';

              console.log('[Settings] Darkmode value from DB:', darkmodeValue);
              console.log('[Settings] Setting isDark to:', isDark);

              setIsDarkMode(isDark);
              localStorage.setItem('theme', isDark ? 'dark' : 'light');

              if (isDark) {
                document.documentElement.classList.add('dark');
              } else {
                document.documentElement.classList.remove('dark');
              }

              console.log('[Settings] Theme applied:', isDark ? 'dark' : 'light');
            }
          }
        }
      } catch (error) {
        console.error('[Settings] Failed to load dark mode preference:', error);
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
          setIsDarkMode(savedTheme === 'dark');
        }
      } finally {
        setIsLoadingPreferences(false);
      }
    };

    loadUserPreferences();
    loadImageSizes();
    loadColorPalettes();
  }, []);

  const loadColorPalettes = async () => {
    try {
      const palettes = await settingsColorPaletteService.getAll();
      setDbPalettes(palettes);
    } catch (error) {
      console.error('Failed to load color palettes:', error);
    }
  };

  const loadImageSizes = async () => {
    try {
      const sizes = await settingsImageSizeService.getAll();
      setImageSizes(sizes);
      const active = sizes.find(size => size.status === 'active');
      if (active) {
        setActiveImageSizeId(active.id);
        setSelectedImageSizeId(active.id);
      }
    } catch (error) {
      console.error('Failed to load image sizes:', error);
    }
  };


  const handlePaletteStatusChange = async (id: number, status: 'active' | 'inactive') => {
    setLoading(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 90) return Math.min(99, prev + 1);
        return Math.min(99, prev + 10);
      });
    }, 100);

    try {
      await settingsColorPaletteService.updateStatus(id, status);
      await loadColorPalettes();

      if (status === 'active') {
        const palette = dbPalettes.find(p => p.id === id);
        if (palette) {
          document.documentElement.style.setProperty('--color-primary', palette.primary);
          document.documentElement.style.setProperty('--color-secondary', palette.secondary);
          document.documentElement.style.setProperty('--color-accent', palette.accent);
        }
      }

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      window.dispatchEvent(new Event('storage'));
      window.dispatchEvent(new CustomEvent('palette-updated'));

      setTimeout(() => {
        setLoading(false);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Color palette activated successfully!'
        });
      }, 500);
    } catch (error) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to activate color palette'
      });
    }
  };

  const handleEditImageSize = () => {
    setIsEditingImageSize(true);
  };

  const handleCancelImageSize = () => {
    setSelectedImageSizeId(activeImageSizeId);
    setIsEditingImageSize(false);
  };

  const handleSaveImageSize = async () => {
    if (selectedImageSizeId === null) return;

    setLoading(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 90) return Math.min(99, prev + 1);
        return Math.min(99, prev + 10);
      });
    }, 100);

    try {
      await settingsImageSizeService.updateStatus(selectedImageSizeId, 'active');
      await loadImageSizes();
      setIsEditingImageSize(false);

      clearInterval(progressInterval);
      setLoadingPercentage(100);

      setTimeout(() => {
        setLoading(false);
        setModal({
          isOpen: true,
          type: 'success',
          title: 'Success',
          message: 'Image upload size updated successfully!'
        });
      }, 500);
    } catch (error) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to update image upload size'
      });
    }
  };

  const handleAddPalette = async (newPalette: ColorPalette) => {
    await settingsColorPaletteService.create({
      palette_name: newPalette.name,
      primary: newPalette.primary,
      secondary: newPalette.secondary,
      accent: newPalette.accent,
      updated_by: 'system'
    });

    await loadColorPalettes();
  };

  const handleDeletePalette = async (id: number) => {
    try {
      await settingsColorPaletteService.delete(id);
      await loadColorPalettes();
    } catch (error) {
      console.error('Failed to delete color palette:', error);
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setModal({
          isOpen: true,
          type: 'warning',
          title: 'File Too Large',
          message: 'File size must be less than 5MB'
        });
        return;
      }

      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
      }

      setLogoFile(file);
      setLogoPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleUploadLogo = async () => {
    if (!logoFile) return;

    setLoading(true);
    setLoadingPercentage(0);

    const progressInterval = setInterval(() => {
      setLoadingPercentage(prev => {
        if (prev >= 90) return Math.min(99, prev + 1);
        return Math.min(99, prev + 10);
      });
    }, 100);

    try {
      const authData = localStorage.getItem('authData');
      const userData = authData ? JSON.parse(authData) : null;
      const updatedBy = userData?.username || 'system';

      const result = await systemConfigService.uploadLogo(logoFile, updatedBy);

      if (result.success && result.data) {
        setLogoUrl(result.data.logo_url);
        setLogoFile(null);
        if (logoPreviewUrl) {
          URL.revokeObjectURL(logoPreviewUrl);
          setLogoPreviewUrl(null);
        }
        localStorage.setItem('logoUpdated', Date.now().toString());
        window.dispatchEvent(new Event('storage'));
        window.dispatchEvent(new CustomEvent('logo-updated'));

        clearInterval(progressInterval);
        setLoadingPercentage(100);

        setTimeout(() => {
          setLoading(false);
          setModal({
            isOpen: true,
            type: 'success',
            title: 'Success',
            message: 'Logo uploaded successfully!'
          });
        }, 500);
      }
    } catch (error) {
      clearInterval(progressInterval);
      setLoading(false);
      setModal({
        isOpen: true,
        type: 'error',
        title: 'Error',
        message: error instanceof Error ? error.message : 'Failed to upload logo'
      });
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const handleDeleteLogo = async () => {
    setModal({
      isOpen: true,
      type: 'confirm',
      title: 'Delete Logo',
      message: 'Are you sure you want to delete the logo?',
      onConfirm: async () => {
        setModal({ ...modal, isOpen: false });
        setLoading(true);
        setLoadingPercentage(0);

        const progressInterval = setInterval(() => {
          setLoadingPercentage(prev => {
            if (prev >= 90) return Math.min(99, prev + 1);
            return Math.min(99, prev + 10);
          });
        }, 100);

        try {
          const authData = localStorage.getItem('authData');
          const userData = authData ? JSON.parse(authData) : null;
          const updatedBy = userData?.username || 'system';

          await systemConfigService.deleteLogo(updatedBy);
          setLogoUrl(null);
          localStorage.setItem('logoUpdated', Date.now().toString());
          window.dispatchEvent(new Event('storage'));
          window.dispatchEvent(new CustomEvent('logo-updated'));

          clearInterval(progressInterval);
          setLoadingPercentage(100);

          setTimeout(() => {
            setLoading(false);
            setModal({
              isOpen: true,
              type: 'success',
              title: 'Success',
              message: 'Logo deleted successfully!'
            });
          }, 500);
        } catch (error) {
          clearInterval(progressInterval);
          setLoading(false);
          setModal({
            isOpen: true,
            type: 'error',
            title: 'Error',
            message: error instanceof Error ? error.message : 'Failed to delete logo'
          });
        }
      },
      onCancel: () => setModal({ ...modal, isOpen: false })
    });
  };

  return (
    <div className={`p-6 min-h-screen ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'
      }`}>
      <div className={`mb-6 pb-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
        }`}>
        <h2 className={`text-2xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
          } mb-2`}>
          Settings
        </h2>
      </div>

      <div className="space-y-6">
        {(userRoleId === 7 || userRoleName.toLowerCase() === 'superadmin') && (
          <div className={`pb-6 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <div className="mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                System Logo
              </h3>
            </div>

            <div className={`p-6 rounded border ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-300'}`}>
              {logoFile ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-4">
                    <div className="flex items-center justify-center p-4 bg-white rounded border border-gray-300 w-full max-w-md">
                      {logoPreviewUrl && (
                        <img
                          src={logoPreviewUrl}
                          alt="Logo Preview"
                          className="max-h-32 object-contain"
                        />
                      )}
                    </div>
                    <p className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      Selected: {logoFile.name}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleUploadLogo}
                      disabled={isUploadingLogo}
                      className="px-4 py-2 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                      style={{
                        backgroundColor: isUploadingLogo ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                      }}
                      onMouseEnter={(e) => {
                        if (!isUploadingLogo && colorPalette?.accent) {
                          e.currentTarget.style.backgroundColor = colorPalette.accent;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isUploadingLogo) {
                          e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                        }
                      }}
                    >
                      {isUploadingLogo ? 'Uploading...' : 'Upload Logo'}
                    </button>
                    <button
                      onClick={() => {
                        setLogoFile(null);
                        if (logoPreviewUrl) {
                          URL.revokeObjectURL(logoPreviewUrl);
                          setLogoPreviewUrl(null);
                        }
                      }}
                      disabled={isUploadingLogo}
                      className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : logoUrl ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center p-4 bg-white rounded border border-gray-200">
                    <img
                      src={convertGoogleDriveUrl(logoUrl)}
                      alt="System Logo"
                      className="max-h-32 object-contain"
                      onError={(e) => {
                        console.error('Failed to load logo image');
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <label
                      className="px-4 py-2 text-white rounded transition-colors cursor-pointer text-sm"
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
                      Change Logo
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoFileChange}
                        className="hidden"
                      />
                    </label>
                    <button
                      onClick={handleDeleteLogo}
                      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-sm"
                    >
                      Delete Logo
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className={`flex flex-col items-center justify-center p-8 border-2 border-dashed rounded ${isDarkMode ? 'border-gray-600' : 'border-gray-400'}`}>
                    <Image className={`h-12 w-12 mb-4 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                    <p className={`text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      No logo uploaded
                    </p>
                    <p className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                      Supported formats: JPEG, PNG, GIF, SVG (Max 5MB)
                    </p>
                  </div>
                  <label
                    className="px-4 py-2 text-white rounded transition-colors cursor-pointer inline-block text-sm"
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
                    Select Logo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileChange}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}


        {(userRoleId === 7 || userRoleName.toLowerCase() === 'superadmin') && (
          <div className="pt-6">
            <div className="mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Color Palette
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dbPalettes.map((palette) => {
                const isDefault = palette.palette_name.toLowerCase() === 'default';
                return (
                  <div
                    key={palette.id}
                    className={`p-4 rounded border transition-all relative ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'}`}
                    style={{
                      borderColor: palette.status === 'active' ? (colorPalette?.primary || '#7c3aed') : undefined,
                      boxShadow: palette.status === 'active' ? '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)' : undefined
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {palette.palette_name}
                      </h4>
                      <div className="flex items-center gap-2">
                        {palette.status === 'active' && (
                          <div className="h-5 w-5 rounded-full flex items-center justify-center" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>
                            <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                        {palette.status === 'inactive' && (
                          <button
                            onClick={() => handlePaletteStatusChange(palette.id, 'active')}
                            className={`px-2 py-1 text-xs rounded transition-colors ${isDarkMode
                              ? 'bg-gray-700 text-white hover:bg-gray-600'
                              : 'bg-gray-300 text-gray-900 hover:bg-gray-400'
                              }`}
                          >
                            Activate
                          </button>
                        )}
                        {!isDefault && (
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete ${palette.palette_name}?`)) {
                                handleDeletePalette(palette.id);
                              }
                            }}
                            className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900 rounded transition-colors"
                            title="Delete palette"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <div className="flex-1">
                        <div
                          className="h-10 rounded"
                          style={{ backgroundColor: palette.primary }}
                        />
                        <p className={`text-xs mt-1 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          Primary
                        </p>
                      </div>
                      <div className="flex-1">
                        <div
                          className="h-10 rounded"
                          style={{ backgroundColor: palette.accent }}
                        />
                        <p className="text-xs text-gray-400 mt-1 text-center">
                          Accent
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                onClick={() => setShowAddPaletteModal(true)}
                className={`p-4 rounded border border-dashed transition-all flex flex-col items-center justify-center gap-2 min-h-[140px] ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-300'}`}
              >
                <div className={`h-10 w-10 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-gray-800' : 'bg-gray-200'}`}>
                  <Plus className="h-5 w-5" style={{ color: colorPalette?.primary || '#7c3aed' }} />
                </div>
                <p className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Add Custom Palette</p>
                <p className={`text-xs text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  Create your own color scheme
                </p>
              </button>
            </div>
          </div>
        )}

        {(userRoleId === 7 || userRoleName.toLowerCase() === 'superadmin') && (
          <div className={`pt-6 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <div className="mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Image Upload Size
              </h3>
            </div>

            <div className={`p-4 rounded border ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-300'}`}>
              <div className="space-y-2 mb-4">
                {imageSizes.map((size) => (
                  <div
                    key={size.id}
                    onClick={() => isEditingImageSize && setSelectedImageSizeId(size.id)}
                    className={`flex items-center justify-between p-3 rounded border transition-all ${isEditingImageSize ? 'cursor-pointer' : ''}`}
                    style={{
                      borderColor: selectedImageSizeId === size.id ? (colorPalette?.primary || '#7c3aed') : undefined,
                      backgroundColor: selectedImageSizeId === size.id ? `${colorPalette?.primary || '#7c3aed'}1A` : undefined
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {size.image_size}
                      </span>
                      <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        -{size.image_size_value}% maximum size
                      </span>
                    </div>
                    {size.status === 'active' && !isEditingImageSize && (
                      <div className="h-5 w-5 rounded-full flex items-center justify-center" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>
                        <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                    {selectedImageSizeId === size.id && isEditingImageSize && (
                      <div className="h-5 w-5 rounded-full flex items-center justify-center" style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}>
                        <svg className="h-3 w-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                {!isEditingImageSize ? (
                  <button
                    onClick={handleEditImageSize}
                    className="px-4 py-2 text-white rounded transition-colors text-sm"
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
                    Edit
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleSaveImageSize}
                      disabled={isSavingImageSize || selectedImageSizeId === activeImageSizeId}
                      className="px-4 py-2 text-white rounded transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed text-sm"
                      style={{
                        backgroundColor: (isSavingImageSize || selectedImageSizeId === activeImageSizeId) ? '#4b5563' : (colorPalette?.primary || '#7c3aed')
                      }}
                      onMouseEnter={(e) => {
                        if (!isSavingImageSize && selectedImageSizeId !== activeImageSizeId && colorPalette?.accent) {
                          e.currentTarget.style.backgroundColor = colorPalette.accent;
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSavingImageSize && selectedImageSizeId !== activeImageSizeId) {
                          e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                        }
                      }}
                    >
                      {isSavingImageSize ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={handleCancelImageSize}
                      disabled={isSavingImageSize}
                      className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed text-sm"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {(userRoleId === 7 || userRoleName.toLowerCase() === 'superadmin') && (
          <div className={`pt-6 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
            <div className="mb-4">
              <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Manual Billing Generation
              </h3>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                Manually generate an SOA and Invoice for a specific customer with an optional service charge.
              </p>
            </div>

            <div className={`p-6 rounded border ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-gray-100 border-gray-300'}`}>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className="flex items-center justify-center rounded-xl mt-0.5"
                    style={{ width: 40, height: 40, backgroundColor: `${colorPalette?.primary || '#7c3aed'}18` }}
                  >
                    <Zap size={18} style={{ color: colorPalette?.primary || '#7c3aed' }} />
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      Generate Billing
                    </p>
                    <p className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                      Select a customer, set an optional service charge, and generate instantly.
                    </p>
                  </div>
                </div>

                <button
                  id="open-generate-billing-modal"
                  onClick={() => setShowGenerateBillingModal(true)}
                  className="sm:ml-auto flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${colorPalette?.primary || '#7c3aed'}, ${colorPalette?.accent || colorPalette?.primary || '#7c3aed'})`,
                    boxShadow: `0 4px 14px ${colorPalette?.primary || '#7c3aed'}40`,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = `0 6px 20px ${colorPalette?.primary || '#7c3aed'}60`;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = `0 4px 14px ${colorPalette?.primary || '#7c3aed'}40`;
                  }}
                >
                  <Zap size={15} />
                  Generate
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <AddColorPaletteModal
        isOpen={showAddPaletteModal}
        onClose={() => setShowAddPaletteModal(false)}
        onSave={handleAddPalette}
      />

      <GenerateBillingModal
        isOpen={showGenerateBillingModal}
        onClose={() => setShowGenerateBillingModal(false)}
        colorPalette={colorPalette}
        isDarkMode={isDarkMode}
      />

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
    </div>
  );
};

export default Settings;
