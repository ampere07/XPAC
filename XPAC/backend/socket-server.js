const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // In production, specify the frontend URL
        methods: ["GET", "POST"]
    }
});

// Endpoint for Laravel to send broadcasts to
app.post('/broadcast/:channel', (req, res) => {
    const { channel } = req.params;
    const data = req.body;

    console.log(`[Broadcast] Channel: ${channel}, Event: ${channel}`, data);

    // Emit to all connected clients
    io.emit(channel, data);

    res.json({ success: true });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

const PORT = 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Socket.IO server running on port ${PORT}`);
});
