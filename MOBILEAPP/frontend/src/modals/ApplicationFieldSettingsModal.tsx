import React from 'react';
import { X, GripVertical, Eye, EyeOff } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface ApplicationFieldSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  fieldVisibility: Record<string, boolean>;
  fieldOrder: string[];
  onToggleVisibility: (field: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onReset: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (dropIndex: number) => void;
  getFieldLabel: (fieldKey: string) => string;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
}

const ApplicationFieldSettingsModal: React.FC<ApplicationFieldSettingsModalProps> = ({
  isOpen,
  onClose,
  fieldVisibility,
  fieldOrder,
  onToggleVisibility,
  onSelectAll,
  onDeselectAll,
  onReset,
  onDragStart,
  onDragOver,
  onDrop,
  getFieldLabel,
  isDarkMode,
  colorPalette
}) => {
  if (!isOpen) return null;

  const visibleCount = Object.values(fieldVisibility).filter(Boolean).length;
  const totalCount = Object.keys(fieldVisibility).length;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 bg-black bg-opacity-50 transition-opacity"
          onClick={onClose}
        />

        <div className="fixed inset-y-0 right-0 max-w-full flex">
          <div className={`w-screen max-w-md transform transition-transform ${isDarkMode ? 'bg-gray-900' : 'bg-white'
            }`}>
            <div className="h-full flex flex-col">
              <div className={`px-6 py-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                      }`}>
                      Field Settings
                    </h2>
                    <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                      }`}>
                      {visibleCount} of {totalCount} fields visible
                    </p>
                  </div>
                  <button
                    onClick={onClose}
                    className={`p-2 rounded-lg transition-colors ${isDarkMode
                      ? 'hover:bg-gray-800 text-gray-400'
                      : 'hover:bg-gray-100 text-gray-600'
                      }`}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={onSelectAll}
                    className={`flex-1 px-3 py-2 rounded text-sm transition-colors ${isDarkMode
                      ? 'bg-gray-800 hover:bg-gray-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}
                  >
                    Select All
                  </button>
                  <button
                    onClick={onDeselectAll}
                    className={`flex-1 px-3 py-2 rounded text-sm transition-colors ${isDarkMode
                      ? 'bg-gray-800 hover:bg-gray-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}
                  >
                    Deselect All
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="space-y-2">
                  {fieldOrder.map((fieldKey, index) => (
                    <div
                      key={fieldKey}
                      draggable
                      onDragStart={() => onDragStart(index)}
                      onDragOver={onDragOver}
                      onDrop={() => onDrop(index)}
                      className={`flex items-center gap-2 p-3 rounded-lg border cursor-move transition-colors ${isDarkMode
                        ? 'border-gray-700 hover:bg-gray-800 bg-gray-850'
                        : 'border-gray-200 hover:bg-gray-50 bg-white'
                        }`}
                    >
                      <GripVertical
                        size={18}
                        className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}
                      />

                      <button
                        onClick={() => onToggleVisibility(fieldKey)}
                        className={`flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}
                      >
                        {fieldVisibility[fieldKey] ? (
                          <Eye size={18} />
                        ) : (
                          <EyeOff size={18} />
                        )}
                      </button>

                      <span className={`flex-1 text-sm ${fieldVisibility[fieldKey]
                        ? isDarkMode ? 'text-white' : 'text-gray-900'
                        : isDarkMode ? 'text-gray-600' : 'text-gray-400'
                        }`}>
                        {getFieldLabel(fieldKey)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`px-6 py-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className="flex space-x-3">
                  <button
                    onClick={onReset}
                    className={`flex-1 px-4 py-2 rounded transition-colors ${isDarkMode
                      ? 'bg-gray-800 hover:bg-gray-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}
                  >
                    Reset
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 px-4 py-2 text-white rounded transition-colors"
                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                    onMouseEnter={(e) => {
                      if (colorPalette?.accent) {
                        e.currentTarget.style.backgroundColor = colorPalette.accent;
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed';
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApplicationFieldSettingsModal;
