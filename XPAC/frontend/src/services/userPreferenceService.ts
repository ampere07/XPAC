import { API_BASE_URL } from '../config/api';

const STORAGE_PREFIX = 'user_pref_';

export interface UserPreference {
  key: string;
  value: any;
}

const getLocalStorageKey = (key: string): string => {
  return `${STORAGE_PREFIX}${key}`;
};

const saveToLocalStorage = (key: string, value: any): void => {
  try {
    localStorage.setItem(getLocalStorageKey(key), JSON.stringify(value));
  } catch (error) {
    console.error('[UserPreferenceService] Failed to save to localStorage', error);
  }
};

const getFromLocalStorage = (key: string): any | null => {
  try {
    const stored = localStorage.getItem(getLocalStorageKey(key));
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed;
    }
  } catch (error) {
    console.error('[UserPreferenceService] Failed to retrieve from localStorage', error);
  }
  return null;
};

export const getUserPreference = async (key: string, defaultValue: any = null): Promise<any> => {
  try {

    const response = await fetch(`${API_BASE_URL}/user-preferences/${key}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });


    if (!response.ok) {
      const localValue = getFromLocalStorage(key);
      return localValue !== null ? localValue : defaultValue;
    }

    const result = await response.json();
    
    if (result.success && result.data.value) {
      return result.data.value;
    }
    
    const localValue = getFromLocalStorage(key);
    return localValue !== null ? localValue : defaultValue;
  } catch (error) {
    console.error('[UserPreferenceService] Fetch exception, falling back to localStorage:', error);
    const localValue = getFromLocalStorage(key);
    return localValue !== null ? localValue : defaultValue;
  }
};

export const setUserPreference = async (key: string, value: any): Promise<boolean> => {
  try {

    const requestBody = { value };

    const response = await fetch(`${API_BASE_URL}/user-preferences/${key}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(requestBody),
    });


    let result;
    try {
      result = await response.json();
    } catch (e) {
      console.error('[UserPreferenceService] Failed to parse JSON response');
      const text = await response.text();
      console.error('[UserPreferenceService] Response text:', text);
      
      saveToLocalStorage(key, value);
      return true;
    }

    if (!response.ok || !result.success) {
      console.warn('[UserPreferenceService] Server save failed, falling back to localStorage', {
        status: response.status,
        statusText: response.statusText,
        responseData: result
      });
      
      saveToLocalStorage(key, value);
      return true;
    }
    
    saveToLocalStorage(key, value);
    return true;
  } catch (error) {
    console.error('[UserPreferenceService] Exception occurred, falling back to localStorage:', error);
    if (error instanceof Error) {
      console.error('[UserPreferenceService] Error details:', {
        message: error.message,
        stack: error.stack
      });
    }
    
    saveToLocalStorage(key, value);
    return true;
  }
};

export const deleteUserPreference = async (key: string): Promise<boolean> => {
  try {
    const response = await fetch(`${API_BASE_URL}/user-preferences/${key}`, {
      method: 'DELETE',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      return false;
    }

    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error('Failed to delete user preference:', error);
    return false;
  }
};

export const getAllUserPreferences = async (): Promise<Record<string, any>> => {
  try {
    const response = await fetch(`${API_BASE_URL}/user-preferences/all`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (!response.ok) {
      return {};
    }

    const result = await response.json();
    return result.success ? result.data : {};
  } catch (error) {
    console.error('Failed to fetch all user preferences:', error);
    return {};
  }
};
