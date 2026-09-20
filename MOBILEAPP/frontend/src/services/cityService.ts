import apiClient from '../config/api';
import { Location } from '../types/location';

// Response interface
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface Region {
  id: number;
  name: string;
  code?: string;
  description?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Borough {
  id: number;
  city_id: number;
  name: string;
  code?: string;
  description?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface LocationDetail {
  id: number;
  barangay_id: number;
  location_name: string;
  created_at?: string;
  updated_at?: string;
}

export interface City {
  id: number;
  region_id: number;
  name: string;
  code?: string;
  description?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export const getCities = async (): Promise<City[]> => {
  try {
    const response = await apiClient.get('/cities');
    const data = response.data as any;
    
    if (Array.isArray(data)) {
      return data;
    }
    
    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }
    
    return [];
  } catch (error: any) {
    return [];
  }
};

// Get cities for a single region (lazy-loaded to avoid fetching every city in the country)
export const getCitiesByRegionId = async (regionId: number): Promise<City[]> => {
  try {
    const response = await apiClient.get(`/locations/regions/${regionId}/cities`);
    const data = response.data as any;

    if (Array.isArray(data)) {
      return data;
    }

    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }

    return [];
  } catch (error: any) {
    return [];
  }
};

// Get barangays for a single city (lazy-loaded to avoid fetching every barangay in the country)
export const getBarangaysByCityId = async (cityId: number): Promise<Borough[]> => {
  try {
    const response = await apiClient.get(`/locations/cities/${cityId}/barangays`);
    const data = response.data as any;

    if (Array.isArray(data)) {
      return data;
    }

    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }

    return [];
  } catch (error: any) {
    return [];
  }
};

// Get locations by type from the location management system
export const getLocationsByType = async (type: 'region' | 'city' | 'borough' | 'village'): Promise<Location[]> => {
  try {
    const response = await apiClient.get<{
      success: boolean;
      data: Location[];
    }>(`/locations/type/${type}`);
    return response.data.success ? response.data.data : [];
  } catch (error) {
    return [];
  }
};

// Get child locations by parent ID
export const getLocationChildren = async (parentId: number): Promise<Location[]> => {
  try {
    const response = await apiClient.get<{
      success: boolean;
      data: Location[];
    }>(`/locations/parent/${parentId}`);
    return response.data.success ? response.data.data : [];
  } catch (error) {
    return [];
  }
};

// Get all locations
export const getAllLocations = async (): Promise<Location[]> => {
  try {
    const response = await apiClient.get<{
      success: boolean;
      data: Location[];
    }>('/locations');
    return response.data.success ? response.data.data : [];
  } catch (error) {
    return [];
  }
};

// Helper function to get regions from location system
export const getRegionsFromLocations = async (): Promise<Location[]> => {
  return getLocationsByType('region');
};

// Helper function to get cities by region
export const getCitiesByRegion = async (regionId: number): Promise<Location[]> => {
  return getLocationChildren(regionId);
};

// Helper function to get barangays by city
export const getBarangaysByCity = async (cityId: number): Promise<Location[]> => {
  return getLocationChildren(cityId);
};

// Create a new region
export const createRegion = async (data: { name: string; code?: string; description?: string }): Promise<Region> => {
  try {
    const response = await apiClient.post<ApiResponse<Region>>('/regions', data);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to create region');
  } catch (error: any) {
    throw error;
  }
};

// Create a new city with region foreign key
export const createCity = async (data: { name: string; region_id: number; code?: string; description?: string }): Promise<City> => {
  try {
    const response = await apiClient.post<ApiResponse<City>>('/cities', data);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to create city');
  } catch (error: any) {
    throw error;
  }
};

// Create a new barangay with city foreign key
export const createBarangay = async (data: { name: string; city_id: number; code?: string; description?: string }): Promise<Borough> => {
  try {
    const response = await apiClient.post<ApiResponse<Borough>>('/barangays', data);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to create barangay');
  } catch (error: any) {
    throw error;
  }
};

// Create a new location with barangay foreign key
export const createLocation = async (data: { name: string; barangay_id: number }): Promise<LocationDetail> => {
  try {
    const response = await apiClient.post<ApiResponse<LocationDetail>>('/location-details', {
      location_name: data.name,
      barangay_id: data.barangay_id
    });
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    throw new Error(response.data.message || 'Failed to create location');
  } catch (error: any) {
    throw error;
  }
};

// Get regions
export const getRegions = async (): Promise<Region[]> => {
  try {
    const response = await apiClient.get('/regions');
    const data = response.data as any;
    
    if (Array.isArray(data)) {
      return data;
    }
    
    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }
    
    return [];
  } catch (error: any) {
    return [];
  }
};

// Get boroughs (barangays)
export const getBoroughs = async (): Promise<Borough[]> => {
  try {
    const response = await apiClient.get('/barangays');
    const data = response.data as any;
    
    if (Array.isArray(data)) {
      return data;
    }
    
    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }
    
    return [];
  } catch (error: any) {
    return [];
  }
};

// Get locations
export const getLocations = async (): Promise<LocationDetail[]> => {
  try {
    const response = await apiClient.get('/location-details');
    const data = response.data as any;
    
    if (Array.isArray(data)) {
      return data;
    }
    
    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }
    
    return [];
  } catch (error: any) {
    return [];
  }
};

// Get region by ID
export const getRegionById = async (id: number): Promise<Region | null> => {
  try {
    const response = await apiClient.get<ApiResponse<Region>>(`/region_list/${id}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    return null;
  } catch (error: any) {
    return null;
  }
};

// Get city by ID
export const getCityById = async (id: number): Promise<City | null> => {
  try {
    const response = await apiClient.get<ApiResponse<City>>(`/city_list/${id}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    return null;
  } catch (error: any) {
    return null;
  }
};

// Get barangay by ID
export const getBarangayById = async (id: number): Promise<Borough | null> => {
  try {
    const response = await apiClient.get<ApiResponse<Borough>>(`/barangay_list/${id}`);
    if (response.data.success && response.data.data) {
      return response.data.data;
    }
    return null;
  } catch (error: any) {
    return null;
  }
};

// Delete region
export const deleteRegion = async (id: number, cascade: boolean = false): Promise<void> => {
  try {
    await apiClient.delete(`/regions/${id}${cascade ? '?cascade=true' : ''}`);
  } catch (error: any) {
    throw error;
  }
};

// Delete city
export const deleteCity = async (id: number, cascade: boolean = false): Promise<void> => {
  try {
    await apiClient.delete(`/cities/${id}${cascade ? '?cascade=true' : ''}`);
  } catch (error: any) {
    throw error;
  }
};

// Delete barangay
export const deleteBarangay = async (id: number, cascade: boolean = false): Promise<void> => {
  try {
    await apiClient.delete(`/barangays/${id}${cascade ? '?cascade=true' : ''}`);
  } catch (error: any) {
    throw error;
  }
};

// Delete location
export const deleteLocation = async (id: number): Promise<void> => {
  try {
    await apiClient.delete(`/location-details/${id}`);
  } catch (error: any) {
    throw error;
  }
};

// Keep the old village functions for backward compatibility
export const getVillages = getLocations;
export const createVillage = createLocation;
export const deleteVillage = deleteLocation;
export type Village = LocationDetail;