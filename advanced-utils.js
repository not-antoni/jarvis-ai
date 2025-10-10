/**
 * Advanced Utilities Service
 * Additional features that work without external APIs
 */

const crypto = require('crypto');
const { createCanvas } = require('canvas');

class AdvancedUtilsService {
    constructor() {
        this.emojiMap = new Map();
        this.initializeEmojiMap();
    }

    initializeEmojiMap() {
        // Common emoji mappings
        this.emojiMap.set('happy', '😊');
        this.emojiMap.set('sad', '😢');
        this.emojiMap.set('angry', '😠');
        this.emojiMap.set('love', '❤️');
        this.emojiMap.set('fire', '🔥');
        this.emojiMap.set('star', '⭐');
        this.emojiMap.set('thumbsup', '👍');
        this.emojiMap.set('thumbsdown', '👎');
        this.emojiMap.set('party', '🎉');
        this.emojiMap.set('money', '💰');
        this.emojiMap.set('rocket', '🚀');
        this.emojiMap.set('brain', '🧠');
        this.emojiMap.set('heart', '❤️');
        this.emojiMap.set('smile', '😀');
        this.emojiMap.set('laugh', '😂');
        this.emojiMap.set('wink', '😉');
        this.emojiMap.set('cool', '😎');
        this.emojiMap.set('thinking', '🤔');
        this.emojiMap.set('confused', '😕');
        this.emojiMap.set('shock', '😱');
        this.emojiMap.set('sleepy', '😴');
    }

    // Text Analysis
    analyzeText(text) {
        const words = text.split(/\s+/).filter(word => word.length > 0);
        const chars = text.split('');
        const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        
        // Count different types of characters
        const letters = chars.filter(c => /[a-zA-Z]/.test(c)).length;
        const digits = chars.filter(c => /[0-9]/.test(c)).length;
        const spaces = chars.filter(c => /\s/.test(c)).length;
        const punctuation = chars.filter(c => /[.,!?;:]/.test(c)).length;
        const symbols = chars.filter(c => /[^a-zA-Z0-9\s.,!?;:]/.test(c)).length;
        
        // Calculate readability metrics
        const avgWordsPerSentence = words.length / sentences.length || 0;
        const avgSyllablesPerWord = this.calculateAvgSyllables(words);
        const fleschScore = this.calculateFleschScore(avgWordsPerSentence, avgSyllablesPerWord);
        
        return {
            stats: {
                characters: chars.length,
                letters: letters,
                digits: digits,
                spaces: spaces,
                punctuation: punctuation,
                symbols: symbols,
                words: words.length,
                sentences: sentences.length,
                paragraphs: paragraphs.length,
                uniqueWords: new Set(words.map(w => w.toLowerCase())).size
            },
            readability: {
                avgWordsPerSentence: Math.round(avgWordsPerSentence * 100) / 100,
                avgSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
                fleschScore: Math.round(fleschScore * 100) / 100,
                readingLevel: this.getReadingLevel(fleschScore)
            },
            words: {
                longest: words.reduce((a, b) => a.length > b.length ? a : b, ''),
                shortest: words.reduce((a, b) => a.length < b.length ? a : b, words[0] || ''),
                averageLength: Math.round((words.reduce((sum, word) => sum + word.length, 0) / words.length) * 100) / 100
            }
        };
    }

    calculateAvgSyllables(words) {
        let totalSyllables = 0;
        words.forEach(word => {
            totalSyllables += this.countSyllables(word.toLowerCase());
        });
        return totalSyllables / words.length || 0;
    }

    countSyllables(word) {
        if (!word) return 0;
        
        // Remove punctuation
        word = word.replace(/[^a-zA-Z]/g, '');
        
        // Handle common exceptions
        if (word.length <= 3) return 1;
        
        // Count vowel groups
        const vowels = 'aeiouy';
        let syllables = 0;
        let prevWasVowel = false;
        
        for (let i = 0; i < word.length; i++) {
            const isVowel = vowels.includes(word[i]);
            if (isVowel && !prevWasVowel) {
                syllables++;
            }
            prevWasVowel = isVowel;
        }
        
        // Handle silent e
        if (word.endsWith('e') && syllables > 1) {
            syllables--;
        }
        
        return Math.max(1, syllables);
    }

    calculateFleschScore(avgWordsPerSentence, avgSyllablesPerWord) {
        return 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
    }

    getReadingLevel(fleschScore) {
        if (fleschScore >= 90) return 'Very Easy (5th grade)';
        if (fleschScore >= 80) return 'Easy (6th grade)';
        if (fleschScore >= 70) return 'Fairly Easy (7th grade)';
        if (fleschScore >= 60) return 'Standard (8th-9th grade)';
        if (fleschScore >= 50) return 'Fairly Difficult (10th-12th grade)';
        if (fleschScore >= 30) return 'Difficult (College level)';
        return 'Very Difficult (Graduate level)';
    }

