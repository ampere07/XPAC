import apiClient from '../config/api';

export interface LocationPayload {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
}

export const technicianLocationService = {
  /**
   * Report the authenticated technician's current GPS position.
   * The backend derives the technician identity from the auth session,
   * so no user id is (or should be) sent from the client.
   */
  updateLocation: async (payload: LocationPayload) => {
    const response = await apiClient.post('/technician-location', payload);
    return response.data;
  },
};
