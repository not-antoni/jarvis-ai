/**
 * Prefix Commands Handler
 * Handles traditional prefix-based commands for additional features
 */

const freeAPIs = require('./free-apis');
const advancedUtils = require('./advanced-utils');
const marvelFeatures = require('./marvel-features');
const interactiveGames = require('./interactive-games');
const { createCanvas } = require('canvas');

class PrefixCommandsHandler {
    constructor() {
        this.commands = new Map();
        this.aliases = new Map();
        this.cooldowns = new Map();
        this.prefix = '!'; // Default prefix
        
        this.initializeCommands();
    }

    initializeCommands() {
        // Image Commands
        this.addCommand('img', this.handleRandomImage, 'Get a random image');
        this.addCommand('image', this.handleRandomImage, 'Get a random image');
        this.addCommand('pic', this.handleRandomImage, 'Get a random image');
        
        // Animal Commands
        this.addCommand('dog', this.handleRandomDog, 'Get a random dog image');
        this.addCommand('cat', this.handleRandomCat, 'Get a random cat image');
        this.addCommand('catfact', this.handleCatFact, 'Get a random cat fact');
        
        // Quote Commands
        this.addCommand('quote', this.handleRandomQuote, 'Get a random inspirational quote');
        this.addCommand('inspire', this.handleRandomQuote, 'Get a random inspirational quote');
        
        // Joke Commands
        this.addCommand('joke', this.handleRandomJoke, 'Get a random joke');
        this.addCommand('laugh', this.handleRandomJoke, 'Get a random joke');
        
        // Utility Commands
        this.addCommand('uuid', this.handleGenerateUUID, 'Generate a UUID');
        this.addCommand('password', this.handleGeneratePassword, 'Generate a secure password');
        this.addCommand('colors', this.handleGenerateColors, 'Generate a random color palette');
        this.addCommand('lorem', this.handleGenerateLorem, 'Generate Lorem Ipsum text');
        
        // Weather Command
        this.addCommand('w', this.handleWeather, 'Get weather for a location');
        this.addCommand('weather', this.handleWeather, 'Get weather for a location');
        
        // IP Command
        this.addCommand('ip', this.handleIPInfo, 'Get IP information');
        this.addCommand('ipinfo', this.handleIPInfo, 'Get IP information');
        
        // Fun Commands
        this.addCommand('8ball', this.handleMagic8Ball, 'Ask the magic 8-ball a question');
        this.addCommand('flip', this.handleCoinFlip, 'Flip a coin');
        this.addCommand('dice', this.handleDiceRoll, 'Roll dice');
        this.addCommand('choose', this.handleChoose, 'Choose between options');
        
        // Text Commands
        this.addCommand('reverse', this.handleReverseText, 'Reverse text');
        this.addCommand('uppercase', this.handleUppercase, 'Convert text to uppercase');
        this.addCommand('lowercase', this.handleLowercase, 'Convert text to lowercase');
        this.addCommand('binary', this.handleBinary, 'Convert text to binary');
        this.addCommand('unbinary', this.handleUnbinary, 'Convert binary to text');
        
        // Math Commands
        this.addCommand('calc', this.handleCalculator, 'Simple calculator');
        this.addCommand('math', this.handleCalculator, 'Simple calculator');
        this.addCommand('prime', this.handlePrimeCheck, 'Check if a number is prime');
        this.addCommand('fibonacci', this.handleFibonacci, 'Generate Fibonacci sequence');
        
        // Time Commands
        this.addCommand('timezone', this.handleTimezone, 'Get time in different timezone');
        this.addCommand('countdown', this.handleCountdown, 'Create a countdown timer');
        
        // ASCII Art Commands
        this.addCommand('ascii', this.handleASCIIArt, 'Generate ASCII art');
        this.addCommand('banner', this.handleASCIIArt, 'Generate ASCII art banner');
        
        // QR Code Command
        this.addCommand('qr', this.handleQRCode, 'Generate QR code');
        
        // Base64 Commands
        this.addCommand('encode', this.handleBase64Encode, 'Encode text to base64');
        this.addCommand('decode', this.handleBase64Decode, 'Decode base64 to text');
        
        // Hash Commands
        this.addCommand('md5', this.handleMD5Hash, 'Generate MD5 hash');
        this.addCommand('sha1', this.handleSHA1Hash, 'Generate SHA1 hash');
        this.addCommand('sha256', this.handleSHA256Hash, 'Generate SHA256 hash');
        
        // Text Analysis Commands
        this.addCommand('analyze', this.handleTextAnalysis, 'Analyze text statistics and readability');
        this.addCommand('analyzetext', this.handleTextAnalysis, 'Analyze text statistics and readability');
        this.addCommand('words', this.handleWordFrequency, 'Analyze word frequency in text');
        this.addCommand('strength', this.handlePasswordStrength, 'Analyze password strength');
        this.addCommand('transform', this.handleTextTransform, 'Transform text (uppercase, lowercase, camelcase, etc.)');
        
        // Color Commands
        this.addCommand('hex', this.handleHexToRgb, 'Convert hex color to RGB');
        this.addCommand('rgb', this.handleRgbToHex, 'Convert RGB to hex color');
        this.addCommand('palette', this.handleColorPalette, 'Generate color palette from base color');
        
        // Number System Commands
        this.addCommand('roman', this.handleRomanNumeral, 'Convert to/from Roman numerals');
        this.addCommand('base', this.handleBaseConvert, 'Convert between number bases');
        
        // Interactive Games
        this.addCommand('rps', this.handleRockPaperScissors, 'Rock Paper Scissors game');
        this.addCommand('guess', this.handleNumberGuess, 'Number guessing game');
        this.addCommand('hangman', this.handleHangman, 'Hangman word game');
        this.addCommand('wordchain', this.handleWordAssociation, 'Word association game');
        this.addCommand('gamestats', this.handleGameStats, 'View your game statistics');
        
        // Marvel Commands
        this.addCommand('suit', this.handleSuitInfo, 'Get Iron Man suit information');
        this.addCommand('suits', this.handleAllSuits, 'List all Iron Man suits');
        this.addCommand('diagnostics', this.handleSuitDiagnostics, 'Run suit diagnostics');
        this.addCommand('stark', this.handleStarkIndustries, 'Get Stark Industries information');
        this.addCommand('arc', this.handleArcReactor, 'Check arc reactor status');
        this.addCommand('avengers', this.handleAvengersStatus, 'Check Avengers team status');
        this.addCommand('malibu', this.handleMalibuWeather, 'Get Malibu weather (Stark Mansion)');
        this.addCommand('mcu', this.handleMCUTimeline, 'Get MCU timeline information');
        this.addCommand('shield', this.handleSHIELDCheck, 'Check S.H.I.E.L.D. clearance');
        this.addCommand('protocol', this.handleEmergencyProtocols, 'Get emergency protocols');
        this.addCommand('jarvis', this.handleJarvisQuote, 'Get random JARVIS quote');
        
        // Help Command
        this.addCommand('help', this.handleHelp, 'Show available commands');
        this.addCommand('commands', this.handleHelp, 'Show available commands');
    }

