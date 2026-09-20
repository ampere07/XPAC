import React, { useState, useEffect } from 'react';
import { Trash2, Edit, ChevronLeft, ChevronRight as ChevronRightNav, Maximize2, X, Info, Mail } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch (e) {
    return dateString;
  }
};

interface ExpenseRecord {
  id: string;
  expensesId: string;
  date: string;
  amount: number;
  payee: string;
  category: string;
  description: string;
  invoiceNo: string;
  provider: string;
  photo?: string;
  processedBy: string;
  modifiedBy: string;
  modifiedDate: string;
  userEmail: string;
  receivedDate: string;
  supplier: string;
  city: string;
}

interface ExpensesLogDetailsProps {
  expenseRecord: ExpenseRecord;
}

const ExpensesLogDetails: React.FC<ExpensesLogDetailsProps> = ({
  expenseRecord
}) => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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

  useEffect(() => {
    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark');
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  return (
    <div className={`h-full flex flex-col ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'
      }`}>
      {/* Header */}
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isDarkMode
          ? 'bg-gray-800 border-gray-700'
          : 'bg-gray-100 border-gray-200'
        }`}>
        <h1 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>
          {formatDate(expenseRecord.date)}
        </h1>
        <div className="flex items-center space-x-2">
          <button className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
            }`}>
            <Trash2 size={18} />
          </button>
          <button
            className="p-2 rounded transition-colors text-white"
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
            <Edit size={18} />
          </button>
          <button className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
            }`}>
            <ChevronLeft size={18} />
          </button>
          <button className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
            }`}>
            <ChevronRightNav size={18} />
          </button>
          <button className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
            }`}>
            <Maximize2 size={18} />
          </button>
          <button className={`p-2 rounded transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200'
            }`}>
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Expense Details */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Date */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Date</span>
          <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{formatDate(expenseRecord.date)}</span>
        </div>

        {/* Expenses ID */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Expenses ID</span>
          <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{expenseRecord.expensesId}</span>
        </div>

        {/* Provider */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Provider</span>
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{expenseRecord.provider}</span>
            <Info size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </div>
        </div>

        {/* Description */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Description</span>
          <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{expenseRecord.description}</span>
        </div>

        {/* Amount */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Amount</span>
          <span className={`font-medium text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>₱{expenseRecord.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>

        {/* Processed By */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Processed By</span>
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{expenseRecord.processedBy}</span>
            <Info size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </div>
        </div>

        {/* Modified By */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Modified By</span>
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{expenseRecord.modifiedBy}</span>
            <Info size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </div>
        </div>

        {/* Modified Date */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Modified Date</span>
          <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{formatDate(expenseRecord.modifiedDate)}</span>
        </div>

        {/* User Email */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>User Email</span>
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{expenseRecord.userEmail}</span>
            <Mail size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </div>
        </div>

        {/* Payee */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Payee</span>
          <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{expenseRecord.payee}</span>
        </div>

        {/* Category */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Category</span>
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{expenseRecord.category}</span>
            <Info size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </div>
        </div>

        {/* Invoice Number */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Invoice No.</span>
          <span className="text-red-400 font-medium">{expenseRecord.invoiceNo}</span>
        </div>

        {/* Received Date */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Received Date</span>
          <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{formatDate(expenseRecord.receivedDate)}</span>
        </div>

        {/* Supplier */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>Supplier</span>
          <div className="flex items-center space-x-2">
            <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
              }`}>{expenseRecord.supplier}</span>
            <Info size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-600'} />
          </div>
        </div>

        {/* City */}
        <div className="flex justify-between items-center">
          <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
            }`}>City</span>
          <span className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
            }`}>{expenseRecord.city}</span>
        </div>
      </div>
    </div>
  );
};

export default ExpensesLogDetails;
