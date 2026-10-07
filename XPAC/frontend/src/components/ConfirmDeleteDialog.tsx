import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmDeleteDetail {
  label: string;
  value: React.ReactNode;
}

interface ConfirmDeleteDialogProps {
  isOpen: boolean;
  isDarkMode: boolean;
  title: string;
  description: string;
  details: ConfirmDeleteDetail[];
  warning?: string;
  error?: string;
  isDeleting: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const ConfirmDeleteDialog: React.FC<ConfirmDeleteDialogProps> = ({
  isOpen,
  isDarkMode,
  title,
  description,
  details,
  warning,
  error,
  isDeleting,
  confirmLabel,
  onCancel,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const cancel = () => {
    if (!isDeleting) onCancel();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={cancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-delete-title"
        onClick={(e) => e.stopPropagation()}
        className={`rounded-lg p-6 max-w-md w-full mx-4 border ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-white border-gray-200'
          }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-full ${isDarkMode ? 'bg-red-900 bg-opacity-40' : 'bg-red-100'}`}>
              <Trash2 size={20} className="text-red-500" />
            </div>
            <h2 id="confirm-delete-title" className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              {title}
            </h2>
          </div>
          <button
            onClick={cancel}
            disabled={isDeleting}
            aria-label="Close"
            className={`transition-colors disabled:opacity-50 ${isDarkMode
              ? 'text-gray-400 hover:text-white'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-6 space-y-4">
          <p className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{description}</p>
          <div className={`p-4 rounded border space-y-2 ${isDarkMode
            ? 'bg-gray-900 border-gray-700'
            : 'bg-gray-100 border-gray-200'
            }`}>
            {details.map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>{label}</span>
                <span className={`text-right ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{value}</span>
              </div>
            ))}
          </div>
          {warning && (
            <div className={`flex items-start space-x-2 p-3 rounded border text-sm ${isDarkMode
              ? 'bg-yellow-900 bg-opacity-30 border-yellow-700 text-yellow-200'
              : 'bg-yellow-50 border-yellow-300 text-yellow-800'
              }`}>
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{warning}</span>
            </div>
          )}
          {error && (
            <p role="alert" className={`text-sm ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
              {error}
            </p>
          )}
        </div>

        <div className="flex space-x-3">
          <button
            onClick={cancel}
            disabled={isDeleting}
            className={`flex-1 px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isDarkMode
              ? 'bg-gray-700 hover:bg-gray-600 text-white'
              : 'bg-gray-300 hover:bg-gray-400 text-gray-900'
              }`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            aria-label={`Confirm ${confirmLabel}`}
            className="flex-1 px-4 py-2 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center text-white bg-red-600 hover:bg-red-700"
          >
            {isDeleting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Deleting...
              </>
            ) : (
              <>
                <Trash2 size={16} className="mr-2" />
                {confirmLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDeleteDialog;
