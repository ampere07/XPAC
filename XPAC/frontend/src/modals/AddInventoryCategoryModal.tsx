import React, { useState, useEffect } from 'react';
import { X, Calendar, Loader2 } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface AddInventoryCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (categoryData: { name: string; modified_by?: string; organization_id?: number | null }) => void;
}

const AddInventoryCategoryModal: React.FC<AddInventoryCategoryModalProps> = ({
  isOpen,
  onClose,
  onSave
}) => {
  const [categoryName, setCategoryName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  
  // Get real logged in user email from localStorage
  const getInitialEmail = () => {
    const authData = localStorage.getItem('authData');
    if (authData) {
      try {
        const userData = JSON.parse(authData);
        return userData.email || userData.user?.email || '';
      } catch (error) {
        console.error('Error parsing auth data:', error);
      }
    }
    return '';
  };

  const [modifiedBy] = useState(getInitialEmail());
  const [modifiedDate, setModifiedDate] = useState('');
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
    const now = new Date();
    const formatted = now.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
    setModifiedDate(formatted);
  }, []);

  useEffect(() => {
    if (loading) {
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
  }, [loading]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!categoryName.trim()) {
      newErrors.categoryName = 'Category name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    const isValid = validateForm();

    if (!isValid) {
      return;
    }

    setLoading(true);

    try {
      console.log('Creating new inventory category:', categoryName);

      await new Promise(resolve => setTimeout(resolve, 100));

      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;

      onSave({
        name: categoryName.trim(),
        modified_by: modifiedBy,
        ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
      });

      setLoadingProgress(100);

      setTimeout(() => {
        setLoading(false);
        handleClose();
      }, 500);
    } catch (error: any) {
      console.error('Error creating inventory category:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to create inventory category. Please try again.';
      alert(`Error: ${errorMessage}`);
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;

    setCategoryName('');
    setErrors({});
    setLoadingProgress(0);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div className={`h-full w-full max-w-2xl shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}>
          <div className={`px-6 py-4 flex items-center justify-between ${isDarkMode ? 'bg-gray-900' : 'bg-gray-100'
            }`}>
            <div className="flex items-center space-x-4">
              <button
                onClick={handleClose}
                disabled={loading}
                className={`transition-colors disabled:cursor-not-allowed ${isDarkMode
                  ? 'text-gray-400 hover:text-white disabled:text-gray-600'
                  : 'text-gray-600 hover:text-gray-900 disabled:text-gray-400'
                  }`}
              >
                <X size={24} />
              </button>
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                }`}>Inventory Category Form</h2>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={loading}
                className={`px-6 py-2 border rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                  ? 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white'
                  : 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
                  }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                className="px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
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
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Save
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Category Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => {
                  setCategoryName(e.target.value);
                  if (errors.categoryName) {
                    setErrors(prev => ({ ...prev, categoryName: '' }));
                  }
                }}
                placeholder=""
                disabled={loading}
                className={`w-full px-4 py-3 border rounded focus:outline-none focus:border-red-500 disabled:cursor-not-allowed ${errors.categoryName ? 'border-red-500' : isDarkMode ? 'border-gray-700' : 'border-gray-300'
                  } ${isDarkMode
                    ? 'bg-gray-900 text-white disabled:bg-gray-800'
                    : 'bg-white text-gray-900 disabled:bg-gray-100'
                  }`}
                autoFocus
              />
              {errors.categoryName && <p className="text-red-500 text-xs mt-1">{errors.categoryName}</p>}
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Modified By
              </label>
              <div className={`inline-block px-4 py-2 border rounded-full text-sm ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-gray-100 border-gray-300 text-gray-900'
                }`}>
                {modifiedBy}
              </div>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}>
                Modified Date
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={modifiedDate}
                  readOnly
                  className={`w-full px-4 py-3 border rounded focus:outline-none cursor-default ${isDarkMode
                    ? 'bg-gray-900 border-gray-700 text-gray-400'
                    : 'bg-gray-50 border-gray-300 text-gray-600'
                    }`}
                />
                <Calendar className={`absolute right-4 top-3.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`} size={20} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading && (
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

export default AddInventoryCategoryModal;
