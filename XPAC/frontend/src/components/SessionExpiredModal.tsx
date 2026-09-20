import React from 'react';
import { ColorPalette } from '../services/settingsColorPaletteService';

interface SessionExpiredModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  isDarkMode?: boolean;
  colorPalette?: ColorPalette | null;
}

const SessionExpiredModal: React.FC<SessionExpiredModalProps> = ({ isOpen, onConfirm, isDarkMode, colorPalette }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 animate-in fade-in duration-200">
      <div className={`rounded-lg shadow-xl max-w-sm w-full overflow-hidden transform animate-in zoom-in-95 duration-200 ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}>
        <div className="p-6 text-center">
          <h2 className={`text-xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
            Session Expired
          </h2>
          <p className={isDarkMode ? 'text-slate-400' : 'text-slate-600'}>
            Please re-login to continue using the application.
          </p>
        </div>
        
        <div className="p-6 pt-0">
          <button
            onClick={onConfirm}
            className="w-full py-3 px-4 text-white rounded font-bold transition-colors hover:opacity-90"
            style={{ backgroundColor: colorPalette?.primary || '#2563eb' }}
          >
            Re-login
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionExpiredModal;