    addCommand(name, handler, description, aliases = []) {
        this.commands.set(name, { handler, description });
        aliases.forEach(alias => {
            this.aliases.set(alias, name);
        });
    }

    async handleMessage(message, client) {
        const content = message.content.trim();
        
        // Check if message starts with prefix
        if (!content.startsWith(this.prefix)) return false;
        
        // Extract command and arguments
        const args = content.slice(this.prefix.length).trim().split(/\s+/);
        const commandName = args[0].toLowerCase();
        const commandArgs = args.slice(1);
        
        // Check aliases
        const actualCommand = this.aliases.get(commandName) || commandName;
        const command = this.commands.get(actualCommand);
        
        if (!command) return false;
        
        // Check cooldown
        const userId = message.author.id;
        const cooldownKey = `${userId}_${actualCommand}`;
        const cooldownTime = 3000; // 3 seconds
        
        if (this.cooldowns.has(cooldownKey)) {
            const lastUsed = this.cooldowns.get(cooldownKey);
            if (Date.now() - lastUsed < cooldownTime) {
                const remaining = Math.ceil((cooldownTime - (Date.now() - lastUsed)) / 1000);
                await message.reply(`Please wait ${remaining} seconds before using this command again, sir.`);
                return true;
            }
        }
        
        this.cooldowns.set(cooldownKey, Date.now());
        
        try {
            // Execute command
            const result = await command.handler(message, commandArgs, client);
            if (result) {
                await message.reply(result);
            }
        } catch (error) {
            console.error(`Error executing command ${actualCommand}:`, error);
            await message.reply('Command execution failed, sir. Technical difficulties.');
        }
        
        return true;
    }

    // Command Handlers
    async handleRandomImage(message, args) {
        const category = args[0] || 'nature';
        const result = await freeAPIs.getRandomImage(category);
        
        if (result.error) {
            return `Failed to get image, sir. ${result.error}`;
        }
        
        return {
            embeds: [{
                title: `Random ${category} Image`,
                image: { url: result.url },
                footer: { text: `Source: ${result.source}` },
                timestamp: result.timestamp
            }]
        };
    }

    async handleRandomDog(message, args) {
        const result = await freeAPIs.getRandomDog();
        
        return {
            embeds: [{
                title: `Random Dog - ${result.breed}`,
                image: { url: result.imageUrl },
                footer: { text: 'Source: Dog CEO API' },
                timestamp: result.timestamp
            }]
        };
    }

    async handleRandomCat(message, args) {
        const result = await freeAPIs.getRandomCat();
        
        return {
            embeds: [{
                title: 'Random Cat',
                image: { url: result.imageUrl },
                footer: { text: 'Source: The Cat API' },
                timestamp: result.timestamp
            }]
        };
    }

    async handleCatFact(message, args) {
        const result = await freeAPIs.getCatFact();
        
        return {
            embeds: [{
                title: '🐱 Cat Fact',
                description: result.fact,
                footer: { text: 'Source: Cat Facts API' },
                timestamp: result.timestamp
            }]
        };
    }

    async handleRandomQuote(message, args) {
        const result = await freeAPIs.getRandomQuote();
        
        return {
            embeds: [{
                title: '💭 Inspirational Quote',
                description: `"${result.text}"`,
                footer: { text: `- ${result.author}` },
                timestamp: result.timestamp
            }]
        };
    }

    async handleRandomJoke(message, args) {
        const result = await freeAPIs.getRandomJoke();
        
        return {
            embeds: [{
                title: '😄 Random Joke',
                fields: [
                    { name: 'Setup', value: result.setup, inline: false },
                    { name: 'Punchline', value: result.punchline, inline: false }
                ],
                footer: { text: `Type: ${result.type}` },
                timestamp: result.timestamp
            }]
        };
    }

    async handleGenerateUUID(message, args) {
        const result = await freeAPIs.generateUUID();
        
        return `Generated UUID: \`${result.uuid}\``;
    }

    async handleGeneratePassword(message, args) {
        const length = parseInt(args[0]) || 12;
        const symbols = args.includes('--symbols') || args.includes('-s');
        
        if (length < 4 || length > 50) {
            return 'Password length must be between 4 and 50 characters, sir.';
        }
        
        const result = await freeAPIs.generatePassword(length, { symbols });
        
        return {
            embeds: [{
                title: '🔐 Generated Password',
                description: `\`${result.password}\``,
                fields: [
                    { name: 'Length', value: result.length.toString(), inline: true },
                    { name: 'Strength', value: result.strength, inline: true },
                    { name: 'Options', value: `Symbols: ${result.options.symbols ? 'Yes' : 'No'}`, inline: true }
                ],
                footer: { text: 'Keep your passwords secure!' },
                timestamp: result.timestamp
            }]
        };
    }

