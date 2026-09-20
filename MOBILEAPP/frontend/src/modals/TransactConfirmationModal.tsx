import React, { useState, useEffect } from 'react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface TransactConfirmationModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  amount?: string;
  description?: string;
  billingRecord?: any;
}

const TransactConfirmationModal: React.FC<TransactConfirmationModalProps> = ({
  isOpen,
  onConfirm,
  onCancel,
  amount,
  description,
  billingRecord
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className={`rounded-lg border shadow-xl p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}>
        <div className="mb-4">
          <h3 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Confirm Transaction</h3>
        </div>
        <div className={`mb-6 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
          }`}>
          <p className="whitespace-pre-line">Are you sure you want to proceed with this transaction?</p>
          {description && <p className="mt-1 text-sm opacity-75">{description}</p>}
        </div>
        <div className="flex items-center justify-end gap-3">
          <button
            className={`px-4 py-2 rounded transition-colors ${isDarkMode
              ? 'bg-gray-700 hover:bg-gray-600 text-white'
              : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
              }`}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="text-white px-4 py-2 rounded transition-colors"
            onClick={onConfirm}
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
            Confirm Transaction
          </button>
        </div>
      </div>
    </div>
  );
};

export default TransactConfirmationModal;
