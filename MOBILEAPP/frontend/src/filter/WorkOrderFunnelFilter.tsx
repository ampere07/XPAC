import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface WorkOrderFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
}

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date';
    value?: string;
    from?: string | number;
    to?: string | number;
  };
}

interface Column {
  key: string;
  label: string;
  table: string;
  dataType: 'varchar' | 'text' | 'int' | 'bigint' | 'decimal' | 'date' | 'datetime' | 'enum';
}

const STORAGE_KEY = 'workOrderFunnelFilters';

const allColumns: Column[] = [
  { key: 'id', label: 'ID', table: 'work_orders', dataType: 'bigint' },
  { key: 'application_id', label: 'Application ID', table: 'work_orders', dataType: 'bigint' },
  { key: 'timestamp', label: 'Timestamp', table: 'work_orders', dataType: 'datetime' },
  { key: 'date_installed', label: 'Date Installed', table: 'work_orders', dataType: 'date' },
  { key: 'installation_fee', label: 'Installation Fee', table: 'work_orders', dataType: 'decimal' },
  { key: 'billing_day', label: 'Billing Day', table: 'work_orders', dataType: 'int' },
  { key: 'billing_status', label: 'Billing Status', table: 'work_orders', dataType: 'varchar' },
  { key: 'modem_router_sn', label: 'Modem/Router SN', table: 'work_orders', dataType: 'varchar' },
  { key: 'router_model', label: 'Router Model', table: 'work_orders', dataType: 'varchar' },
  { key: 'group_name', label: 'Group Name', table: 'work_orders', dataType: 'varchar' },
  { key: 'lcpnap', label: 'LCPNAP', table: 'work_orders', dataType: 'varchar' },
  { key: 'port', label: 'PORT', table: 'work_orders', dataType: 'varchar' },
  { key: 'vlan', label: 'VLAN', table: 'work_orders', dataType: 'varchar' },
  { key: 'username', label: 'Username', table: 'work_orders', dataType: 'varchar' },
  { key: 'ip_address', label: 'IP Address', table: 'work_orders', dataType: 'varchar' },
  { key: 'connection_type', label: 'Connection Type', table: 'work_orders', dataType: 'enum' },
  { key: 'usage_type', label: 'Usage Type', table: 'work_orders', dataType: 'varchar' },
  { key: 'username_status', label: 'Username Status', table: 'work_orders', dataType: 'varchar' },
  { key: 'visit_by', label: 'Visit By', table: 'work_orders', dataType: 'varchar' },
  { key: 'visit_with', label: 'Visit With', table: 'work_orders', dataType: 'varchar' },
  { key: 'visit_with_other', label: 'Visit With Other', table: 'work_orders', dataType: 'varchar' },
  { key: 'onsite_status', label: 'Onsite Status', table: 'work_orders', dataType: 'enum' },
  { key: 'onsite_remarks', label: 'Onsite Remarks', table: 'work_orders', dataType: 'text' },
  { key: 'status_remarks', label: 'Status Remarks', table: 'work_orders', dataType: 'text' },
  { key: 'address_coordinates', label: 'Address Coordinates', table: 'work_orders', dataType: 'varchar' },
  { key: 'contract_link', label: 'Contract Link', table: 'work_orders', dataType: 'text' },
  { key: 'client_signature_url', label: 'Client Signature URL', table: 'work_orders', dataType: 'text' },
  { key: 'setup_image_url', label: 'Setup Image URL', table: 'work_orders', dataType: 'text' },
  { key: 'speedtest_image_url', label: 'Speedtest Image URL', table: 'work_orders', dataType: 'text' },
  { key: 'signed_contract_image_url', label: 'Signed Contract Image URL', table: 'work_orders', dataType: 'text' },
  { key: 'box_reading_image_url', label: 'Box Reading Image URL', table: 'work_orders', dataType: 'text' },
  { key: 'router_reading_image_url', label: 'Router Reading Image URL', table: 'work_orders', dataType: 'text' },
  { key: 'port_label_image_url', label: 'Port Label Image URL', table: 'work_orders', dataType: 'text' },
  { key: 'house_front_picture_url', label: 'House Front Picture URL', table: 'work_orders', dataType: 'text' },
  { key: 'created_at', label: 'Created At', table: 'work_orders', dataType: 'datetime' },
  { key: 'created_by_user_email', label: 'Created By User Email', table: 'work_orders', dataType: 'varchar' },
  { key: 'updated_at', label: 'Updated At', table: 'work_orders', dataType: 'datetime' },
  { key: 'updated_by_user_email', label: 'Updated By User Email', table: 'work_orders', dataType: 'varchar' },
  { key: 'assigned_email', label: 'Assigned Email', table: 'work_orders', dataType: 'varchar' },
  { key: 'pppoe_username', label: 'PPPoE Username', table: 'work_orders', dataType: 'varchar' },
  { key: 'pppoe_password', label: 'PPPoE Password', table: 'work_orders', dataType: 'varchar' },
  { key: 'full_name', label: 'Full Name', table: 'work_orders', dataType: 'varchar' },
  { key: 'address', label: 'Address', table: 'work_orders', dataType: 'text' },
  { key: 'contract_template', label: 'Contract Template', table: 'work_orders', dataType: 'varchar' },
  { key: 'first_name', label: 'First Name', table: 'work_orders', dataType: 'varchar' },
  { key: 'middle_initial', label: 'Middle Initial', table: 'work_orders', dataType: 'varchar' },
  { key: 'last_name', label: 'Last Name', table: 'work_orders', dataType: 'varchar' },
  { key: 'contact_number', label: 'Contact Number', table: 'work_orders', dataType: 'varchar' },
  { key: 'second_contact_number', label: 'Second Contact Number', table: 'work_orders', dataType: 'varchar' },
  { key: 'email_address', label: 'Email Address', table: 'work_orders', dataType: 'varchar' },
  { key: 'region', label: 'Region', table: 'work_orders', dataType: 'varchar' },
  { key: 'city', label: 'City', table: 'work_orders', dataType: 'varchar' },
  { key: 'barangay', label: 'Barangay', table: 'work_orders', dataType: 'varchar' },

  { key: 'choose_plan', label: 'Choose Plan', table: 'work_orders', dataType: 'varchar' },
  { key: 'referred_by', label: 'Referred By', table: 'work_orders', dataType: 'varchar' },
  { key: 'start_timestamp', label: 'Start Timestamp', table: 'work_orders', dataType: 'datetime' },
  { key: 'end_timestamp', label: 'End Timestamp', table: 'work_orders', dataType: 'datetime' },
  { key: 'duration', label: 'Duration', table: 'work_orders', dataType: 'varchar' },
];

const WorkOrderFunnelFilter: React.FC<WorkOrderFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters
}) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});

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
  };

  const handleBack = () => {
    setSelectedColumn(null);
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
    work_orders: allColumns.filter(col => col.table === 'work_orders')
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
                        Work Order Details
                      </h3>
                      <div className="flex flex-col gap-2 w-full">
                        {groupedColumns.work_orders.map(column => {
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

export default WorkOrderFunnelFilter;
