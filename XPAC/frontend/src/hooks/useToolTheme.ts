import { useEffect, useState } from 'react';
import { settingsColorPaletteService, type ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Theme and brand colour for the reconciliation tools.
 *
 * Both halves of "look like the rest of SYNC" in one place: the dark-mode flag the
 * shell watches on `documentElement`, and the active colour palette every list screen
 * tints its selection, sort arrows and action buttons with.
 *
 * The tools previously read `localStorage.theme` themselves and hardcoded cyan, so
 * they were the only screens in the product that ignored a client palette. A
 * deployment that has white-labelled its accent now gets it here too.
 *
 * A palette that cannot be fetched resolves to null and every consumer falls back to
 * the product default — a tool must never fail to render because a colour lookup did.
 */
export function useToolTheme(isDarkModeProp?: boolean) {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof isDarkModeProp === 'boolean') return isDarkModeProp;
    const theme = localStorage.getItem('theme');
    return theme === 'dark' || theme === null;
  });

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 768
  );

  useEffect(() => {
    if (typeof isDarkModeProp === 'boolean') {
      setIsDarkMode(isDarkModeProp);
      return;
    }

    const check = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    check();
    // The theme is applied as a class on <html>; watching it is what makes a toggle
    // elsewhere in the app reach a tool that is already open.
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [isDarkModeProp]);

  useEffect(() => {
    let cancelled = false;

    settingsColorPaletteService
      .getActive()
      .then((palette) => {
        if (!cancelled) setColorPalette(palette);
      })
      .catch(() => {
        if (!cancelled) setColorPalette(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { isDarkMode, colorPalette, isMobile };
}
