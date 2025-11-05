module.exports = {
  apps: [{
    name: 'telegram-image-bot',
    script: 'ts-node',
    args: 'src/index-production.ts',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
    kill_timeout: 5000,
    listen_timeout: 10000
  }]
};
