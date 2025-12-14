'use strict';

require('dotenv').config();

const OpenAI = require('openai');
const { getAIFetch } = require('../src/services/ai-proxy');

async function main() {
    const key = process.env.OPENAI || process.env.OPENAI_API_KEY;
    if (!key) {
        throw new Error('Missing OPENAI or OPENAI_API_KEY env var');
    }

    const aiFetch = getAIFetch();

    const iterations = Number(process.env.AI_PROXY_TEST_ITERATIONS || 5);

    for (let i = 0; i < iterations; i += 1) {
        const res = await aiFetch('https://api.openai.com/v1/models', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${key}`
            }
        });

        const proxy = res.headers.get('x-jarvis-proxy') || 'none';
        const choice = res.headers.get('x-jarvis-proxy-choice') || 'n/a';
        const target = res.headers.get('x-jarvis-proxy-target') || 'n/a';

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(
                `OpenAI models request failed: ${res.status} ${res.statusText} | proxy=${proxy} choice=${choice} target=${target} | ${body.slice(0, 300)}`
            );
        }

        await res.json().catch(() => null);
        console.log(
            `[test-ai-proxy-rotation] ${i + 1}/${iterations}: proxy=${proxy} choice=${choice} target=${target}`
        );
    }

    if (String(process.env.AI_PROXY_TEST_CHAT || '').trim().toLowerCase() === 'true') {
        const client = new OpenAI({
            apiKey: key,
            fetch: aiFetch
        });

        const response = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'ping (chat)' }],
            max_tokens: 10,
            temperature: 0
        });

        const content = response?.choices?.[0]?.message?.content;
        console.log(`[test-ai-proxy-rotation] chat: ${String(content || '').trim()}`);
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
