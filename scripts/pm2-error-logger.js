#!/usr/bin/env node

/**
 * PM2 Error Log Monitor for Discord
 * Watches PM2 error logs and sends alerts to Discord webhook
 * 
 * Usage: node scripts/pm2-error-logger.js
 * Or in ecosystem.config.js as a separate process
 * 
 * Environment variables:
 *   PM2_ERROR_WEBHOOK: Discord webhook URL for error alerts
 *   PM2_APP_NAME: Name of the PM2 app to monitor (default: jarvis)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync, spawn } = require('child_process');

// Configuration
const WEBHOOK_URL = process.env.PM2_ERROR_WEBHOOK || process.env.ERROR_WEBHOOK_URL;
const APP_NAME = process.env.PM2_APP_NAME || 'jarvis';
const OWNER_ID = process.env.OWNER_DISCORD_ID || '';
const PM2_HOME = process.env.PM2_HOME || path.join(require('os').homedir(), '.pm2');
const ERROR_LOG_PATH = path.join(PM2_HOME, 'logs', `${APP_NAME}-error.log`);

// Rate limiting
const recentErrors = [];
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_ERRORS_PER_WINDOW = 5;

// Deduplication
const sentErrors = new Map();
const ERROR_DEDUPE_TIME = 300000; // 5 minutes

function log(msg) {
    console.log(`[PM2-Logger] ${new Date().toISOString()} ${msg}`);
}

function sendWebhook(payload) {
    if (!WEBHOOK_URL) {
        log('No webhook URL configured');
        return;
    }

    const data = JSON.stringify(payload);
    const url = new URL(WEBHOOK_URL);

    const options = {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode !== 204 && res.statusCode !== 200) {
            log(`Webhook failed with status: ${res.statusCode}`);
        }
    });

    req.on('error', (e) => {
        log(`Webhook error: ${e.message}`);
    });

    req.write(data);
    req.end();
}

function isRateLimited() {
    const now = Date.now();
    // Clean old entries
    while (recentErrors.length > 0 && recentErrors[0] < now - RATE_LIMIT_WINDOW) {
        recentErrors.shift();
    }
    return recentErrors.length >= MAX_ERRORS_PER_WINDOW;
}

function recordError() {
    recentErrors.push(Date.now());
}

function isDuplicate(errorKey) {
    const lastSent = sentErrors.get(errorKey);
    const now = Date.now();

    // Clean old entries
    for (const [key, time] of sentErrors.entries()) {
        if (now - time > ERROR_DEDUPE_TIME) {
            sentErrors.delete(key);
        }
    }

    if (lastSent && now - lastSent < ERROR_DEDUPE_TIME) {
        return true;
    }

    sentErrors.set(errorKey, now);
    return false;
}

function parseErrorLines(lines) {
    const errors = [];
    let currentError = null;

    for (const line of lines) {
        // Check for new error start
        if (line.includes('Error:') || line.includes('ReferenceError:') ||
            line.includes('TypeError:') || line.includes('SyntaxError:') ||
            line.includes('FATAL') || line.includes('CRASH')) {
            if (currentError) {
                errors.push(currentError);
            }
            currentError = {
                type: line.match(/(Error|ReferenceError|TypeError|SyntaxError|FATAL|CRASH)/)?.[0] || 'Error',
                message: line,
                stack: [line]
            };
        } else if (currentError && line.includes('    at ')) {
            // Stack trace line
            currentError.stack.push(line);
        } else if (currentError && line.trim() === '') {
            // End of stack trace
            errors.push(currentError);
            currentError = null;
        }
    }

    if (currentError) {
        errors.push(currentError);
    }

    return errors;
}

function formatErrorEmbed(error) {
    const stackPreview = error.stack.slice(0, 5).join('\n');
    const errorKey = error.message.slice(0, 100);

    if (isDuplicate(errorKey)) {
        return null;
    }

    const embed = {
        title: `🚨 PM2 Error: ${error.type}`,
        description: `\`\`\`\n${error.message.slice(0, 200)}\n\`\`\``,
        color: 0xe74c3c,
        fields: [
            {
                name: 'Stack Trace',
                value: `\`\`\`\n${stackPreview.slice(0, 900)}\n\`\`\``,
                inline: false
            },
            {
                name: 'App',
                value: APP_NAME,
                inline: true
            },
            {
                name: 'Time',
                value: new Date().toISOString(),
                inline: true
            }
        ],
        footer: {
            text: 'PM2 Error Logger'
        }
    };

    return embed;
}

function sendErrorAlert(error) {
    if (isRateLimited()) {
        log('Rate limited, skipping alert');
        return;
    }

    const embed = formatErrorEmbed(error);
    if (!embed) {
        log('Duplicate error, skipping');
        return;
    }

    recordError();

    const payload = {
        content: OWNER_ID ? `<@${OWNER_ID}>` : undefined,
        embeds: [embed]
    };

    sendWebhook(payload);
    log(`Sent alert for: ${error.type}`);
}

function watchLogFile() {
    log(`Watching: ${ERROR_LOG_PATH}`);

    // Check if file exists
    if (!fs.existsSync(ERROR_LOG_PATH)) {
        log('Error log file not found, waiting for creation...');

        // Watch for file creation
        const dir = path.dirname(ERROR_LOG_PATH);
        fs.watch(dir, (eventType, filename) => {
            if (filename === path.basename(ERROR_LOG_PATH)) {
                log('Log file created, starting watch');
                startTailing();
            }
        });
        return;
    }

    startTailing();
}

function startTailing() {
    // Get current file size (we only want new errors)
    const stats = fs.statSync(ERROR_LOG_PATH);
    let lastSize = stats.size;
    let buffer = '';

    fs.watch(ERROR_LOG_PATH, (eventType) => {
        if (eventType === 'change') {
            try {
                const currentStats = fs.statSync(ERROR_LOG_PATH);
                const currentSize = currentStats.size;

                if (currentSize > lastSize) {
                    // Read new content
                    const fd = fs.openSync(ERROR_LOG_PATH, 'r');
                    const newContent = Buffer.alloc(currentSize - lastSize);
                    fs.readSync(fd, newContent, 0, currentSize - lastSize, lastSize);
                    fs.closeSync(fd);

                    buffer += newContent.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    if (lines.length > 0) {
                        const errors = parseErrorLines(lines);
                        for (const error of errors) {
                            sendErrorAlert(error);
                        }
                    }

                    lastSize = currentSize;
                } else if (currentSize < lastSize) {
                    // Log was rotated
                    lastSize = currentSize;
                    buffer = '';
                }
            } catch (e) {
                log(`Watch error: ${e.message}`);
            }
        }
    });

    log('Tailing started');
}

// Alternative: Use PM2's log stream
function usePm2LogStream() {
    try {
        const pm2 = spawn('pm2', ['logs', APP_NAME, '--err', '--raw', '--lines', '0'], {
            shell: true
        });

        let buffer = '';

        pm2.stdout.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            if (lines.length > 0) {
                const errors = parseErrorLines(lines);
                for (const error of errors) {
                    sendErrorAlert(error);
                }
            }
        });

        pm2.stderr.on('data', (data) => {
            buffer += data.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            if (lines.length > 0) {
                const errors = parseErrorLines(lines);
                for (const error of errors) {
                    sendErrorAlert(error);
                }
            }
        });

        pm2.on('close', (code) => {
            log(`PM2 logs stream closed with code ${code}, restarting...`);
            setTimeout(usePm2LogStream, 5000);
        });

        log('PM2 log stream started');
    } catch (e) {
        log(`Failed to start PM2 log stream: ${e.message}`);
        // Fallback to file watching
        watchLogFile();
    }
}

// Startup alert
function sendStartupMessage() {
    if (!WEBHOOK_URL) return;

    const embed = {
        title: '🟢 PM2 Error Logger Started',
        description: `Monitoring **${APP_NAME}** for errors`,
        color: 0x2ecc71,
        fields: [
            {
                name: 'Log Path',
                value: `\`${ERROR_LOG_PATH}\``,
                inline: false
            }
        ],
        footer: {
            text: 'Will send alerts for new errors'
        },
        timestamp: new Date().toISOString()
    };

    sendWebhook({ embeds: [embed] });
}

// Main
log('PM2 Error Logger starting...');

if (!WEBHOOK_URL) {
    log('WARNING: PM2_ERROR_WEBHOOK not set. Set it to receive Discord alerts.');
    log('Example: export PM2_ERROR_WEBHOOK="https://discord.com/api/webhooks/..."');
} else {
    sendStartupMessage();
}

// Try PM2 log stream first, fallback to file watching
try {
    execSync('which pm2', { encoding: 'utf8' });
    usePm2LogStream();
} catch {
    log('PM2 not found in PATH, using file watcher');
    watchLogFile();
}

process.on('SIGINT', () => {
    log('Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('Shutting down...');
    process.exit(0);
});
