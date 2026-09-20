import { useState, useCallback } from 'react';
import { radiusOperationsService, isOperationSuccessful, getOperationErrorMessage } from '../services/radiusOperationsService';
import type { 
  RadiusOperationResponse,
  DisconnectUserRequest,
  ReconnectUserRequest,
  UpdateCredentialsRequest 
} from '../types/radiusOperations';

interface UseRadiusOperationsState {
  loading: boolean;
  error: string | null;
  success: string | null;
  response: RadiusOperationResponse | null;
}

interface UseRadiusOperationsReturn extends UseRadiusOperationsState {
  disconnectUser: (params: Omit<DisconnectUserRequest, 'updatedBy'>) => Promise<boolean>;
  reconnectUser: (params: Omit<ReconnectUserRequest, 'updatedBy'>) => Promise<boolean>;
  updateCredentials: (params: Omit<UpdateCredentialsRequest, 'updatedBy'>) => Promise<boolean>;
  clearMessages: () => void;
  reset: () => void;
}

/**
 * Custom React Hook for RADIUS Operations
 * 
 * Provides a simple interface for managing RADIUS operations with automatic
 * loading states, error handling, and success messages.
 * 
 * @example
 * ```tsx
 * const { disconnectUser, loading, error, success } = useRadiusOperations();
 * 
 * const handleDisconnect = async () => {
 *   const result = await disconnectUser({
 *     username: 'user@example',
 *     accountNumber: '12345',
 *     remarks: 'Non-payment'
 *   });
 *   
 *   if (result) {
 *     // Success!
 *   }
 * };
 * ```
 */
export const useRadiusOperations = (currentUser: string = 'System'): UseRadiusOperationsReturn => {
  const [state, setState] = useState<UseRadiusOperationsState>({
    loading: false,
    error: null,
    success: null,
    response: null,
  });

  const clearMessages = useCallback(() => {
    setState(prev => ({
      ...prev,
      error: null,
      success: null,
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      loading: false,
      error: null,
      success: null,
      response: null,
    });
  }, []);

  const disconnectUser = useCallback(async (
    params: Omit<DisconnectUserRequest, 'updatedBy'>
  ): Promise<boolean> => {
    setState(prev => ({ ...prev, loading: true, error: null, success: null }));
    
    try {
      const response = await radiusOperationsService.disconnectUser({
        ...params,
        updatedBy: currentUser,
      });

      setState({
        loading: false,
        error: isOperationSuccessful(response) ? null : getOperationErrorMessage(response),
        success: isOperationSuccessful(response) ? response.output : null,
        response,
      });

      return isOperationSuccessful(response);
    } catch (error: any) {
      const errorMessage = error?.message || 'Network error occurred';
      setState({
        loading: false,
        error: errorMessage,
        success: null,
        response: null,
      });
      return false;
    }
  }, [currentUser]);

  const reconnectUser = useCallback(async (
    params: Omit<ReconnectUserRequest, 'updatedBy'>
  ): Promise<boolean> => {
    setState(prev => ({ ...prev, loading: true, error: null, success: null }));
    
    try {
      const response = await radiusOperationsService.reconnectUser({
        ...params,
        updatedBy: currentUser,
      });

      setState({
        loading: false,
        error: isOperationSuccessful(response) ? null : getOperationErrorMessage(response),
        success: isOperationSuccessful(response) ? response.output : null,
        response,
      });

      return isOperationSuccessful(response);
    } catch (error: any) {
      const errorMessage = error?.message || 'Network error occurred';
      setState({
        loading: false,
        error: errorMessage,
        success: null,
        response: null,
      });
      return false;
    }
  }, [currentUser]);

  const updateCredentials = useCallback(async (
    params: Omit<UpdateCredentialsRequest, 'updatedBy'>
  ): Promise<boolean> => {
    setState(prev => ({ ...prev, loading: true, error: null, success: null }));
    
    try {
      const response = await radiusOperationsService.updateCredentials({
        ...params,
        updatedBy: currentUser,
      });

      setState({
        loading: false,
        error: isOperationSuccessful(response) ? null : getOperationErrorMessage(response),
        success: isOperationSuccessful(response) ? response.output : null,
        response,
      });

      return isOperationSuccessful(response);
    } catch (error: any) {
      const errorMessage = error?.message || 'Network error occurred';
      setState({
        loading: false,
        error: errorMessage,
        success: null,
        response: null,
      });
      return false;
    }
  }, [currentUser]);

  return {
    ...state,
    disconnectUser,
    reconnectUser,
    updateCredentials,
    clearMessages,
    reset,
  };
};

/**
 * Example usage in a component:
 * 
 * ```tsx
 * import { useRadiusOperations } from './hooks/useRadiusOperations';
 * 
 * const MyComponent = () => {
 *   const { 
 *     disconnectUser, 
 *     reconnectUser, 
 *     updateCredentials,
 *     loading, 
 *     error, 
 *     success,
 *     clearMessages 
 *   } = useRadiusOperations('AdminUser');
 * 
 *   const handleDisconnect = async () => {
 *     const result = await disconnectUser({
 *       username: 'user@example',
 *       accountNumber: '12345',
 *       remarks: 'Pullout'
 *     });
 *     
 *     if (result) {
 *       console.log('User disconnected successfully!');
 *     }
 *   };
 * 
 *   return (
 *     <div>
 *       {loading && <p>Processing...</p>}
 *       {error && <div className="error">{error}</div>}
 *       {success && <div className="success">{success}</div>}
 *       <button onClick={handleDisconnect} disabled={loading}>
 *         Disconnect User
 *       </button>
 *     </div>
 *   );
 * };
 * ```
 */
