export interface Location {
  id: number;
  name: string;
  type: 'region' | 'city' | 'borough' | 'village';
  parentId?: number;
  parentName?: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationFormData {
  name: string;
  type: 'region' | 'city' | 'borough' | 'village';
  parentId?: number;
  description?: string;
  isActive: boolean;
}

export interface LocationsResponse {
  success: boolean;
  data: Location[];
  message?: string;
}

export interface LocationResponse {
  success: boolean;
  data: Location;
  message?: string;
}

export interface LocationTypeOption {
  value: string;
  label: string;
}

export interface LocationHierarchy {
  regions: Location[];
  cities: Location[];
  boroughs: Location[];
  villages: Location[];
}

export interface LocationStats {
  totalLocations: number;
  activeLocations: number;
  inactiveLocations: number;
  byType: {
    region: number;
    city: number;
    borough: number;
    village: number;
  };
}
