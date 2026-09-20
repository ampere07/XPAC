// RN-safe no-op stub. The web app used socket.io-client for realtime updates, but
// socket.io-client is not installed in the Expo app and there are no active importers.
// Realtime is non-essential on mobile (screens use pull-to-refresh + silent intervals).
// This mirrors services/pusherService.ts. Restore a real impl only if socket.io-client is added.

type Handler = (...args: any[]) => void;

export const socket = {
  connected: false,
  on: (_event: string, _handler: Handler) => socket,
  off: (_event: string, _handler?: Handler) => socket,
  emit: (_event: string, ..._args: any[]) => socket,
  connect: () => socket,
  disconnect: () => socket,
};

export default socket;
