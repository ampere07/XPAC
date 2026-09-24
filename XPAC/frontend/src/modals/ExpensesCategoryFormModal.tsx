import React, { useState, useEffect } from 'react';
import { X, Calendar, Loader2 } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { ExpensesCategory } from '../services/expensesCategoryService';

interface ExpensesCategoryFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string; modified_by?: string }) => Promise<void>;
  /** Present when editing; omit to add a new category. */
  category?: ExpensesCategory | null;
}

const ExpensesCategoryFormModal: React.FC<ExpensesCategoryFormModalProps> = ({
  isOpen,
  onClose,
  onSave,
  category,
}) => {
  const isEditing = Boolean(category);

  const [categoryName, setCategoryName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [modifiedDate, setModifiedDate] = useState('');
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const modifiedBy = (() => {
    try {
      const authData = JSON.parse(localStorage.getItem('authData') || '{}');
      return authData.email || authData.user?.email || authData.email_address || '';
    } catch {
      return '';
    }
  })();

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));
  }, []);

  // Reset on open, so a cancelled edit never carries into the next open.
  useEffect(() => {
    if (!isOpen) return;

    setCategoryName(category?.name ?? '');
    setErrors({});
    setSubmitError(null);
    setModifiedDate(
      new Date().toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      })
    );
  }, [isOpen, category]);

  const handleSave = async () => {
    if (!categoryName.trim()) {
      setErrors({ categoryName: 'Category name is required' });
      return;
    }

    setSaving(true);
    setSubmitError(null);

    try {
      await onSave({ name: categoryName.trim(), modified_by: modifiedBy });
      onClose();
    } catch (error: any) {
      setSubmitError(
        error?.response?.data?.message ||
          error?.message ||
          'Failed to save category. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  if (!isOpen) return null;

  const accent = colorPalette?.primary || '#7c3aed';

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50">
        <div
          className={`h-full w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col ${
            isDarkMode ? 'bg-gray-900' : 'bg-white'
          }`}
        >
          <div
            className={`px-6 py-4 flex items-center justify-between flex-shrink-0 ${
              isDarkMode ? 'bg-gray-900' : 'bg-gray-100'
            }`}
          >
            <div className="flex items-center space-x-4">
              <button
                onClick={handleClose}
                disabled={saving}
                className={`transition-colors disabled:cursor-not-allowed ${
                  isDarkMode
                    ? 'text-gray-400 hover:text-white disabled:text-gray-600'
                    : 'text-gray-600 hover:text-gray-900 disabled:text-gray-400'
                }`}
              >
                <X size={24} />
              </button>
              <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Expenses Category Form
              </h2>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={handleClose}
                disabled={saving}
                className={`px-6 py-2 border rounded text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDarkMode
                    ? 'border-red-600 text-red-600 hover:bg-red-600 hover:text-white'
                    : 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center"
                style={{ backgroundColor: accent }}
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {isEditing ? 'Update' : 'Save'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            {submitError && (
              <div className="p-4 rounded border border-red-500/40 bg-red-500/10 text-red-500 text-sm">
                {submitError}
              </div>
            )}

            <div>
              <label
                className={`block text-sm font-medium mb-2 ${
                  isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Category Name<span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={categoryName}
                onChange={(e) => {
                  setCategoryName(e.target.value);
                  if (errors.categoryName) setErrors({});
                }}
                disabled={saving}
                autoFocus
                className={`w-full px-4 py-3 border rounded focus:outline-none disabled:cursor-not-allowed ${
                  errors.categoryName
                    ? 'border-red-500'
                    : isDarkMode
                    ? 'border-gray-700'
                    : 'border-gray-300'
                } ${
                  isDarkMode
                    ? 'bg-gray-900 text-white disabled:bg-gray-800'
                    : 'bg-white text-gray-900 disabled:bg-gray-100'
                }`}
              />
              {errors.categoryName && (
                <p className="text-red-500 text-xs mt-1">{errors.categoryName}</p>
              )}
            </div>

            <div>
              <label
                className={`block text-sm font-medium mb-2 ${
                  isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Modified By
              </label>
              <div
                className={`inline-block px-4 py-2 border rounded-full text-sm ${
                  isDarkMode
                    ? 'bg-gray-800 border-gray-700 text-white'
                    : 'bg-gray-100 border-gray-300 text-gray-900'
                }`}
              >
                {modifiedBy || 'System'}
              </div>
            </div>

            <div>
              <label
                className={`block text-sm font-medium mb-2 ${
                  isDarkMode ? 'text-gray-300' : 'text-gray-700'
                }`}
              >
                Modified Date
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={modifiedDate}
                  readOnly
                  className={`w-full px-4 py-3 border rounded focus:outline-none cursor-default ${
                    isDarkMode
                      ? 'bg-gray-900 border-gray-700 text-gray-400'
                      : 'bg-gray-50 border-gray-300 text-gray-600'
                  }`}
                />
                <Calendar
                  className={`absolute right-4 top-3.5 ${
                    isDarkMode ? 'text-gray-500' : 'text-gray-400'
                  }`}
                  size={20}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {saving && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[60]">
          <div
            className={`rounded-lg p-12 flex flex-col items-center gap-6 ${
              isDarkMode ? 'bg-gray-800' : 'bg-white'
            }`}
          >
            <Loader2 className="h-16 w-16 animate-spin" style={{ color: accent }} />
            <p className={`font-bold text-xl ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              Saving…
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default ExpensesCategoryFormModal;
