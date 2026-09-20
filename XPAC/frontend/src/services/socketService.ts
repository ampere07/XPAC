import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from '../config/api';

// Match socket server URL based on environment (same pattern as Header.tsx)
const isDev = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const socketServerUrl = isDev 
    ? 'http://localhost:3001' 
    : (process.env.REACT_APP_SOCKET_URL || API_BASE_URL.replace(/\/api$/, ''));

export const socket: Socket = io(socketServerUrl, {
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    autoConnect: true,
});;

socket.on('connect', () => {
});

socket.on('connect_error', (error) => {
});

socket.on('disconnect', () => {
});

export default socket;