    async handleGenerateColors(message, args) {
        const result = await freeAPIs.generateColorPalette();
        
        const colorFields = result.colors.map((color, index) => ({
            name: `Color ${index + 1}`,
            value: `Hex: \`${color.hex}\`\nRGB: \`rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})\``,
            inline: true
        }));
        
        return {
            embeds: [{
                title: '🎨 Random Color Palette',
                fields: colorFields,
                footer: { text: 'Generated color palette' },
                timestamp: result.timestamp
            }]
        };
    }

    async handleGenerateLorem(message, args) {
        const paragraphs = parseInt(args[0]) || 1;
        const words = parseInt(args[1]) || 50;
        
        if (paragraphs < 1 || paragraphs > 10) {
            return 'Number of paragraphs must be between 1 and 10, sir.';
        }
        
        if (words < 10 || words > 200) {
            return 'Words per paragraph must be between 10 and 200, sir.';
        }
        
        const result = await freeAPIs.generateLoremIpsum(paragraphs, words);
        
        return {
            embeds: [{
                title: '📝 Lorem Ipsum Text',
                description: result.text,
                footer: { text: `${result.paragraphs} paragraphs, ${result.wordsPerParagraph} words each` },
                timestamp: result.timestamp
            }]
        };
    }

    async handleWeather(message, args) {
        if (args.length === 0) {
            return 'Please provide a location, sir. Usage: `!weather <location>`';
        }
        
        const location = args.join(' ');
        const result = await freeAPIs.getWeatherFree(location);
        
        if (result.error) {
            return `Weather service unavailable, sir. ${result.error}`;
        }
        
        if (result.simple) {
            return `Weather: ${result.simple}`;
        }
        
        return {
            embeds: [{
                title: `🌤️ Weather in ${result.location}`,
                fields: [
                    { name: 'Temperature', value: result.temperature, inline: true },
                    { name: 'Condition', value: result.condition, inline: true },
                    { name: 'Feels Like', value: result.feelsLike, inline: true },
                    { name: 'Humidity', value: result.humidity, inline: true },
                    { name: 'Wind Speed', value: result.windSpeed, inline: true },
                    { name: 'Pressure', value: result.pressure, inline: true }
                ],
                footer: { text: 'Source: wttr.in' },
                timestamp: result.timestamp
            }]
        };
    }

    async handleIPInfo(message, args) {
        const ip = args[0] || null;
        const result = await freeAPIs.getIPInfo(ip);
        
        if (result.error) {
            return `IP information unavailable, sir. ${result.error}`;
        }
        
        return {
            embeds: [{
                title: `🌐 IP Information`,
                fields: [
                    { name: 'IP Address', value: result.ip, inline: true },
                    { name: 'Country', value: result.country, inline: true },
                    { name: 'Region', value: result.region, inline: true },
                    { name: 'City', value: result.city, inline: true },
                    { name: 'Timezone', value: result.timezone, inline: true },
                    { name: 'ISP', value: result.isp, inline: true },
                    { name: 'Organization', value: result.org, inline: true },
                    { name: 'Coordinates', value: `${result.lat}, ${result.lon}`, inline: true }
                ],
                footer: { text: 'Source: ip-api.com' },
                timestamp: result.timestamp
            }]
        };
    }

    async handleMagic8Ball(message, args) {
        if (args.length === 0) {
            return 'Please ask a question, sir. Usage: `!8ball <question>`';
        }
        
        const responses = [
            'It is certain.',
            'It is decidedly so.',
            'Without a doubt.',
            'Yes - definitely.',
            'You may rely on it.',
            'As I see it, yes.',
            'Most likely.',
            'Outlook good.',
            'Yes.',
            'Signs point to yes.',
            'Reply hazy, try again.',
            'Ask again later.',
            'Better not tell you now.',
            'Cannot predict now.',
            'Concentrate and ask again.',
            'Don\'t count on it.',
            'My reply is no.',
            'My sources say no.',
            'Outlook not so good.',
            'Very doubtful.'
        ];
        
        const question = args.join(' ');
        const response = responses[Math.floor(Math.random() * responses.length)];
        
        return {
            embeds: [{
                title: '🎱 Magic 8-Ball',
                fields: [
                    { name: 'Question', value: question, inline: false },
                    { name: 'Answer', value: response, inline: false }
                ],
                color: 0x3498db
            }]
        };
    }

    async handleCoinFlip(message, args) {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        const emoji = result === 'Heads' ? '🪙' : '🪙';
        
        return `${emoji} **${result}**`;
    }

    async handleDiceRoll(message, args) {
        const sides = parseInt(args[0]) || 6;
        const count = parseInt(args[1]) || 1;
        
        if (sides < 2 || sides > 100) {
            return 'Number of sides must be between 2 and 100, sir.';
        }
        
        if (count < 1 || count > 10) {
            return 'Number of dice must be between 1 and 10, sir.';
        }
        
        const results = [];
        let total = 0;
        
        for (let i = 0; i < count; i++) {
            const roll = Math.floor(Math.random() * sides) + 1;
            results.push(roll);
            total += roll;
        }
        
        const resultText = results.join(', ');
        const totalText = count > 1 ? ` (Total: ${total})` : '';
        
        return `🎲 **${count}d${sides}**: ${resultText}${totalText}`;
    }

    async handleChoose(message, args) {
        if (args.length < 2) {
            return 'Please provide at least 2 options, sir. Usage: `!choose <option1> <option2> [option3...]`';
        }
        
        const choice = args[Math.floor(Math.random() * args.length)];
        return `I choose: **${choice}**`;
    }

    async handleReverseText(message, args) {
        if (args.length === 0) {
            return 'Please provide text to reverse, sir.';
        }
        
        const text = args.join(' ');
        const reversed = text.split('').reverse().join('');
        
        return `Reversed: \`${reversed}\``;
    }

    async handleUppercase(message, args) {
        if (args.length === 0) {
            return 'Please provide text, sir.';
        }
        
        const text = args.join(' ');
        return `Uppercase: \`${text.toUpperCase()}\``;
    }

