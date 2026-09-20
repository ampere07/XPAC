import api from '../config/api';
import {
  RadiusOperationParams,
  RadiusOperationResponse,
  DisconnectUserRequest,
  ReconnectUserRequest,
  UpdateCredentialsRequest,
} from '../types/radiusOperations';

/**
 * Manual RADIUS Operations Service
 * Handles manual disconnect, reconnect, and credential updates for RADIUS users
 */
export const radiusOperationsService = {
  /**
   * Generic operation handler (supports all operation types via single endpoint)
   */
  handleOperation: async (params: RadiusOperationParams): Promise<RadiusOperationResponse> => {
    try {
      const response = await api.post<RadiusOperationResponse>(
        '/radius/manual-operations',
        params
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },

  /**
   * Disconnect a user from RADIUS
   * Sets user status to Inactive or Pullout and kills active sessions
   */
  disconnectUser: async (params: DisconnectUserRequest): Promise<RadiusOperationResponse> => {
    try {
      const response = await api.post<RadiusOperationResponse>(
        '/radius/disconnect',
        params
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },

  /**
   * Reconnect a user to RADIUS
   * Sets user to Active status and assigns them to a plan group
   */
  reconnectUser: async (params: ReconnectUserRequest): Promise<RadiusOperationResponse> => {
    try {
      const response = await api.post<RadiusOperationResponse>(
        '/radius/reconnect',
        params
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },

  /**
   * Update user credentials in RADIUS and database
   * Changes username and password, kills old sessions
   */
  updateCredentials: async (params: UpdateCredentialsRequest): Promise<RadiusOperationResponse> => {
    try {
      const response = await api.post<RadiusOperationResponse>(
        '/radius/update-credentials',
        params
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.data) {
        return error.response.data;
      }
      throw error;
    }
  },
};

/**
 * Helper function to check if operation was successful
 */
export const isOperationSuccessful = (response: RadiusOperationResponse): boolean => {
  return response.status === 'success';
};

/**
 * Helper function to get error message from response
 */
export const getOperationErrorMessage = (response: RadiusOperationResponse): string => {
  if (response.errors) {
    const errorMessages = Object.values(response.errors).flat();
    return errorMessages.join(', ');
  }
  return response.message;
};