    // Password Strength Analysis
    analyzePasswordStrength(password) {
        const length = password.length;
        let score = 0;
        let feedback = [];
        
        // Length scoring
        if (length >= 8) score += 1;
        if (length >= 12) score += 1;
        if (length >= 16) score += 1;
        
        // Character variety scoring
        if (/[a-z]/.test(password)) score += 1;
        else feedback.push('Add lowercase letters');
        
        if (/[A-Z]/.test(password)) score += 1;
        else feedback.push('Add uppercase letters');
        
        if (/[0-9]/.test(password)) score += 1;
        else feedback.push('Add numbers');
        
        if (/[^A-Za-z0-9]/.test(password)) score += 1;
        else feedback.push('Add special characters');
        
        // Common patterns penalty
        if (/(.)\1{2,}/.test(password)) {
            score -= 1;
            feedback.push('Avoid repeated characters');
        }
        
        if (/123|abc|qwe/i.test(password)) {
            score -= 1;
            feedback.push('Avoid sequential patterns');
        }
        
        // Common passwords check
        const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein'];
        if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
            score -= 2;
            feedback.push('Avoid common passwords');
        }
        
        // Calculate entropy
        const charsetSize = this.getCharsetSize(password);
        const entropy = Math.log2(Math.pow(charsetSize, length));
        
        const levels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
        const strength = levels[Math.max(0, Math.min(score, levels.length - 1))];
        
