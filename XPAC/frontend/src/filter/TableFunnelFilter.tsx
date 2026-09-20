import React, { useState, useEffect, useMemo } from 'react';
import { X, ChevronLeft, ChevronRight, Search, Check } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

/**
 * The column filter panel, for tables that do not have a bespoke one.
 *
 * Nine screens — Service Orders, Customers, Job Orders, Invoices, SOAs, Transactions, Payment
 * Portal, Applications, Application Visits — each carry their own funnel filter, and those nine
 * files are ~95% the same markup. Fifteen further tables had no column filter at all, and cloning
 * the boilerplate a sixteenth time would have made the drift between copies permanent.
 *
 * This is that boilerplate, extracted once and driven by a column list. The panel is a copy of the
 * existing ones down to the class names — same slide-over, same two-level navigation (column list,
 * then that column's input), same Clear All / Apply footer, same colour-palette theming — so a
 * table adopting it looks like the ones that already had a filter. The bespoke nine are deliberately
 * NOT migrated onto it: several carry per-column behaviour (checklist options fetched from lookup
 * endpoints, prepaid-only date guards) that does not belong in a generic component, and rewriting
 * working screens is risk without benefit.
 *
 * Columns are listed A-Z by display name, which is the rule applied across every filter panel in
 * the app.
 *
 * @see applyFunnelFilters — the matching predicate. A panel that collects filters nothing applies
 *      is worse than no panel, so the two are exported together and must be adopted together.
 */

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

export interface FilterValues {
  [key: string]: {
    type: 'text' | 'number' | 'date' | 'checklist' | 'boolean';
    value?: string | boolean | (string | number)[];
    from?: string | number;
    to?: string | number;
  };
}

export interface FunnelColumn {
  /** Must match the key the table renders the cell from — see `applyFunnelFilters`. */
  key: string;
  label: string;
  dataType: 'varchar' | 'text' | 'int' | 'decimal' | 'date' | 'datetime' | 'checklist' | 'bigint' | 'enum';
  /**
   * Checklist options. Supply them for a 'checklist' column; when omitted the distinct values
   * present in the data are offered instead (see `optionsByKey`), which is what makes a status or
   * category column filterable without adding a lookup endpoint.
   */
  options?: { label: string; value: string | number }[];
}

interface TableFunnelFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyFilters: (filters: FilterValues) => void;
  currentFilters?: FilterValues;
  columns: FunnelColumn[];
  /** Panel heading, e.g. 'Overdue Filters'. */
  title: string;
  /** Sub-heading under the title. */
  subtitle?: string;
  /** localStorage key the panel remembers its selections under. Unique per table. */
  storageKey: string;
  /**
   * Distinct values per column key, derived from the rows currently loaded. Used for any
   * 'checklist' column that did not declare `options` of its own.
   */
  optionsByKey?: Record<string, (string | number)[]>;
}

/**
 * Does one row satisfy the collected filters?
 *
 * Mirrors the predicate the bespoke filters use, so a table adopting this panel behaves the way
 * the rest of the app already does:
 *
 *  - text     — case-insensitive "contains"
 *  - number   — inclusive from/to range; a row whose value is not numeric is excluded once a
 *               bound is set, rather than silently passing
 *  - date     — inclusive from/to range. The 'to' bound is taken to the END of its day, so a
 *               timestamp at 14:00 is not dropped by a 'to' of its own date
 *  - checklist— exact match against any selected option, never "contains": that is what stops
 *               'Paid' matching 'Unpaid' and 'Ultra' matching 'Ultra-Plus 2099'
 *
 * `getValue` resolves a row's value for a column key. Pass one when the table renders a cell from
 * a differently-named field; the default reads the key verbatim.
 */
