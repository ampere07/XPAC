/**
 * RN-safe stub for the web `pusher-js` real-time client.
 *
 * The web app uses pusher-js (Soketi) for live updates. That package is NOT installed
 * in the mobile app, and real-time push is a non-essential enhancement here — the
 * screens that used it (Overdue, Discounts, LiveMonitor, TransactionList, …) already
 * support manual pull-to-refresh and periodic silent refresh.
 *
 * This stub preserves the Pusher API surface those screens call (subscribe → channel
 * with bind/unbind, unsubscribe, connection.bind, disconnect) so they compile and run;
 * the callbacks simply never fire. If real-time is wanted later, install
 * `pusher-js` and restore the real implementation (kept in git history of the web app).
 */

type Callback = (...args: any[]) => void;

interface StubChannel {
  bind: (event: string, cb: Callback) => StubChannel;
  unbind: (event?: string, cb?: Callback) => StubChannel;
  bind_global: (cb: Callback) => StubChannel;
  unbind_global: () => StubChannel;
}

const makeChannel = (): StubChannel => {
  const channel: StubChannel = {
    bind: () => channel,
    unbind: () => channel,
    bind_global: () => channel,
    unbind_global: () => channel,
  };
  return channel;
};

const connection = {
  bind: (_event: string, _cb: Callback) => {},
  unbind: (_event?: string, _cb?: Callback) => {},
};

const pusher = {
  subscribe: (_channelName: string): StubChannel => makeChannel(),
  unsubscribe: (_channelName: string): void => {},
  channel: (_channelName: string): StubChannel => makeChannel(),
  bind: (_event: string, _cb: Callback) => {},
  unbind: (_event?: string, _cb?: Callback) => {},
  disconnect: (): void => {},
  connection,
};

export default pusher;
