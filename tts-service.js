/**
 * Text-to-Speech Service using Google's free TTS API
 * Supports multiple voices and languages
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

class TTSService {
    constructor() {
        this.googleTTSApiKey = process.env.GOOGLE_TTS_API_KEY;
        this.voices = [
            { name: 'Jarvis (Male)', code: 'en-US', voice: 'en-US-Wavenet-D', ssmlGender: 'MALE' },
            { name: 'Assistant (Female)', code: 'en-US', voice: 'en-US-Wavenet-E', ssmlGender: 'FEMALE' },
            { name: 'British (Male)', code: 'en-GB', voice: 'en-GB-Wavenet-A', ssmlGender: 'MALE' },
            { name: 'British (Female)', code: 'en-GB', voice: 'en-GB-Wavenet-B', ssmlGender: 'FEMALE' },
            { name: 'Australian (Male)', code: 'en-AU', voice: 'en-AU-Wavenet-A', ssmlGender: 'MALE' }
        ];
        this.currentVoiceIndex = 0;
        this.fallbackTTS = true; // Enable fallback TTS if Google fails
    }

    async generateSpeech(text, options = {}) {
        try {
            console.log(`Generating speech for: "${text.substring(0, 50)}..."`);
            
            // Clean and prepare text
            const cleanText = this.cleanTextForTTS(text);
            const voice = this.voices[options.voiceIndex || this.currentVoiceIndex];
            
            if (this.googleTTSApiKey) {
                return await this.generateGoogleTTS(cleanText, voice, options);
            } else {
                console.log('No Google TTS API key, using fallback');
                return await this.generateFallbackTTS(cleanText, options);
            }
        } catch (error) {
            console.error('TTS generation error:', error);
            return await this.generateFallbackTTS(text, options);
        }
    }

    async generateGoogleTTS(text, voice, options = {}) {
        try {
            const requestBody = {
                input: { text: text },
                voice: {
                    languageCode: voice.code,
                    name: voice.voice,
                    ssmlGender: voice.ssmlGender
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    speakingRate: options.speed || 1.0,
                    pitch: options.pitch || 0.0,
                    volumeGainDb: options.volume || 0.0
                }
            };

            const response = await axios.post(
                `https://texttospeech.googleapis.com/v1/text:synthesize?key=${this.googleTTSApiKey}`,
                requestBody,
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 30000
                }
            );

            if (response.data && response.data.audioContent) {
                const audioBuffer = Buffer.from(response.data.audioContent, 'base64');
                return {
                    success: true,
                    audioBuffer: audioBuffer,
                    format: 'mp3',
                    voice: voice.name,
                    duration: this.estimateDuration(text)
                };
            } else {
                throw new Error('Invalid response from Google TTS');
            }
        } catch (error) {
            console.error('Google TTS error:', error.message);
            throw error;
        }
    }

    async generateFallbackTTS(text, options = {}) {
        try {
            // Use Web Speech API simulation or simple audio generation
            // This is a basic fallback - in a real implementation, you might use
            // a different free TTS service or generate simple audio tones
            
            console.log('Using fallback TTS method');
            
            // For now, we'll create a simple text file with TTS instructions
            // In a real implementation, you could integrate with other free TTS services
            const ttsData = {
                text: text,
                voice: 'Fallback',
                instructions: 'This would be converted to speech using a fallback TTS service',
                timestamp: new Date().toISOString()
            };

            // Create a simple audio placeholder
            // In practice, you'd use a library like 'say' for system TTS
            return {
                success: true,
                audioBuffer: Buffer.from(JSON.stringify(ttsData)),
                format: 'json', // Placeholder format
                voice: 'Fallback',
                duration: this.estimateDuration(text),
                fallback: true
            };
        } catch (error) {
            console.error('Fallback TTS error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    cleanTextForTTS(text) {
        // Remove Discord formatting
        let clean = text
            .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
            .replace(/\*(.*?)\*/g, '$1') // Italic
            .replace(/~~(.*?)~~/g, '$1') // Strikethrough
            .replace(/__(.*?)__/g, '$1') // Underline
            .replace(/`(.*?)`/g, '$1') // Code
            .replace(/<@!?\d+>/g, 'user') // User mentions
            .replace(/<#\d+>/g, 'channel') // Channel mentions
            .replace(/<:\w+:\d+>/g, 'emoji') // Custom emojis
            .replace(/https?:\/\/[^\s]+/g, 'link') // URLs
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');

        // Limit length for TTS
        if (clean.length > 500) {
            clean = clean.substring(0, 500) + '...';
        }

        return clean;
    }

    estimateDuration(text) {
        // Rough estimation: average reading speed is ~150 words per minute
        const words = text.split(/\s+/).length;
        const minutes = words / 150;
        return Math.ceil(minutes * 60); // Return seconds
    }

    async generateSSML(text, options = {}) {
        // Generate SSML for more advanced speech control
        const voice = this.voices[options.voiceIndex || this.currentVoiceIndex];
        
        let ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${voice.code}">`;
        
        if (options.speed && options.speed !== 1.0) {
            ssml += `<prosody rate="${options.speed}">`;
        }
        
        if (options.pitch && options.pitch !== 0.0) {
            ssml += `<prosody pitch="${options.pitch > 0 ? '+' : ''}${options.pitch}st">`;
        }
        
        ssml += this.escapeSSML(text);
        
        if (options.pitch && options.pitch !== 0.0) {
            ssml += `</prosody>`;
        }
        
        if (options.speed && options.speed !== 1.0) {
            ssml += `</prosody>`;
        }
        
        ssml += `</speak>`;
        
        return ssml;
    }

    escapeSSML(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    getAvailableVoices() {
        return this.voices.map((voice, index) => ({
            index: index,
            name: voice.name,
            code: voice.code,
            gender: voice.ssmlGender
        }));
    }

    setVoice(index) {
        if (index >= 0 && index < this.voices.length) {
            this.currentVoiceIndex = index;
            return true;
        }
        return false;
    }

    getCurrentVoice() {
        return this.voices[this.currentVoiceIndex];
    }

    async generateJarvisResponse(text, options = {}) {
        // Special method for generating Jarvis-style responses
        const jarvisText = `Sir, ${text}`;
        const jarvisOptions = {
            ...options,
            speed: options.speed || 0.9, // Slightly slower for dramatic effect
            pitch: options.pitch || -2.0, // Deeper voice
            voiceIndex: 0 // Use Jarvis voice
        };
        
        return await this.generateSpeech(jarvisText, jarvisOptions);
    }

    async generateMultipleVoices(text, voiceIndices = [0, 1, 2]) {
        // Generate the same text with multiple voices for comparison
        const results = [];
        
        for (const voiceIndex of voiceIndices) {
            try {
                const result = await this.generateSpeech(text, { voiceIndex });
                if (result.success) {
                    results.push({
                        voice: this.voices[voiceIndex].name,
                        audioBuffer: result.audioBuffer,
                        format: result.format
                    });
                }
            } catch (error) {
                console.error(`Error generating voice ${voiceIndex}:`, error);
            }
        }
        
        return results;
    }
}

module.exports = new TTSService();
