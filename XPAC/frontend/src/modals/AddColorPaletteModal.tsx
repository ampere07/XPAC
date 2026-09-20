import React, { useState, useEffect } from 'react';
import { X, Loader2, XCircle } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface AddColorPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (palette: ColorPaletteData) => Promise<void>;
}

interface ColorPaletteData {
  id: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
}

const AddColorPaletteModal: React.FC<AddColorPaletteModalProps> = ({
  isOpen,
  onClose,
  onSave
}) => {
  const [paletteName, setPaletteName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7c3aed');
  const [accentColor, setAccentColor] = useState('#7c3aed');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showError, setShowError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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
    if (isLoading) {
      setLoadingProgress(0);
      const interval = setInterval(() => {
        setLoadingProgress((prev) => {
          if (prev >= 90) {
            clearInterval(interval);
            return prev;
          }
          return prev + Math.random() * 15;
        });
      }, 200);

      return () => clearInterval(interval);
    }
  }, [isLoading]);

  const validateHexColor = (color: string): boolean => {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!paletteName.trim()) {
      newErrors.name = 'Palette name is required';
    }

    if (!validateHexColor(primaryColor)) {
      newErrors.primary = 'Invalid hex color';
    }

    if (!validateHexColor(accentColor)) {
      newErrors.accent = 'Invalid hex color';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setShowError(false);
    setErrorMessage('');

    const newPalette: ColorPaletteData = {
      id: `custom_${Date.now()}`,
      name: paletteName,
      primary: primaryColor,
      secondary: '#1f2937', // Default secondary value
      accent: accentColor
    };

    try {
      await onSave(newPalette);
      setLoadingProgress(100);
      setTimeout(() => {
        setIsLoading(false);
        handleClose();
      }, 500);
    } catch (error) {
      setIsLoading(false);
      setShowError(true);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to create color palette');
    }
  };

  const handleClose = () => {
    if (isLoading) return;

    setPaletteName('');
    setPrimaryColor('#7c3aed');
    setAccentColor('#7c3aed');
    setErrors({});
    setShowError(false);
    setErrorMessage('');
    setLoadingProgress(0);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode
            ? 'bg-gray-800 border-gray-700'
            : 'bg-gray-100 border-gray-300'
            }`}>
            <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>Add Custom Color Palette</h2>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={isLoading}
                className={`px-4 py-2 rounded text-sm disabled:cursor-not-allowed ${isDarkMode
                  ? 'bg-gray-700 hover:bg-gray-600 text-white disabled:bg-gray-600'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-900 disabled:bg-gray-300'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isLoading}
                className="px-4 py-2 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                style={{
                  backgroundColor: colorPalette?.primary || '#7c3aed'
                }}
                onMouseEnter={(e) => {
                  if (colorPalette?.accent && !isLoading) {
                    e.currentTarget.style.backgroundColor = colorPalette.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                }}
              >
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </button>
              <button
                onClick={handleClose}
                disabled={isLoading}
                className={`transition-colors disabled:cursor-not-allowed ${isDarkMode
                  ? 'text-gray-400 hover:text-white disabled:text-gray-600'
                  : 'text-gray-600 hover:text-gray-900 disabled:text-gray-400'
                  }`}
              >
                <X size={24} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {showError && (
              <div className={`border rounded p-4 flex items-start gap-3 ${isDarkMode
                ? 'bg-red-900/20 border-red-500'
                : 'bg-red-50 border-red-300'
                }`}>
                <XCircle className={`h-5 w-5 flex-shrink-0 mt-0.5 ${isDarkMode ? 'text-red-500' : 'text-red-600'
                  }`} />
                <div>
                  <p className={`font-medium ${isDarkMode ? 'text-red-500' : 'text-red-900'
                    }`}>Error</p>
                  <p className={`text-sm mt-1 ${isDarkMode ? 'text-red-400' : 'text-red-700'
                    }`}>{errorMessage}</p>
                </div>
              </div>
            )}

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Palette Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={paletteName}
                onChange={(e) => {
                  setPaletteName(e.target.value);
                  if (errors.name) setErrors({ ...errors, name: '' });
                }}
                placeholder="Enter palette name"
                disabled={isLoading}
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                className={`w-full px-3 py-2 border rounded focus:outline-none disabled:cursor-not-allowed ${errors.name ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode
                    ? 'bg-gray-800 text-white disabled:bg-gray-700'
                    : 'bg-white text-gray-900 disabled:bg-gray-100'
                  }`}
                style={{
                  borderColor: (focusedField === 'name' && !errors.name) ? (colorPalette?.primary || '#7c3aed') : undefined,
                  boxShadow: (focusedField === 'name' && !errors.name) ? `0 0 0 1px ${colorPalette?.primary || '#7c3aed'}` : undefined
                }}
              />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
            </div>

            <div className="space-y-4">
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Primary Color<span className="text-red-500">*</span>
                </label>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => {
                        setPrimaryColor(e.target.value);
                        if (errors.primary) setErrors({ ...errors, primary: '' });
                      }}
                      placeholder="#7c3aed"
                      disabled={isLoading}
                      onFocus={() => setFocusedField('primary')}
                      onBlur={() => setFocusedField(null)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none disabled:cursor-not-allowed ${errors.primary ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                        } ${isDarkMode
                          ? 'bg-gray-800 text-white disabled:bg-gray-700'
                          : 'bg-white text-gray-900 disabled:bg-gray-100'
                        }`}
                      style={{
                        borderColor: (focusedField === 'primary' && !errors.primary) ? (colorPalette?.primary || '#7c3aed') : undefined,
                        boxShadow: (focusedField === 'primary' && !errors.primary) ? `0 0 0 1px ${colorPalette?.primary || '#7c3aed'}` : undefined
                      }}
                    />
                    {errors.primary && <p className="text-red-500 text-xs mt-1">{errors.primary}</p>}
                  </div>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    disabled={isLoading}
                    className={`w-16 h-10 border rounded cursor-pointer disabled:cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-800 border-gray-700'
                      : 'bg-white border-gray-300'
                      }`}
                  />
                </div>
                <div
                  className={`mt-2 h-12 rounded border ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    }`}
                  style={{ backgroundColor: primaryColor }}
                />
              </div>



              <div>
                <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                  }`}>
                  Accent Color<span className="text-red-500">*</span>
                </label>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={accentColor}
                      onChange={(e) => {
                        setAccentColor(e.target.value);
                        if (errors.accent) setErrors({ ...errors, accent: '' });
                      }}
                      placeholder="#7c3aed"
                      disabled={isLoading}
                      onFocus={() => setFocusedField('accent')}
                      onBlur={() => setFocusedField(null)}
                      className={`w-full px-3 py-2 border rounded focus:outline-none disabled:cursor-not-allowed ${errors.accent ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                        } ${isDarkMode
                          ? 'bg-gray-800 text-white disabled:bg-gray-700'
                          : 'bg-white text-gray-900 disabled:bg-gray-100'
                        }`}
                      style={{
                        borderColor: (focusedField === 'accent' && !errors.accent) ? (colorPalette?.primary || '#7c3aed') : undefined,
                        boxShadow: (focusedField === 'accent' && !errors.accent) ? `0 0 0 1px ${colorPalette?.primary || '#7c3aed'}` : undefined
                      }}
                    />
                    {errors.accent && <p className="text-red-500 text-xs mt-1">{errors.accent}</p>}
                  </div>
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    disabled={isLoading}
                    className={`w-16 h-10 border rounded cursor-pointer disabled:cursor-not-allowed ${isDarkMode
                      ? 'bg-gray-800 border-gray-700'
                      : 'bg-white border-gray-300'
                      }`}
                  />
                </div>
                <div
                  className={`mt-2 h-12 rounded border ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
                    }`}
                  style={{ backgroundColor: accentColor }}
                />
              </div>
            </div>

            <div className={`pt-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-300'
              }`}>
              <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>Preview</h3>
              <div className={`p-4 rounded border ${isDarkMode
                ? 'bg-gray-800 border-gray-700'
                : 'bg-gray-50 border-gray-300'
                }`}>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <div
                      className="h-16 rounded"
                      style={{ backgroundColor: primaryColor }}
                    />
                    <p className={`text-xs mt-2 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>Primary</p>
                  </div>
                  <div className="flex-1">
                    <div
                      className="h-16 rounded"
                      style={{ backgroundColor: accentColor }}
                    />
                    <p className={`text-xs mt-2 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>Accent</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60]">
          <div className={`rounded-lg p-12 flex flex-col items-center gap-6 ${isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}>
            <Loader2
              className="h-16 w-16 animate-spin"
              style={{
                color: colorPalette?.primary || '#7c3aed'
              }}
            />
            <p className={`font-bold text-4xl ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{Math.round(loadingProgress)}%</p>
          </div>
        </div>
      )}
    </>
  );
};

export default AddColorPaletteModal;
