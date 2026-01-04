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
                // Find JSON in stdout (may have other output before it)
                const jsonMatch = stdout.match(/\{[\s\S]*\}$/);
                if (!jsonMatch) {
                    throw new Error('No JSON found in output');
                }

                const result = JSON.parse(jsonMatch[0]);
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

module.exports = { query };
