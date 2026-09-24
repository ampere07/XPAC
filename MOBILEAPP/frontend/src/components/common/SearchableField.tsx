import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown } from 'lucide-react';

export interface GroupedOption {
  label: string;
  options: any[];
}

interface SearchableFieldProps {
  label: string;
  placeholder?: string;
  value: string;
  onSelect: (value: string, option?: any) => void;
  options?: any[];
  groupedOptions?: GroupedOption[];
  optionLabelKey: string;
  isDarkMode: boolean;
  error?: string;
  icon?: React.ReactNode;
  colorPalette?: any;
  required?: boolean;
  isHeaderSelectable?: boolean;
  emptyMessage?: string;
}

const SearchableField: React.FC<SearchableFieldProps> = ({
  label,
  placeholder = 'Search...',
  value,
  onSelect,
  options = [],
  groupedOptions,
  optionLabelKey,
  isDarkMode,
  error,
  icon,
  colorPalette,
  required,
  isHeaderSelectable = false,
  emptyMessage
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getFilteredOptions = () => {
    if (groupedOptions) {
      return groupedOptions.map(group => {
        const labelMatches = (group.label || '').toLowerCase().includes(searchTerm.toLowerCase());
        const filteredOptions = group.options.filter(option =>
          (option[optionLabelKey] || '').toLowerCase().includes(searchTerm.toLowerCase())
        );

        return {
          ...group,
          options: labelMatches ? group.options : filteredOptions,
          isLabelMatch: labelMatches
        };
      }).filter(group => group.options.length > 0 || group.isLabelMatch);
    }
    
    return options.filter(option =>
      (option[optionLabelKey] || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  const filteredData = getFilteredOptions();
  const hasResults = groupedOptions 
    ? (filteredData as any[]).some(g => g.options.length > 0 || g.isLabelMatch)
    : (filteredData as any[]).length > 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <label className={`block text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {label}{required && <span className="text-red-500">*</span>}
      </label>
      <div className={`flex items-center px-3 py-2 border rounded transition-colors ${
        isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'
      } ${error ? 'border-red-500' : 'focus-within:border-orange-500'}`}>
        {icon || <Search size={16} className={`mr-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} />}
        <input
          type="text"
          placeholder={placeholder}
          value={isOpen ? searchTerm : (value || '')}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className={`w-full bg-transparent border-none focus:outline-none p-0 text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
        />
        <button
          type="button"
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
              setSearchTerm('');
            } else {
              setIsOpen(true);
            }
          }}
          className={`ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        >
          <ChevronDown size={18} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
        </button>
      </div>

      {isOpen && (
        <div className={`absolute left-0 right-0 top-full mt-1 z-50 rounded-md shadow-2xl border overflow-hidden flex flex-col ${
          isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
        }`} style={{ minWidth: '100vw', maxWidth: '300px', width: '100%' }}>
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {hasResults ? (
              groupedOptions ? (
                (filteredData as GroupedOption[]).map((group, gIdx) => (
                  <div key={gIdx}>
                    <div 
                      className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider ${
                        isDarkMode ? 'bg-gray-900/50 text-gray-500' : 'bg-gray-50 text-gray-400'
                      } ${isHeaderSelectable ? `cursor-pointer hover:bg-orange-500/10 hover:text-orange-500 transition-colors ${
                        value === group.label ? (isDarkMode ? 'text-orange-400' : 'text-orange-600') : ''
                      }` : ''}`}
                      onClick={() => {
                        if (isHeaderSelectable) {
                          onSelect(group.label);
                          setIsOpen(false);
                          setSearchTerm('');
                        }
                      }}
                    >
                      {group.label}
                    </div>
                    {group.options.map((option, oIdx) => (
                      <div
                        key={`${gIdx}-${oIdx}`}
                        className={`px-6 py-2 text-sm cursor-pointer transition-colors ${
                          isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                        } ${value === option[optionLabelKey] ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                        onClick={() => {
                          onSelect(option[optionLabelKey], option);
                          setIsOpen(false);
                          setSearchTerm('');
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span>{option[optionLabelKey]}</span>
                          {value === option[optionLabelKey] && (
                            <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              ) : (
                (filteredData as any[]).map((option, idx) => (
                  <div
                    key={option.id || idx}
                    className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${
                      isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-700'
                    } ${value === option[optionLabelKey] ? (isDarkMode ? 'bg-orange-600/20 text-orange-400' : 'bg-orange-50 text-orange-600') : ''}`}
                    onClick={() => {
                      onSelect(option[optionLabelKey], option);
                      setIsOpen(false);
                      setSearchTerm('');
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span>{option[optionLabelKey]}</span>
                      {value === option[optionLabelKey] && (
                        <div className="w-1.5 h-1.5 rounded-full bg-orange-500"></div>
                      )}
                    </div>
                  </div>
                ))
              )
            ) : (
              <div className={`px-4 py-8 text-center text-sm italic ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {emptyMessage && (!groupedOptions?.length && !options?.length) 
                  ? emptyMessage 
                  : (searchTerm ? `No results found for "${searchTerm}"` : (emptyMessage || 'No data available'))}
              </div>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default SearchableField;
