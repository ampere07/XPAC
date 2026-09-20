import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface LoadingModalProps {
  isOpen: boolean;
  message?: string;
  percentage?: number;
}

const LoadingModal: React.FC<LoadingModalProps> = ({ 
  isOpen, 
  message = 'Processing...', 
  percentage 
}) => {
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
      <div className={`rounded-lg p-6 max-w-sm w-full mx-4 ${
        isDarkMode ? 'bg-gray-800' : 'bg-white'
      }`}>
        <div className="flex flex-col items-center">
          <Loader2 
            className="w-12 h-12 animate-spin mb-4" 
            style={{
              color: colorPalette?.primary || '#7c3aed'
            }}
          />
          <p className={`text-center mb-2 ${
            isDarkMode ? 'text-white' : 'text-gray-900'
          }`}>{message}</p>
          
          {percentage !== undefined && (
            <div className="w-full">
              <div className={`w-full rounded-full h-2.5 mb-2 ${
                isDarkMode ? 'bg-gray-700' : 'bg-gray-200'
              }`}>
                <div 
                  className="h-2.5 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${percentage}%`,
                    backgroundColor: colorPalette?.primary || '#7c3aed'
                  }}
                ></div>
              </div>
              <p 
                className="text-center text-sm font-medium"
                style={{
                  color: colorPalette?.primary || '#7c3aed'
                }}
              >
                {percentage}%
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoadingModal;
