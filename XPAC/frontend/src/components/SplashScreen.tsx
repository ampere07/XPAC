import React, { useState, useEffect } from 'react';
import atsslogo from '../assets/atsslogo.png';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

const SplashScreen: React.FC = () => {
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

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      backgroundColor: '#ffffff',
      color: '#1a1a1a',
      fontSize: '18px',
      fontWeight: '600'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '20px'
      }}>
        <img
          src={atsslogo}
          alt="ATSS Fiber Logo"
          style={{
            height: '80px',
            marginBottom: '10px'
          }}
        />
        <div style={{
          width: '48px',
          height: '48px',
          border: '4px solid',
          borderColor: '#e5e7eb',
          borderTopColor: colorPalette?.primary || '#6d28d9',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <div>Loading...</div>
      </div>
      <style>{`
        * {
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          text-rendering: optimizeLegibility;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default SplashScreen;
