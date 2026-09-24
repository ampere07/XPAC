const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

// Load config
let config;
try {
    config = require('./soketi-config.json');
} catch (e) {
    config = {
        port: 6001,
        'appManager.array.apps': [{
            id: '1000001',
            key: '8ctWR5PdV1dgM5h6RTGioI8k1hPbl8ImM3P6K3cne5v',
            secret: 'KsCIAKjsPEWMDj2vWCWs7qYwkXZBUugVfcRjZyPRhJo'
        }]
    };
}

const PORT = config.port || 6001;
const apps = config['appManager.array.apps'] || [];
const app = apps[0] || {};
const APP_ID = app.id || '1000001';
const APP_KEY = app.key || '8a84OUseLCGQAtaEeANi04muzz1HYsjfaYsz3d6KMAK';
const APP_SECRET = app.secret || 'szxUAz9MQ5hTRAIC7MJfI4PfoghnK5LmQE9hoyuLIFt';

// Channel subscriptions: { channelName: Set<ws> }
const channels = {};
let socketIdCounter = 0;

function generateSocketId() {
    socketIdCounter++;
    return `${process.pid}.${socketIdCounter}`;
}

// Create HTTP server for Pusher HTTP API (Laravel broadcasts here)
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Pusher-Library');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', server: 'pusher-compatible', port: PORT }));
        return;
    }

    // Pusher HTTP API: POST /apps/{appId}/events
    const eventsMatch = req.url && req.url.match(/^\/apps\/([^/]+)\/events/);
    if (req.method === 'POST' && eventsMatch) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const eventName = payload.name;
                const eventChannels = payload.channels || (payload.channel ? [payload.channel] : []);
                const eventData = payload.data;

                console.log(`[Pusher Server] Event "${eventName}" -> channels: [${eventChannels.join(', ')}]`);

                eventChannels.forEach(channelName => {
                    if (channels[channelName]) {
                        const message = JSON.stringify({
                            event: eventName,
                            channel: channelName,
                            data: eventData
                        });

                        channels[channelName].forEach(ws => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(message);
                            }
                        });

                        console.log(`[Pusher Server] Broadcasted "${eventName}" to ${channels[channelName].size} client(s) on "${channelName}"`);
                    } else {
                        console.log(`[Pusher Server] No subscribers on channel "${channelName}"`);
                    }
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch (err) {
                console.error('[Pusher Server] Error processing event:', err.message);
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Pusher HTTP API: POST /apps/{appId}/batch_events
    const batchMatch = req.url && req.url.match(/^\/apps\/([^/]+)\/batch_events/);
    if (req.method === 'POST' && batchMatch) {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const batch = payload.batch || [];

                batch.forEach(item => {
                    const eventName = item.name;
                    const channelName = item.channel;
                    const eventData = item.data;

                    if (channels[channelName]) {
                        const message = JSON.stringify({
                            event: eventName,
                            channel: channelName,
                            data: eventData
                        });

                        channels[channelName].forEach(ws => {
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(message);
                            }
                        });
                    }
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    // Channels info: GET /apps/{appId}/channels
    const channelsMatch = req.url && req.url.match(/^\/apps\/([^/]+)\/channels/);
    if (req.method === 'GET' && channelsMatch) {
        const channelInfo = {};
        Object.keys(channels).forEach(name => {
            channelInfo[name] = { subscription_count: channels[name].size };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ channels: channelInfo }));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

// WebSocket server on /app/{key} path (Pusher protocol)
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    const url = request.url || '';
    const appKeyMatch = url.match(/^\/app\/([^?]+)/);

    if (!appKeyMatch) {
        socket.destroy();
        return;
    }

    const clientKey = appKeyMatch[1];
    if (clientKey !== APP_KEY) {
        console.log(`[Pusher Server] Rejected connection: invalid key "${clientKey}"`);
        socket.destroy();
        return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws, request) => {
    const socketId = generateSocketId();
    ws._socketId = socketId;
    ws._channels = new Set();

    // Send pusher:connection_established
    ws.send(JSON.stringify({
        event: 'pusher:connection_established',
        data: JSON.stringify({
            socket_id: socketId,
            activity_timeout: 120
        })
    }));

    console.log(`[Pusher Server] Client connected: ${socketId}`);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());

            // Handle subscribe
            if (msg.event === 'pusher:subscribe') {
                const channelName = msg.data && msg.data.channel;
                if (channelName) {
                    if (!channels[channelName]) {
                        channels[channelName] = new Set();
                    }
                    channels[channelName].add(ws);
                    ws._channels.add(channelName);

                    // Prepare subscription data
                    let subscriptionData = '{}';

                    // For presence channels, we must return a presence object
                    if (channelName.startsWith('presence-')) {
                        const memberIds = [];
                        const membersHash = {};

                        // Collect current members in this channel
                        channels[channelName].forEach(client => {
                            const id = client._socketId || 'unknown';
                            memberIds.push(id);
                            membersHash[id] = client._userInfo || {};
                        });

                        subscriptionData = JSON.stringify({
                            presence: {
                                ids: memberIds,
                                hash: membersHash,
                                count: memberIds.length
                            }
                        });
                    }

                    // Send subscription succeeded
                    ws.send(JSON.stringify({
                        event: 'pusher_internal:subscription_succeeded',
                        channel: channelName,
                        data: subscriptionData
                    }));

                    console.log(`[Pusher Server] ${socketId} subscribed to "${channelName}" (${channels[channelName].size} subscriber(s))`);
                }
            }

            // Handle unsubscribe
            if (msg.event === 'pusher:unsubscribe') {
                const channelName = msg.data && msg.data.channel;
                if (channelName && channels[channelName]) {
                    channels[channelName].delete(ws);
                    ws._channels.delete(channelName);
                    if (channels[channelName].size === 0) {
                        delete channels[channelName];
                    }
                    console.log(`[Pusher Server] ${socketId} unsubscribed from "${channelName}"`);
                }
            }

            // Handle ping
            if (msg.event === 'pusher:ping') {
                ws.send(JSON.stringify({ event: 'pusher:pong', data: '{}' }));
            }

        } catch (err) {
            console.error(`[Pusher Server] Error parsing message from ${socketId}:`, err.message);
        }
    });

    ws.on('close', () => {
        // Remove from all channels
        ws._channels.forEach(channelName => {
            if (channels[channelName]) {
                channels[channelName].delete(ws);
                if (channels[channelName].size === 0) {
                    delete channels[channelName];
                }
            }
        });
        console.log(`[Pusher Server] Client disconnected: ${socketId}`);
    });

    ws.on('error', (err) => {
        console.error(`[Pusher Server] WebSocket error for ${socketId}:`, err.message);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`======================================`);
    console.log(`  Pusher-Compatible WebSocket Server`);
    console.log(`  Port: ${PORT}`);
    console.log(`  App ID: ${APP_ID}`);
    console.log(`  App Key: ${APP_KEY}`);
    console.log(`======================================`);
});
