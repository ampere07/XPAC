import React from 'react';
import { X } from 'lucide-react';
import RelatedDataTableBase from './RelatedDataTable';
const RelatedDataTable: any = RelatedDataTableBase;
import { TableColumn } from '../config/relatedDataColumns';

interface GlobalRelatedDataOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  data: any[];
  columns: TableColumn[];
  count: number;
  isDarkMode: boolean;
  onRowClick?: (row: any) => void;
}

const GlobalRelatedDataOverlay: React.FC<GlobalRelatedDataOverlayProps> = ({
  isOpen,
  onClose,
  title,
  data,
  columns,
  count,
  isDarkMode,
  onRowClick
}) => {
  if (!isOpen) return null;

  return (
    <div className={`absolute inset-0 z-[100] flex flex-col ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${
        isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
      }`}>
        <div className="flex items-center space-x-2 md:space-x-4">
          <div className="flex items-center space-x-2 md:space-x-3">
            <h2 className={`text-lg md:text-xl font-bold truncate max-w-[200px] md:max-w-none ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
              {title}
            </h2>
            <span className={`text-[10px] md:text-xs font-bold px-2 py-0.5 rounded-full border ${
              isDarkMode 
                ? 'bg-gray-800 text-gray-400 border-gray-700' 
                : 'bg-blue-50 text-blue-600 border-blue-100'
            }`}>
              {count} {count === 1 ? 'item' : 'items'}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className={`p-2 rounded-lg transition-all ${
            isDarkMode 
              ? 'hover:bg-red-500/10 text-gray-400 hover:text-red-500' 
              : 'hover:bg-red-50 text-gray-600 hover:text-red-600'
          }`}
          aria-label="Close"
        >
          <X size={24} />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className={`flex-1 flex flex-col overflow-hidden ${
          isDarkMode ? 'bg-gray-950' : 'bg-gray-50'
        }`}>
          <div className="flex-1 overflow-auto custom-scroll">
            <RelatedDataTable
              data={data}
              columns={columns}
              isDarkMode={isDarkMode}
              fullContent={true}
              onRowClick={onRowClick}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default GlobalRelatedDataOverlay;