export function applyFunnelFilters<T>(
  rows: T[],
  filters: FilterValues | undefined,
  getValue: (row: T, key: string) => any = (row, key) => (row as any)[key]
): T[] {
  if (!filters || Object.keys(filters).length === 0) return rows;

  const toTime = (raw: any, endOfDay = false): number => {
    let s = String(raw).trim().replace(' ', 'T');
    if (s.length === 10) s = endOfDay ? `${s}T23:59:59.999` : `${s}T00:00:00`;
    return new Date(s).getTime();
  };

  return rows.filter(row =>
    Object.entries(filters).every(([key, filter]) => {
      const value = getValue(row, key);

      if (filter.type === 'checklist') {
        const selected = filter.value;
        if (!Array.isArray(selected) || selected.length === 0) return true;

        const valStr = String(value ?? '').toLowerCase().trim();
        return selected.some(option => String(option).toLowerCase().trim() === valStr);
      }

      if (filter.type === 'number') {
        const hasFrom = filter.from !== undefined && filter.from !== '';
        const hasTo = filter.to !== undefined && filter.to !== '';
        if (!hasFrom && !hasTo) return true;

        const num = parseFloat(String(value));
        if (isNaN(num)) return false;
        if (hasFrom && num < parseFloat(String(filter.from))) return false;
        if (hasTo && num > parseFloat(String(filter.to))) return false;
        return true;
      }

      if (filter.type === 'date') {
        if (!filter.from && !filter.to) return true;
        if (!value) return false;

        const time = toTime(value);
        if (isNaN(time)) return false;
        if (filter.from && time < toTime(filter.from)) return false;
        if (filter.to && time > toTime(filter.to, true)) return false;
        return true;
      }

      // text
      const needle = typeof filter.value === 'string' ? filter.value : '';
      if (needle === '') return true;
      return String(value ?? '').toLowerCase().includes(needle.toLowerCase());
    })
  );
}

/**
 * Distinct, A-Z sorted values for each checklist column, taken from the rows on screen.
 *
 * Lets a table offer real options — the statuses and categories actually present — without a
 * lookup endpoint per column. Blank values are dropped so the list never opens with an empty row.
 */
export function deriveOptionsByKey<T>(
  rows: T[],
  columns: FunnelColumn[],
  getValue: (row: T, key: string) => any = (row, key) => (row as any)[key]
): Record<string, (string | number)[]> {
  const wanted = columns.filter(c => c.dataType === 'checklist' && !c.options);
  if (wanted.length === 0) return {};

  const sets: Record<string, Set<string>> = {};
  wanted.forEach(c => { sets[c.key] = new Set<string>(); });

  rows.forEach(row => {
    wanted.forEach(c => {
      const raw = getValue(row, c.key);
      if (raw === null || raw === undefined) return;
      const str = String(raw).trim();
      if (str !== '' && str !== '-') sets[c.key].add(str);
    });
  });

  const out: Record<string, (string | number)[]> = {};
  Object.entries(sets).forEach(([key, set]) => {
    out[key] = Array.from(set).sort((a, b) => a.localeCompare(b));
  });
  return out;
}

