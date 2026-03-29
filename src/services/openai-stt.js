'use strict';

const OpenAI = require('openai');
const { toFile } = require('openai');

const DEFAULT_MODEL = 'gpt-4o-transcribe';
const DEFAULT_LANGUAGE = 'en';

class OpenAISttService {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI || '';
        this.model = (process.env.OPENAI_STT_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
        this.language = (process.env.OPENAI_STT_LANGUAGE || DEFAULT_LANGUAGE).trim() || DEFAULT_LANGUAGE;
        this.client = this.apiKey ? new OpenAI({ apiKey: this.apiKey }) : null;
    }

    get enabled() {
        return Boolean(this.client);
    }

    async transcribe(wavBuffer, context = {}) {
        if (!this.client || !wavBuffer?.length) {
            return null;
        }

        const startedAt = Date.now();
        const tag = context.tag ? ` tag=${context.tag}` : '';
        try {
            const file = await toFile(wavBuffer, context.filename || 'voice-chat.wav');
            const response = await this.client.audio.transcriptions.create({
                file,
                model: this.model,
                language: this.language,
                response_format: 'json',
                temperature: 0
            });

            const ms = Date.now() - startedAt;
            const usage = response?.usage;
            const usageSummary = usage?.type === 'duration'
                ? ` seconds=${usage.seconds}`
                : usage?.type === 'tokens'
                    ? ` inputTokens=${usage.input_tokens} outputTokens=${usage.output_tokens}`
                    : '';
            console.log(`[OpenAIStt] OK ${ms}ms model=${this.model}${tag}${usageSummary}`);

            return response?.text?.trim() || null;
        } catch (error) {
            const ms = Date.now() - startedAt;
            console.error(`[OpenAIStt] Failed ${ms}ms model=${this.model}${tag}:`, error?.message || error);
            return null;
        }
    }
}

module.exports = new OpenAISttService();
