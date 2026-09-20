import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Search, Check } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import apiClient from '../config/api';
import { planService } from '../services/planService';

interface ApplicationVisitFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date' | 'checklist';
    value?: string;
    from?: string | number;
    to?: string | number;
    selectedOptions?: string[];
  };
}

interface Column {
  key: string;
  label: string;
  table: string;
  dataType: 'varchar' | 'text' | 'int' | 'bigint' | 'decimal' | 'date' | 'datetime' | 'enum' | 'checklist';
}

const STORAGE_KEY = 'applicationVisitFunnelFilters';

const allColumns: Column[] = [
  { key: 'id', label: 'ID', table: 'application_visits', dataType: 'bigint' },
  { key: 'application_id', label: 'Application ID', table: 'application_visits', dataType: 'bigint' },
  { key: 'timestamp', label: 'Timestamp', table: 'application_visits', dataType: 'datetime' },
  { key: 'assigned_email', label: 'Assigned Email', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_by', label: 'Visit By', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_with', label: 'Visit With', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_with_other', label: 'Visit With (Other)', table: 'application_visits', dataType: 'varchar' },
  { key: 'visit_status', label: 'Visit Status', table: 'application_visits', dataType: 'enum' },
  { key: 'visit_remarks', label: 'Visit Remarks', table: 'application_visits', dataType: 'text' },
  { key: 'status_remarks', label: 'Status Remarks', table: 'application_visits', dataType: 'text' },
  { key: 'application_status', label: 'Application Status', table: 'application_visits', dataType: 'varchar' },
  { key: 'full_name', label: 'Full Name', table: 'application_visits', dataType: 'varchar' },
  { key: 'full_address', label: 'Full Address', table: 'application_visits', dataType: 'text' },
  { key: 'referred_by', label: 'Referred By', table: 'application_visits', dataType: 'varchar' },
  { key: 'updated_by_user_email', label: 'Updated By User Email', table: 'application_visits', dataType: 'varchar' },
  { key: 'created_at', label: 'Created At', table: 'application_visits', dataType: 'datetime' },
  { key: 'updated_at', label: 'Updated At', table: 'application_visits', dataType: 'datetime' },
  { key: 'first_name', label: 'First Name', table: 'application_visits', dataType: 'varchar' },
  { key: 'middle_initial', label: 'Middle Initial', table: 'application_visits', dataType: 'varchar' },
  { key: 'last_name', label: 'Last Name', table: 'application_visits', dataType: 'varchar' },
  { key: 'region', label: 'Region', table: 'application_visits', dataType: 'varchar' },
  { key: 'city', label: 'City', table: 'application_visits', dataType: 'varchar' },
  { key: 'barangay', label: 'Barangay', table: 'application_visits', dataType: 'varchar' },

  { key: 'choose_plan', label: 'Choose Plan', table: 'application_visits', dataType: 'checklist' },
  { key: 'promo', label: 'Promo', table: 'application_visits', dataType: 'varchar' },
  { key: 'house_front_picture_url', label: 'House Front Picture URL', table: 'application_visits', dataType: 'text' },
  { key: 'image1_url', label: 'Image 1 URL', table: 'application_visits', dataType: 'text' },
  { key: 'image2_url', label: 'Image 2 URL', table: 'application_visits', dataType: 'text' },
  { key: 'image3_url', label: 'Image 3 URL', table: 'application_visits', dataType: 'text' },
];

const ApplicationVisitFunnelFilter: React.FC<ApplicationVisitFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters
}) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [plans, setPlans] = useState<string[]>([]);

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

  useEffect(() => {
    if (isOpen) {
      const fetchChecklistData = async () => {
        try {
          const planData = await planService.getAllPlans();
          if (planData) {
            const formattedPlans = planData.map(p => {
              const name = p.name || (p as any).plan_name || 'Unknown';
              const price = Math.floor(Number(p.price || 0));
              return `${name} ${price}`;
            });
            setPlans([...formattedPlans].sort((a, b) => String(a).localeCompare(String(b))));
          }
        } catch (err) {
          console.error('Failed to fetch checklist data:', err);
        }
      };
      fetchChecklistData();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const savedFilters = localStorage.getItem(STORAGE_KEY);
      if (savedFilters) {
        try {
          setFilterValues(JSON.parse(savedFilters));
        } catch (err) {
          console.error('Failed to load saved filters:', err);
        }
      } else if (currentFilters) {
        setFilterValues(currentFilters);
      }
    }
  }, [isOpen, currentFilters]);

  const handleColumnClick = (column: Column) => {
    setSelectedColumn(column);
    setSearchTerm('');
  };

  const handleBack = () => {
    setSelectedColumn(null);
    setSearchTerm('');
  };

  const handleApply = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filterValues));
    onApplyFilters(filterValues);
    onClose();
  };

  const handleReset = () => {
    setFilterValues({});
    setSelectedColumn(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  const isNumericType = (dataType: string) => {
    return ['int', 'bigint', 'decimal'].includes(dataType);
  };

  const isDateType = (dataType: string) => {
    return ['date', 'datetime'].includes(dataType);
  };

  const handleTextChange = (columnKey: string, value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: {
        type: 'text',
        value
      }
    }));
  };

  const handleRangeChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: {
        ...prev[columnKey],
        type: 'number',
        [field]: value
      }
    }));
  };

  const handleDateChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => ({
      ...prev,
      [columnKey]: {
        ...prev[columnKey],
        type: 'date',
        [field]: value
      }
    }));
  };

  const toggleOption = (columnKey: string, option: string) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'checklist', selectedOptions: [] };
      const selectedOptions = current.selectedOptions || [];

      const nextOptions = selectedOptions.includes(option)
        ? selectedOptions.filter((o: string) => o !== option)
        : [...selectedOptions, option];

      if (nextOptions.length === 0) {
        const newFilters = { ...prev };
        delete newFilters[columnKey];
        return newFilters;
      }

      return {
        ...prev,
        [columnKey]: {
          ...current,
          type: 'checklist',
          selectedOptions: nextOptions
        }
      };
    });
  };

  const getActiveFilterCount = () => {
    return Object.keys(filterValues).filter(key => {
      const filter = filterValues[key];
      if (filter.type === 'text') {
        return filter.value && filter.value.trim() !== '';
      }
      return filter.from !== undefined || filter.to !== undefined;
    }).length;
  };

  const groupedColumns = {
    application_visits: allColumns.filter(col => col.table === 'application_visits')
  };

  const renderFilterInput = () => {
    if (!selectedColumn) return null;

    const currentValue = filterValues[selectedColumn.key];

    if (isNumericType(selectedColumn.dataType)) {
      return (
        <div className="space-y-4">
          <div>
            <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              From
            </label>
            <input
              type="number"
              value={currentValue?.from || ''}
              onChange={(e) => handleRangeChange(selectedColumn.key, 'from', e.target.value)}
              placeholder="Minimum value"
              className={`w-full px-3 py-2 rounded border ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
            />
          </div>
          <div>
            <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              To
            </label>
            <input
              type="number"
              value={currentValue?.to || ''}
              onChange={(e) => handleRangeChange(selectedColumn.key, 'to', e.target.value)}
              placeholder="Maximum value"
              className={`w-full px-3 py-2 rounded border ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
            />
          </div>
        </div>
      );
    }

    if (isDateType(selectedColumn.dataType)) {
      return (
        <div className="space-y-4">
          <div>
            <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              From
            </label>
            <input
              type={selectedColumn.dataType === 'datetime' ? 'datetime-local' : 'date'}
              value={currentValue?.from || ''}
              onChange={(e) => handleDateChange(selectedColumn.key, 'from', e.target.value)}
              className={`w-full px-3 py-2 rounded border ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
            />
          </div>
          <div>
            <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
              }`}>
              To
            </label>
            <input
              type={selectedColumn.dataType === 'datetime' ? 'datetime-local' : 'date'}
              value={currentValue?.to || ''}
              onChange={(e) => handleDateChange(selectedColumn.key, 'to', e.target.value)}
              className={`w-full px-3 py-2 rounded border ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-white border-gray-300 text-gray-900'
                }`}
            />
          </div>
        </div>
      );
    }

    if (selectedColumn.dataType === 'checklist') {
      let options: { label: string, value: string }[] = [];
      if (selectedColumn.key === 'choose_plan') {
        options = plans.map(p => ({ label: p, value: p }));
      }

      const filteredOptions = options.filter(opt =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase())
      );

      return (
        <div className="space-y-4">
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />
            <input
              type="text"
              placeholder={`Search ${selectedColumn.label}...`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pl-9 pr-3 py-2 rounded-lg border text-sm transition-colors ${
                isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:border-gray-600'
                  : 'bg-gray-50 border-gray-200 text-gray-900 placeholder-gray-400 focus:border-gray-300'
              } focus:outline-none focus:ring-1 focus:ring-opacity-50`}
              style={{
                '--tw-ring-color': colorPalette?.primary || '#7c3aed'
              } as React.CSSProperties}
            />
          </div>

          <div className="max-h-60 overflow-y-auto space-y-1 pr-2 custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = currentValue?.selectedOptions?.includes(option.value) || false;
                return (
                  <button
                    key={option.value}
                    onClick={() => toggleOption(selectedColumn.key, option.value)}
                    className={`w-full flex items-center justify-between p-2 rounded-md text-sm transition-all ${
                      isSelected
                        ? isDarkMode
                          ? 'bg-gray-800 text-white font-medium'
                          : 'bg-indigo-50 text-indigo-900 font-medium'
                        : isDarkMode
                          ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <span>{option.label}</span>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'border-transparent'
                        : isDarkMode
                          ? 'border-gray-600'
                          : 'border-gray-300'
                    }`}
                    style={isSelected ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                    >
                      {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className={`text-center py-4 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                No options found
              </div>
            )}
          </div>
        </div>
      );
    }

    return (
      <div>
        <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
          }`}>
          Search Value
        </label>
        <input
          type="text"
          value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
          onChange={(e) => handleTextChange(selectedColumn.key, e.target.value)}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          className={`w-full px-3 py-2 rounded border ${isDarkMode
            ? 'bg-gray-800 border-gray-700 text-white'
            : 'bg-white border-gray-300 text-gray-900'
            }`}
        />
      </div>
    );
  };

  if (!isOpen) return null;

  const activeFilterCount = getActiveFilterCount();

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
                  <div className="flex items-center space-x-3">
                    {selectedColumn && (
                      <button
                        onClick={handleBack}
                        className={`p-2 rounded-lg transition-colors ${isDarkMode
                          ? 'hover:bg-gray-800 text-gray-400'
                          : 'hover:bg-gray-100 text-gray-600'
                          }`}
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                    )}
                    <div>
                      <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}>
                        {selectedColumn ? selectedColumn.label : 'Filter'}
                      </h2>
                      {!selectedColumn && activeFilterCount > 0 && (
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                          }`}>
                          {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
                        </p>
                      )}
                    </div>
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
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4">
                {selectedColumn ? (
                  renderFilterInput()
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h3 className={`text-sm font-semibold mb-3 uppercase tracking-wider ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                        Application Visit Details
                      </h3>
                      <div className="flex flex-col gap-2 w-full">
                        {[...groupedColumns.application_visits].sort((a, b) => a.label.localeCompare(b.label)).map(column => {
                          const hasFilter = filterValues[column.key] && (
                            filterValues[column.key].value ||
                            filterValues[column.key].from !== undefined ||
                            filterValues[column.key].to !== undefined
                          );

                          return (
                            <div
                              key={column.key}
                              onClick={() => handleColumnClick(column)}
                              className={`w-full p-3 cursor-pointer transition-all flex items-center justify-between border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                                }`}
                            >
                              <div className="flex items-center space-x-2">
                                <span className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                                  }`}>
                                  {column.label}
                                </span>
                                {hasFilter && (
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                  />
                                )}
                              </div>
                              <ChevronRight className={`h-4 w-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                                }`} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className={`px-6 py-4 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                }`}>
                <div className="flex space-x-3">
                  <button
                    onClick={handleReset}
                    className={`flex-1 px-4 py-2 rounded transition-colors ${isDarkMode
                      ? 'bg-gray-800 hover:bg-gray-700 text-white'
                      : 'bg-gray-200 hover:bg-gray-300 text-gray-900'
                      }`}
                  >
                    Clear All
                  </button>
                  <button
                    onClick={handleApply}
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
                    Apply Filters
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

export default ApplicationVisitFunnelFilter;