const TableFunnelFilter: React.FC<TableFunnelFilterProps> = ({
  isOpen,
  onClose,
  onApplyFilters,
  currentFilters,
  columns,
  title,
  subtitle,
  storageKey,
  optionsByKey = {}
}) => {
  const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<FunnelColumn | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        setFilterValues(JSON.parse(saved));
        return;
      } catch (err) {
        console.error('Failed to load saved filters:', err);
      }
    }
    if (currentFilters) setFilterValues(currentFilters);
  }, [isOpen, currentFilters, storageKey]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    settingsColorPaletteService.getActive()
      .then(setColorPalette)
      .catch(err => console.error('Failed to fetch color palette:', err));
  }, []);

  // A-Z by display name, the rule every filter panel in the app follows.
  const sortedColumns = useMemo(
    () => [...columns].sort((a, b) => a.label.localeCompare(b.label)),
    [columns]
  );

  const isNumericType = (dataType: string) => ['int', 'decimal', 'bigint'].includes(dataType);
  const isDateType = (dataType: string) => ['date', 'datetime'].includes(dataType);

  const handleTextChange = (columnKey: string, value: string) => {
    setFilterValues(prev => {
      if (value === '') {
        const next = { ...prev };
        delete next[columnKey];
        return next;
      }
      return { ...prev, [columnKey]: { type: 'text', value } };
    });
  };

  const handleRangeChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'number' as const };
      const next = { ...current, type: 'number' as const, [field]: value };

      if ((next.from === '' || next.from === undefined) && (next.to === '' || next.to === undefined)) {
        const cleared = { ...prev };
        delete cleared[columnKey];
        return cleared;
      }
      return { ...prev, [columnKey]: next };
    });
  };

  const handleDateChange = (columnKey: string, field: 'from' | 'to', value: string) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'date' as const };
      const next = { ...current, type: 'date' as const, [field]: value };

      if (!next.from && !next.to) {
        const cleared = { ...prev };
        delete cleared[columnKey];
        return cleared;
      }
      return { ...prev, [columnKey]: next };
    });
  };

  const toggleOption = (columnKey: string, option: string | number) => {
    setFilterValues(prev => {
      const current = prev[columnKey] || { type: 'checklist' as const, value: [] };
      const selected = ((current.value as (string | number)[]) || []).map(String);
      const optStr = String(option);

      const nextOptions = selected.includes(optStr)
        ? selected.filter(o => o !== optStr)
        : [...selected, optStr];

      if (nextOptions.length === 0) {
        const cleared = { ...prev };
        delete cleared[columnKey];
        return cleared;
      }
      return { ...prev, [columnKey]: { type: 'checklist', value: nextOptions } };
    });
  };

  const handleApply = () => {
    localStorage.setItem(storageKey, JSON.stringify(filterValues));
    onApplyFilters(filterValues);
    onClose();
  };

  const handleReset = () => {
    setFilterValues({});
    setSelectedColumn(null);
    localStorage.removeItem(storageKey);
    onApplyFilters({});
  };

  const inputClass = `w-full px-3 py-2 rounded border focus:outline-none transition-all ${isDarkMode
    ? 'bg-gray-800 border-gray-700 text-white'
    : 'bg-white border-gray-300 text-gray-900'
    }`;

  const focusBorder = {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      if (colorPalette?.primary) e.currentTarget.style.borderColor = colorPalette.primary;
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = 'transparent';
    }
  };

  const renderFilterInput = () => {
    if (!selectedColumn) return null;
    const currentValue = filterValues[selectedColumn.key];

    if (selectedColumn.dataType === 'checklist') {
      const options = selectedColumn.options
        ?? (optionsByKey[selectedColumn.key] || []).map(v => ({ label: String(v), value: v }));

      const filteredOptions = options.filter(opt =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase())
      );

      return (
        <div className="flex flex-col h-full overflow-hidden">
          <div className="relative mb-4">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} />
            <input
              type="text"
              placeholder="Search options..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 rounded-lg border text-sm focus:outline-none transition-all ${isDarkMode
                ? 'bg-gray-800 border-gray-700 text-white'
                : 'bg-gray-50 border-gray-200 text-gray-900'
                }`}
              style={{ borderColor: 'transparent' }}
              {...focusBorder}
            />
          </div>
          <div className="flex-1 overflow-y-auto pr-2 space-y-1 custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, idx) => {
                const isSelected = (currentValue?.value as (string | number)[])?.map(String).includes(String(option.value));
                return (
                  <button
                    key={idx}
                    onClick={() => toggleOption(selectedColumn.key, option.value)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${isSelected
                      ? ''
                      : (isDarkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-50 text-gray-700')
                      }`}
                    style={isSelected ? {
                      backgroundColor: hexToRgba(colorPalette?.primary || '#7c3aed', 0.1),
                      color: colorPalette?.primary || '#7c3aed'
                    } : {}}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    {isSelected && <Check className="h-4 w-4" />}
                  </button>
                );
              })
            ) : (
              <div className="text-center py-8">
                <p className={`text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>No results found</p>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (isNumericType(selectedColumn.dataType)) {
      return (
        <div className="space-y-4">
          {(['from', 'to'] as const).map(bound => (
            <div key={bound}>
              <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {bound === 'from' ? 'From' : 'To'}
              </label>
              <input
                type="number"
                value={currentValue?.[bound] ?? ''}
                onChange={(e) => handleRangeChange(selectedColumn.key, bound, e.target.value)}
                placeholder={bound === 'from' ? 'Minimum value' : 'Maximum value'}
                className={inputClass}
                style={{ borderColor: 'transparent' }}
                {...focusBorder}
              />
            </div>
          ))}
        </div>
      );
    }

    if (isDateType(selectedColumn.dataType)) {
      return (
        <div className="space-y-4">
          {(['from', 'to'] as const).map(bound => (
            <div key={bound}>
              <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                {bound === 'from' ? 'From' : 'To'}
              </label>
              <input
                type={selectedColumn.dataType === 'datetime' ? 'datetime-local' : 'date'}
                value={currentValue?.[bound] ?? ''}
                onChange={(e) => handleDateChange(selectedColumn.key, bound, e.target.value)}
                className={inputClass}
                style={{ borderColor: 'transparent' }}
                {...focusBorder}
              />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div>
        <label className={`text-sm font-medium mb-2 block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
          Search Value
        </label>
        <input
          type="text"
          value={typeof currentValue?.value === 'string' ? currentValue.value : ''}
          onChange={(e) => handleTextChange(selectedColumn.key, e.target.value)}
          placeholder={`Enter ${selectedColumn.label.toLowerCase()}`}
          className={inputClass}
          style={{ borderColor: 'transparent' }}
          {...focusBorder}
        />
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden text-left">
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />

        <div className="fixed inset-y-0 right-0 max-w-full flex">
          <div className={`w-screen max-w-md transform transition-transform duration-300 flex flex-col ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 shadow-2xl'
            }`}>
            {/* Header */}
            <div className={`px-6 py-5 flex items-center justify-between border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-100'
              }`}>
              <div className="flex items-center space-x-4">
                {selectedColumn && (
                  <button
                    onClick={() => { setSelectedColumn(null); setSearchTerm(''); }}
                    className={`p-2 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                )}
                <div>
                  <h2 className="text-xl font-bold tracking-tight">
                    {selectedColumn ? selectedColumn.label : title}
                  </h2>
                  {!selectedColumn && subtitle && (
                    <p className={`text-xs mt-0.5 font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      {subtitle}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className={`p-2 rounded-xl transition-colors ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-6 scroll-smooth">
              {selectedColumn ? (
                renderFilterInput()
              ) : (
                <div className="space-y-1">
                  {sortedColumns.map((column) => {
                    const isActive = !!filterValues[column.key];
                    return (
                      <button
                        key={column.key}
                        onClick={() => { setSelectedColumn(column); setSearchTerm(''); }}
                        className={`w-full group flex items-center justify-between p-4 rounded-2xl transition-all duration-200 ${isDarkMode
                          ? 'hover:bg-gray-800'
                          : 'hover:bg-gray-50 border border-transparent hover:border-gray-200'
                          }`}
                      >
                        <div className="flex items-center space-x-4">
                          <div className="relative">
                            <div className={`text-sm font-semibold transition-colors ${isActive ? '' : (isDarkMode ? 'text-gray-200' : 'text-gray-700')
                              }`}
                              style={isActive ? { color: colorPalette?.primary || '#7c3aed' } : {}}
                            >
                              {column.label}
                            </div>
                            {isActive && (
                              <div
                                className="absolute -left-3 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
                                style={{
                                  backgroundColor: colorPalette?.primary || '#7c3aed',
                                  boxShadow: `0 0 8px ${hexToRgba(colorPalette?.primary || '#7c3aed', 0.6)}`
                                }}
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-3">
                          {isActive && (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
                              style={{
                                backgroundColor: hexToRgba(colorPalette?.primary || '#7c3aed', isDarkMode ? 0.2 : 0.1),
                                color: colorPalette?.primary || '#7c3aed'
                              }}
                            >
                              Active
                            </span>
                          )}
                          <ChevronRight className={`h-4 w-4 transition-transform group-hover:translate-x-0.5 ${isDarkMode ? 'text-gray-600' : 'text-gray-300'
                            }`} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={`px-6 py-6 border-t ${isDarkMode ? 'border-gray-800 bg-gray-900/50' : 'border-gray-100 bg-gray-50/50'}`}>
              <div className="flex space-x-3">
                <button
                  onClick={handleReset}
                  className={`flex-1 px-4 py-3 rounded-2xl font-bold text-sm transition-all duration-200 ${isDarkMode
                    ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                    : 'bg-white border border-gray-200 hover:border-gray-300 text-gray-600 shadow-sm'
                    }`}
                >
                  Clear All
                </button>
                <button
                  onClick={handleApply}
                  className="flex-1 px-4 py-3 rounded-2xl font-bold text-sm text-white transition-all duration-200 active:scale-[0.98]"
                  style={{
                    backgroundColor: colorPalette?.primary || '#7c3aed',
                    boxShadow: `0 4px 12px ${hexToRgba(colorPalette?.primary || '#7c3aed', 0.2)}`
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
  );
};

export default TableFunnelFilter;
