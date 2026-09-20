import React, { useState, useRef, useEffect } from 'react';

interface Option {
  id: number | string;
  name: string;
  code?: string;
}

interface SearchableSelectProps {
  id: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  options: Option[];
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  name,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  required = false,
  style,
  className = ""
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => String(opt.code || opt.id) === String(value));

  // Sync searchTerm with the selected option when not open
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm(selectedOption ? selectedOption.name : '');
    }
  }, [selectedOption, isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt =>
    opt.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (option: Option) => {
    const syntheticEvent = {
      target: {
        name,
        value: String(option.code || option.id)
      }
    } as React.ChangeEvent<HTMLSelectElement>;
    
    onChange(syntheticEvent);
    setIsOpen(false);
    setSearchTerm(option.name);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    if (!isOpen) setIsOpen(true);
    
    // If input is cleared, clear the value
    if (e.target.value === '') {
      const syntheticEvent = {
        target: {
          name,
          value: ''
        }
      } as React.ChangeEvent<HTMLSelectElement>;
      onChange(syntheticEvent);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onClick={() => !disabled && setIsOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          className={`w-full border rounded px-3 py-2 pr-10 focus:outline-none focus:ring-1 focus:ring-blue-500 ${disabled ? 'opacity-50 cursor-not-allowed text-gray-400' : ''}`}
          style={{
            borderColor: style?.borderColor || '#E5E7EB',
            backgroundColor: style?.backgroundColor || '#FFFFFF',
            color: style?.color || '#1F2937'
          }}
        />
        <div 
          className="absolute right-0 top-0 h-full flex items-center pr-3 cursor-pointer"
          onClick={() => !disabled && setIsOpen(!isOpen)}
        >
          <svg
            className={`w-4 h-4 transition-transform text-gray-500 ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div 
          className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto"
          style={{
            borderColor: style?.borderColor || '#E5E7EB',
            backgroundColor: style?.backgroundColor || '#FFFFFF'
          }}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <div
                key={option.id}
                className="px-4 py-2 cursor-pointer hover:bg-blue-50 transition-colors text-sm"
                onClick={() => handleSelect(option)}
                style={{ color: style?.color || '#1F2937' }}
              >
                {option.name}
              </div>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-gray-500">No results found</div>
          )}
        </div>
      )}
      
      {/* Hidden select for form compatibility if needed */}
      <select
        id={id}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        className="hidden"
      >
        <option value="">{placeholder}</option>
        {options.map(option => (
          <option key={option.id} value={String(option.code || option.id)}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SearchableSelect;
