module.exports = {
    apps: [
        {
            name: 'soketi',
            script: 'pusher-server.js',
            cwd: __dirname,
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production'
            },
            error_file: './storage/logs/soketi-error.log',
            out_file: './storage/logs/soketi-out.log',
            log_file: './storage/logs/soketi-combined.log',
            time: true
        },
        {
            name: 'socket-io',
            script: 'socket-server.js',
            cwd: __dirname,
            autorestart: true,
            watch: false,
            max_memory_restart: '256M',
            env: {
                NODE_ENV: 'production'
            },
            error_file: './storage/logs/socket-error.log',
            out_file: './storage/logs/socket-out.log',
            log_file: './storage/logs/socket-combined.log',
            time: true
        }
    ]
};
