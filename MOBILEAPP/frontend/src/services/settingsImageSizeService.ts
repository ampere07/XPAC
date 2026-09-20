import api from '../config/api';

export interface ImageSize {
  id: number;
  image_size: string;
  image_size_value: number;
  status: 'active' | 'inactive';
}

interface ImageSizeResponse {
  data: ImageSize;
}

export const settingsImageSizeService = {
  getAll: async (): Promise<ImageSize[]> => {
    const response = await api.get<ImageSize[]>('/settings-image-size');
    return response.data;
  },

  getActive: async (): Promise<ImageSize | null> => {
    const response = await api.get<ImageSize | null>('/settings-image-size/active');
    return response.data;
  },

  updateStatus: async (id: number, status: 'active' | 'inactive'): Promise<ImageSize> => {
    const response = await api.put<ImageSizeResponse>(`/settings-image-size/${id}/status`, { status });
    return response.data.data;
  }
};