    async handleLowercase(message, args) {
        if (args.length === 0) {
            return 'Please provide text, sir.';
        }
        
        const text = args.join(' ');
        return `Lowercase: \`${text.toLowerCase()}\``;
    }

    async handleBinary(message, args) {
        if (args.length === 0) {
            return 'Please provide text to convert, sir.';
        }
        
        const text = args.join(' ');
        const binary = text.split('').map(char => char.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
        
        return `Binary: \`${binary}\``;
    }

    async handleUnbinary(message, args) {
        if (args.length === 0) {
            return 'Please provide binary to convert, sir.';
        }
        
        try {
            const binary = args.join(' ');
            const text = binary.split(' ').map(bin => String.fromCharCode(parseInt(bin, 2))).join('');
            return `Text: \`${text}\``;
        } catch (error) {
            return 'Invalid binary format, sir.';
        }
    }

    async handleCalculator(message, args) {
        if (args.length === 0) {
            return 'Please provide a math expression, sir. Usage: `!calc <expression>`';
        }
        
        try {
            const expression = args.join(' ');
            // Simple safe evaluation - only allow basic math operations
            const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
            const result = eval(sanitized);
            
            if (isNaN(result) || !isFinite(result)) {
                return 'Invalid math expression, sir.';
            }
            
            return `${expression} = **${result}**`;
        } catch (error) {
            return 'Invalid math expression, sir.';
        }
    }

    async handlePrimeCheck(message, args) {
        if (args.length === 0) {
            return 'Please provide a number, sir.';
        }
        
        const num = parseInt(args[0]);
        
        if (isNaN(num) || num < 2) {
            return 'Please provide a valid number greater than 1, sir.';
        }
        
        if (num > 1000000) {
            return 'Number too large, sir. Please use a number less than 1,000,000.';
        }
        
        const isPrime = this.isPrime(num);
        return `${num} is **${isPrime ? 'prime' : 'not prime'}**.`;
    }

    async handleFibonacci(message, args) {
        const count = parseInt(args[0]) || 10;
        
        if (count < 1 || count > 50) {
            return 'Count must be between 1 and 50, sir.';
        }
        
        const sequence = this.generateFibonacci(count);
        return `Fibonacci sequence (${count} numbers): \`${sequence.join(', ')}\``;
    }

    async handleHelp(message, args) {
        const categories = {
            'Images': ['img', 'image', 'pic', 'dog', 'cat'],
            'Fun': ['quote', 'joke', '8ball', 'flip', 'dice', 'choose', 'catfact'],
            'Games': ['rps', 'guess', 'hangman', 'wordchain', 'gamestats'],
            'Utility': ['uuid', 'password', 'colors', 'lorem', 'ip', 'weather'],
            'Text': ['reverse', 'uppercase', 'lowercase', 'binary', 'unbinary', 'analyze', 'words', 'strength', 'transform'],
            'Math': ['calc', 'math', 'prime', 'fibonacci', 'roman', 'base'],
            'Colors': ['hex', 'rgb', 'palette'],
            'Encoding': ['encode', 'decode', 'md5', 'sha1', 'sha256'],
            'Marvel': ['suit', 'suits', 'diagnostics', 'stark', 'arc', 'avengers', 'malibu', 'mcu', 'shield', 'protocol', 'jarvis'],
            'Help': ['help', 'commands']
        };
        
        let helpText = '**Available Prefix Commands:**\n\n';
        
        for (const [category, commands] of Object.entries(categories)) {
            helpText += `**${category}:**\n`;
            commands.forEach(cmd => {
                const command = this.commands.get(cmd);
                if (command) {
                    helpText += `\`!${cmd}\` - ${command.description}\n`;
                }
            });
            helpText += '\n';
        }
        
        helpText += `**Usage:** Use \`!command\` followed by any arguments.\n`;
        helpText += `**Cooldown:** 3 seconds between commands.\n`;
        helpText += `**Example:** \`!weather New York\` or \`!quote\``;
        
        return helpText;
    }

    // Utility Functions
    isPrime(num) {
        if (num < 2) return false;
        if (num === 2) return true;
        if (num % 2 === 0) return false;
        
        for (let i = 3; i <= Math.sqrt(num); i += 2) {
            if (num % i === 0) return false;
        }
        
        return true;
    }

    generateFibonacci(count) {
        const sequence = [0, 1];
        
        for (let i = 2; i < count; i++) {
            sequence[i] = sequence[i - 1] + sequence[i - 2];
        }
        
        return sequence.slice(0, count);
    }

    // Stub handlers for future implementation
    async handleASCIIArt(message, args) {
        return 'ASCII art generation coming soon, sir.';
    }

    async handleQRCode(message, args) {
        return 'QR code generation coming soon, sir.';
    }

    async handleBase64Encode(message, args) {
        if (args.length === 0) return 'Please provide text to encode, sir.';
        const text = args.join(' ');
        const encoded = Buffer.from(text).toString('base64');
        return `Base64: \`${encoded}\``;
    }

    async handleBase64Decode(message, args) {
        if (args.length === 0) return 'Please provide base64 to decode, sir.';
        try {
            const encoded = args.join(' ');
            const decoded = Buffer.from(encoded, 'base64').toString('utf8');
            return `Decoded: \`${decoded}\``;
        } catch (error) {
            return 'Invalid base64 format, sir.';
        }
    }

    async handleMD5Hash(message, args) {
        if (args.length === 0) return 'Please provide text to hash, sir.';
        const text = args.join(' ');
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(text).digest('hex');
        return `MD5: \`${hash}\``;
    }

    async handleSHA1Hash(message, args) {
        if (args.length === 0) return 'Please provide text to hash, sir.';
        const text = args.join(' ');
        const crypto = require('crypto');
        const hash = crypto.createHash('sha1').update(text).digest('hex');
        return `SHA1: \`${hash}\``;
    }

    async handleSHA256Hash(message, args) {
        if (args.length === 0) return 'Please provide text to hash, sir.';
        const text = args.join(' ');
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        return `SHA256: \`${hash}\``;
    }

    async handleTimezone(message, args) {
        return 'Timezone conversion coming soon, sir.';
    }

    async handleCountdown(message, args) {
        return 'Countdown timers coming soon, sir.';
    }

    async handleTextAnalysis(message, args) {
        if (args.length === 0) {
            return 'Please provide text to analyze, sir. Usage: `!analyze <text>`';
        }
        
        const text = args.join(' ');
        const analysis = advancedUtils.analyzeText(text);
        
        return {
            embeds: [{
                title: '📊 Text Analysis',
                fields: [
                    { name: 'Characters', value: analysis.stats.characters.toString(), inline: true },
                    { name: 'Words', value: analysis.stats.words.toString(), inline: true },
                    { name: 'Sentences', value: analysis.stats.sentences.toString(), inline: true },
                    { name: 'Unique Words', value: analysis.stats.uniqueWords.toString(), inline: true },
                    { name: 'Reading Level', value: analysis.readability.readingLevel, inline: true },
                    { name: 'Flesch Score', value: analysis.readability.fleschScore.toString(), inline: true },
                    { name: 'Longest Word', value: `\`${analysis.words.longest}\``, inline: true },
                    { name: 'Average Word Length', value: analysis.words.averageLength.toString(), inline: true },
                    { name: 'Words per Sentence', value: analysis.readability.avgWordsPerSentence.toString(), inline: true }
                ],
                footer: { text: 'Text analysis completed' }
            }]
        };
    }

    async handleWordFrequency(message, args) {
        if (args.length === 0) {
            return 'Please provide text to analyze, sir. Usage: `!words <text>`';
        }
        
        const text = args.join(' ');
        const analysis = advancedUtils.analyzeWordFrequency(text);
        
        const topWords = analysis.topWords.slice(0, 10).map(item => 
            `**${item.word}**: ${item.count} (${item.percentage}%)`
        ).join('\n');
        
        return {
            embeds: [{
                title: '📈 Word Frequency Analysis',
                fields: [
                    { name: 'Total Words', value: analysis.totalWords.toString(), inline: true },
                    { name: 'Unique Words', value: analysis.uniqueWords.toString(), inline: true },
                    { name: 'Top 10 Words', value: topWords || 'No words found', inline: false }
                ],
                footer: { text: 'Word frequency analysis completed' }
            }]
        };
    }

    async handlePasswordStrength(message, args) {
        if (args.length === 0) {
            return 'Please provide a password to analyze, sir. Usage: `!strength <password>`';
        }
        
        const password = args.join(' ');
        const analysis = advancedUtils.analyzePasswordStrength(password);
        
        const feedback = analysis.feedback.length > 0 ? 
            analysis.feedback.join('\n') : 'No specific feedback';
        
        return {
            embeds: [{
                title: '🔐 Password Strength Analysis',
                fields: [
                    { name: 'Strength', value: analysis.strength, inline: true },
                    { name: 'Score', value: `${analysis.score}/6`, inline: true },
                    { name: 'Entropy', value: analysis.entropy.toString(), inline: true },
                    { name: 'Time to Crack', value: analysis.timeToCrack, inline: true },
                    { name: 'Feedback', value: feedback || 'Password looks good!', inline: false }
                ],
                footer: { text: 'Keep your passwords secure!' }
            }]
        };
    }

    async handleTextTransform(message, args) {
        if (args.length < 2) {
            return 'Please provide transformation type and text, sir. Usage: `!transform <type> <text>`';
        }
        
        const transformation = args[0];
        const text = args.slice(1).join(' ');
        
        const transformed = advancedUtils.transformText(text, transformation);
        
        return {
            embeds: [{
                title: `🔄 Text Transformation: ${transformation}`,
                fields: [
                    { name: 'Original', value: `\`${text}\``, inline: false },
                    { name: 'Transformed', value: `\`${transformed}\``, inline: false }
                ]
            }]
        };
    }

    async handleHexToRgb(message, args) {
        if (args.length === 0) {
            return 'Please provide a hex color, sir. Usage: `!hex #FF5733`';
        }
        
        const hex = args[0];
        const rgb = advancedUtils.hexToRgb(hex);
        
        if (!rgb) {
            return 'Invalid hex color format, sir. Please use format like #FF5733';
        }
        
        return {
            embeds: [{
                title: '🎨 Color Conversion',
                fields: [
                    { name: 'Hex', value: hex.toUpperCase(), inline: true },
                    { name: 'RGB', value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`, inline: true },
                    { name: 'Preview', value: `Color: ${hex}`, inline: true }
                ],
                color: parseInt(hex.replace('#', ''), 16)
            }]
        };
    }

    async handleRgbToHex(message, args) {
        if (args.length < 3) {
            return 'Please provide RGB values, sir. Usage: `!rgb 255 87 51`';
        }
        
        const r = parseInt(args[0]);
        const g = parseInt(args[1]);
        const b = parseInt(args[2]);
        
        if (isNaN(r) || isNaN(g) || isNaN(b) || r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
            return 'Invalid RGB values, sir. Please use values between 0-255';
        }
        
        const hex = advancedUtils.rgbToHex(r, g, b);
        
        return {
            embeds: [{
                title: '🎨 Color Conversion',
                fields: [
                    { name: 'RGB', value: `rgb(${r}, ${g}, ${b})`, inline: true },
                    { name: 'Hex', value: hex.toUpperCase(), inline: true },
                    { name: 'Preview', value: `Color: ${hex}`, inline: true }
                ],
                color: parseInt(hex.replace('#', ''), 16)
            }]
        };
    }

    async handleColorPalette(message, args) {
        const baseColor = args[0] || '#3498db';
        const count = parseInt(args[1]) || 5;
        
        const palette = advancedUtils.generateColorPalette(baseColor, count);
        
        if (!palette) {
            return 'Invalid base color, sir. Please use format like #3498db';
        }
        
        const colorFields = palette.map((color, index) => ({
            name: `Color ${index + 1}`,
            value: `Hex: \`${color.hex}\`\nRGB: \`rgb(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})\``,
            inline: true
        }));
        
        return {
            embeds: [{
                title: `🎨 Color Palette (${count} colors)`,
                description: `Generated from base color: ${baseColor}`,
                fields: colorFields,
                footer: { text: 'Color palette generated' }
            }]
        };
    }

    async handleRomanNumeral(message, args) {
        if (args.length === 0) {
            return 'Please provide a number or Roman numeral, sir. Usage: `!roman 42` or `!roman XLII`';
        }
        
        const input = args[0];
        
        // Check if input is a number
        if (!isNaN(input)) {
            const num = parseInt(input);
            if (num < 1 || num > 3999) {
                return 'Number must be between 1 and 3999, sir.';
            }
            const roman = advancedUtils.toRomanNumeral(num);
            return `**${num}** = **${roman}**`;
        } else {
            // Assume it's a Roman numeral
            const num = advancedUtils.fromRomanNumeral(input.toUpperCase());
            return `**${input.toUpperCase()}** = **${num}**`;
        }
    }

    async handleBaseConvert(message, args) {
        if (args.length < 3) {
            return 'Please provide number, from base, and to base, sir. Usage: `!base 255 10 16`';
        }
        
        const number = args[0];
        const fromBase = parseInt(args[1]);
        const toBase = parseInt(args[2]);
        
        if (isNaN(fromBase) || isNaN(toBase) || fromBase < 2 || fromBase > 36 || toBase < 2 || toBase > 36) {
            return 'Bases must be numbers between 2 and 36, sir.';
        }
        
        try {
            const result = advancedUtils.convertBase(number, fromBase, toBase);
            return `**${number}** (base ${fromBase}) = **${result}** (base ${toBase})`;
        } catch (error) {
            return 'Invalid number or base conversion failed, sir.';
        }
    }

    // Marvel Command Handlers
    async handleSuitInfo(message, args) {
        const suitName = args[0] || 'Mark LXXXV';
        const suitInfo = marvelFeatures.getSuitInfo(suitName);
        
        if (suitInfo.error) {
            return {
                embeds: [{
                    title: '⚠️ Suit Not Found',
                    description: suitInfo.message,
                    fields: [
                        { name: 'Available Suits', value: suitInfo.availableSuits.join(', '), inline: false }
                    ],
                    color: 0xff4444
                }]
            };
        }
        
        return {
            embeds: [{
                title: `🦾 ${suitInfo.name}`,
                fields: [
                    { name: 'Year', value: suitInfo.year.toString(), inline: true },
                    { name: 'Status', value: suitInfo.status, inline: true },
                    { name: 'Power Level', value: `${suitInfo.powerLevel}%`, inline: true },
                    { name: 'Integrity', value: `${suitInfo.integrity}%`, inline: true },
                    { name: 'Description', value: suitInfo.description, inline: false },
                    { name: 'Features', value: suitInfo.features.join(', '), inline: false }
                ],
                color: 0xffd700,
                footer: { text: 'Stark Industries' }
            }]
        };
    }

    async handleAllSuits(message, args) {
        const suits = marvelFeatures.getAllSuits();
        const suitList = suits.map(suit => 
            `**${suit.name}** (${suit.year}) - ${suit.description}`
        ).join('\n');
        
        return {
            embeds: [{
                title: '🦾 Iron Man Suit Database',
                description: `**${suits.length} suits** in database:\n\n${suitList}`,
                color: 0xffd700,
                footer: { text: 'Stark Industries • Classified' }
            }]
        };
    }

    async handleSuitDiagnostics(message, args) {
        const suitName = args[0] || 'Mark LXXXV';
        const diagnostics = marvelFeatures.runSuitDiagnostics(suitName);
        
        if (diagnostics.error) {
            return `Diagnostics failed, sir. ${diagnostics.message}`;
        }
        
        const systemFields = Object.entries(diagnostics.systems).map(([system, data]) => ({
            name: system,
            value: `Status: ${data.status}\n${Object.entries(data).filter(([key]) => key !== 'status').map(([key, value]) => `${key}: ${value}`).join('\n')}`,
            inline: true
        }));
        
        return {
            embeds: [{
                title: `🔧 ${diagnostics.suit} Diagnostics`,
                fields: systemFields,
                color: 0x00ff00,
                footer: { text: `Diagnostics completed at ${new Date().toLocaleTimeString()}` }
            }]
        };
    }

    async handleStarkIndustries(message, args) {
        const info = marvelFeatures.getStarkIndustriesInfo();
        
        return {
            embeds: [{
                title: '🏢 Stark Industries',
                fields: [
                    { name: 'CEO', value: info.ceo, inline: true },
                    { name: 'Headquarters', value: info.headquarters, inline: true },
                    { name: 'Stock Price', value: `$${info.stockPrice}`, inline: true },
                    { name: 'Divisions', value: info.divisions.join(', '), inline: false },
                    { name: 'Locations', value: info.locations.join(', '), inline: false },
                    { name: 'Key Personnel', value: info.keyPersonnel.join(', '), inline: false }
                ],
                color: 0x0066cc,
                footer: { text: 'Stark Industries • Official' }
            }]
        };
    }

    async handleArcReactor(message, args) {
        const reactor = marvelFeatures.getArcReactorStatus();
        
        return {
            embeds: [{
                title: '⚡ Arc Reactor Status',
                fields: [
                    { name: 'Model', value: reactor.model, inline: true },
                    { name: 'Status', value: reactor.status, inline: true },
                    { name: 'Power Output', value: reactor.powerOutput, inline: true },
                    { name: 'Efficiency', value: reactor.efficiency, inline: true },
                    { name: 'Temperature', value: reactor.temperature, inline: true },
                    { name: 'Core Stability', value: reactor.coreStability, inline: true },
                    { name: 'Next Maintenance', value: reactor.nextMaintenance, inline: true },
                    { name: 'Lifespan', value: reactor.lifespan, inline: true }
                ],
                color: 0x00ffff,
                footer: { text: reactor.location }
            }]
        };
    }

    async handleAvengersStatus(message, args) {
        const avengers = marvelFeatures.getAvengersStatus();
        
        const memberList = avengers.members.map(member => 
            `${member.status === 'Active' ? '🟢' : '🔴'} **${member.name}** - ${member.location}`
        ).join('\n');
        
        return {
            embeds: [{
                title: '🦸 Avengers Team Status',
                fields: [
                    { name: 'Active Members', value: avengers.activeMembers.toString(), inline: true },
                    { name: 'Total Members', value: avengers.totalMembers.toString(), inline: true },
                    { name: 'Threat Level', value: avengers.threatLevel, inline: true },
                    { name: 'Last Mission', value: avengers.lastMission, inline: true },
                    { name: 'Team Members', value: memberList, inline: false }
                ],
                color: 0xff0000,
                footer: { text: 'S.H.I.E.L.D. • Classified' }
            }]
        };
    }

    async handleMalibuWeather(message, args) {
        const weather = marvelFeatures.getMalibuWeather();
        
        return {
            embeds: [{
                title: '☀️ Malibu Weather Report',
                description: `Stark Mansion, ${weather.location}`,
                fields: [
                    { name: 'Temperature', value: weather.temperature, inline: true },
                    { name: 'Condition', value: weather.condition, inline: true },
                    { name: 'Humidity', value: weather.humidity, inline: true },
                    { name: 'Wind Speed', value: weather.windSpeed, inline: true },
                    { name: 'Visibility', value: weather.visibility, inline: true },
                    { name: 'UV Index', value: weather.uvIndex.toString(), inline: true },
                    { name: 'Sunrise', value: weather.sunrise, inline: true },
                    { name: 'Sunset', value: weather.sunset, inline: true }
                ],
                color: 0x87ceeb,
                footer: { text: `Updated: ${weather.time}` }
            }]
        };
    }

    async handleMCUTimeline(message, args) {
        const year = args[0];
        const timeline = marvelFeatures.getMCUTimeline(year);
        
        if (year) {
            return {
                embeds: [{
                    title: `🎬 MCU Timeline - ${year}`,
                    fields: [
                        { name: 'Phase', value: timeline.phase, inline: true },
                        { name: 'Films Released', value: timeline.films.join(', ') || 'None', inline: false }
                    ],
                    color: 0x800080,
                    footer: { text: 'Marvel Cinematic Universe' }
                }]
            };
        }
        
        const phaseInfo = Object.entries(timeline.phases).map(([phase, years]) => 
            `**${phase}**: ${years}`
        ).join('\n');
        
        return {
            embeds: [{
                title: '🎬 Marvel Cinematic Universe Timeline',
                fields: [
                    { name: 'Total Films', value: timeline.totalFilms.toString(), inline: true },
                    { name: 'Phases', value: phaseInfo, inline: false }
                ],
                color: 0x800080,
                footer: { text: 'Marvel Cinematic Universe • Official Timeline' }
            }]
        };
    }

    async handleSHIELDCheck(message, args) {
        const userId = message.author.id;
        const clearance = marvelFeatures.checkSHIELDClearance(userId);
        
        return {
            embeds: [{
                title: '🛡️ S.H.I.E.L.D. Clearance Check',
                fields: [
                    { name: 'User', value: `<@${userId}>`, inline: true },
                    { name: 'Clearance Level', value: clearance.clearance, inline: true },
                    { name: 'Status', value: clearance.status, inline: true },
                    { name: 'Access Granted', value: clearance.access.join('\n'), inline: false },
                    { name: 'Expires', value: new Date(clearance.expires).toLocaleDateString(), inline: true }
                ],
                color: 0x0000ff,
                footer: { text: clearance.agency }
            }]
        };
    }

    async handleEmergencyProtocols(message, args) {
        const protocols = marvelFeatures.getEmergencyProtocols();
        
        const protocolList = Object.entries(protocols).map(([code, description]) => 
            `**${code}**: ${description}`
        ).join('\n');
        
        return {
            embeds: [{
                title: '🚨 Emergency Protocols',
                description: 'Stark Industries Emergency Response Codes',
                fields: [
                    { name: 'Protocols', value: protocolList, inline: false }
                ],
                color: 0xff4444,
                footer: { text: 'Stark Industries • Classified' }
            }]
        };
    }

    async handleJarvisQuote(message, args) {
        const quote = marvelFeatures.getRandomJarvisQuote();
        
        return {
            embeds: [{
                title: '🎭 J.A.R.V.I.S. Quote',
                description: `*"${quote.quote}"*`,
                footer: { text: `- ${quote.character} • ${quote.source}` },
                color: 0xffd700
            }]
        };
    }

    // Interactive Game Handlers
    async handleRockPaperScissors(message, args) {
        if (args.length === 0) {
            return 'Please choose rock, paper, or scissors, sir. Usage: `!rps rock`';
        }

        const userId = message.author.id;
        const result = await interactiveGames.playRockPaperScissors(userId, args[0]);

        if (result.error) {
            return result.error;
        }

        let resultText = '';
        if (result.result === 'win') {
            resultText = '🎉 You win, sir! Well played.';
        } else if (result.result === 'lose') {
            resultText = '😔 I win this round, sir. Better luck next time.';
        } else {
            resultText = '🤝 It\'s a tie, sir. Good game.';
        }

        return {
            embeds: [{
                title: '🪨 Rock Paper Scissors',
                fields: [
                    { name: 'Your Choice', value: `${result.emoji.user} ${result.userChoice.toUpperCase()}`, inline: true },
                    { name: 'My Choice', value: `${result.emoji.bot} ${result.botChoice.toUpperCase()}`, inline: true },
                    { name: 'Result', value: resultText, inline: false }
                ],
                color: result.win ? 0x00ff00 : (result.result === 'tie' ? 0xffaa00 : 0xff4444)
            }]
        };
    }

    async handleNumberGuess(message, args) {
        const userId = message.author.id;
        
        if (args.length === 0) {
            // Start new game
            const max = 100;
            const result = await interactiveGames.startNumberGuess(userId, max);
            
            if (result.error) {
                return result.error;
            }
            
            return {
                embeds: [{
                    title: '🎯 Number Guessing Game',
                    description: result.message,
                    fields: [
                        { name: 'Range', value: `1 to ${max}`, inline: true },
                        { name: 'Attempts', value: `${result.maxAttempts}`, inline: true }
                    ],
                    color: 0x0099ff
                }]
            };
        } else {
            // Make guess
            const result = await interactiveGames.guessNumber(userId, args[0]);
            
            if (result.error) {
                return result.error;
            }

            let color = 0x0099ff;
            if (result.result === 'win') color = 0x00ff00;
            if (result.result === 'lose') color = 0xff4444;

            return {
                embeds: [{
                    title: '🎯 Number Guessing Game',
                    description: result.message,
                    fields: result.attemptsLeft ? [
                        { name: 'Attempts Used', value: result.attempts.toString(), inline: true },
                        { name: 'Attempts Left', value: result.attemptsLeft.toString(), inline: true }
                    ] : [
                        { name: 'Total Attempts', value: result.attempts.toString(), inline: true }
                    ],
                    color: color
                }]
            };
        }
    }

    async handleHangman(message, args) {
        const userId = message.author.id;
        
        if (args.length === 0) {
            // Start new game
            const result = await interactiveGames.startHangman(userId);
            
            if (result.error) {
                return result.error;
            }
            
            return {
                embeds: [{
                    title: '🎯 Hangman Game',
                    description: result.message,
                    fields: [
                        { name: 'Word', value: `\`${result.display}\``, inline: false },
                        { name: 'Wrong Guesses', value: `${result.wrongGuesses}/${result.maxWrong}`, inline: true }
                    ],
                    color: 0x0099ff
                }]
            };
        } else {
            // Make guess
            const result = await interactiveGames.guessHangman(userId, args[0]);
            
            if (result.error) {
                return result.error;
            }

            let color = 0x0099ff;
            if (result.result === 'win') color = 0x00ff00;
            if (result.result === 'lose') color = 0xff4444;

            const embed = {
                title: '🎯 Hangman Game',
                description: result.message,
                fields: [
                    { name: 'Word', value: `\`${result.display}\``, inline: false },
                    { name: 'Wrong Guesses', value: `${result.wrongGuesses}/6`, inline: true }
                ],
                color: color
            };

            if (result.hangman) {
                embed.fields.push({ name: 'Hangman', value: result.hangman, inline: false });
            }

            return { embeds: [embed] };
        }
    }

    async handleWordAssociation(message, args) {
        const userId = message.author.id;
        
        if (args.length === 0) {
            // Start new game
            const result = await interactiveGames.startWordAssociation(userId);
            
            if (result.error) {
                return result.error;
            }
            
            return {
                embeds: [{
                    title: '🔗 Word Association Game',
                    description: result.message,
                    fields: [
                        { name: 'Current Word', value: result.currentWord, inline: true },
                        { name: 'Chain Length', value: '1', inline: true }
                    ],
                    color: 0x9932cc
                }]
            };
        } else {
            // Continue game
            const result = await interactiveGames.continueWordAssociation(userId, args.join(' '));
            
            if (result.error) {
                return result.error;
            }

            let color = 0x9932cc;
            if (result.result === 'invalid') color = 0xff4444;

            return {
                embeds: [{
                    title: '🔗 Word Association Game',
                    description: result.message,
                    fields: [
                        { name: 'Current Word', value: result.currentWord, inline: true },
                        { name: 'Chain Length', value: result.chainLength.toString(), inline: true },
                        { name: 'Chain', value: result.chain.join(' → ') || 'None yet', inline: false }
                    ],
                    color: color
                }]
            };
        }
    }

    async handleGameStats(message, args) {
        const userId = message.author.id;
        const stats = interactiveGames.getGameStats(userId);

        const rpsWinRate = (stats.rps.wins + stats.rps.losses + stats.rps.ties) > 0 
            ? Math.round((stats.rps.wins / (stats.rps.wins + stats.rps.losses + stats.rps.ties)) * 100)
            : 0;

        const guessWinRate = (stats.guess.wins + stats.guess.losses) > 0
            ? Math.round((stats.guess.wins / (stats.guess.wins + stats.guess.losses)) * 100)
            : 0;

        const hangmanWinRate = (stats.hangman.wins + stats.hangman.losses) > 0
            ? Math.round((stats.hangman.wins / (stats.hangman.wins + stats.hangman.losses)) * 100)
            : 0;

        return {
            embeds: [{
                title: '🎮 Your Game Statistics',
                fields: [
                    { 
                        name: '🪨 Rock Paper Scissors', 
                        value: `Wins: ${stats.rps.wins} | Losses: ${stats.rps.losses} | Ties: ${stats.rps.ties}\nWin Rate: ${rpsWinRate}%`, 
                        inline: true 
                    },
                    { 
                        name: '🎯 Number Guessing', 
                        value: `Wins: ${stats.guess.wins} | Losses: ${stats.guess.losses}\nWin Rate: ${guessWinRate}%`, 
                        inline: true 
                    },
                    { 
                        name: '🎯 Hangman', 
                        value: `Wins: ${stats.hangman.wins} | Losses: ${stats.hangman.losses}\nWin Rate: ${hangmanWinRate}%`, 
                        inline: true 
                    },
                    { 
                        name: '📊 Overall', 
                        value: `Total Games: ${stats.totalGames}\nTotal Wins: ${stats.totalWins}\nOverall Win Rate: ${stats.winRate}%`, 
                        inline: false 
                    }
                ],
                color: 0x00ff00,
                footer: { text: 'Keep playing to improve your stats, sir!' }
            }]
        };
    }
}

module.exports = new PrefixCommandsHandler();
