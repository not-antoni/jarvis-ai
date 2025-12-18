#!/usr/bin/env node
/**
 * Jarvis AI - Selfhost First-Time Setup Wizard
 * 
 * Interactive setup for VPS/selfhost deployments.
 * Guides users through configuration, validates settings,
 * and provides PM2/Nginx setup instructions.
 * 
 * Usage: 
 *   node scripts/selfhost-setup.js          # Interactive setup
 *   node scripts/selfhost-setup.js --verify # Verify current configuration
 *   node scripts/selfhost-setup.js --force  # Re-run setup from scratch
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');
const net = require('net');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ENV_EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');
const DATA_DIR = path.join(__dirname, '..', 'data');
const SETUP_COMPLETE_FILE = path.join(DATA_DIR, '.selfhost-setup-complete');
const PROJECT_ROOT = path.join(__dirname, '..');

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

const log = {
    info: msg => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
    success: msg => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    warn: msg => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    error: msg => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    step: msg => console.log(`\n${colors.bright}${colors.blue}▶ ${msg}${colors.reset}`),
    header: msg => console.log(`\n${colors.bright}${colors.magenta}═══ ${msg} ═══${colors.reset}\n`)
};

class SelfhostSetup {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        this.envVars = {};
        this.existingEnv = {};
    }

    async prompt(question, defaultValue = '') {
        const defaultStr = defaultValue ? ` ${colors.dim}[${defaultValue}]${colors.reset}` : '';
        return new Promise(resolve => {
            this.rl.question(`${question}${defaultStr}: `, answer => {
                resolve(answer.trim() || defaultValue);
            });
        });
    }

    async promptYesNo(question, defaultYes = true) {
        const hint = defaultYes ? '[Y/n]' : '[y/N]';
        const answer = await this.prompt(`${question} ${hint}`);
        if (!answer) return defaultYes;
        return answer.toLowerCase().startsWith('y');
    }

    async promptSecret(question) {
        const stdin = process.stdin;
        const stdout = process.stdout;
        
        // Check if we're in a TTY (interactive terminal)
        if (!stdin.isTTY) {
            // Fallback to regular prompt for non-TTY (piped input, scripts, etc.)
            return this.prompt(question);
        }
        
        return new Promise(resolve => {
            stdout.write(`${question}: `);
            stdin.setRawMode(true);
            stdin.resume();
            stdin.setEncoding('utf8');
            
            let password = '';
            const onData = char => {
                if (char === '\n' || char === '\r' || char === '\u0004') {
                    stdin.setRawMode(false);
                    stdin.pause();
                    stdin.removeListener('data', onData);
                    stdout.write('\n');
                    resolve(password);
                } else if (char === '\u0003') {
                    process.exit();
                } else if (char === '\u007F' || char === '\b') {
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        stdout.write('\b \b');
                    }
                } else {
                    password += char;
                    stdout.write('*');
                }
            };
            stdin.on('data', onData);
        });
    }

    loadExistingEnv() {
        if (fs.existsSync(ENV_PATH)) {
            const content = fs.readFileSync(ENV_PATH, 'utf8');
            for (const line of content.split('\n')) {
                const match = line.match(/^([^#=]+)=(.*)$/);
                if (match) {
                    let value = match[2].trim();
                    // Remove quotes
                    if ((value.startsWith('"') && value.endsWith('"')) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.slice(1, -1);
                    }
                    this.existingEnv[match[1].trim()] = value;
                }
            }
        }
    }

    generateMasterKey() {
        return crypto.randomBytes(32).toString('base64');
    }

    detectPublicIP() {
        try {
            // Try multiple methods
            const methods = [
                'curl -s --max-time 5 ifconfig.me',
                'curl -s --max-time 5 icanhazip.com',
                'curl -s --max-time 5 api.ipify.org',
                'hostname -I | awk \'{print $1}\''
            ];
            
            for (const cmd of methods) {
                try {
                    const ip = execSync(cmd, { encoding: 'utf8', timeout: 6000 }).trim();
                    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
                        return ip;
                    }
                } catch {
                    continue;
                }
            }
        } catch {
            // Fallback
        }
        return null;
    }

    /**
     * Check if local MongoDB is running on localhost:27017
     */
    async checkLocalMongo() {
        return new Promise(resolve => {
            const socket = new net.Socket();
            socket.setTimeout(2000);
            
            socket.on('connect', () => {
                socket.destroy();
                resolve(true);
            });
            
            socket.on('timeout', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.on('error', () => {
                socket.destroy();
                resolve(false);
            });
            
            socket.connect(27017, 'localhost');
        });
    }

    async run() {
        console.clear();
        log.header('Jarvis AI - Selfhost Setup Wizard');
        
        // Check if already set up
        if (fs.existsSync(SETUP_COMPLETE_FILE)) {
            log.info('Selfhost setup was already completed.');
            const rerun = await this.promptYesNo('Do you want to run setup again?', false);
            if (!rerun) {
                log.info('Exiting. Run with --force to skip this check.');
                this.rl.close();
                return;
            }
        }

        this.loadExistingEnv();
        
        // Step 1: Basic Info
        log.step('Step 1: Environment Detection');
        
        const detectedIP = this.detectPublicIP();
        if (detectedIP) {
            log.success(`Detected public IP: ${detectedIP}`);
        } else {
            log.warn('Could not auto-detect public IP');
        }

        const isVPS = await this.promptYesNo('Are you running on a VPS/cloud server (not localhost)?', true);
        
        // Step 2: Base URL Configuration
        log.step('Step 2: Base URL Configuration');
        
        let baseUrl = this.existingEnv.PUBLIC_BASE_URL || '';
        if (isVPS) {
            log.info('For OAuth callbacks and webhooks, you need a public URL.');
            log.info('Options: Use your IP (http://1.2.3.4:3000) or a domain (https://jarvis.example.com)');
            
            const suggestedUrl = detectedIP ? `http://${detectedIP}:3000` : '';
            baseUrl = await this.prompt('Enter your public base URL', suggestedUrl || baseUrl);
            
            if (baseUrl && !baseUrl.startsWith('http')) {
                baseUrl = `http://${baseUrl}`;
            }
            baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
        } else {
            baseUrl = await this.prompt('Base URL (for local dev)', 'http://localhost:3000');
        }
        this.envVars.PUBLIC_BASE_URL = baseUrl;

        // Step 3: Discord Configuration
        log.step('Step 3: Discord Configuration');
        
        let discordToken = this.existingEnv.DISCORD_TOKEN;
        if (discordToken) {
            log.success('Discord token already configured');
            const change = await this.promptYesNo('Do you want to change it?', false);
            if (change) {
                discordToken = await this.promptSecret('Enter Discord Bot Token');
            }
        } else {
            log.warn('Discord token not found');
            discordToken = await this.promptSecret('Enter Discord Bot Token');
        }
        if (discordToken) this.envVars.DISCORD_TOKEN = discordToken;

        // Discord OAuth (for moderator dashboard)
        const setupOAuth = await this.promptYesNo('Set up Discord OAuth (for moderator dashboard)?', true);
        if (setupOAuth) {
            log.info(`\nIn Discord Developer Portal, add this redirect URL:`);
            log.info(`${colors.bright}${baseUrl}/auth/discord/callback${colors.reset}\n`);
            
            const clientId = await this.prompt('Discord Client ID', this.existingEnv.DISCORD_CLIENT_ID || '');
            const clientSecret = await this.promptSecret('Discord Client Secret');
            
            if (clientId) this.envVars.DISCORD_CLIENT_ID = clientId;
            if (clientSecret) this.envVars.DISCORD_CLIENT_SECRET = clientSecret;
        }

        // Step 4: Database Configuration
        log.step('Step 4: Database Configuration');
        
        const hasMongoMain = !!this.existingEnv.MONGO_URI_MAIN;
        const hasMongoVault = !!this.existingEnv.MONGO_URI_VAULT;
        
        if (hasMongoMain && hasMongoVault) {
            log.success('MongoDB URIs already configured');
        } else {
            log.info('MongoDB is required for full functionality.');
            log.info('Options: 1) Local MongoDB, 2) MongoDB Atlas, 3) No database (limited)');
            
            // Check if local MongoDB is running
            const localMongoRunning = await this.checkLocalMongo();
            
            if (localMongoRunning) {
                log.success('Local MongoDB detected on localhost:27017');
                const useLocalMongo = await this.promptYesNo('Use local MongoDB?', true);
                if (useLocalMongo) {
                    this.envVars.MONGO_URI_MAIN = 'mongodb://localhost:27017/jarvis';
                    this.envVars.MONGO_URI_VAULT = 'mongodb://localhost:27017/jarvis_vault';
                    log.success('Configured local MongoDB URIs');
                } else {
                    const mongoMain = await this.prompt('MongoDB Main URI', '');
                    const mongoVault = await this.prompt('MongoDB Vault URI', mongoMain);
                    if (mongoMain) this.envVars.MONGO_URI_MAIN = mongoMain;
                    if (mongoVault) this.envVars.MONGO_URI_VAULT = mongoVault;
                }
            } else {
                log.warn('Local MongoDB not detected on localhost:27017');
                log.info('Install MongoDB: sudo apt install mongodb-org && sudo systemctl start mongod');
                
                const useLocalDb = await this.promptYesNo('Continue without MongoDB (LOCAL_DB_MODE)?', false);
                if (useLocalDb) {
                    this.envVars.LOCAL_DB_MODE = '1';
                    this.envVars.ALLOW_START_WITHOUT_DB = '1';
                    log.warn('Using LOCAL_DB_MODE - some features like Starkbucks will be disabled');
                } else {
                    const mongoMain = await this.prompt('MongoDB Main URI (Atlas or custom)', '');
                    const mongoVault = await this.prompt('MongoDB Vault URI', mongoMain);
                    if (mongoMain) this.envVars.MONGO_URI_MAIN = mongoMain;
                    if (mongoVault) this.envVars.MONGO_URI_VAULT = mongoVault;
                }
            }
        }

        // Step 5: Security
        log.step('Step 5: Security Configuration');
        
        let masterKey = this.existingEnv.MASTER_KEY_BASE64;
        if (masterKey) {
            log.success('Master key already configured');
        } else {
            log.warn('No master key found - generating new one');
            masterKey = this.generateMasterKey();
            log.success(`Generated: ${masterKey.substring(0, 10)}...`);
        }
        this.envVars.MASTER_KEY_BASE64 = masterKey;

        // Step 6: Selfhost Mode
        log.step('Step 6: Selfhost Mode Configuration');
        
        this.envVars.DEPLOY_TARGET = 'selfhost';
        this.envVars.SELFHOST_MODE = 'true';
        log.success('Enabled selfhost mode');

        // Optional: AI Providers
        log.step('Step 7: AI Provider Configuration (Optional)');
        
        const configureAI = await this.promptYesNo('Configure AI providers now?', false);
        if (configureAI) {
            const openrouterKey = await this.promptSecret('OpenRouter API Key (leave empty to skip)');
            if (openrouterKey) this.envVars.OPENROUTER_API_KEY = openrouterKey;
            
            const groqKey = await this.promptSecret('Groq API Key (leave empty to skip)');
            if (groqKey) this.envVars.GROQ_API_KEY = groqKey;
            
            const googleKey = await this.promptSecret('Google AI API Key (leave empty to skip)');
            if (googleKey) this.envVars.GOOGLE_AI_API_KEY = googleKey;
        }

        // Step 8: System Setup (VPS only)
        if (isVPS) {
            log.step('Step 8: System Setup');
            await this.runSystemSetup();
        }

        // Step 9: Write Configuration
        log.step(isVPS ? 'Step 9: Saving Configuration' : 'Step 8: Saving Configuration');
        
        this.writeEnvFile();
        
        // Mark setup as complete
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SETUP_COMPLETE_FILE, new Date().toISOString());
        
        // Step 10: Post-Setup Instructions
        log.header('Setup Complete!');
        
        console.log(`${colors.bright}Next Steps:${colors.reset}\n`);
        
        console.log(`1. ${colors.cyan}Update Discord Developer Portal:${colors.reset}`);
        console.log(`   - Go to https://discord.com/developers/applications`);
        console.log(`   - OAuth2 → Redirects → Add: ${colors.bright}${baseUrl}/auth/discord/callback${colors.reset}`);
        console.log(`   - OAuth2 → Redirects → Add: ${colors.bright}${baseUrl}/moderator/callback${colors.reset}\n`);
        
        if (isVPS) {
            console.log(`2. ${colors.cyan}Start the bot with PM2:${colors.reset}`);
            console.log(`   ${colors.dim}pm2 start index.js --name "jarvis" --max-memory-restart 500M${colors.reset}`);
            console.log(`   ${colors.dim}pm2 startup && pm2 save${colors.reset}\n`);
        }
        
        console.log(`${colors.green}Verify setup:${colors.reset} node scripts/selfhost-setup.js --verify`);
        console.log(`${colors.green}Start the bot:${colors.reset} npm start\n`);
        
        this.rl.close();
    }

    // Check if a command exists
    commandExists(cmd) {
        try {
            const result = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 5000 });
            return result.status === 0 && result.stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    // Run a command and show output
    runCmd(cmd, description) {
        log.info(`Running: ${cmd}`);
        try {
            const result = execSync(cmd, { 
                encoding: 'utf8', 
                timeout: 120000,
                stdio: ['pipe', 'pipe', 'pipe']
            });
            if (result.trim()) {
                console.log(`   ${colors.dim}${result.trim().split('\n').slice(0, 3).join('\n   ')}${colors.reset}`);
            }
            log.success(description);
            return true;
        } catch (error) {
            log.error(`Failed: ${error.message}`);
            return false;
        }
    }

    // Run system setup commands
    async runSystemSetup() {
        log.info('This will install/configure system dependencies.');
        log.info('Some commands require sudo (you may be prompted for password).\n');
        
        const runSetup = await this.promptYesNo('Run automated system setup?', true);
        if (!runSetup) {
            log.info('Skipping system setup. You can run these manually later.');
            return;
        }

        const setupTasks = [];

        // Check and install ffmpeg
        if (!this.commandExists('ffmpeg')) {
            setupTasks.push({
                name: 'Install ffmpeg',
                cmd: 'sudo apt-get update && sudo apt-get install -y ffmpeg',
                check: () => this.commandExists('ffmpeg'),
                envVar: { key: 'FFMPEG_PATH', value: '/usr/bin/ffmpeg' }
            });
        } else {
            log.success('ffmpeg already installed');
            this.envVars.FFMPEG_PATH = '/usr/bin/ffmpeg';
        }

        // Check and install PM2
        if (!this.commandExists('pm2')) {
            setupTasks.push({
                name: 'Install PM2',
                cmd: 'sudo npm install -g pm2',
                check: () => this.commandExists('pm2')
            });
        } else {
            log.success('PM2 already installed');
        }

        // Configure firewall
        const configureFirewall = await this.promptYesNo('Configure UFW firewall (allow SSH + port 3000)?', true);
        if (configureFirewall) {
            setupTasks.push({
                name: 'Allow SSH through firewall',
                cmd: 'sudo ufw allow ssh',
                check: () => true
            });
            setupTasks.push({
                name: 'Allow port 3000 through firewall',
                cmd: 'sudo ufw allow 3000',
                check: () => true
            });
            setupTasks.push({
                name: 'Enable firewall',
                cmd: 'echo "y" | sudo ufw enable',
                check: () => true
            });
        }

        // Run npm install if node_modules missing
        const nodeModulesPath = path.join(PROJECT_ROOT, 'node_modules');
        if (!fs.existsSync(nodeModulesPath)) {
            setupTasks.push({
                name: 'Install npm dependencies',
                cmd: 'npm install',
                cwd: PROJECT_ROOT,
                check: () => fs.existsSync(nodeModulesPath)
            });
        } else {
            log.success('npm dependencies already installed');
        }

        // Create data directory
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            log.success('Created data directory');
        }

        // Run setup tasks
        if (setupTasks.length > 0) {
            console.log('');
            for (const task of setupTasks) {
                log.info(`${task.name}...`);
                try {
                    const options = { 
                        encoding: 'utf8', 
                        timeout: 300000,
                        stdio: ['pipe', 'pipe', 'pipe']
                    };
                    if (task.cwd) options.cwd = task.cwd;
                    
                    execSync(task.cmd, options);
                    
                    if (task.check && task.check()) {
                        log.success(task.name);
                        if (task.envVar) {
                            this.envVars[task.envVar.key] = task.envVar.value;
                        }
                    } else if (task.check) {
                        log.warn(`${task.name} - completed but verification failed`);
                    } else {
                        log.success(task.name);
                    }
                } catch (error) {
                    log.error(`${task.name} failed: ${error.message}`);
                    const cont = await this.promptYesNo('Continue with remaining tasks?', true);
                    if (!cont) break;
                }
            }
        }

        // Set up PM2 startup if available
        if (this.commandExists('pm2')) {
            const setupPm2Startup = await this.promptYesNo('Configure PM2 to start on boot?', true);
            if (setupPm2Startup) {
                log.info('Setting up PM2 startup...');
                try {
                    // Get startup command
                    const startupCmd = execSync('pm2 startup systemd -u $USER --hp $HOME 2>&1 | grep "sudo" | head -1', {
                        encoding: 'utf8',
                        timeout: 30000,
                        shell: '/bin/bash'
                    }).trim();
                    
                    if (startupCmd && startupCmd.includes('sudo')) {
                        log.info('Running PM2 startup command...');
                        execSync(startupCmd, { encoding: 'utf8', timeout: 60000, stdio: 'inherit' });
                        log.success('PM2 configured to start on boot');
                    }
                } catch (error) {
                    log.warn('PM2 startup setup needs manual intervention. Run: pm2 startup');
                }
            }
        }

        console.log('');
        log.success('System setup complete!');
    }

    writeEnvFile() {
        // APPEND-ONLY MODE: Only add/update variables, never remove existing ones
        
        if (!fs.existsSync(ENV_PATH)) {
            // No existing .env - create new one with just our vars
            let content = '# Jarvis AI - Environment Configuration\n';
            content += `# Generated by selfhost-setup.js on ${new Date().toISOString()}\n\n`;
            
            for (const [key, value] of Object.entries(this.envVars)) {
                const needsQuotes = /[\s#=]/.test(value);
                content += needsQuotes ? `${key}="${value}"\n` : `${key}=${value}\n`;
            }
            
            fs.writeFileSync(ENV_PATH, content);
            log.success('Created new .env configuration');
            return;
        }
        
        // Read existing .env content
        let existingContent = fs.readFileSync(ENV_PATH, 'utf8');
        
        // Backup existing .env first
        const backupPath = `${ENV_PATH}.backup.${Date.now()}`;
        fs.copyFileSync(ENV_PATH, backupPath);
        log.info(`Backed up existing .env to ${path.basename(backupPath)}`);
        
        // Track what we've updated vs what needs to be appended
        const toAppend = [];
        
        for (const [key, value] of Object.entries(this.envVars)) {
            const needsQuotes = /[\s#=]/.test(value);
            const formattedValue = needsQuotes ? `"${value}"` : value;
            
            // Check if key already exists in file
            const keyRegex = new RegExp(`^${key}=.*$`, 'm');
            
            if (keyRegex.test(existingContent)) {
                // Update existing key in place
                existingContent = existingContent.replace(keyRegex, `${key}=${formattedValue}`);
                log.info(`Updated: ${key}`);
            } else {
                // Key doesn't exist - append it
                toAppend.push({ key, value: formattedValue });
            }
        }
        
        // Append new variables at the end
        if (toAppend.length > 0) {
            existingContent = existingContent.trimEnd();
            existingContent += '\n\n# Added by selfhost-setup.js\n';
            for (const { key, value } of toAppend) {
                existingContent += `${key}=${value}\n`;
                log.info(`Added: ${key}`);
            }
        }
        
        fs.writeFileSync(ENV_PATH, existingContent);
        log.success('Updated .env configuration (append-only mode)');
    }
}

/**
 * System verification checks
 */
class SystemVerifier {
    constructor() {
        this.results = { passed: 0, warnings: 0, failed: 0, checks: [] };
    }

    addResult(name, status, message) {
        this.results.checks.push({ name, status, message });
        if (status === 'pass') this.results.passed++;
        else if (status === 'warn') this.results.warnings++;
        else this.results.failed++;
    }

    // Check if a command exists
    commandExists(cmd) {
        try {
            const result = spawnSync('which', [cmd], { encoding: 'utf8', timeout: 5000 });
            return result.status === 0 && result.stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    // Check if a port is in use
    async checkPort(port) {
        return new Promise(resolve => {
            const server = net.createServer();
            server.once('error', () => resolve(true)); // Port in use
            server.once('listening', () => {
                server.close();
                resolve(false); // Port available
            });
            server.listen(port, '127.0.0.1');
        });
    }

    // Get installed Node version
    getNodeVersion() {
        try {
            return process.version;
        } catch {
            return null;
        }
    }

    // Check ffmpeg
    checkFfmpeg() {
        if (this.commandExists('ffmpeg')) {
            try {
                const version = execSync('ffmpeg -version 2>&1 | head -1', { encoding: 'utf8', timeout: 5000 }).trim();
                this.addResult('ffmpeg', 'pass', version.substring(0, 60));
                return '/usr/bin/ffmpeg';
            } catch {
                this.addResult('ffmpeg', 'pass', 'Installed');
                return '/usr/bin/ffmpeg';
            }
        } else {
            this.addResult('ffmpeg', 'warn', 'Not installed - yt-dlp may show warnings. Install: sudo apt install ffmpeg');
            return null;
        }
    }

    // Check PM2
    checkPM2() {
        if (this.commandExists('pm2')) {
            try {
                const version = execSync('pm2 --version', { encoding: 'utf8', timeout: 5000 }).trim();
                this.addResult('PM2', 'pass', `Version ${version}`);
                return true;
            } catch {
                this.addResult('PM2', 'pass', 'Installed');
                return true;
            }
        } else {
            this.addResult('PM2', 'warn', 'Not installed - recommended for production. Install: sudo npm install -g pm2');
            return false;
        }
    }

    // Check Node version
    checkNode() {
        const version = this.getNodeVersion();
        const major = parseInt(version.replace('v', '').split('.')[0], 10);
        if (major >= 18) {
            this.addResult('Node.js', 'pass', version);
        } else if (major >= 16) {
            this.addResult('Node.js', 'warn', `${version} - recommend v18+`);
        } else {
            this.addResult('Node.js', 'fail', `${version} - requires v16+`);
        }
    }

    // Check .env file
    checkEnvFile() {
        if (!fs.existsSync(ENV_PATH)) {
            this.addResult('.env file', 'fail', 'Missing - run setup first');
            return null;
        }
        
        const content = fs.readFileSync(ENV_PATH, 'utf8');
        const env = {};
        for (const line of content.split('\n')) {
            const match = line.match(/^([^#=]+)=(.*)$/);
            if (match) {
                let value = match[2].trim();
                if ((value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                env[match[1].trim()] = value;
            }
        }
        
        this.addResult('.env file', 'pass', 'Found');
        return env;
    }

    // Check critical env vars
    checkEnvVars(env) {
        if (!env) return;

        // Required
        const required = ['DISCORD_TOKEN', 'MASTER_KEY_BASE64'];
        for (const key of required) {
            if (env[key] && env[key].length > 5) {
                this.addResult(key, 'pass', 'Configured');
            } else {
                this.addResult(key, 'fail', 'Missing or invalid');
            }
        }

        // Selfhost mode
        const isSelfhost = env.DEPLOY_TARGET === 'selfhost' || env.SELFHOST_MODE === 'true';
        if (isSelfhost) {
            this.addResult('Selfhost Mode', 'pass', 'Enabled');
        } else {
            this.addResult('Selfhost Mode', 'warn', 'Not enabled - set DEPLOY_TARGET=selfhost');
        }

        // PUBLIC_BASE_URL
        if (env.PUBLIC_BASE_URL && env.PUBLIC_BASE_URL.length > 5) {
            this.addResult('PUBLIC_BASE_URL', 'pass', env.PUBLIC_BASE_URL);
        } else if (isSelfhost) {
            this.addResult('PUBLIC_BASE_URL', 'warn', 'Not set - OAuth callbacks may fail');
        }

        // Database
        const hasLocalDb = env.LOCAL_DB_MODE === '1' || env.ALLOW_START_WITHOUT_DB === '1';
        if (env.MONGO_URI_MAIN && env.MONGO_URI_MAIN.length > 10) {
            this.addResult('MongoDB', 'pass', 'Configured');
        } else if (hasLocalDb) {
            this.addResult('MongoDB', 'warn', 'Using LOCAL_DB_MODE (limited features)');
        } else {
            this.addResult('MongoDB', 'fail', 'Not configured');
        }

        // AI Providers
        const aiKeys = ['OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI', 'OPENAI_API_KEY'];
        const hasAI = aiKeys.some(k => env[k] && env[k].length > 10);
        if (hasAI) {
            this.addResult('AI Providers', 'pass', 'At least one configured');
        } else {
            this.addResult('AI Providers', 'warn', 'None configured - AI features will be limited');
        }

        // ffmpeg path
        if (env.FFMPEG_PATH) {
            this.addResult('FFMPEG_PATH', 'pass', env.FFMPEG_PATH);
        }
    }

    // Check if port is available
    async checkPortAvailability() {
        const port = process.env.PORT || 3000;
        const inUse = await this.checkPort(port);
        if (inUse) {
            this.addResult(`Port ${port}`, 'warn', 'Already in use - bot may already be running');
        } else {
            this.addResult(`Port ${port}`, 'pass', 'Available');
        }
    }

    // Check node_modules
    checkNodeModules() {
        const nodeModulesPath = path.join(PROJECT_ROOT, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
            this.addResult('Dependencies', 'pass', 'node_modules exists');
        } else {
            this.addResult('Dependencies', 'fail', 'node_modules missing - run: npm install');
        }
    }

    // Check disk space
    checkDiskSpace() {
        try {
            const result = execSync("df -h . | tail -1 | awk '{print $4, $5}'", { 
                encoding: 'utf8', 
                timeout: 5000 
            }).trim();
            const [available, usedPercent] = result.split(' ');
            const usedNum = parseInt(usedPercent.replace('%', ''), 10);
            
            if (usedNum > 90) {
                this.addResult('Disk Space', 'fail', `${available} available (${usedPercent} used) - critically low!`);
            } else if (usedNum > 80) {
                this.addResult('Disk Space', 'warn', `${available} available (${usedPercent} used) - getting low`);
            } else {
                this.addResult('Disk Space', 'pass', `${available} available (${usedPercent} used)`);
            }
        } catch {
            this.addResult('Disk Space', 'warn', 'Could not check disk space');
        }
    }

    // Check memory
    checkMemory() {
        try {
            const result = execSync("free -h | grep Mem | awk '{print $2, $7}'", { 
                encoding: 'utf8', 
                timeout: 5000 
            }).trim();
            const [total, available] = result.split(' ');
            this.addResult('Memory', 'pass', `${available} available of ${total}`);
        } catch {
            // Try alternative for systems without 'free'
            try {
                const memInfo = fs.readFileSync('/proc/meminfo', 'utf8');
                const match = memInfo.match(/MemAvailable:\s+(\d+)/);
                if (match) {
                    const availMB = Math.round(parseInt(match[1], 10) / 1024);
                    this.addResult('Memory', 'pass', `${availMB}MB available`);
                }
            } catch {
                this.addResult('Memory', 'warn', 'Could not check memory');
            }
        }
    }

    // Check Discord OAuth configuration
    checkDiscordOAuth(env) {
        if (!env) return;
        
        const hasClientId = env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_ID.length > 10;
        const hasClientSecret = env.DISCORD_CLIENT_SECRET && env.DISCORD_CLIENT_SECRET.length > 10;
        
        if (hasClientId && hasClientSecret) {
            this.addResult('Discord OAuth', 'pass', 'Client ID and Secret configured');
        } else if (hasClientId && !hasClientSecret) {
            this.addResult('Discord OAuth', 'fail', 'Client ID set but Secret missing');
        } else {
            this.addResult('Discord OAuth', 'warn', 'Not configured - moderator dashboard will use password auth');
        }
    }

    // Check yt-dlp binary
    checkYtDlp() {
        const ytdlpPath = path.join(PROJECT_ROOT, 'bin', 'yt-dlp');
        const ytdlpPathWin = path.join(PROJECT_ROOT, 'bin', 'yt-dlp.exe');
        
        if (fs.existsSync(ytdlpPath) || fs.existsSync(ytdlpPathWin)) {
            this.addResult('yt-dlp', 'pass', 'Binary exists in bin/');
        } else {
            this.addResult('yt-dlp', 'warn', 'Not downloaded yet - will auto-download on first use');
        }
    }

    // Check data directory
    checkDataDir() {
        if (fs.existsSync(DATA_DIR)) {
            try {
                fs.accessSync(DATA_DIR, fs.constants.W_OK);
                this.addResult('Data Directory', 'pass', 'Exists and writable');
            } catch {
                this.addResult('Data Directory', 'fail', 'Exists but not writable');
            }
        } else {
            this.addResult('Data Directory', 'warn', 'Does not exist - will be created on first run');
        }
    }

    // Run all checks
    async runAll() {
        log.header('System Verification');

        log.step('Checking system dependencies...');
        this.checkNode();
        this.checkFfmpeg();
        this.checkPM2();
        this.checkYtDlp();
        this.checkNodeModules();

        log.step('Checking system resources...');
        this.checkDiskSpace();
        this.checkMemory();
        this.checkDataDir();

        log.step('Checking configuration...');
        const env = this.checkEnvFile();
        this.checkEnvVars(env);
        this.checkDiscordOAuth(env);

        log.step('Checking network...');
        await this.checkPortAvailability();

        // Print results
        console.log('\n');
        for (const check of this.results.checks) {
            const icon = check.status === 'pass' ? `${colors.green}✓` :
                         check.status === 'warn' ? `${colors.yellow}⚠` :
                         `${colors.red}✗`;
            console.log(`${icon}${colors.reset} ${colors.bright}${check.name}${colors.reset}: ${check.message}`);
        }

        console.log('\n' + '─'.repeat(50));
        console.log(`${colors.green}Passed: ${this.results.passed}${colors.reset} | ` +
                    `${colors.yellow}Warnings: ${this.results.warnings}${colors.reset} | ` +
                    `${colors.red}Failed: ${this.results.failed}${colors.reset}`);

        if (this.results.failed > 0) {
            console.log(`\n${colors.red}Fix the failed checks before running the bot.${colors.reset}`);
            return false;
        } else if (this.results.warnings > 0) {
            console.log(`\n${colors.yellow}Warnings found - bot will run but some features may be limited.${colors.reset}`);
            return true;
        } else {
            console.log(`\n${colors.green}All checks passed! Ready to start.${colors.reset}`);
            return true;
        }
    }
}

// Parse command line arguments
const args = process.argv.slice(2);
const verifyMode = args.includes('--verify') || args.includes('-v');
const forceSetup = args.includes('--force') || args.includes('-f');

if (forceSetup) {
    if (fs.existsSync(SETUP_COMPLETE_FILE)) {
        fs.unlinkSync(SETUP_COMPLETE_FILE);
    }
}

// Run appropriate mode
if (verifyMode) {
    // Verification mode
    const verifier = new SystemVerifier();
    verifier.runAll().then(success => {
        process.exit(success ? 0 : 1);
    });
} else {
    // Interactive setup mode
    const setup = new SelfhostSetup();
    setup.run().catch(err => {
        console.error('Setup failed:', err);
        process.exit(1);
    });
}
