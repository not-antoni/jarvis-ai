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
                    return result.result;
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
}

module.exports = new RapGenerator();
