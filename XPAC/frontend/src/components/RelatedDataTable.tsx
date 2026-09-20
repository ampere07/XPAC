import React, { useState, useEffect } from 'react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
  className?: string;
}

interface RelatedDataTableProps {
  data: any[];
  columns: Column[];
  isDarkMode: boolean;
  onRowClick?: (row: any) => void;
  fullContent?: boolean;
}

const getStatusColor = (status: string, isDarkMode: boolean) => {
  if (!status) return '';
  const lowerStatus = String(status).toLowerCase();
  
  if (['done', 'paid', 'complete', 'completed', 'success', 'active'].includes(lowerStatus)) {
    return isDarkMode ? 'text-green-400' : 'text-green-600';
  }
  
  if (['failed', 'error', 'cancelled', 'declined', 'disconnected', 'void', 'inactive'].includes(lowerStatus)) {
    return isDarkMode ? 'text-red-400' : 'text-red-600';
  }
  
  if (['in progress', 'pending', 'processing', 'restricted', 'waiting'].includes(lowerStatus)) {
    return isDarkMode ? 'text-orange-400' : 'text-orange-600';
  }
  
  return isDarkMode ? 'text-gray-300' : 'text-gray-600';
};

const RelatedDataTable: React.FC<RelatedDataTableProps> = ({
  data = [],
  columns,
  isDarkMode,
  onRowClick,
  fullContent = false
}) => {
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  useEffect(() => {
    const fetchPalette = async () => {
      const palette = await settingsColorPaletteService.getActive();
      setColorPalette(palette);
    };
    fetchPalette();
  }, []);

  const headerTextStyle = {
    color: isDarkMode ? '#ffffff' : '#000000'
  };

  if (!data || data.length === 0) {
    return (
      <div className={`flex-1 flex flex-col ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
        <table className="min-w-full border-collapse">
          <thead className="sticky top-0 z-20 shadow-sm">
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.key}
                  className={`px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap border-b ${
                    isDarkMode 
                      ? `bg-gray-800 ${index < columns.length - 1 ? 'border-r border-gray-700' : ''} border-gray-700` 
                      : `bg-gray-100 ${index < columns.length - 1 ? 'border-r border-gray-200' : ''} border-gray-200`
                  }`}
                  style={headerTextStyle}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td 
                colSpan={columns.length} 
                className={`px-4 py-20 text-center border-b font-medium ${
                  isDarkMode ? 'text-gray-500 border-gray-800' : 'text-gray-400 border-gray-200'
                }`}
              >
                No related records found
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto custom-scroll h-full ${fullContent ? 'full-content-table' : ''}`}>
      <style>{`
        .full-content-table .related-details-list {
          max-height: none !important;
          overflow: visible !important;
        }
      `}</style>
      <table className={`min-w-full border-collapse ${isDarkMode ? 'bg-gray-950' : 'bg-white'}`}>
        <thead className="sticky top-0 z-20 shadow-sm">
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                className={`px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap border-b ${
                  isDarkMode 
                    ? `bg-gray-800 ${index < columns.length - 1 ? 'border-r border-gray-700' : ''} border-gray-700` 
                    : `bg-gray-100 ${index < columns.length - 1 ? 'border-r border-gray-200' : ''} border-gray-200`
                }`}
                style={headerTextStyle}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-200'}`}>
          {data.map((row: any, index: number) => (
            <tr
              key={index}
              className={`transition-colors ${
                isDarkMode 
                  ? 'text-white hover:bg-gray-800' 
                  : 'text-gray-900 hover:bg-gray-50'
              } ${onRowClick ? 'cursor-pointer' : ''}`}
              onClick={(e) => {
                if (onRowClick) {
                  e.stopPropagation();
                  onRowClick(row);
                }
              }}
            >
              {columns.map((column, colIndex) => {
                const isStatusColumn = column.key.toLowerCase().includes('status') || column.label.toLowerCase().includes('status');
                const rawValue = row[column.key];
                
                let renderedContent = column.render
                  ? column.render(rawValue, row)
                  : rawValue || '-';

                if (isStatusColumn && rawValue && typeof rawValue === 'string') {
                  const statusColors = getStatusColor(rawValue, isDarkMode);
                  renderedContent = (
                    <span className={`inline-flex font-bold ${statusColors}`}>
                      {renderedContent}
                    </span>
                  );
                }

                return (
                  <td
                    key={column.key}
                    className={`px-3 py-4 text-sm ${column.className || 'whitespace-nowrap'} ${
                      isDarkMode 
                        ? `${colIndex < columns.length - 1 ? 'border-r border-gray-800' : ''}` 
                        : `${colIndex < columns.length - 1 ? 'border-r border-gray-200' : ''}`
                    }`}
                  >
                    <div className={`${fullContent ? 'whitespace-normal break-words' : 'truncate'} max-w-[400px]`}>
                      {renderedContent}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RelatedDataTable;
