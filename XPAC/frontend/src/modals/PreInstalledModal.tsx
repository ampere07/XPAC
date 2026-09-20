import React, { useState, useEffect } from 'react';
import { Loader } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface PreInstalledModalProps {
  isOpen: boolean;
  /** Disables both buttons and the field while the save is in flight. */
  saving?: boolean;
  /** Shown when reopening a job order that already carries a pre-install note. */
  initialRemarks?: string | null;
  onSave: (remarks: string) => void;
  onCancel: () => void;
}

/**
 * Records a pre-installation visit against a job order.
 *
 * The remarks are the whole point of the modal — marking a job order
 * pre-installed without saying what was found on site leaves the next person
 * nothing to work from — so Save stays disabled until something is typed.
 */
const PreInstalledModal: React.FC<PreInstalledModalProps> = ({
  isOpen,
  saving = false,
  initialRemarks,
  onSave,
  onCancel
}) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [remarks, setRemarks] = useState<string>('');

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
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();
  }, []);

  // Reset on each open so a cancelled note is not offered again as if it had
  // been saved, while an already-recorded one comes back for editing.
  useEffect(() => {
    if (isOpen) {
      setRemarks(initialRemarks || '');
    }
  }, [isOpen, initialRemarks]);

  if (!isOpen) return null;

  const trimmed = remarks.trim();
  const canSave = trimmed !== '' && !saving;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className={`rounded shadow-lg p-6 w-full max-w-md mx-4 ${isDarkMode ? 'bg-gray-800' : 'bg-white'
        }`}>
        <div className="mb-4">
          <h3 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Pre Installed</h3>
        </div>

        <label
          htmlFor="pre-installed-remarks"
          className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
        >
          Pre Installed Remarks
        </label>
        <textarea
          id="pre-installed-remarks"
          rows={4}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          disabled={saving}
          autoFocus
          placeholder="What was done or found on the pre-installation visit"
          className={`w-full px-3 py-2 rounded border text-sm resize-none focus:outline-none disabled:opacity-60 ${isDarkMode
              ? 'bg-gray-900 border-gray-700 text-white placeholder-gray-500'
              : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400'
            }`}
        />

        <div className="flex justify-end space-x-4 mt-6">
          <button
            type="button"
            className={`px-4 py-2 rounded transition-colors disabled:opacity-60 ${isDarkMode
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
              }`}
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="text-white px-4 py-2 rounded transition-colors flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              backgroundColor: colorPalette?.primary || '#7c3aed'
            }}
            onMouseEnter={(e) => {
              if (canSave && colorPalette?.accent) {
                e.currentTarget.style.backgroundColor = colorPalette.accent;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
            }}
            onClick={() => onSave(trimmed)}
            disabled={!canSave}
          >
            {saving && <Loader className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PreInstalledModal;
