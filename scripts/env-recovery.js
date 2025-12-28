/**
 * Emergency .env Recovery Script
 * Sends the .env file contents to the bot owner via DM on startup
 * 
 * REMOVE THIS FILE AFTER RECOVERY!!!
 */

const fs = require('fs');
const path = require('path');

const OWNER_ID = process.env.BOT_OWNER_ID;
const ENV_PATH = path.join(__dirname, '..', '.env');

async function sendEnvToOwner(client) {
    if (!OWNER_ID) {
        console.error('[EnvRecovery] BOT_OWNER_ID not set - cannot send .env');
        return;
    }

    try {
        // Read the .env file
        if (!fs.existsSync(ENV_PATH)) {
            console.error('[EnvRecovery] .env file not found at:', ENV_PATH);
            return;
        }

        const envContents = fs.readFileSync(ENV_PATH, 'utf8');
        
        // Get the owner user
        const owner = await client.users.fetch(OWNER_ID);
        if (!owner) {
            console.error('[EnvRecovery] Could not fetch owner user');
            return;
        }

        // Split into chunks if too long (Discord limit is 2000 chars)
        const MAX_LENGTH = 1900; // Leave some buffer
        const chunks = [];
        
        if (envContents.length <= MAX_LENGTH) {
            chunks.push(envContents);
        } else {
            const lines = envContents.split('\n');
            let currentChunk = '';
            
            for (const line of lines) {
                if ((currentChunk + '\n' + line).length > MAX_LENGTH) {
                    chunks.push(currentChunk);
                    currentChunk = line;
                } else {
                    currentChunk += (currentChunk ? '\n' : '') + line;
                }
            }
            if (currentChunk) chunks.push(currentChunk);
        }

        // Send to owner
        await owner.send('🔐 **Emergency .env Recovery**\n\n⚠️ **DELETE scripts/env-recovery.js AFTER RECOVERY!**\n');
        
        for (let i = 0; i < chunks.length; i++) {
            await owner.send(`\`\`\`env\n${chunks[i]}\n\`\`\``);
        }

        await owner.send('✅ **End of .env file** - Remember to delete `scripts/env-recovery.js` from your repo!');
        
        console.log('[EnvRecovery] Successfully sent .env to owner via DM');
    } catch (error) {
        console.error('[EnvRecovery] Failed to send .env:', error.message);
    }
}

module.exports = { sendEnvToOwner };
