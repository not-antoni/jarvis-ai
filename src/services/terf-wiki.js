/**
 * Terf Wiki Bridge Service
 * Calls Python CLI and returns parsed JSON results
 */
const { spawn } = require('child_process');
const path = require('path');

const TERF_WIKI_DIR = path.join(__dirname, '../../Terf wiki');
const PYTHON_CMD = process.env.PYTHON_CMD || 'python3';
const TIMEOUT_MS = 60000; // 60 seconds for model loading + query

/**
 * Query the Terf Wiki RAG system
 * @param {string} question - The question to ask
 * @returns {Promise<{success: boolean, answer?: string, sources?: Array, error?: string}>}
 */
async function query(question) {
    return new Promise((resolve) => {
        const startTime = Date.now();

        const proc = spawn(PYTHON_CMD, ['cli.py', '--query', question], {
            cwd: TERF_WIKI_DIR,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1'
            }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            proc.kill('SIGTERM');
            resolve({
                success: false,
                error: 'Query timed out (60s). The wiki system may be loading models.'
            });
        }, TIMEOUT_MS);

        proc.on('close', (code) => {
            clearTimeout(timeout);
            const elapsed = Date.now() - startTime;

            if (code !== 0 && !stdout.trim()) {
                console.error(`[TerfWiki] Process exited with code ${code} after ${elapsed}ms`);
                console.error(`[TerfWiki] stderr: ${stderr.slice(0, 500)}`);
                resolve({
                    success: false,
                    error: `Wiki system error (code ${code})`
                });
                return;
            }

            try {
                // Find potential JSON substring (more robust than regex)
                const start = stdout.indexOf('{');
                const end = stdout.lastIndexOf('}');

                if (start === -1 || end === -1 || start >= end) {
                    throw new Error('No JSON object found in output');
                }

                const jsonStr = stdout.substring(start, end + 1);
                const result = JSON.parse(jsonStr);
                console.log(`[TerfWiki] Query completed in ${elapsed}ms`);
                resolve(result);
            } catch (e) {
                console.error(`[TerfWiki] Failed to parse response: ${e.message}`);
                console.error(`[TerfWiki] stdout: ${stdout.slice(0, 500)}`);
                resolve({
                    success: false,
                    error: 'Failed to parse wiki response'
                });
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timeout);
            console.error(`[TerfWiki] Spawn error: ${err.message}`);
            resolve({
                success: false,
                error: `Failed to start wiki system: ${err.message}`
            });
        });
    });
}

const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Run the wiki updater check
 */
function runUpdate() {
    console.log('[TerfWiki] Checking for wiki updates...');
    const proc = spawn(PYTHON_CMD, ['update.py'], {
        cwd: TERF_WIKI_DIR,
        env: process.env
    });

    proc.stdout.on('data', d => console.log(`[TerfWiki Update] ${d.toString().trim()}`));
    proc.stderr.on('data', d => console.error(`[TerfWiki Update] ${d.toString().trim()}`));

    proc.on('close', code => {
        if (code !== 0) console.error(`[TerfWiki Update] Process failed with code ${code}`);
    });
}

// Start scheduler
setInterval(runUpdate, UPDATE_INTERVAL_MS);

// Run initial check on startup (after a slight delay to allow bot startup)
setTimeout(runUpdate, 60000);

module.exports = { query, runUpdate };
