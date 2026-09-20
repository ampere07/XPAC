// Manual RADIUS Operations Types

export type RadiusOperationAction = 'disconnectUser' | 'reconnectUser' | 'updateCredentials' | 'updateGroup';

export interface BaseRadiusOperationParams {
  accountNumber?: string;
  username: string;
  updatedBy?: string;
}

export interface DisconnectUserParams extends BaseRadiusOperationParams {
  action: 'disconnectUser';
  remarks?: string;
}

export interface ReconnectUserParams extends BaseRadiusOperationParams {
  action: 'reconnectUser';
  plan: string;
}

export interface UpdateGroupParams extends BaseRadiusOperationParams {
  action: 'updateGroup';
  plan: string;
}

export interface UpdateCredentialsParams extends BaseRadiusOperationParams {
  action: 'updateCredentials';
  newUsername: string;
  newPassword: string;
}

export type RadiusOperationParams = 
  | DisconnectUserParams 
  | ReconnectUserParams 
  | UpdateGroupParams
  | UpdateCredentialsParams;

export interface RadiusOperationResponse {
  status: 'success' | 'error';
  message: string;
  output: string;
  errors?: Record<string, string[]>;
}

// Dedicated endpoint request types
export interface DisconnectUserRequest {
  accountNumber?: string;
  username: string;
  remarks?: string;
  updatedBy?: string;
}

export interface ReconnectUserRequest {
  accountNumber?: string;
  username: string;
  plan: string;
  updatedBy?: string;
}

export interface UpdateGroupRequest {
  accountNumber?: string;
  username: string;
  plan: string;
  updatedBy?: string;
}

export interface UpdateCredentialsRequest {
  accountNumber?: string;
  username: string;
  newUsername: string;
  newPassword: string;
  updatedBy?: string;
}
