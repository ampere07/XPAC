import api from '../config/api';
import { requestCache } from '../utils/requestCache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

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

const STORAGE_KEY = 'active_color_palette';

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
    // Try to get from cache first
    const cached = requestCache.getSync<ColorPalette>('color_palette_active', 30000);
    if (cached) return cached;

    // Try to get from storage next
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Pre-fill cache but don't return yet if we want fresh data
        // For now, let's return stored data for speed
        requestCache.set('color_palette_active', parsed);
      }
    } catch (e) {
      console.error('Error reading palette from storage:', e);
    }

    return requestCache.get(
      'color_palette_active',
      async () => {
        const response = await api.get<ColorPalette | null>('/settings-color-palette/active');
        if (response.data) {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(response.data));
          DeviceEventEmitter.emit('colorPaletteChanged', response.data);
        }
        return response.data;
      },
      30000
    );
  },

  getActiveSync: (): ColorPalette | null => {
    return requestCache.getSync('color_palette_active', 30000);
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
    
    if (status === 'active') {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(response.data.data));
      DeviceEventEmitter.emit('colorPaletteChanged', response.data.data);
    }
    
    return response.data.data;
  },

  delete: async (id: number): Promise<void> => {
    await api.delete(`/settings-color-palette/${id}`);
    requestCache.invalidate('color_palettes_all');
    requestCache.invalidate('color_palette_active');
  }
};
