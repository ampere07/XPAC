import React, { useState } from 'react';
import { Search, X } from 'lucide-react';
import { ColorPalette } from '../../services/settingsColorPaletteService';

const hexToRgba = (hex: string, opacity: number) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${opacity})` : hex;
};

interface GlobalSearchProps {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  placeholder?: string;
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ 
  searchQuery, 
  setSearchQuery, 
  isDarkMode, 
  colorPalette, 
  placeholder = "Search records..." 
}) => {
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  return (
    <div className="relative flex-1 group">
      <div 
        className={`relative w-full h-[38px] rounded flex items-center transition-all ${
          isDarkMode ? 'bg-gray-800' : 'bg-white'
        } border`}
        style={{
          borderColor: isSearchFocused 
            ? (colorPalette?.primary || '#7c3aed') 
            : (isDarkMode ? '#374151' : '#d1d5db'),
          boxShadow: isSearchFocused 
            ? `0 0 0 1px ${colorPalette?.primary || '#7c3aed'}` 
            : 'none'
        }}
      >
        <Search className={`absolute left-3 h-4 w-4 pointer-events-none transition-colors ${
          isSearchFocused ? (isDarkMode ? 'text-white' : 'text-gray-900') : (isDarkMode ? 'text-gray-400' : 'text-gray-500')
        }`} />
        
        {searchQuery && !isSearchFocused ? (
          <div
            className="relative ml-9 flex items-center cursor-text pr-10 w-full h-full"
          >
            <button
              type="button"
              aria-label={`Edit search ${searchQuery}`}
              onClick={() => setIsSearchFocused(true)}
              className="absolute inset-0 h-full w-full cursor-text"
            />
            <div
              className="relative pointer-events-none flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border leading-none"
              style={{
                backgroundColor: hexToRgba(colorPalette?.primary || '#ef4444', 0.08),
                borderColor: hexToRgba(colorPalette?.primary || '#ef4444', 0.25),
                color: colorPalette?.primary || '#ef4444'
              }}
            >
              <span>{searchQuery}</span>
              <div 
                role="button"
                aria-label="Clear search"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setSearchQuery('');
                }}
                className="pointer-events-auto hover:scale-110 transition-transform p-0.5"
              >
                <X className="h-2.5 w-2.5" />
              </div>
            </div>
          </div>
        ) : (
          <input
            type="text"
            aria-label={placeholder}
            autoFocus={isSearchFocused}
            placeholder={isSearchFocused ? "" : placeholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            className={`w-full bg-transparent border-none focus:outline-none focus:ring-0 pl-10 pr-10 py-2 h-full text-sm ${
              isDarkMode ? 'text-white' : 'text-gray-900'
            }`}
          />
        )}

        {searchQuery && isSearchFocused && (
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSearchQuery('');
            }}
            className={`absolute right-3 p-0.5 rounded-full transition-colors ${isDarkMode
              ? 'text-gray-400 hover:text-white hover:bg-gray-700'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
              }`}
            title="Clear search"
            type="button"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

export default GlobalSearch;
