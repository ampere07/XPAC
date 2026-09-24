import axios from 'axios';

const getCookie = (name: string): string | null => {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
};

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL as string;

if (!API_BASE_URL) {
  throw new Error('REACT_APP_API_BASE_URL must be defined in .env file');
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

let csrfInitializationPromise: Promise<void> | null = null;

export const initializeCsrf = async (): Promise<void> => {
  if (csrfInitialized) {
    return;
  }

  if (csrfInitializationPromise) {
    return csrfInitializationPromise;
  }

  csrfInitializationPromise = (async () => {
    try {
      const baseUrl = API_BASE_URL.replace(/\/api$/, '');
      await axios.get(`${baseUrl}/sanctum/csrf-cookie`, {
        withCredentials: true,
      });
      csrfInitialized = true;
    } catch (error) {
      console.error('CSRF Initialization failed:', error);
      throw error;
    } finally {
      csrfInitializationPromise = null;
    }
  })();

  return csrfInitializationPromise;
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

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

/**
 * Asks the backend whether the session is still good.
 *
 * Resolving the guard server-side is what triggers Laravel's recaller-cookie path, so simply
 * calling this rebuilds a session that lapsed through inactivity. The endpoint answers 200
 * with authenticated:false rather than 401, so it can never recurse into this interceptor.
 *
 * Returns true when the caller should retry, false when the user genuinely has to sign in.
 * A network/5xx failure returns null — unknown, and must NOT be treated as logged out.
 */
let sessionProbeInFlight: Promise<boolean | null> | null = null;

export const revalidateSession = async (): Promise<boolean | null> => {
  // A page issues many parallel requests; a burst of 401s must produce ONE probe, not one
  // per request, otherwise every in-flight call races to declare the session dead.
  if (sessionProbeInFlight) return sessionProbeInFlight;

  sessionProbeInFlight = (async () => {
    try {
      const { data } = await axios.get<{ authenticated: boolean }>(
        `${API_BASE_URL}/auth/session`,
        { withCredentials: true, timeout: 15000 }
      );
      return data?.authenticated === true;
    } catch (probeError: any) {
      // Reachable and explicitly unauthorised: genuinely signed out.
      if (probeError?.response?.status === 401 || probeError?.response?.status === 419) {
        return false;
      }
      // Offline, timeout, 500: we do not know, so do not log anyone out over it.
      return null;
    } finally {
      sessionProbeInFlight = null;
    }
  })();

  return sessionProbeInFlight;
};

apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    if (error.response) {
      const status = error.response.status;
      const config = error.config || {};

      // Handle CSRF expiration
      if (status === 419) {
        csrfInitialized = false;
        try {
          await initializeCsrf();
          config.headers['X-XSRF-TOKEN'] = getCookie('XSRF-TOKEN') || '';
          return apiClient(config);
        } catch (retryError) {
          return Promise.reject(retryError);
        }
      }

      // Handle Session expiration (401).
      //
      // A 401 is no longer taken at face value. The session may simply have gone idle past
      // SESSION_LIFETIME while a valid recaller cookie is still held, in which case one probe
      // restores it and the original request succeeds on retry — the user sees nothing. Only
      // a probe that comes back definitively unauthenticated raises the expiry modal.
      if (status === 401 && !config.__sessionRetried) {
        const stillValid = await revalidateSession();

        if (stillValid === true) {
          config.__sessionRetried = true;   // retry exactly once, never loop
          // The CSRF token is rotated along with the rebuilt session.
          if (['post', 'put', 'patch', 'delete'].includes(String(config.method).toLowerCase())) {
            config.headers = config.headers || {};
            config.headers['X-XSRF-TOKEN'] = getCookie('XSRF-TOKEN') || '';
          }
          return apiClient(config);
        }

        if (stillValid === false) {
          console.warn('[API] Session is genuinely expired. Prompting re-login.');
          window.dispatchEvent(new CustomEvent('auth:session-expired'));
        } else {
          // Could not reach the server to find out — surface the request failure, but keep
          // the user signed in. A dropped connection is not a logout.
          console.warn('[API] Got 401 but the session probe was unreachable; staying signed in.');
        }
      }
    }
    return Promise.reject(error);
  }
);

export default apiClient;
export { API_BASE_URL };
