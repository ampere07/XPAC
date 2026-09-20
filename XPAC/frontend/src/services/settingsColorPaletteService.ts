import api from '../config/api';
import { requestCache } from '../utils/requestCache';

export interface ColorPalette {
  id: number;
  palette_name: string;
  primary: string;
  secondary: string;
  accent: string;
  status: 'active' | 'inactive';
  created_at?: string;
  updated_at?: string;
  updated_by?: string;
}

interface ColorPaletteCreateData {
  palette_name: string;
  primary: string;
  secondary: string;
  accent: string;
  updated_by?: string;
}

interface ColorPaletteResponse {
  data: ColorPalette;
}

/**
 * The active palette drives every branded colour on the customer pages, so until it
 * arrives they render in the fallback slate and then repaint. requestCache is
 * in-memory only, so a fresh page load always paid for that repaint; mirroring the
 * palette into localStorage lets the very first frame use the right colours.
 */
const ACTIVE_PALETTE_CACHE_KEY = 'activeColorPalette.v1';

/**
 * The last known active palette, read synchronously so a component can seed its state
 * with it instead of starting on the fallback. Null when nothing is stored, or when
 * storage is unreadable — a private-mode WebView has to degrade to the fallback
 * colour rather than to a thrown error.
 */
export const getCachedActivePalette = (): ColorPalette | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_PALETTE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ColorPalette) : null;
  } catch {
    return null;
  }
};

const cacheActivePalette = (palette: ColorPalette | null): void => {
  try {
    if (palette) {
      localStorage.setItem(ACTIVE_PALETTE_CACHE_KEY, JSON.stringify(palette));
    } else {
      localStorage.removeItem(ACTIVE_PALETTE_CACHE_KEY);
    }
  } catch {
    // Storage refused. The in-memory cache still applies for this page load.
  }
};

export const settingsColorPaletteService = {
  getAll: async (): Promise<ColorPalette[]> => {
    return requestCache.get(
      'color_palettes_all',
      async () => {
        const response = await api.get<ColorPalette[]>('/settings-color-palette');
        return response.data;
      },
      30000
    );
  },

  getActive: async (): Promise<ColorPalette | null> => {
    return requestCache.get(
      'color_palette_active',
      async () => {
        const response = await api.get<ColorPalette | null>('/settings-color-palette/active');
        cacheActivePalette(response.data);
        return response.data;
      },
      30000
    );
  },

  create: async (data: ColorPaletteCreateData): Promise<ColorPalette> => {
    const response = await api.post<ColorPaletteResponse>('/settings-color-palette', data);
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
    cacheActivePalette(null);
    return response.data.data;
  },

  update: async (id: number, data: ColorPaletteCreateData): Promise<ColorPalette> => {
    const response = await api.put<ColorPaletteResponse>(`/settings-color-palette/${id}`, data);
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
    cacheActivePalette(null);
    return response.data.data;
  },

  updateStatus: async (id: number, status: 'active' | 'inactive'): Promise<ColorPalette> => {
    const response = await api.put<ColorPaletteResponse>(`/settings-color-palette/${id}/status`, { status });
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
    cacheActivePalette(null);
    return response.data.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/settings-color-palette/${id}`);
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
    cacheActivePalette(null);
  }
};
