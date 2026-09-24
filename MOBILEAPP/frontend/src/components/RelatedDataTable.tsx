import React from 'react';

interface Column {
  key: string;
  label: string;
  render?: (value: any, row: any) => React.ReactNode;
}

interface RelatedDataTableProps {
  data: any[];
  columns: Column[];
  isDarkMode: boolean;
}

const RelatedDataTable: React.FC<RelatedDataTableProps> = ({
  data,
  columns,
  isDarkMode
}) => {
  if (data.length === 0) {
    return (
      <div className={`text-center py-8 ${
        isDarkMode ? 'text-gray-500' : 'text-gray-600'
      }`}>
        No items
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className={`min-w-full divide-y ${
        isDarkMode ? 'divide-gray-700' : 'divide-gray-200'
      }`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-2 text-left text-xs font-medium ${
                  isDarkMode ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={`divide-y ${
          isDarkMode ? 'divide-gray-700' : 'divide-gray-200'
        }`}>
          {data.map((row: any, index: number) => (
            <tr
              key={index}
              className={isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-2 text-sm ${
                    isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}
                >
                  {column.render
                    ? column.render(row[column.key], row)
                    : row[column.key] || 'N/A'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default RelatedDataTable;
