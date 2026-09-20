import Pusher from 'pusher-js';
import apiClient, { API_BASE_URL } from '../config/api';

const SOKETI_HOST = process.env.REACT_APP_SOKETI_HOST || 'ws.atssfiber.ph';
const SOKETI_PORT = 443;
const SOKETI_KEY = process.env.REACT_APP_SOKETI_KEY || '8ctWR5PdV1dgM5h6RTGioI8k1hPbl8ImM3P6K3cne5v';
const SOKETI_FORCE_TLS = true; 
// Enable Pusher logging (disabled for production clean-up)
Pusher.logToConsole = false;

const pusher = new Pusher(SOKETI_KEY, {
    wsHost: SOKETI_HOST,
    wsPort: SOKETI_PORT,
    wssPort: SOKETI_PORT,
    forceTLS: SOKETI_FORCE_TLS,
    disableStats: true,
    enabledTransports: ['ws', 'wss'],
    cluster: 'mt1',
    // Custom authorizer using our axios instance
    authorizer: (channel: any, options: any) => {
        return {
            authorize: (socketId: string, callback: (error: Error | null, data: any) => void) => {
                const performAuth = async (retries = 1) => {
                    try {
                        const response = await apiClient.post('/broadcasting/auth', {
                            socket_id: socketId,
                            channel_name: channel.name
                        }, {
                            headers: {
                                'X-App-ID': 'my_soketi_app_123'
                            }
                        });
                        callback(null, response.data);
                    } catch (error: any) {
                        const status = error.response?.status;
                        
                        // If 401 and we have retries, wait a bit and try again 
                        // (handles race conditions during initial app load/CSRF init)
                        if (status === 401 && retries > 0) {
                            setTimeout(() => performAuth(retries - 1), 1000);
                            return;
                        }

                        console.error('[Pusher] Auth error:', error);
                        callback(new Error(`Pusher auth failed: ${status || 'Network Error'}`), null);
                    }
                };

                performAuth();
            }
        };
    },
    userAuthentication: {
        endpoint: `${API_BASE_URL}/broadcasting/auth`,
        transport: 'ajax',
    }
} as any);

// Fallback: force withCredentials for any AJAX transport Pusher might use internally
// @ts-ignore
if (typeof XMLHttpRequest !== 'undefined') {
    const originalCreateXHR = (Pusher.Runtime as any).createXHR;
    (Pusher.Runtime as any).createXHR = function () {
        const xhr = originalCreateXHR ? originalCreateXHR.apply(Pusher.Runtime, arguments) : new XMLHttpRequest();
        xhr.withCredentials = true;
        return xhr;
    };
}


// For Pusher 8+ with Laravel Sanctum, we often need to ensure common headers are set
// or use a custom authorizer if Sanctum requires special CSRF handling.

export default pusher;
