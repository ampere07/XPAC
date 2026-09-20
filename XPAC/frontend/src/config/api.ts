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

/*
 * ── Bearer token fallback ───────────────────────────────────────────────────
 *
 * The session cookie stays the primary credential and nothing below changes
 * how it is used. This is the fallback for a browser that will not return it.
 *
 * The SPA is served from sync.atssfiber.ph and the API lives on
 * backend.atssfiber.ph. A normal browser treats those as the same site and
 * sends the session cookie with every API call. An in-app browser — the one
 * inside Messenger above all — is a WebView with its own cookie policy, and
 * the restrictive ones drop a cookie set by a host other than the page's.
 * Login then appears to succeed and every request after it is a 401, because
 * the cookie the server issued is never sent back.
 *
 * A token in an Authorization header does not depend on cookie policy at all,
 * so it survives where the cookie does not. The server tries the cookie
 * session first and only falls back to the token, so a browser where cookies
 * work is completely unaffected by this.
 *
 * localStorage rather than a cookie, deliberately: a cookie is exactly the
 * thing that does not survive here.
 */
const AUTH_TOKEN_KEY = 'authToken';

/**
 * A stable id for this browser profile, generated once and kept.
 *
 * The server names each personal access token after the device that asked for
 * it, so signing in again replaces that browser's own credential rather than
 * somebody else's. It used to name them after the User-Agent, which is not
 * device-identifying at all — two Chrome-on-Windows machines send byte-identical
 * strings — so a second sign-in on the same account silently revoked the first
 * machine's token. See the login route in ATSS2_0/backend/routes/api.php.
 *
 * Not a secret and never used to authenticate: it only says which row to
 * replace, and only from a caller that has just proved who it is.
 */
const DEVICE_ID_KEY = 'deviceId';

export const getDeviceId = (): string | null => {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;

    const chunk = () => Math.random().toString(36).slice(2, 10);
    const fresh = `${chunk()}${chunk()}${chunk()}`;
    localStorage.setItem(DEVICE_ID_KEY, fresh);

    return fresh;
  } catch {
    // Private-mode browsers can refuse localStorage. The server then falls back
    // to its old naming, which is no worse than before this existed.
    return null;
  }
};

export const setAuthToken = (token: string | null): void => {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(AUTH_TOKEN_KEY);
    }
  } catch {
    // Private-mode WebViews can refuse localStorage. The cookie session is
    // still in play, so this is a degraded fallback rather than a failure.
  }
};

export const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
};

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
      console.warn('CSRF cookie endpoint unavailable, proceeding with Authorization token:', error);
      csrfInitialized = true;
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

    // Sent on every request, not only when the cookie is known to be missing.
    // There is no reliable way for the page to tell whether the browser will
    // return a cookie set by another host — document.cookie cannot see it —
    // so the token always rides along and the server decides. It tries the
    // cookie session first and only reads this if that fails, which leaves a
    // working cookie browser behaving exactly as before.
    const authToken = getAuthToken();
    if (authToken) {
      config.headers = config.headers || {};
      config.headers['Authorization'] = `Bearer ${authToken}`;
      // The same token under a plain header name. Authorization is the one
      // header the chain to PHP is liable to eat — Apache withholds it from a
      // CGI/FastCGI process unless .htaccess copies it across, and proxies strip
      // it — and when that happens the token authenticates nobody despite being
      // issued, stored and sent correctly. A custom header nothing treats
      // specially survives that. Read as a fallback in AppServiceProvider::boot.
      config.headers['X-Auth-Token'] = authToken;
    }

    // Which browser profile this is, so the server replaces this one's
    // credential and not one belonging to another machine on the same account.
    const deviceId = getDeviceId();
    if (deviceId) {
      config.headers = config.headers || {};
      config.headers['X-Device-Id'] = deviceId;
    }

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    if (error.response) {
      const status = error.response.status;
      
      // Handle CSRF expiration
      if (status === 419) {
        csrfInitialized = false;
        try {
          await initializeCsrf();
          const config = error.config;
          config.headers['X-XSRF-TOKEN'] = getCookie('XSRF-TOKEN') || '';
          return apiClient(config);
        } catch (retryError) {
          return Promise.reject(retryError);
        }
      }
      
      // Handle Session expiration (401)
      if (status === 401) {
        console.warn('[API] Unauthorized (401). Triggering session expiration modal...');
        // Neither credential is good any more: the cookie session has gone and
        // the token was either rejected or absent. Dropping it here stops a
        // dead token being replayed on every later request.
        setAuthToken(null);
        // Dispatch custom event so App.tsx can show the modal
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      }
    }
    return Promise.reject(error);
  }
);

/**
 * `fetch` with the same credentials apiClient sends.
 *
 * A number of call sites use `fetch` directly rather than the axios client —
 * file downloads, streamed responses, a few one-off admin actions. They passed
 * `credentials: 'include'` and nothing else, which was enough while the
 * endpoints they call checked nothing. Now that every endpoint is authorized,
 * they need the bearer token too, for exactly the reason the axios client sends
 * it: a browser that drops a cross-site cookie has no other credential.
 *
 * Same signature as `fetch`, so a call site changes by name only.
 */
export const authFetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
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

  const authToken = getAuthToken();
  if (authToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }
  // The same fallback the axios interceptor sends, for the same reason: this
  // path must not be the one place a stripped Authorization header goes unnoticed.
  if (authToken && !headers.has('X-Auth-Token')) {
    headers.set('X-Auth-Token', authToken);
  }

  const deviceId = getDeviceId();
  if (deviceId && !headers.has('X-Device-Id')) {
    headers.set('X-Device-Id', deviceId);
  }

  const xsrfToken = getCookie('XSRF-TOKEN');
  if (requiresCsrf && xsrfToken && !headers.has('X-XSRF-TOKEN')) {
    headers.set('X-XSRF-TOKEN', xsrfToken);
  }

  const response = await fetch(input, { credentials: 'include', ...init, headers });

  // Same treatment the axios interceptor gives a 401, so a session that has
  // gone ends the same way whichever transport noticed.
  if (response.status === 401) {
    setAuthToken(null);
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
  }

  return response;
};

export default apiClient;
export { API_BASE_URL };