        return {
            score: Math.max(0, score),
            strength: strength,
            entropy: Math.round(entropy * 100) / 100,
            feedback: feedback,
            timeToCrack: this.estimateCrackTime(entropy)
        };
    }

    getCharsetSize(password) {
        let size = 0;
        if (/[a-z]/.test(password)) size += 26;
        if (/[A-Z]/.test(password)) size += 26;
        if (/[0-9]/.test(password)) size += 10;
        if (/[^A-Za-z0-9]/.test(password)) size += 32; // Approximate special chars
        return size;
    }

    estimateCrackTime(entropy) {
        // Assuming 1 billion guesses per second
        const guessesPerSecond = 1e9;
        const seconds = Math.pow(2, entropy) / guessesPerSecond;
        
        if (seconds < 1) return 'Less than a second';
        if (seconds < 60) return `${Math.round(seconds)} seconds`;
        if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
        if (seconds < 86400) return `${Math.round(seconds / 3600)} hours`;
        if (seconds < 31536000) return `${Math.round(seconds / 86400)} days`;
        return `${Math.round(seconds / 31536000)} years`;
    }

    // Color Utilities
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    rgbToHsl(r, g, b) {
        r /= 255;
        g /= 255;
        b /= 255;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s, l = (max + min) / 2;
        
        if (max === min) {
            h = s = 0; // achromatic
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        
        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100)
        };
    }

    // Generate color palette from a base color
    generateColorPalette(baseColor, count = 5) {
        const rgb = this.hexToRgb(baseColor);
        if (!rgb) return null;
        
        const hsl = this.rgbToHsl(rgb.r, rgb.g, rgb.b);
        const colors = [];
        
        for (let i = 0; i < count; i++) {
            const hue = (hsl.h + (i * 360 / count)) % 360;
            const saturation = Math.max(20, Math.min(100, hsl.s + (Math.random() - 0.5) * 40));
            const lightness = Math.max(20, Math.min(80, hsl.l + (Math.random() - 0.5) * 40));
            
            const newRgb = this.hslToRgb(hue, saturation, lightness);
            colors.push({
                hex: this.rgbToHex(newRgb.r, newRgb.g, newRgb.b),
                rgb: newRgb,
                hsl: { h: hue, s: saturation, l: lightness }
            });
        }
        
        return colors;
    }

    hslToRgb(h, s, l) {
        h /= 360;
        s /= 100;
        l /= 100;
        
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        let r, g, b;
        
        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        return {
            r: Math.round(r * 255),
            g: Math.round(g * 255),
            b: Math.round(b * 255)
        };
    }

    // Text Transformations
    transformText(text, transformation) {
        switch (transformation.toLowerCase()) {
            case 'uppercase':
                return text.toUpperCase();
            case 'lowercase':
                return text.toLowerCase();
            case 'titlecase':
                return text.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
            case 'camelcase':
                return text.replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toLowerCase() : word.toUpperCase()).replace(/\s+/g, '');
            case 'snakecase':
                return text.toLowerCase().replace(/\s+/g, '_');
            case 'kebabcase':
                return text.toLowerCase().replace(/\s+/g, '-');
            case 'pascalcase':
                return text.replace(/(?:^\w|[A-Z]|\b\w)/g, word => word.toUpperCase()).replace(/\s+/g, '');
            case 'reverse':
                return text.split('').reverse().join('');
            case 'spongebob':
                return text.split('').map((char, i) => i % 2 === 0 ? char.toLowerCase() : char.toUpperCase()).join('');
            case 'vaporwave':
                return text.toUpperCase().split('').join(' ');
            case 'clap':
                return text.split(' ').join(' 👏 ');
            case 'emoji':
                return this.addRandomEmojis(text);
            default:
                return text;
        }
    }

    addRandomEmojis(text) {
        const emojis = ['😀', '😂', '😊', '😎', '🤔', '😍', '🥳', '🔥', '⭐', '💯', '🚀', '❤️'];
        return text.split('').map(char => char + (Math.random() < 0.1 ? emojis[Math.floor(Math.random() * emojis.length)] : '')).join('');
    }

    // QR Code Generator (simple text-based)
    generateQRCodeText(text) {
        // This is a simplified ASCII QR-like representation
        const lines = [];
        const size = 21; // Standard QR code size
        
        for (let y = 0; y < size; y++) {
            let line = '';
            for (let x = 0; x < size; x++) {
                // Simple pattern based on text hash
                const hash = crypto.createHash('md5').update(text + x + y).digest('hex');
                line += parseInt(hash[0], 16) % 2 === 0 ? '██' : '  ';
            }
            lines.push(line);
        }
        
        return lines.join('\n');
    }

    // ASCII Art Generator
    generateASCIIArt(text, style = 'block') {
        const styles = {
            block: ['█', '▄', '▀', '▓', '▒', '░'],
            line: ['─', '│', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼'],
            star: ['★', '☆', '✦', '✧', '✩', '✪', '✫', '✬', '✭', '✮', '✯', '✰'],
            dot: ['●', '○', '◎', '◉', '◯', '◐', '◑', '◒', '◓']
        };
        
        const chars = styles[style] || styles.block;
        let result = '';
        
        for (const char of text) {
            if (char === ' ') {
                result += '  ';
            } else {
                const randomChar = chars[Math.floor(Math.random() * chars.length)];
                result += randomChar + ' ';
            }
        }
        
        return result.trim();
    }

    // URL Shortener (mock)
    generateShortUrl(url) {
        const shortCode = crypto.randomBytes(4).toString('hex');
        return {
            original: url,
            short: `https://jarvis.ly/${shortCode}`,
            code: shortCode
        };
    }

    // Base Converter
    convertBase(number, fromBase, toBase) {
        const num = parseInt(number, fromBase);
        return num.toString(toBase);
    }

    // Number System Converter
    convertNumber(number, fromSystem, toSystem) {
        const systems = {
            decimal: 10,
            binary: 2,
            octal: 8,
            hexadecimal: 16,
            roman: 'roman'
        };
        
        const from = systems[fromSystem.toLowerCase()];
        const to = systems[toSystem.toLowerCase()];
        
        if (to === 'roman') {
            return this.toRomanNumeral(parseInt(number, from));
        }
        
        if (from === 'roman') {
            return parseInt(this.fromRomanNumeral(number), to).toString(to);
        }
        
        return this.convertBase(number, from, to);
    }

    toRomanNumeral(num) {
        const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
        const symbols = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
        
        let result = '';
        for (let i = 0; i < values.length; i++) {
            while (num >= values[i]) {
                result += symbols[i];
                num -= values[i];
            }
        }
        return result;
    }

    fromRomanNumeral(roman) {
        const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
        let result = 0;
        
        for (let i = 0; i < roman.length; i++) {
            if (i + 1 < roman.length && values[roman[i]] < values[roman[i + 1]]) {
                result -= values[roman[i]];
            } else {
                result += values[roman[i]];
            }
        }
        
        return result;
    }

    // Word Frequency Analysis
    analyzeWordFrequency(text) {
        const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(word => word.length > 0);
        const frequency = {};
        
        words.forEach(word => {
            frequency[word] = (frequency[word] || 0) + 1;
        });
        
        const sorted = Object.entries(frequency)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 20);
        
        return {
            totalWords: words.length,
            uniqueWords: Object.keys(frequency).length,
            topWords: sorted.map(([word, count]) => ({ word, count, percentage: ((count / words.length) * 100).toFixed(2) }))
        };
    }

    // Text Similarity
    calculateSimilarity(text1, text2) {
        const words1 = new Set(text1.toLowerCase().split(/\s+/));
        const words2 = new Set(text2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(x => words2.has(x)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size;
    }

    // Cleanup function
    cleanup() {
        // Clean up any resources if needed
        console.log('Advanced utils cleanup completed');
    }
}

module.exports = new AdvancedUtilsService();
