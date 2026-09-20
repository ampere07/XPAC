import React from 'react';
import { Loader2 } from 'lucide-react';
import { ColorPalette } from '../../services/settingsColorPaletteService';

interface LoadingModalGlobalProps {
  isOpen: boolean;
  type: 'loading' | 'success' | 'error' | 'confirm' | 'warning';
  title: string;
  message: string;
  loadingPercentage?: number;
  onConfirm?: () => void;
  onCancel?: () => void;
  colorPalette?: ColorPalette | null;
  isDarkMode: boolean;
}

const LoadingModalGlobal: React.FC<LoadingModalGlobalProps> = ({
  isOpen,
  type,
  title,
  message,
  loadingPercentage = 0,
  onConfirm,
  onCancel,
  colorPalette,
  isDarkMode
}) => {
  if (!isOpen) return null;

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const accentColor = colorPalette?.accent || '#6d28d9';

  if (type === 'loading') {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
        <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] shadow-2xl ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
          <Loader2
            className="w-20 h-20 animate-spin"
            style={{ color: primaryColor }}
          />
          <div className="text-center">
            <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{loadingPercentage}%</p>
            <p className={`mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{message}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10000]">
      <div className={`border rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl transform transition-all duration-300 scale-100 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        <h3 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
        <p className={`mb-8 whitespace-pre-line leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{message}</p>
        
        <div className="flex items-center justify-end space-x-3">
          {type === 'confirm' && (
            <button
              onClick={onCancel}
              className={`px-6 py-2 rounded font-medium transition-colors ${isDarkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              Cancel
            </button>
          )}
          
          <button
            onClick={onConfirm}
            className="px-8 py-2.5 text-white rounded transition-all shadow-lg active:scale-95 font-semibold tracking-wide"
            style={{ backgroundColor: primaryColor }}
            onMouseEnter={(e) => { if (accentColor) e.currentTarget.style.backgroundColor = accentColor; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = primaryColor; }}
          >
            {type === 'confirm' ? 'Confirm' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoadingModalGlobal;
