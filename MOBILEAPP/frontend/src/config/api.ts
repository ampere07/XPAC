import axios from 'axios';
import { Platform } from 'react-native';

// In React Native, we don't have document.cookie. 
// We'll store cookies in memory or you could use a persistent store/CookieManager.
import AsyncStorage from '@react-native-async-storage/async-storage';

let cookieStore: string = '';

export const loadCookies = async (): Promise<void> => {
  try {
    const savedCookies = await AsyncStorage.getItem('authCookies');
    if (savedCookies) {
      cookieStore = savedCookies;
      csrfInitialized = true;
    }
  } catch (error) {
    console.error('Failed to load cookies', error);
  }
};

export const clearCookies = async (): Promise<void> => {
  cookieStore = '';
  csrfInitialized = false;
  try {
    await AsyncStorage.removeItem('authCookies');
  } catch (error) {
    console.error('Failed to clear cookies', error);
  }
};

const getCookie = (name: string): string | null => {
  const match = cookieStore.match(new RegExp('(^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
};

// Fallback or explicit definition for React Native environment
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.REACT_APP_API_BASE_URL || '';

if (!API_BASE_URL) {
  console.warn('API_BASE_URL is not defined in any environment variable, using default.');
}

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 60000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

let csrfInitialized = false;

export const initializeCsrf = async (): Promise<void> => {
  if (csrfInitialized) {
    return;
  }

  try {
    const baseUrl = API_BASE_URL.replace(/\/api$/, '');
    const response = await axios.get(`${baseUrl}/sanctum/csrf-cookie`, {
      withCredentials: true,
    });

    // Capture cookies from the response for React Native
    if (response.headers['set-cookie']) {
      if (Array.isArray(response.headers['set-cookie'])) {
        cookieStore = response.headers['set-cookie'].join('; ');
      } else {
        cookieStore = response.headers['set-cookie'];
      }
      AsyncStorage.setItem('authCookies', cookieStore).catch(e => console.error('Failed to save cookies', e));
    }

    csrfInitialized = true;
  } catch (error) {
    // CSRF initialization failed
    console.error('CSRF Init Failed:', error);
  }
};

apiClient.interceptors.request.use(
  async (config: any) => {
    const method = config.method?.toUpperCase();
    const requiresCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method || '');

    if (requiresCsrf && !csrfInitialized) {
      await initializeCsrf();
    }

    const xsrfToken = getCookie('XSRF-TOKEN');
    if (xsrfToken && requiresCsrf) {
      config.headers = config.headers || {};
      config.headers['X-XSRF-TOKEN'] = xsrfToken;
    }

    // Manually attach cookies in React Native since there's no browser to do it automatically
    if (cookieStore) {
      config.headers.Cookie = cookieStore;
    }

    // Set Origin to ensure Sanctum triggers stateful middleware if needed
    if (!config.headers.Origin && !config.headers.origin && API_BASE_URL) {
      try {
        const url = new URL(API_BASE_URL);
        config.headers.Origin = url.origin;
      } catch {
        // Skip if URL parsing fails
      }
    }

    // Manually attach Bearer token
    try {
      const authToken = await AsyncStorage.getItem('authToken');
      if (authToken) {
        config.headers.Authorization = `Bearer ${authToken}`;
      }
    } catch (e) {
      console.error('Failed to get auth token', e);
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response) => {
    // Update cookies if the response sets them
    if (response.headers['set-cookie']) {
      if (Array.isArray(response.headers['set-cookie'])) {
        const newCookies = response.headers['set-cookie'].join('; ');
        // Simple append/replace logic - for a robust app use a Cookie Jar library
        cookieStore = newCookies;
      } else {
        cookieStore = response.headers['set-cookie'];
      }
      AsyncStorage.setItem('authCookies', cookieStore).catch(e => console.error('Failed to save cookies', e));
    }
    return response;
  },
  async (error) => {
    if (error.response) {
      if (error.response.status === 419) {
        csrfInitialized = false;
        const originalRequest = error.config;

        if (!originalRequest._retry) {
          originalRequest._retry = true;
          try {
            await initializeCsrf();
            const xsrfToken = getCookie('XSRF-TOKEN');
            if (xsrfToken) {
              originalRequest.headers['X-XSRF-TOKEN'] = xsrfToken;
            }
            if (cookieStore) {
              originalRequest.headers.Cookie = cookieStore;
            }
            return apiClient(originalRequest);
          } catch (retryError) {
            return Promise.reject(retryError);
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
export { API_BASE_URL };
