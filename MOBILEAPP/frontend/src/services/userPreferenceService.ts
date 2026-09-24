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
    console.log('[UserPreferenceService] Saved to localStorage', { key, value });
  } catch (error) {
    console.error('[UserPreferenceService] Failed to save to localStorage', error);
  }
};

const getFromLocalStorage = (key: string): any | null => {
  try {
    const stored = localStorage.getItem(getLocalStorageKey(key));
    if (stored) {
      const parsed = JSON.parse(stored);
      console.log('[UserPreferenceService] Retrieved from localStorage', { key, value: parsed });
      return parsed;
    }
  } catch (error) {
    console.error('[UserPreferenceService] Failed to retrieve from localStorage', error);
  }
  return null;
};

export const getUserPreference = async (key: string, defaultValue: any = null): Promise<any> => {
  try {
    console.log('[UserPreferenceService] Fetching preference', {
      key,
      defaultValue,
      url: `${API_BASE_URL}/user-preferences/${key}`
    });

    const response = await fetch(`${API_BASE_URL}/user-preferences/${key}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    console.log('[UserPreferenceService] Fetch response status:', response.status);

    if (!response.ok) {
      console.log('[UserPreferenceService] Server fetch failed, checking localStorage');
      const localValue = getFromLocalStorage(key);
      return localValue !== null ? localValue : defaultValue;
    }

    const result = await response.json();
    console.log('[UserPreferenceService] Fetch result:', result);
    
    if (result.success && result.data.value) {
      return result.data.value;
    }
    
    console.log('[UserPreferenceService] No server value, checking localStorage');
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
    console.log('[UserPreferenceService] Starting save operation', {
      key,
      value,
      url: `${API_BASE_URL}/user-preferences/${key}`,
      timestamp: new Date().toISOString()
    });

    const requestBody = { value };
    console.log('[UserPreferenceService] Request body:', requestBody);

    const response = await fetch(`${API_BASE_URL}/user-preferences/${key}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(requestBody),
    });

    console.log('[UserPreferenceService] Response status:', response.status);
    console.log('[UserPreferenceService] Response ok:', response.ok);

    let result;
    try {
      result = await response.json();
      console.log('[UserPreferenceService] Response data:', result);
    } catch (e) {
      console.error('[UserPreferenceService] Failed to parse JSON response');
      const text = await response.text();
      console.error('[UserPreferenceService] Response text:', text);
      
      console.log('[UserPreferenceService] Server error, saving to localStorage as fallback');
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
    
    console.log('[UserPreferenceService] Successfully saved to server');
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
