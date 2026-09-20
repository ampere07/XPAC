import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ApprovalConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}

const ApprovalConfirmationModal: React.FC<ApprovalConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  loading = false
}) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

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

  // Reset processing state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setIsProcessing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (isProcessing || loading) return;
    setIsProcessing(true);
    onConfirm();
  };

  const handleClose = () => {
    if (isProcessing || loading) return;
    onClose();
  };

  const isDisabled = isProcessing || loading;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div className={`rounded-lg shadow-2xl w-full max-w-md ${isDarkMode ? 'bg-gray-800' : 'bg-white'
        }`}>
        <div className="p-6">
          <h2 className={`text-xl font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>Confirm</h2>

          <p className={`mb-4 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
            }`}>
            Are you sure you want to approve this job order?
          </p>

          <div className={`mb-8 p-3 rounded-md text-sm border ${isDarkMode ? 'bg-orange-900 bg-opacity-20 border-orange-800 text-orange-200' : 'bg-orange-50 border-orange-200 text-orange-800'}`}>
            <p className="font-semibold mb-1">One-to-One Approval Process:</p>
            <p className="mb-2">This action is <b>one-to-one</b>. Approving this job order will create exactly one set of records in the following tables:</p>
            <ul className="list-disc ml-5 space-y-1">
              <li>Customers</li>
              <li>Billing Accounts</li>
              <li>Technical Details</li>
              <li>Online Status</li>
              <li>Users (Login Account)</li>
            </ul>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              onClick={handleClose}
              disabled={isDisabled}
              className={`px-6 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
                ? 'bg-gray-700 text-white hover:bg-gray-600'
                : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                }`}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isDisabled}
              className="px-6 py-2 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: isDisabled ? '#9ca3af' : (colorPalette?.primary || '#7c3aed')
              }}
              onMouseEnter={(e) => {
                if (colorPalette?.accent && !isDisabled) {
                  e.currentTarget.style.backgroundColor = colorPalette.accent;
                }
              }}
              onMouseLeave={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                }
              }}
            >
              {isProcessing || loading ? 'Processing...' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApprovalConfirmationModal;
