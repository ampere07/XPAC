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
        return response.data;
      },
      30000
    );
  },

  create: async (data: ColorPaletteCreateData): Promise<ColorPalette> => {
    const response = await api.post<ColorPaletteResponse>('/settings-color-palette', data);
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
    return response.data.data;
  },

  update: async (id: number, data: ColorPaletteCreateData): Promise<ColorPalette> => {
    const response = await api.put<ColorPaletteResponse>(`/settings-color-palette/${id}`, data);
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
    return response.data.data;
  },

  updateStatus: async (id: number, status: 'active' | 'inactive'): Promise<ColorPalette> => {
    const response = await api.put<ColorPaletteResponse>(`/settings-color-palette/${id}/status`, { status });
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
    return response.data.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/settings-color-palette/${id}`);
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
  }
};
