/**
 * Free APIs Service - No authentication required
 * Optimized for Render free tier
 */

const axios = require('axios');

class FreeAPIsService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
        this.rateLimits = new Map(); // Track API rate limits
        this.setupRateLimits();
    }

    setupRateLimits() {
        // Set up rate limiting for APIs with restrictions
        this.rateLimits.set('ip-api.com', {
            requests: 0,
            resetTime: Date.now() + 60000, // 1 minute window
            maxRequests: 45 // 45 requests per minute
        });
        
        this.rateLimits.set('quotable.io', {
            requests: 0,
            resetTime: Date.now() + 3600000, // 1 hour window
            maxRequests: 100 // Conservative limit
        });
    }

    checkRateLimit(apiName) {
        const limit = this.rateLimits.get(apiName);
        if (!limit) return true; // No limit set

        // Reset counter if window expired
        if (Date.now() > limit.resetTime) {
            limit.requests = 0;
            limit.resetTime = Date.now() + (apiName === 'ip-api.com' ? 60000 : 3600000);
        }

        return limit.requests < limit.maxRequests;
    }

    incrementRateLimit(apiName) {
        const limit = this.rateLimits.get(apiName);
        if (limit) {
            limit.requests++;
        }
    }

    // Random Image APIs (No keys required)
    async getRandomImage(category = 'nature', width = 800, height = 600) {
        const cacheKey = `image_${category}_${width}_${height}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
        // Removed deprecated source.unsplash.com - using only reliable APIs
        const imageUrls = [
            `https://picsum.photos/${width}/${height}?random=${Date.now()}`,
            `https://picsum.photos/seed/${category}/${width}/${height}`,
            `https://via.placeholder.com/${width}x${height}/333/fff?text=${category}`,
            `https://picsum.photos/${width}/${height}?blur=2`,
            `https://picsum.photos/${width}/${height}?grayscale`
        ];

            const randomUrl = imageUrls[Math.floor(Math.random() * imageUrls.length)];
            
            const result = {
                url: randomUrl,
                category: category,
                dimensions: { width, height },
                source: 'Free Image API',
                timestamp: new Date().toISOString()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Random image error:', error);
            return {
                url: `https://via.placeholder.com/${width}x${height}/333/fff?text=Error`,
                category: category,
                dimensions: { width, height },
                source: 'Fallback',
                error: error.message
            };
        }
    }

    // Free Weather API (No key required)
    async getWeatherFree(location) {
        const cacheKey = `weather_free_${location}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            // Using wttr.in - completely free, no API key needed
            const response = await axios.get(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Jarvis-Discord-Bot'
                }
            });

            if (response.data && response.data.current_condition) {
                const data = response.data.current_condition[0];
                const location = response.data.nearest_area[0];

                const result = {
                    location: `${location.areaName[0].value}, ${location.country[0].value}`,
                    temperature: `${data.temp_C}°C (${data.temp_F}°F)`,
                    condition: data.weatherDesc[0].value,
                    humidity: `${data.humidity}%`,
                    windSpeed: `${data.windspeedKmph} km/h`,
                    pressure: `${data.pressure} mb`,
                    feelsLike: `${data.FeelsLikeC}°C`,
                    uvIndex: data.uvIndex,
                    timestamp: new Date().toISOString()
                };

                this.setCache(cacheKey, result);
                return result;
            }
        } catch (error) {
            console.error('Free weather API error:', error);
        }

        // Fallback to simple text weather
        try {
            const response = await axios.get(`https://wttr.in/${encodeURIComponent(location)}?format=3`, {
                timeout: 10000
            });
            
            return {
                location: location,
                simple: response.data.trim(),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                location: location,
                error: 'Weather service unavailable',
                fallback: `Weather in ${location}: Data unavailable`
            };
        }
    }

    // Free Quote API (Enhanced with rate limiting)
    async getRandomQuote() {
        const cacheKey = 'random_quote';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        // Check rate limit
        if (!this.checkRateLimit('quotable.io')) {
            console.log('Quote API rate limited, using fallback');
            return this.getFallbackQuote();
        }

        try {
            const response = await axios.get('https://api.quotable.io/random', { 
                timeout: 5000,
                headers: {
                    'User-Agent': 'Jarvis-Discord-Bot/1.0'
                }
            });
            
            this.incrementRateLimit('quotable.io');
            
            const result = {
                text: response.data.content,
                author: response.data.author,
                length: response.data.length,
                tags: response.data.tags,
                timestamp: new Date().toISOString()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Quote API error:', error);
            return this.getFallbackQuote();
        }
    }

    getFallbackQuote() {
        const fallbackQuotes = [
            { text: "The best way to predict the future is to create it.", author: "Peter Drucker" },
            { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
            { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
            { text: "Stay hungry, stay foolish.", author: "Steve Jobs" },
            { text: "Your time is limited, don't waste it living someone else's life.", author: "Steve Jobs" },
            { text: "I am Iron Man.", author: "Tony Stark" },
            { text: "Sometimes you gotta run before you can walk.", author: "Tony Stark" },
            { text: "Genius, billionaire, playboy, philanthropist.", author: "Tony Stark" }
        ];
        
        const randomQuote = fallbackQuotes[Math.floor(Math.random() * fallbackQuotes.length)];
        return {
            ...randomQuote,
            fallback: true,
            timestamp: new Date().toISOString()
        };
    }

    // Free Joke API
    async getRandomJoke() {
        const cacheKey = 'random_joke';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const response = await axios.get('https://official-joke-api.appspot.com/random_joke', { timeout: 5000 });
            
            const result = {
                setup: response.data.setup,
                punchline: response.data.punchline,
                type: response.data.type,
                timestamp: new Date().toISOString()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Joke API error:', error);
            return {
                setup: "Why don't scientists trust atoms?",
                punchline: "Because they make up everything!",
                fallback: true
            };
        }
    }

    // Free Cat Facts API
    async getCatFact() {
        const cacheKey = 'cat_fact';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const response = await axios.get('https://catfact.ninja/fact', { timeout: 5000 });
            
            const result = {
                fact: response.data.fact,
                length: response.data.length,
                timestamp: new Date().toISOString()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Cat fact API error:', error);
            return {
                fact: "Cats spend 70% of their lives sleeping.",
                fallback: true
            };
        }
    }

    // Free Dog Images API
    async getRandomDog() {
        const cacheKey = 'random_dog';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        try {
            const response = await axios.get('https://dog.ceo/api/breeds/image/random', { timeout: 5000 });
            
            const result = {
                imageUrl: response.data.message,
                breed: this.extractBreedFromUrl(response.data.message),
                status: response.data.status,
                timestamp: new Date().toISOString()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Dog API error:', error);
            return {
                imageUrl: 'https://images.dog.ceo/breeds/retriever-golden/n02099601_1004.jpg',
                breed: 'Golden Retriever',
                fallback: true
            };
        }
    }

    // Free Cat Images API (Fixed - No Authentication Required)
    async getRandomCat() {
        const cacheKey = 'random_cat';
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        // Use free alternatives that don't require API keys
        const freeCatAPIs = [
            'https://cataas.com/cat',
            'https://cataas.com/cat/gif',
            'https://placekitten.com/400/400',
            'https://placekitten.com/500/500',
            'https://placekitten.com/600/400'
        ];

        try {
            // Try cataas.com API first (completely free)
            const response = await axios.get('https://cataas.com/cat', { 
                timeout: 5000,
                maxRedirects: 0,
                validateStatus: (status) => status === 302 // Expect redirect to actual image
            });
            
            const result = {
                imageUrl: 'https://cataas.com/cat',
                source: 'Cataas API',
                timestamp: new Date().toISOString()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error('Cat API error, using fallback:', error);
            
            // Fallback to random free image
            const fallbackUrl = freeCatAPIs[Math.floor(Math.random() * freeCatAPIs.length)];
            return {
                imageUrl: fallbackUrl,
                source: 'Fallback',
                timestamp: new Date().toISOString()
            };
        }
    }

    // Free IP Information API (Enhanced with rate limiting)
    async getIPInfo(ip = null) {
        const cacheKey = `ip_${ip || 'current'}`;
        const cached = this.getCached(cacheKey);
        if (cached) return cached;

        // Check rate limit
        if (!this.checkRateLimit('ip-api.com')) {
            console.log('IP API rate limited, using fallback');
            return {
                ip: ip || 'Unknown',
                country: 'Rate Limited',
                region: 'API Limit Reached',
                city: 'Try Again Later',
                error: 'Rate limit exceeded, please try again in a minute',
                timestamp: new Date().toISOString()
            };
        }

        try {
            const url = ip ? `http://ip-api.com/json/${ip}` : 'http://ip-api.com/json/';
            const response = await axios.get(url, { 
                timeout: 10000,
                headers: {
                    'User-Agent': 'Jarvis-Discord-Bot/1.0'
                }
            });
            
            this.incrementRateLimit('ip-api.com');
            
            const result = {
                ip: response.data.query,
                country: response.data.country,
                region: response.data.regionName,
                city: response.data.city,
                timezone: response.data.timezone,
                isp: response.data.isp,
                org: response.data.org,
                as: response.data.as,
                lat: response.data.lat,
                lon: response.data.lon,
                timestamp: new Date().toISOString()
            };

            this.setCache(cacheKey, result);
            return result;
        } catch (error) {
            console.error('IP info API error:', error);
            return { 
                ip: ip || 'Unknown',
                error: 'IP information unavailable',
                timestamp: new Date().toISOString()
            };
        }
    }

    // Free UUID Generator
    async generateUUID() {
        return {
            uuid: require('crypto').randomUUID(),
            timestamp: new Date().toISOString()
        };
    }

    // Free Password Generator
    async generatePassword(length = 12, options = {}) {
        const chars = {
            lowercase: 'abcdefghijklmnopqrstuvwxyz',
            uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            numbers: '0123456789',
            symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
        };

        let charset = '';
        if (options.lowercase !== false) charset += chars.lowercase;
        if (options.uppercase !== false) charset += chars.uppercase;
        if (options.numbers !== false) charset += chars.numbers;
        if (options.symbols) charset += chars.symbols;

        let password = '';
        for (let i = 0; i < length; i++) {
            password += charset.charAt(Math.floor(Math.random() * charset.length));
        }

        return {
            password: password,
            length: length,
            options: options,
            strength: this.calculatePasswordStrength(password),
            timestamp: new Date().toISOString()
        };
    }

    // Free Color Palette Generator
    async generateColorPalette() {
        const colors = [];
        for (let i = 0; i < 5; i++) {
            colors.push({
                hex: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
                rgb: this.hexToRgb('#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'))
            });
        }

        return {
            colors: colors,
            timestamp: new Date().toISOString()
        };
    }

    // Free Lorem Ipsum Generator
    async generateLoremIpsum(paragraphs = 1, wordsPerParagraph = 50) {
        const loremWords = [
            'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
            'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
            'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
            'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
            'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
            'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
            'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
            'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum'
        ];

        let result = '';
        for (let p = 0; p < paragraphs; p++) {
            let paragraph = '';
            for (let w = 0; w < wordsPerParagraph; w++) {
                const word = loremWords[Math.floor(Math.random() * loremWords.length)];
                paragraph += (w === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word) + ' ';
            }
            result += paragraph.trim() + '\n\n';
        }

        return {
            text: result.trim(),
            paragraphs: paragraphs,
            wordsPerParagraph: wordsPerParagraph,
            timestamp: new Date().toISOString()
        };
    }

    // Utility Functions
    extractBreedFromUrl(url) {
        const parts = url.split('/');
        const breedPart = parts[parts.length - 2];
        return breedPart ? breedPart.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown';
    }

    calculatePasswordStrength(password) {
        let score = 0;
        if (password.length >= 8) score += 1;
        if (password.length >= 12) score += 1;
        if (/[a-z]/.test(password)) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/[0-9]/.test(password)) score += 1;
        if (/[^A-Za-z0-9]/.test(password)) score += 1;

        const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
        return levels[Math.min(score, levels.length - 1)];
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    getCached(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.cache.clear();
    }

    getCacheStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}

module.exports = new FreeAPIsService();
