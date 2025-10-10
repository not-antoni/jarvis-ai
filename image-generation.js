/**
 * Image Generation Service using Hugging Face's free API
 * Supports multiple free image generation models
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class ImageGenerationService {
    constructor() {
        this.huggingFaceToken = process.env.HUGGINGFACE_TOKEN;
        this.models = [
            {
                name: "stabilityai/stable-diffusion-xl-base-1.0",
                endpoint: "https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
                requiresAuth: true
            },
            {
                name: "runwayml/stable-diffusion-v1-5",
                endpoint: "https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5",
                requiresAuth: false
            },
            {
                name: "CompVis/stable-diffusion-v1-4",
                endpoint: "https://api-inference.huggingface.co/models/CompVis/stable-diffusion-v1-4",
                requiresAuth: false
            }
        ];
        this.currentModelIndex = 0;
    }

    async generateImage(prompt, options = {}) {
        try {
            console.log(`Generating image with prompt: "${prompt}"`);
            
            const model = this.models[this.currentModelIndex];
            const payload = {
                inputs: prompt,
                parameters: {
                    num_inference_steps: options.steps || 20,
                    guidance_scale: options.guidance || 7.5,
                    width: options.width || 512,
                    height: options.height || 512
                }
            };

            const headers = {
                'Content-Type': 'application/json'
            };

            if (model.requiresAuth && this.huggingFaceToken) {
                headers['Authorization'] = `Bearer ${this.huggingFaceToken}`;
            }

            const response = await axios.post(model.endpoint, payload, {
                headers,
                responseType: 'arraybuffer',
                timeout: 60000 // 60 seconds timeout
            });

            if (response.status === 200 && response.data) {
                // Process and optimize the image
                const processedImage = await this.processImage(response.data, options);
                return {
                    success: true,
                    imageBuffer: processedImage,
                    model: model.name,
                    prompt: prompt
                };
            } else {
                throw new Error(`Unexpected response status: ${response.status}`);
            }

        } catch (error) {
            console.error('Image generation error:', error.message);
            
            // Try next model if available
            if (this.currentModelIndex < this.models.length - 1) {
                console.log('Trying next model...');
                this.currentModelIndex++;
                return await this.generateImage(prompt, options);
            }
            
            return {
                success: false,
                error: error.message,
                fallback: await this.generateFallbackImage(prompt)
            };
        }
    }

    async processImage(imageBuffer, options = {}) {
        try {
            // Use sharp to optimize and resize the image
            let processed = sharp(imageBuffer);
            
            // Resize if needed
            if (options.maxWidth || options.maxHeight) {
                processed = processed.resize(options.maxWidth || 512, options.maxHeight || 512, {
                    fit: 'inside',
                    withoutEnlargement: true
                });
            }
            
            // Convert to PNG and optimize
            return await processed
                .png({ quality: 90 })
                .toBuffer();
        } catch (error) {
            console.error('Image processing error:', error);
            return imageBuffer; // Return original if processing fails
        }
    }

    async generateFallbackImage(prompt) {
        // Generate a simple text-based image as fallback
        try {
            const { createCanvas, loadImage } = require('canvas');
            
            const width = 512;
            const height = 512;
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');
            
            // Dark background
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(0, 0, width, height);
            
            // Jarvis-style text
            ctx.fillStyle = '#00ff00';
            ctx.font = 'bold 24px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const lines = this.wrapText(ctx, prompt, width - 40);
            const lineHeight = 30;
            const startY = (height - (lines.length * lineHeight)) / 2;
            
            lines.forEach((line, index) => {
                ctx.fillText(line, width / 2, startY + (index * lineHeight));
            });
            
            // Add Jarvis signature
            ctx.font = '16px Arial';
            ctx.fillStyle = '#666666';
            ctx.fillText('Generated by Jarvis AI', width / 2, height - 40);
            
            return canvas.toBuffer('image/png');
        } catch (error) {
            console.error('Fallback image generation failed:', error);
            return null;
        }
    }

    wrapText(ctx, text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + ' ' + word).width;
            if (width < maxWidth) {
                currentLine += ' ' + word;
            } else {
                lines.push(currentLine);
                currentLine = word;
            }
        }
        lines.push(currentLine);
        return lines.slice(0, 5); // Limit to 5 lines
    }

    async generateVariation(baseImageBuffer, prompt, options = {}) {
        try {
            // This would require img2img models which are less common in free APIs
            // For now, we'll generate a new image with modified prompt
            const variationPrompt = `${prompt}, artistic variation, different style`;
            return await this.generateImage(variationPrompt, options);
        } catch (error) {
            console.error('Image variation error:', error);
            return { success: false, error: error.message };
        }
    }

    async upscaleImage(imageBuffer, scale = 2) {
        try {
            const processed = await sharp(imageBuffer)
                .resize({ 
                    width: Math.round(512 * scale), 
                    height: Math.round(512 * scale),
                    kernel: sharp.kernel.lanczos3
                })
                .png({ quality: 95 })
                .toBuffer();
            
            return {
                success: true,
                imageBuffer: processed,
                scale: scale
            };
        } catch (error) {
            console.error('Image upscaling error:', error);
            return { success: false, error: error.message };
        }
    }

    getAvailableModels() {
        return this.models.map(model => ({
            name: model.name,
            requiresAuth: model.requiresAuth,
            endpoint: model.endpoint
        }));
    }

    setModel(index) {
        if (index >= 0 && index < this.models.length) {
            this.currentModelIndex = index;
            return true;
        }
        return false;
    }

    getCurrentModel() {
        return this.models[this.currentModelIndex];
    }
}

module.exports = new ImageGenerationService();
