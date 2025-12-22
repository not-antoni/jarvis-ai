/**
 * PM2 Ecosystem Configuration for Jarvis AI
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js
 */

module.exports = {
    apps: [{
        name: 'jarvis',
        script: 'index.js',
        instances: 1,
        exec_mode: 'fork',
        autorestart: true,
        watch: false,
        max_memory_restart: '500M',
        min_uptime: '10s',
        max_restarts: 10,
        restart_delay: 5000,
        
        // Environment variables
        env: {
            NODE_ENV: 'development',
            DEPLOY_TARGET: 'selfhost',
            SELFHOST_MODE: 'true'
        },
        env_production: {
            NODE_ENV: 'production',
            DEPLOY_TARGET: 'selfhost',
            SELFHOST_MODE: 'true',
            UV_THREADPOOL_SIZE: '16'
        },
        
        // Logging
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        error_file: 'logs/jarvis-error.log',
        out_file: 'logs/jarvis-out.log',
        merge_logs: true,
        
        // Graceful shutdown
        kill_timeout: 10000,
        listen_timeout: 10000,
        shutdown_with_message: true
    }]
};
