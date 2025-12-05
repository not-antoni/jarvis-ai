/**
 * Rap Generator Client
 * Uses AskYourPDF's rap generator API
 */

const fetch = require('node-fetch');

class RapGenerator {
    constructor() {
        this.baseUrl = 'https://tools.askyourpdf.com/job/generate';
        this.pollInterval = 1000; // 1 second
        this.maxRetries = 30; // 30 seconds max wait
    }

    /**
     * Generate a rap based on input text
     * @param {string} text - The input/topic for the rap
     * @param {number} temperature - Model temperature (0-1), higher = more creative
     * @returns {Promise<string>} Generated rap text
     */
    async generate(text, temperature = 1) {
        try {
            // Submit the job
            const jobResponse = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-site'
                },
                body: JSON.stringify({
                    action: 'RAP_GENERATOR',
                    text: text,
                    parameters: {},
                    model_temperature: temperature
                })
            });

            if (!jobResponse.ok) {
                throw new Error(`Failed to submit job: ${jobResponse.status}`);
            }

            const jobData = await jobResponse.json();
            const jobId = jobData.job_id;

            if (!jobId) {
                throw new Error('No job ID returned');
            }

            // Poll for result
            for (let i = 0; i < this.maxRetries; i++) {
                await this.sleep(this.pollInterval);

                const resultResponse = await fetch(`${this.baseUrl}/${jobId}`, {
                    method: 'GET',
                    headers: {
                        'accept': 'application/json, text/plain, */*',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-site'
                    }
                });

                if (!resultResponse.ok) {
                    continue; // Retry
                }

                const result = await resultResponse.json();

                if (result.status === 'COMPLETED' && result.result) {
                    // Filter the result to extract just the rap lines
                    return this.filterRapOutput(result.result);
                } else if (result.status === 'FAILED') {
                    throw new Error('Rap generation failed');
                }
                // Still processing, continue polling
            }

            throw new Error('Timeout waiting for rap generation');
        } catch (error) {
            console.error('Rap generator error:', error);
            throw error;
        }
    }

    /**
     * Generate a diss rap targeting someone
     * @param {string} target - Name/description of target
     * @returns {Promise<string>}
     */
    async generateDiss(target) {
        const prompts = [
            `roast ${target} in a rap battle`,
            `diss ${target} with fire bars`,
            `destroy ${target} in a rap`,
            `${target} thinks they can rap but they cant`,
            `${target} is weak sauce roast them`
        ];
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        return this.generate(prompt, 1);
    }

    /**
     * Generate comeback lines for the database
     * @param {number} count - Number of lines to generate
     * @returns {Promise<string[]>}
     */
    async generateComebacks(count = 5) {
        const themes = [
            'roast a weak rapper who thinks theyre good',
            'diss someone with no skills',
            'destroy a noob in a rap battle',
            'fire bars for a rap battle',
            'insult a wannabe rapper',
            'comeback lines for rap battles',
            'AI robot roasting humans in rap'
        ];

        const lines = [];
        for (let i = 0; i < count; i++) {
            try {
                const theme = themes[Math.floor(Math.random() * themes.length)];
                const rap = await this.generate(theme, 1);
                
                // Extract individual lines
                const extracted = rap
                    .split('\n')
                    .map(l => l.trim())
                    .filter(l => l.length > 10 && !l.startsWith('[') && !l.startsWith('*'));
                
                lines.push(...extracted);
                
                // Small delay between requests
                await this.sleep(500);
            } catch (e) {
                console.error('Failed to generate comeback:', e);
            }
        }

        return lines;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Filter rap output to extract just the lines
     * Removes intro text, section headers, and other noise
     * @param {string} rawOutput - Raw output from the API
     * @returns {string} Clean rap lines
     */
    filterRapOutput(rawOutput) {
        if (!rawOutput || typeof rawOutput !== 'string') {
            return rawOutput;
        }

        const lines = rawOutput.split('\n');
        const cleanLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip empty lines
            if (!trimmed) continue;
            
            // Skip common intro phrases
            const skipPatterns = [
                /^here'?s?\s+(a\s+)?rap/i,
                /^let'?s?\s+get/i,
                /^this\s+verse/i,
                /^note:/i,
                /^parameters?:/i,
                /^selecttype/i,
                /^selectbesttempo/i,
                /^complexity/i,
                /^language/i,
                /^\*\s*\w+:/i,  // * Parameter:
                /^the\s+rap\s+verse/i,
                /^i'?n?\s+this\s+rap/i,
                /^this\s+incorporates/i,
                /^featuring/i
            ];
            
            let shouldSkip = false;
            for (const pattern of skipPatterns) {
                if (pattern.test(trimmed)) {
                    shouldSkip = true;
                    break;
                }
            }
            if (shouldSkip) continue;
            
            // Skip section headers like [Verse 1:] or [Chorus:]
            if (/^\[.+\]:?$/i.test(trimmed)) continue;
            
            // Skip asterisk-wrapped text (stage directions)
            if (/^\*[^*]+\*$/.test(trimmed)) continue;
            
            // Extract content from quoted lines if present
            const quoteMatch = trimmed.match(/^[""](.+)[""]$/);
            if (quoteMatch) {
                cleanLines.push(quoteMatch[1]);
                continue;
            }
            
            // Add valid lines (actual rap content)
            if (trimmed.length > 10) {
                cleanLines.push(trimmed);
            }
        }

        return cleanLines.join('\n');
    }

    /**
     * Extract individual comeback lines from filtered rap
     * @param {string} filteredRap - Filtered rap output
     * @returns {string[]} Array of individual lines
     */
    extractLines(filteredRap) {
        if (!filteredRap) return [];
        
        return filteredRap
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 15 && l.length < 200);
    }
}

module.exports = new RapGenerator();
