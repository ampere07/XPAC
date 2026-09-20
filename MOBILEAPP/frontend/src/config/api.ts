import axios from 'axios';
import { DeviceEventEmitter, Platform } from 'react-native';

/**
 * Raised when the server rejects the app's credential.
 *
 * The web client dispatches a `window` CustomEvent of the same name and App.tsx
 * listens for it; React Native has no window, so DeviceEventEmitter carries it
 * instead. Same name, same meaning, so the two apps stay readable side by side.
 */
export const SESSION_EXPIRED_EVENT = 'auth:session-expired';

/**
 * Requests whose 401 means "those credentials are wrong", not "your session has
 * gone". Signing in with a bad account/mobile number pair is an ordinary failure
 * that the login screen reports itself — raising a session-expired event for it
 * would tear down the screen the customer is typing into.
 */
const AUTH_ENDPOINTS = ['/login', '/forgot-password'];

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

/**
 * A stable id for this install, generated once and kept for the life of the app.
 *
 * The server names each personal access token after the device that asked for
 * it, so that signing in again replaces that device's own credential instead of
 * somebody else's. It used to name them after the User-Agent, which a React
 * Native app does not set — OkHttp supplies one, identical on every Android
 * install — so two phones on one account collided and the second sign-in revoked
 * the first phone's token. See the login route in ATSS2_0/backend/routes/api.php.
 *
 * Not a secret and not used for authentication: it only says which row to
 * replace, and the server accepts it solely from a caller that has just proved
 * who it is. Cached in memory so the interceptor is not reading storage twice on
 * every request.
 */
const DEVICE_ID_KEY = 'deviceId';
let deviceId: string | null = null;

export const getDeviceId = async (): Promise<string> => {
  if (deviceId) return deviceId;

  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) {
      deviceId = stored;
      return stored;
    }
  } catch {
    // Storage unavailable — fall through and mint one for this run.
  }

  const chunk = () => Math.random().toString(36).slice(2, 10);
  const fresh = `${chunk()}${chunk()}${chunk()}`;
  deviceId = fresh;

  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, fresh);
  } catch {
    // Not persisted; this run still sends a consistent id.
  }

  return fresh;
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
        // The same token under a plain header name.
        //
        // Authorization is the one header the chain between this phone and PHP
        // is liable to eat: Apache does not pass it to a CGI/FastCGI process
        // unless .htaccess copies it across, and some hosts and proxies strip it
        // outright. When that happened the token authenticated nobody even
        // though it was issued, stored and sent correctly, and the session
        // cookie became the only credential that worked — so a customer who
        // stayed signed in past its life had none at all. A custom header is not
        // treated specially by anything in between, and the server reads it as a
        // fallback. See AppServiceProvider::boot.
        config.headers['X-Auth-Token'] = authToken;
      }
    } catch (e) {
      console.error('Failed to get auth token', e);
    }

    // Which install this is, so the server replaces this device's credential and
    // not one belonging to another phone on the same account.
    try {
      config.headers['X-Device-Id'] = await getDeviceId();
    } catch {
      // Absent simply means the server falls back to its old naming.
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
      // An expired or revoked token, surfaced rather than swallowed.
      //
      // Nothing here used to look at 401 at all. Every service on the customer
      // dashboard catches its own failure and returns null — getCustomerDetail and
      // getCustomerPaySummary both do — so the status died inside those catch
      // blocks and the context re-threw a generic 'Could not fetch customer
      // details'. The dashboard tested that message for '401', never matched, and
      // showed a balance card reading Unavailable with the customer's name and
      // account number still filled in from the stale authData behind it. The
      // retry loop then re-sent the same dead token every 30 seconds for as long
      // as the app was open. This is the one place that still knows the status,
      // so it is the only place that can tell anyone.
      const status = error.response.status;
      const url: string = error.config?.url || '';

      // A 401 on a request that carried no credential says nothing about the
      // stored one — it means the interceptor found no token to attach, which
      // happens while storage is still being read on a cold start. Dropping the
      // token here would turn a race into a sign-out.
      const sentCredential = Boolean(
        error.config?.headers?.Authorization || error.config?.headers?.['X-Auth-Token']
      );

      if (status === 401 && sentCredential && !AUTH_ENDPOINTS.some((path) => url.includes(path))) {
        console.warn('[API] Unauthorized (401). Session has expired.');
        // Dropped here so a token the server has already rejected is not replayed
        // on every request that follows. The cookie jar and the stored authData go
        // with it when the customer confirms the modal, via App.tsx's handleLogout.
        await AsyncStorage.removeItem('authToken').catch(() => { /* best effort */ });
        DeviceEventEmitter.emit(SESSION_EXPIRED_EVENT);
      }

      if (status === 419) {
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

/**
 * `fetch` that carries the same credentials the axios client does.
 *
 * The API refuses anything it cannot resolve a user for, and a bare fetch()
 * sends neither the stored cookie nor the bearer token — RN has no browser to
 * attach them. Call sites change by name only.
 *
 * Mirrors authFetch in ATSS2_0/frontend/src/config/api.ts.
 */
export const authFetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
  const method = (init.method || 'GET').toUpperCase();
  const requiresCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  if (requiresCsrf && !csrfInitialized) {
    try {
      await initializeCsrf();
    } catch {
      // Carry on with whatever credential is already held; the request will
      // fail on its own terms if that is not enough.
    }
  }

  const headers = new Headers(init.headers || {});

  try {
    const authToken = await AsyncStorage.getItem('authToken');
    if (authToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    // The same fallback the axios interceptor sends, for the same reason: this
    // path must not be the one place a stripped Authorization header goes unnoticed.
    if (authToken && !headers.has('X-Auth-Token')) {
      headers.set('X-Auth-Token', authToken);
    }
  } catch (e) {
    console.error('Failed to get auth token', e);
  }

  try {
    if (!headers.has('X-Device-Id')) {
      headers.set('X-Device-Id', await getDeviceId());
    }
  } catch {
    // Optional; its absence only costs the server its per-device token naming.
  }

  if (cookieStore && !headers.has('Cookie')) {
    headers.set('Cookie', cookieStore);
  }

  const xsrfToken = getCookie('XSRF-TOKEN');
  if (requiresCsrf && xsrfToken && !headers.has('X-XSRF-TOKEN')) {
    headers.set('X-XSRF-TOKEN', xsrfToken);
  }

  return fetch(input, { ...init, headers });
};

export default apiClient;
export { API_BASE_URL };
