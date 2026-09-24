import React, { useState, useEffect } from 'react';
import { Search, Eye, X } from 'lucide-react';
import ExpensesLogDetails from '../components/ExpensesLogDetails';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

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
  organization_id?: number;
}

const ExpensesLog: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expenseRecords, setExpenseRecords] = useState<ExpenseRecord[]>([]);
  const [selectedExpense, setSelectedExpense] = useState<ExpenseRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

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

  // API Base URL
  const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

  useEffect(() => {
    const fetchExpenseData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetch(`${API_BASE_URL}/expenses-logs`);
        const result = await response.json();

        if (result.status === 'success') {
          setExpenseRecords(result.data);
        } else {
          throw new Error(result.message || 'Failed to fetch expense records');
        }
      } catch (err: any) {
        console.error('Failed to fetch expense data:', err);
        setError(err.message || 'Failed to load expense records. Please try again.');
        setExpenseRecords([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchExpenseData();
  }, []);

  const filteredExpenseRecords = expenseRecords.filter(record => {
    const authData = JSON.parse(localStorage.getItem('authData') || '{}');
    const userOrgId = authData.organization_id;

    // Organization filter
    if (userOrgId && record.organization_id && record.organization_id !== userOrgId) {
      return false;
    }

    const matchesSearch = searchQuery === '' ||
      record.payee.toLowerCase().includes(searchQuery.toLowerCase()) ||
      record.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      record.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      record.invoiceNo.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  const handleRowClick = (record: ExpenseRecord) => {
    setSelectedExpense(record);
  };

  const handleCloseDetails = () => {
    setSelectedExpense(null);
  };

  return (
    <div className={`h-full flex overflow-hidden ${isDarkMode ? 'bg-slate-900' : 'bg-gray-50'
      }`}>
      {/* Main Table Area */}
      <div className={`${selectedExpense ? 'flex-1' : 'w-full'} flex flex-col overflow-hidden`}>
        {/* Search Bar */}
        <div className={`p-4 border-b flex-shrink-0 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'
          }`}>
          <div className="relative">
            <input
              type="text"
              placeholder="Search expense records..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full rounded pl-10 pr-4 py-3 focus:outline-none text-sm ${isDarkMode
                  ? 'bg-slate-700 text-white border-slate-600'
                  : 'bg-white text-gray-900 border-gray-300'
                }`}
              onFocus={(e) => {
                if (colorPalette?.primary) {
                  e.currentTarget.style.borderColor = colorPalette.primary;
                  e.currentTarget.style.boxShadow = `0 0 0 1px ${colorPalette.primary}`;
                }
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = isDarkMode ? '#475569' : '#d1d5db';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
            <Search className={`absolute left-3 top-3.5 h-4 w-4 ${isDarkMode ? 'text-slate-400' : 'text-gray-500'
              }`} />
          </div>
        </div>

        {/* Table Content */}
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">
            {isLoading ? (
              <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                }`}>
                <div className="animate-pulse flex flex-col items-center">
                  <div className={`h-4 w-1/3 rounded mb-4 ${isDarkMode ? 'bg-slate-700' : 'bg-gray-300'
                    }`}></div>
                  <div className={`h-4 w-1/2 rounded ${isDarkMode ? 'bg-slate-700' : 'bg-gray-300'
                    }`}></div>
                </div>
                <p className="mt-4">Loading expense records...</p>
              </div>
            ) : error ? (
              <div className={`px-4 py-12 text-center ${isDarkMode ? 'text-red-400' : 'text-red-600'
                }`}>
                <p>{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className={`mt-4 text-white px-4 py-2 rounded ${isDarkMode ? 'bg-slate-700 hover:bg-slate-600' : 'bg-gray-500 hover:bg-gray-600'
                    }`}>
                  Retry
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-max min-w-full text-sm">
                  <thead>
                    <tr className={`border-b ${isDarkMode ? 'border-slate-700 bg-slate-800' : 'border-gray-200 bg-gray-50'
                      }`}>
                      <th className={`text-left py-3 px-4 font-medium min-w-28 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Date</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-32 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Amount</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-56 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Payee</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-40 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Category</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-64 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Description</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-32 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Invoice No.</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-28 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Provider</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-24 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Photo</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-40 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Processed By</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-36 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Modified By</th>
                      <th className={`text-left py-3 px-4 font-medium min-w-40 whitespace-nowrap ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                        }`}>Modified Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenseRecords.length > 0 ? (
                      filteredExpenseRecords.map((record) => (
                        <tr
                          key={record.id}
                          className={`border-b cursor-pointer transition-colors ${isDarkMode
                              ? 'border-slate-800 hover:bg-slate-800'
                              : 'border-gray-200 hover:bg-gray-50'
                            } ${selectedExpense?.id === record.id
                              ? isDarkMode ? 'bg-slate-800' : 'bg-gray-100'
                              : ''
                            }`}
                          onClick={() => handleRowClick(record)}
                        >
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>{record.date}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>₱{record.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`} title={record.payee}>{record.payee}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>{record.category}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`} title={record.description}>{record.description}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-red-400' : 'text-red-600'
                            }`}>{record.invoiceNo}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>{record.provider}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>
                            {record.photo ? (
                              <button className={isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}>
                                <Eye size={16} />
                              </button>
                            ) : (
                              <span className={isDarkMode ? 'text-slate-500' : 'text-gray-400'}>-</span>
                            )}
                          </td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>{record.processedBy}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>{record.modifiedBy}</td>
                          <td className={`py-3 px-4 whitespace-nowrap ${isDarkMode ? 'text-white' : 'text-gray-900'
                            }`}>{record.modifiedDate}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={11} className={`px-4 py-12 text-center ${isDarkMode ? 'text-slate-400' : 'text-gray-600'
                          }`}>
                          No expense records found matching your search
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Expense Details Panel */}
      {selectedExpense && (
        <div className={`w-full max-w-3xl border-l flex-shrink-0 relative ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-white border-gray-200'
          }`}>
          <div className="absolute top-4 right-4 z-10">
            <button
              onClick={handleCloseDetails}
              className={`transition-colors rounded p-1 ${isDarkMode
                  ? 'text-slate-400 hover:text-white bg-slate-800'
                  : 'text-gray-600 hover:text-gray-900 bg-gray-100'
                }`}
            >
              <X size={20} />
            </button>
          </div>
          <ExpensesLogDetails expenseRecord={selectedExpense} />
        </div>
      )}
    </div>
  );
};

export default ExpensesLog;
