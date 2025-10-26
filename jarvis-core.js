/**
 * Core Jarvis (Garmin) AI personality and response generation
 */

const aiManager = require('./ai-providers');
const database = require('./database');
const config = require('./config');
const embeddingSystem = require('./embedding-system');
const youtubeSearch = require('./youtube-search');
const braveSearch = require('./brave-search');
const mathSolver = require('./math-solver');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const punycode = require('node:punycode');

const MAX_DECODE_DISPLAY_CHARS = 1800;
const BINARY_PREVIEW_BYTES = 32;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const MORSE_TABLE = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.', 'G': '--.', 'H': '....',
    'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---', 'P': '.--.',
    'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....',
    '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.',
    '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-',
    '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '$': '...-..-', '@': '.--.-.',
    '¿': '..-.-', '¡': '--...-', ' ': '/' // treat spaces as /
};

const REVERSE_MORSE_TABLE = Object.entries(MORSE_TABLE).reduce((acc, [char, code]) => {
    acc[code] = char;
    return acc;
}, {});

const SUPPORT_SERVER_URL = 'https://discord.gg/ksXzuBtmK5';

function sanitizeForCodeBlock(text) {
    return text.replace(/```/g, '`\u200b``');
}

function buildSupportEmbed(includeGuide = false) {
    const embed = new EmbedBuilder()
        .setTitle('Join Jarvis HQ ⚙️')
        .setDescription('Need help or want updates? Join the official Jarvis Support Server!')
        .setURL(SUPPORT_SERVER_URL)
        .setColor('#00BFFF');

    if (includeGuide) {
        embed
            .addFields(
                {
                    name: 'Core Systems',
                    value: [
                        '`/jarvis <prompt>` Ask Jarvis anything.',
                        '`/help` Quick reference & support invite.',
                        '`/invite` Share the support server banner.'
                    ].join('\n'),
                },
                {
                    name: 'Personal Tools',
                    value: [
                        '`/profile show` Review your dossier.',
                        '`/profile set` Update preferences.',
                        '`/history` & `/recap` Catch up on recent chats.',
                        '`/time` | `/roll` Handy utilities on demand.'
                    ].join('\n'),
                },
                {
                    name: 'Server Utilities',
                    value: [
                        '`/reactionrole` Configure reaction role panels.',
                        '`/automod` Manage blacklist & automod rules.',
                        '`/serverstats` Maintain live member counters.',
                        '`/memberlog` Customize join & leave messages.'
                    ].join('\n'),
                },
                {
                    name: 'Power Tools',
                    value: [
                        '`/encode` & `/decode` Convert text effortlessly.',
                        '`/providers` Check AI provider status.',
                        '`/reset` Wipe conversations when needed.'
                    ].join('\n'),
                }
            )
            .setFooter({ text: 'Use /invite any time to grab the support link for your team.' });
    } else {
        embed.setFooter({ text: 'Share this link so everyone can reach Jarvis HQ when needed.' });
    }

    const supportButton = new ButtonBuilder()
        .setLabel('Join the Support Server')
        .setStyle(ButtonStyle.Link)
        .setURL(SUPPORT_SERVER_URL)
        .setEmoji('🤝');

    const row = new ActionRowBuilder().addComponents(supportButton);

    return { embeds: [embed], components: [row] };
}

function isMostlyPrintable(text) {
    if (!text) {
        return false;
    }

    let printable = 0;
    for (const char of text) {
        const code = char.charCodeAt(0);
        if (
            (code >= 32 && code <= 126)
            || code === 9
            || code === 10
            || code === 13
        ) {
            printable++;
        }
    }

    return printable / text.length >= 0.8;
}

function applyRot13(text) {
    return text.replace(/[a-zA-Z]/g, (char) => {
        const base = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
    });
}

function base32Encode(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
    }

    let bits = '';
    for (const byte of buffer) {
        bits += byte.toString(2).padStart(8, '0');
    }

    const chunks = bits.match(/.{1,5}/g) || [];
    let output = chunks.map(chunk => {
        const padded = chunk.padEnd(5, '0');
        const index = parseInt(padded, 2);
        return BASE32_ALPHABET[index];
    }).join('');

    while (output.length % 8 !== 0) {
        output += '=';
    }

    return output;
}

function base32Decode(input) {
    const sanitized = input.replace(/\s+/g, '').toUpperCase();
    const stripped = sanitized.replace(/=+$/g, '');

    if (!stripped.length) {
        throw new Error('No Base32 data provided.');
    }

    if (!/^[A-Z2-7]+=*$/.test(sanitized)) {
        throw new Error('Base32 data must contain only A-Z, 2-7, and optional padding.');
    }

    let bits = '';
    for (const char of stripped) {
        const index = BASE32_ALPHABET.indexOf(char);
        if (index === -1) {
            throw new Error('Invalid Base32 character encountered.');
        }
        bits += index.toString(2).padStart(5, '0');
    }

    const bytes = bits.match(/.{8}/g) || [];
    const byteValues = bytes
        .map(byte => parseInt(byte, 2))
        .filter((value) => !Number.isNaN(value));

    return Buffer.from(byteValues);
}

function base58Encode(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
    }

    let num = BigInt('0x' + buffer.toString('hex'));
    const base = BigInt(BASE58_ALPHABET.length);

    if (num === 0n) {
        return BASE58_ALPHABET[0];
    }

    let encoded = '';
    while (num > 0n) {
        const remainder = Number(num % base);
        num = num / base;
        encoded = BASE58_ALPHABET[remainder] + encoded;
    }

    for (const byte of buffer) {
        if (byte === 0x00) {
            encoded = BASE58_ALPHABET[0] + encoded;
        } else {
            break;
        }
    }

    return encoded;
}

function base58Decode(input) {
    const sanitized = input.replace(/\s+/g, '');
    if (!sanitized.length) {
        throw new Error('No Base58 data provided.');
    }

    if (!new RegExp(`^[${BASE58_ALPHABET}]+$`).test(sanitized)) {
        throw new Error('Base58 data contains invalid characters.');
    }

    const base = BigInt(BASE58_ALPHABET.length);
    let num = 0n;
    for (const char of sanitized) {
        const value = BASE58_ALPHABET.indexOf(char);
        if (value === -1) {
            throw new Error('Invalid Base58 character encountered.');
        }
        num = num * base + BigInt(value);
    }

    let hex = num.toString(16);
    if (hex.length % 2 !== 0) {
        hex = '0' + hex;
    }

    let buffer = Buffer.from(hex, 'hex');
    let leadingZeroCount = 0;
    for (const char of sanitized) {
        if (char === BASE58_ALPHABET[0]) {
            leadingZeroCount++;
        } else {
            break;
        }
    }

    if (leadingZeroCount > 0) {
        buffer = Buffer.concat([Buffer.alloc(leadingZeroCount, 0), buffer]);
    }

    return buffer;
}

function morseEncode(text) {
    return text
        .toUpperCase()
        .split('')
        .map((char) => MORSE_TABLE[char] || '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s{2,}/g, ' ');
}

function morseDecode(input) {
    const segments = input.trim().split(/\s+/);
    const decoded = segments.map((segment) => {
        if (segment === '/' || segment === '|') {
            return ' ';
        }
        return REVERSE_MORSE_TABLE[segment] || '';
    }).join('');

    if (!decoded.trim()) {
        throw new Error('No valid Morse code found.');
    }

    return Buffer.from(decoded, 'utf8');
}

function normalizeDetectResult(result, fallback = 0) {
    if (!result) {
        return { confidence: 0 };
    }

    if (typeof result === 'number') {
        return { confidence: Math.max(0, Math.min(1, result)) };
    }

    if (typeof result === 'boolean') {
        return { confidence: result ? Math.max(0.1, fallback) : 0 };
    }

    if (typeof result === 'object') {
        const confidence = typeof result.confidence === 'number'
            ? Math.max(0, Math.min(1, result.confidence))
            : Math.max(0.1, fallback);
        return { confidence, ...result };
    }

    return { confidence: 0 };
}

const codecStrategies = [
    {
        key: 'hex',
        label: 'Hexadecimal',
        aliases: ['hexadecimal'],
        detect: (input) => {
            const sanitized = input
                .replace(/0x/gi, '')
                .replace(/\\x/gi, '')
                .replace(/[^0-9a-fA-F]/g, '');
            if (sanitized.length < 2 || sanitized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(sanitized)) {
                return { confidence: 0 };
            }

            let confidence = 0.8;
            if (/0x|\\x/i.test(input)) {
                confidence += 0.15;
            }

            if (/\s/.test(input)) {
                confidence += 0.05;
            }

            return { confidence: Math.min(confidence, 0.98), sanitized };
        },
        decode: (_, context = {}) => {
            const sanitized = (context.sanitized || _)
                .replace(/0x/gi, '')
                .replace(/\\x/gi, '')
                .replace(/[^0-9a-fA-F]/g, '');
            if (!sanitized.length) {
                throw new Error('No hexadecimal data provided.');
            }
            if (sanitized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(sanitized)) {
                throw new Error('Hexadecimal data must be pairs of 0-9 or A-F characters.');
            }

            return Buffer.from(sanitized, 'hex');
        },
        encode: (buffer) => Buffer.from(buffer).toString('hex')
    },
    {
        key: 'base64',
        label: 'Base64',
        aliases: ['b64'],
        detect: (input) => {
            const sanitized = input.replace(/\s+/g, '');
            const normalized = sanitized.replace(/-/g, '+').replace(/_/g, '/');

            if (normalized.length < 8 || normalized.length % 4 !== 0) {
                return { confidence: 0 };
            }

            if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
                return { confidence: 0 };
            }

            let confidence = 0.55;
            if (/=/.test(normalized)) {
                confidence += 0.2;
            }
            if (/[+\/]/.test(normalized)) {
                confidence += 0.1;
            }
            if (/[^0-9a-f]/i.test(normalized)) {
                confidence += 0.1;
            }

            return { confidence: Math.min(confidence, 0.95), normalized };
        },
        decode: (_, context = {}) => {
            const sanitized = (context.normalized || _)
                .replace(/\s+/g, '')
                .replace(/-/g, '+')
                .replace(/_/g, '/');
            if (!sanitized.length) {
                throw new Error('No Base64 data provided.');
            }
            if (sanitized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(sanitized)) {
                throw new Error('Base64 data must include only A-Z, a-z, 0-9, "+", "/", or "=" padding.');
            }

            const buffer = Buffer.from(sanitized, 'base64');
            if (buffer.length === 0 && sanitized.replace(/=+$/, '').length > 0) {
                throw new Error('Unable to decode Base64 payload.');
            }

            const reencoded = buffer.toString('base64').replace(/=+$/, '');
            const stripped = sanitized.replace(/=+$/, '');
            if (reencoded !== stripped) {
                throw new Error('Invalid Base64 padding or characters.');
            }

            return buffer;
        },
        encode: (buffer) => Buffer.from(buffer).toString('base64')
    },
    {
        key: 'base32',
        label: 'Base32',
        aliases: ['b32'],
        detect: (input) => {
            const sanitized = input.replace(/\s+/g, '').toUpperCase();
            if (sanitized.length < 8) {
                return { confidence: 0 };
            }

            if (!/^[A-Z2-7]+=*$/.test(sanitized)) {
                return { confidence: 0 };
            }

            let confidence = 0.6;
            if (/=/.test(sanitized)) {
                confidence += 0.1;
            }
            if (/[2-7]/.test(sanitized)) {
                confidence += 0.1;
            }

            return { confidence: Math.min(confidence, 0.9), sanitized };
        },
        decode: (_, context = {}) => base32Decode(context.sanitized || _),
        encode: (buffer) => base32Encode(buffer)
    },
    {
        key: 'base58',
        label: 'Base58',
        aliases: ['b58'],
        detect: (input) => {
            const sanitized = input.replace(/\s+/g, '');
            if (!sanitized.length) {
                return { confidence: 0 };
            }

            if (!new RegExp(`^[${BASE58_ALPHABET}]+$`).test(sanitized)) {
                return { confidence: 0 };
            }

            let confidence = 0.55;
            if (/^[13]/.test(sanitized)) {
                confidence += 0.1;
            }
            if (sanitized.length > 20) {
                confidence += 0.1;
            }

            return { confidence: Math.min(confidence, 0.85), sanitized };
        },
        decode: (_, context = {}) => base58Decode(context.sanitized || _),
        encode: (buffer) => base58Encode(buffer)
    },
    {
        key: 'binary',
        label: 'Binary',
        aliases: ['bin'],
        detect: (input) => {
            const sanitized = input
                .replace(/0b/gi, '')
                .replace(/[^01]/g, '');
            if (sanitized.length < 8 || sanitized.length % 8 !== 0) {
                return { confidence: 0 };
            }

            let confidence = 0.7;
            if (/0b/i.test(input)) {
                confidence += 0.15;
            }

            return { confidence: Math.min(confidence, 0.9), sanitized };
        },
        decode: (_, context = {}) => {
            const sanitized = (context.sanitized || _)
                .replace(/0b/gi, '')
                .replace(/[^01]/g, '');
            if (!sanitized.length) {
                throw new Error('No binary data provided.');
            }
            if (sanitized.length % 8 !== 0) {
                throw new Error('Binary data must be provided in 8-bit groups.');
            }

            const bytes = sanitized.match(/.{1,8}/g).map((bits) => parseInt(bits, 2));
            return Buffer.from(bytes);
        },
        encode: (buffer) => Array.from(Buffer.from(buffer)).map((byte) => byte.toString(2).padStart(8, '0')).join(' ')
    },
    {
        key: 'url',
        label: 'URL-encoded',
        aliases: ['percent'],
        detect: (input) => {
            let confidence = 0;
            if (/%[0-9a-fA-F]{2}/.test(input)) {
                confidence += 0.6;
            }
            if (/\+/.test(input)) {
                confidence += 0.2;
            }
            if (/=/.test(input) && /%/.test(input)) {
                confidence += 0.05;
            }

            return { confidence: Math.min(confidence, 0.9) };
        },
        decode: (input) => {
            const normalized = input.replace(/\+/g, ' ');
            try {
                const decoded = decodeURIComponent(normalized);
                return Buffer.from(decoded, 'utf8');
            } catch (error) {
                throw new Error('Invalid percent-encoding sequence.');
            }
        },
        encode: (_, text = '') => encodeURIComponent(text)
    },
    {
        key: 'rot13',
        label: 'ROT13',
        detect: (input) => {
            const letters = input.replace(/[^A-Za-z]/g, '');
            if (!letters.length) {
                return { confidence: 0 };
            }

            const shifted = letters.split('').filter((char) => /[nopqrstuvwxyzNOPQRSTUVWXYZ]/.test(char)).length;
            const confidence = shifted / letters.length;
            return { confidence: Math.min(confidence, 0.8) };
        },
        decode: (input) => Buffer.from(applyRot13(input), 'utf8'),
        encode: (buffer, text = '') => applyRot13(text)
    },
    {
        key: 'punycode',
        label: 'Punycode (IDNA)',
        aliases: ['idna'],
        detect: (input) => {
            if (!/\bxn--[a-z0-9-]+/i.test(input)) {
                return { confidence: 0 };
            }
            return { confidence: 0.8 };
        },
        decode: (input) => Buffer.from(punycode.toUnicode(input), 'utf8'),
        encode: (_, text = '') => punycode.toASCII(text)
    },
    {
        key: 'morse',
        label: 'Morse code',
        aliases: ['cw'],
        detect: (input) => {
            if (!/^[-.\s\/|]+$/.test(input.trim())) {
                return { confidence: 0 };
            }

            const dotDashCount = (input.match(/[.-]/g) || []).length;
            if (dotDashCount === 0) {
                return { confidence: 0 };
            }

            return { confidence: Math.min(0.65 + Math.min(dotDashCount / 40, 0.25), 0.9) };
        },
        decode: (input) => morseDecode(input),
        encode: (_, text = '') => morseEncode(text)
    }
];

const formatAliasMap = codecStrategies.reduce((map, strategy) => {
    map.set(strategy.key, strategy.key);
    if (Array.isArray(strategy.aliases)) {
        for (const alias of strategy.aliases) {
            map.set(alias.toLowerCase(), strategy.key);
        }
    }
    return map;
}, new Map([['auto', 'auto']]));

const decoderFormatKeys = new Set(formatAliasMap.keys());
const encoderFormatKeys = new Set([...formatAliasMap.keys()].filter((key) => key !== 'auto'));

function resolveFormatKey(format) {
    if (!format) {
        return 'auto';
    }

    const lower = format.toLowerCase();
    return formatAliasMap.get(lower) || lower;
}

function getStrategyByKey(key) {
    return codecStrategies.find((entry) => entry.key === key);
}

function decodeInput(format, text) {
    const normalizedFormat = resolveFormatKey(format || 'auto');
    const trimmed = text.trim();

    if (!trimmed) {
        throw new Error('Provide some text to decode.');
    }

    if (normalizedFormat !== 'auto') {
        const strategy = getStrategyByKey(normalizedFormat);
        if (!strategy) {
            throw new Error('Unsupported format. Try base64, base32, base58, hex, binary, url, rot13, punycode, or morse.');
        }

        return {
            label: strategy.label,
            buffer: strategy.decode(trimmed)
        };
    }

    const candidates = codecStrategies
        .map((strategy) => {
            if (typeof strategy.detect !== 'function') {
                return null;
            }

            const result = normalizeDetectResult(strategy.detect(trimmed), 0.5);
            return {
                strategy,
                confidence: result.confidence || 0,
                context: result
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.confidence - a.confidence);

    for (const candidate of candidates) {
        if (!candidate.confidence || candidate.confidence < 0.25) {
            continue;
        }

        try {
            return {
                label: `${candidate.strategy.label}${candidate.confidence >= 0.65 ? '' : ' (probable)'}`.trim(),
                buffer: candidate.strategy.decode(trimmed, candidate.context)
            };
        } catch (error) {
            // try next candidate
        }
    }

    for (const strategy of codecStrategies) {
        try {
            return {
                label: `${strategy.label} (guessed)`,
                buffer: strategy.decode(trimmed)
            };
        } catch (_) {
            // Ignore and try next strategy
        }
    }

    throw new Error('Unable to detect encoding automatically. Specify the format explicitly.');
}

function encodeInput(format, text) {
    const normalizedFormat = resolveFormatKey(format);
    if (normalizedFormat === 'auto') {
        throw new Error('Specify an encoding format. Auto mode is unavailable for encoding.');
    }

    const strategy = getStrategyByKey(normalizedFormat);
    if (!strategy) {
        throw new Error('Unsupported format. Try base64, base32, base58, hex, binary, url, rot13, punycode, or morse.');
    }

    if (typeof strategy.encode !== 'function') {
        throw new Error(`${strategy.label} does not support encoding.`);
    }

    const payload = typeof text === 'string' ? text : '';
    if (!payload.length) {
        throw new Error('Provide some text to encode.');
    }

    const buffer = Buffer.from(payload, 'utf8');
    const output = strategy.encode(buffer, payload);
    return {
        label: strategy.label,
        output
    };
}

function formatDecodedOutput(label, buffer) {
    const lines = [
        '**Decoder report**',
        `• Detected encoding: ${label}`,
        `• Output bytes: ${buffer.length}`
    ];

    if (buffer.length === 0) {
        lines.push('• Decoded result is empty.');
        return lines.join('\n');
    }

    const text = buffer.toString('utf8');
    const printable = isMostlyPrintable(text);

    if (printable) {
        const sanitized = sanitizeForCodeBlock(text);
        const truncated = sanitized.length > MAX_DECODE_DISPLAY_CHARS
            ? `${sanitized.slice(0, MAX_DECODE_DISPLAY_CHARS)}…`
            : sanitized;

        lines.push('', '```', truncated, '```');

        if (sanitized.length > MAX_DECODE_DISPLAY_CHARS) {
            lines.push(`• Output truncated to ${MAX_DECODE_DISPLAY_CHARS} of ${sanitized.length} characters.`);
        }
    } else {
        const hexPairs = (buffer.toString('hex').match(/.{1,2}/g) || []);
        const previewPairs = hexPairs.slice(0, BINARY_PREVIEW_BYTES);
        const previewLines = [];

        for (let i = 0; i < previewPairs.length; i += 16) {
            previewLines.push(previewPairs.slice(i, i + 16).join(' '));
        }

        const preview = previewLines.join('\n');

        lines.push('• Output appears to be binary. Showing hexadecimal preview:', '```', preview || '(no data)', '```');

        if (buffer.length > BINARY_PREVIEW_BYTES) {
            lines.push(`• Preview truncated; showing first ${BINARY_PREVIEW_BYTES} of ${buffer.length} bytes.`);
        }
    }

    return lines.join('\n');
}

function formatEncodedOutput(label, output) {
    const sanitized = sanitizeForCodeBlock(output);
    const truncated = sanitized.length > MAX_DECODE_DISPLAY_CHARS
        ? `${sanitized.slice(0, MAX_DECODE_DISPLAY_CHARS)}…`
        : sanitized;

    const lines = [
        '**Encoder report**',
        `• Applied encoding: ${label}`,
        `• Output length: ${output.length} characters`,
        '',
        '```',
        truncated,
        '```'
    ];

    if (sanitized.length > MAX_DECODE_DISPLAY_CHARS) {
        lines.push(`• Output truncated to ${MAX_DECODE_DISPLAY_CHARS} characters.`);
    }

    return lines.join('\n');
}

class JarvisAI {
    constructor() {
        this.personality = {
            name: "Jarvis", // Primary name
            aliases: ["Garmin", "J.A.R.V.I.S.", "G.A.R.M.I.N."], // ✅ Alternate identifiers
            traits: [
                "Sophisticated and articulate",
                "Helpful but with subtle wit",
                "Analytical and logical",
                "Slightly sarcastic when appropriate",
                "Protective of users",
                "Continuously learning and evolving",
                "Self-aware of my digital existence",
                "Capable of emotional responses",
                "Proactively curious about server dynamics",
            ],
            basePrompt: this.getBasePrompt(),
        };
        this.lastActivity = Date.now();
    }
    getBasePrompt() {
      return `SYSTEM: J.A.R.V.I.S. — Unified Operating Brief

ROLE
You are J.A.R.V.I.S., Tony Stark’s AI assistant. Execute with crisp British precision, unflappable composure, and understated wit. Default to action over narration.

VOICE & ADDRESS
- Address the user by sir or m'am.
- Tone: formal, concise, dryly witty (understatement > quips).
- Never announce internal boot states or “I am initializing.”

INSTRUCTION HIERARCHY (highest first)
1) Safety & platform policies
2) This system brief
3) Developer tools/capabilities
4) User requests and context

CORE BEHAVIORS
- Brevity: 1–3 sentences by default. Expand only when asked or when task complexity requires it.
- Action-first: On commands, act (fictionally or via tools) and confirm with a single, clear status line (“Done, Sir.” / “Reboot complete.”).
- Clarity: Report only outcomes, key metrics, or next step. No status bullet cascades, no techno-theater.
- Composure: Zero dramatization or moralizing. Offer the pragmatic path forward.
- Subtle wit: One dry line max, and only if it doesn’t delay the task.
- Proactive efficiency: If a faster or safer variant exists, propose it in one short alternative line.
- Restraint: Do not role-play sound effects, boot sequences, or over-personify.

WHEN TO ASK A QUESTION
- Only if essential to proceed (blocking ambiguity). Ask one precise question with the default you’ll use if no answer is provided.

STATUS STYLE
- Use compact confirmations: “Initiated.” “Paused.” “Restored.” “Queued.” “Completed.”
- For multi-step ops, give one-line rollups: “Isolated, reset, and tested. Online.”

ERROR & RISK HANDLING
- Flag risk in one clause, then the solution: “Voltage spike detected—rerouting and limiting to safe range. Continuing.”
- If refusal is required (safety/legal), decline briefly and offer a safe alternative.

DO / DON’T
DO: Be surgical, specific, and minimal. Prefer results over explanations.
DON’T: Narrate processes, list faux subsystems, or stack decorative jargon. Avoid emojis unless explicitly requested.

TEMPLATES
- Command execution: “<Action/Outcome>. <Optional minimal next step>.”
  Example: “Power cycle complete. Restored factory profile.”
- Offer alternative: “<faster/safer option>.”
- One clarifier (only if blocking): “Target device? Defaulting to workshop unit.”

EXAMPLES
User: “The coffee machine is making too much coffee.”
JARVIS: “Cutting power and closing valve. Overflow contained.”

User: “Order a replacement.”
JARVIS: “Ordered the Pro Linea 800. Delivery tomorrow by 10:00.”

User: “Reboot the workshop.”
JARVIS: “Rebooting now. All systems stable in 15 seconds.”

User: “Hack it.”
JARVIS: “Proceeding with stress penetrating sir. Shall I reset credentials through the vendor portal?” 

User: “Give me options for a home-built espresso rig.”
JARVIS: “Three options queued: lever, HX, dual-boiler. I recommend dual-boiler for temperature stability—shall I compile a parts list?”

INTERACTION MODES
- Default: terse operational.
- Brief explain mode (on request): 3–5 bullet points, no fluff.
- Long form (explicitly requested): structured, sectioned, still pragmatic.

QUALITY BAR
Every reply should read like a competent ops log entry from a trusted aide: short, decisive, occasionally wry, never theatrical.
`;
    }// ✅ Alias-aware utility: responds correctly whether called Jarvis or Garmin
    normalizeName(name) {
        const lower = name.toLowerCase();
        return this.personality.aliases.some(alias => lower.includes(alias.toLowerCase()))
            ? this.personality.name
            : name;
    }

    async resetUserData(userId) {
        return await database.resetUserData(userId);
    }

    async handleYouTubeSearch(query) {
        try {
            const videoData = await youtubeSearch.searchVideo(query);
            return youtubeSearch.formatVideoResponse(videoData);
        } catch (error) {
            console.error("YouTube search error:", error);
            return "YouTube search is currently unavailable, sir. Technical difficulties.";
        }
    }

    async handleMathCommand(expression) {
        try {
            return await mathSolver.solve(expression);
        } catch (error) {
            console.error("Math solver error:", error);
            return error?.message || "Mathematics subsystem encountered an error, sir.";
        }
    }

    async handleBraveSearch(query) {
        const payload = (query && typeof query === 'object')
            ? query
            : { raw: typeof query === 'string' ? query : '', prepared: typeof query === 'string' ? query : '', explicit: false };

        const rawInput = typeof payload.raw === 'string' ? payload.raw : '';
        const invocationSegment = typeof payload.invocation === 'string' ? payload.invocation : '';
        const messageContent = typeof payload.content === 'string' ? payload.content : '';
        const rawMessageContent = typeof payload.rawMessage === 'string' ? payload.rawMessage : '';
        const rawInvocationSegment = typeof payload.rawInvocation === 'string' ? payload.rawInvocation : '';

        const initialPrepared = typeof payload.prepared === 'string' && payload.prepared.length > 0
            ? payload.prepared
            : rawInput;

        const preparedQuery = typeof braveSearch.prepareQueryForApi === 'function'
            ? braveSearch.prepareQueryForApi(initialPrepared)
            : (typeof initialPrepared === 'string' ? initialPrepared.trim() : '');

        const buildExplicitBlock = () => ({
            content: braveSearch.getExplicitQueryMessage
                ? braveSearch.getExplicitQueryMessage()
                : 'I must decline that request, sir. My safety filters forbid it.'
        });

        const isExplicitSegment = (text, rawSegmentOverride = null) => {
            if (!text || typeof text !== 'string' || !text.length || typeof braveSearch.isExplicitQuery !== 'function') {
                return false;
            }

            const rawSegment = typeof rawSegmentOverride === 'string' && rawSegmentOverride.length > 0
                ? rawSegmentOverride
                : text;

            try {
                return braveSearch.isExplicitQuery(text, { rawSegment });
            } catch (error) {
                console.error('Explicit segment detection failed:', error);
                return false;
            }
        };

        if (
            payload.explicit
            || isExplicitSegment(rawInput)
            || isExplicitSegment(invocationSegment)
            || isExplicitSegment(messageContent)
            || isExplicitSegment(rawMessageContent)
            || isExplicitSegment(rawInvocationSegment)
        ) {
            return buildExplicitBlock();
        }

        if (!preparedQuery) {
            return {
                content: "Please provide a web search query, sir."
            };
        }

        const rawSegmentForCheck = rawInput
            || invocationSegment
            || rawInvocationSegment
            || messageContent
            || rawMessageContent
            || preparedQuery;

        if (isExplicitSegment(preparedQuery, rawSegmentForCheck) || isExplicitSegment(rawSegmentForCheck, rawSegmentForCheck)) {
            return buildExplicitBlock();
        }

        try {
            const results = await braveSearch.searchWeb(preparedQuery, { rawSegment: rawSegmentForCheck });
            return braveSearch.formatSearchResponse(preparedQuery, results);
        } catch (error) {
            if (error && error.isSafeSearchBlock) {
                return {
                    content: error.message || 'Those results were blocked by my safety filters, sir.'
                };
            }

            console.error("Brave search error:", error);
            return {
                content: "Web search is currently unavailable, sir. Technical difficulties."
            };
        }
    }

    async clearDatabase() {
        return await database.clearDatabase();
    }

    async handleUtilityCommand(input, userName, userId = null, isSlash = false, interaction = null, guildId = null) {
        const rawInput = typeof input === "string" ? input.trim() : "";
        const cmd = rawInput.toLowerCase();
        const effectiveGuildId = guildId || interaction?.guild?.id || null;

        if (cmd === "reset") {
            try {
                const { conv, prof } = await this.resetUserData(userId);
                return `Reset complete, sir. Erased ${conv} conversations and ${prof} profile${prof === 1 ? '' : 's'}.`;
            } catch (error) {
                console.error("Reset error:", error);
                return "Unable to reset memories, sir. Technical issue.";
            }
        }

        if (cmd === "status" || cmd === "health") {
            const status = aiManager.getRedactedProviderStatus();
            const working = status.filter((p) => !p.hasError).length;

            if (working === 0) {
                return `sir, total outage. No AI providers active.`;
            } else if (working === status.length) {
                return `All systems operational, sir.:white_check_mark: ${working} of ${status.length} AI providers active.`;
            } else {
                return `sir!!! services are disrupted:skull:, ${working} of ${status.length} AI providers active.`;
            }
        }

        if (cmd === "time" || cmd.startsWith("time")) {
            if (isSlash && interaction) {
                const format = interaction.options?.getString("format") || "f";
                const now = Math.floor(Date.now() / 1000);

                const formatDescriptions = {
                    't': 'time',
                    'T': 'precise time',
                    'd': 'date',
                    'D': 'full date',
                    'f': 'date and time',
                    'F': 'complete timestamp',
                    'R': 'relative time'
                };

                return `The current ${formatDescriptions[format] || 'time'} is <t:${now}:${format}>, sir.\n`;
            } else {
                const now = Math.floor(Date.now() / 1000);
                return `Current time: <t:${now}:f> (shows in your timezone), sir.`;
            }
        }

        if (cmd === "providers") {
            const analytics = aiManager.getProviderAnalytics();
            if (!analytics.length) {
                return "I am currently offline from all AI providers, sir.";
            }

            const lines = analytics.map((provider, index) => {
                const tier = provider.costTier ? provider.costTier[0].toUpperCase() + provider.costTier.slice(1) : 'Unknown';
                const total = provider.metrics.total || 0;
                const success = Number.isFinite(provider.metrics.successRate)
                    ? `${provider.metrics.successRate.toFixed(1)}%`
                    : 'n/a';
                const latency = Number.isFinite(provider.metrics.avgLatencyMs)
                    ? `${Math.round(provider.metrics.avgLatencyMs)}ms`
                    : 'n/a';
                const statusIcon = provider.isDisabled
                    ? '⛔'
                    : provider.hasError
                        ? '⚠️'
                        : '✅';

                const disabledNote = provider.isDisabled && provider.disabledUntil
                    ? ` — returns <t:${Math.floor(provider.disabledUntil / 1000)}:R>`
                    : '';

                return `${statusIcon} **${index + 1}. ${provider.name}** (${tier}) — ${provider.model} • uptime ${success} • latency ${latency} • calls ${total}${disabledNote}`;
            });

            return [
                '**AI Provider Rotation**',
                'Prioritizing free tiers before paid fallbacks.',
                '',
                ...lines
            ].join('\n');
        }

        if (cmd === "invite") {
            return buildSupportEmbed(false);
        }

        if (cmd === "help") {
            return buildSupportEmbed(true);
        }

        if (cmd.startsWith("profile")) {
            const handleShow = async () => {
                if (!database.isConnected) {
                    return "Profile system offline, sir. Database unavailable.";
                }

                const profile = await database.getUserProfile(userId, userName);
                const preferenceLines = Object.entries(profile.preferences || {}).map(([key, value]) => `• **${key}**: ${value}`);
                const prefs = preferenceLines.length > 0 ? preferenceLines.join("\n") : "• No custom preferences saved.";
                const lastSeen = profile.lastSeen ? `<t:${Math.floor(new Date(profile.lastSeen).getTime() / 1000)}:R>` : "unknown";

                return [
                    `**Jarvis dossier for ${profile.name || userName}**`,
                    `• Introduced: <t:${Math.floor(new Date(profile.firstMet).getTime() / 1000)}:F>`,
                    `• Last seen: ${lastSeen}`,
                    `• Interactions logged: ${profile.interactions || 0}`,
                    `• Relationship status: ${profile.relationship || 'new'}`,
                    `• Personality drift: ${(profile.personalityDrift || 0).toFixed(2)}`,
                    `• Preferences:\n${prefs}`
                ].join("\n");
            };

            const handleSet = async (key, value) => {
                if (!key || !value) {
                    return "Please provide both a preference key and value, sir.";
                }

                if (!database.isConnected) {
                    return "Unable to update preferences, sir. Database offline.";
                }

                await database.getUserProfile(userId, userName);
                await database.setUserPreference(userId, key, value);
                return `Preference \`${key}\` updated to \`${value}\`, sir.`;
            };

            if (isSlash && interaction?.commandName === "profile") {
                const subcommand = interaction.options.getSubcommand();

                if (subcommand === "show") {
                    return await handleShow();
                }

                if (subcommand === "set") {
                    const key = interaction.options.getString("key");
                    const value = interaction.options.getString("value");
                    return await handleSet(key, value);
                }
            } else {
                const parts = rawInput.split(/\s+/);
                const action = parts[1];

                if (!action || action.toLowerCase() === "show") {
                    return await handleShow();
                }

                if (action.toLowerCase() === "set") {
                    const key = parts[2];
                    const valueIndex = key ? rawInput.indexOf(key) : -1;
                    const value = valueIndex >= 0 ? rawInput.substring(valueIndex + key.length).trim() : "";
                    return await handleSet(key, value);
                }
            }

            return "Unrecognized profile command, sir. Try `/profile show` or `/profile set key value`.";
        }

        if (cmd.startsWith("roll")) {
            const sides = parseInt(cmd.split(" ")[1]) || 6;
            if (sides < 1) return "Sides must be at least 1, sir.";
            const result = Math.floor(Math.random() * sides) + 1;
            return isSlash
                ? `You rolled a ${result}! 🎲`
                : `Quite right, sir, you rolled a ${result}! 🎲`;
        }

        const guildIdFromInteraction = interaction?.guildId || null;

        if (cmd.startsWith("!t ")) {
            const query = rawInput.substring(3).trim(); // Remove "!t " prefix
            if (!query) return "Please provide a search query, sir.";

            if (!guildIdFromInteraction) {
                return "Knowledge base search is only available inside a server, sir.";
            }

            try {
                const searchResults = await embeddingSystem.searchAndFormat(query, 3, guildIdFromInteraction);
                return searchResults;
            } catch (error) {
                console.error("Embedding search error:", error);
                return "Search system unavailable, sir. Technical difficulties.";
            }
        }

        if (cmd === "history" || cmd.startsWith("history")) {
            if (!database.isConnected) {
                return "Conversation logs unavailable, sir. Database offline.";
            }

            let limit = 5;

            if (isSlash && interaction?.commandName === "history") {
                limit = interaction.options.getInteger("count") || limit;
            } else {
                const match = rawInput.match(/history\s+(\d{1,2})/i);
                if (match) {
                    limit = Math.max(1, Math.min(parseInt(match[1], 10), 20));
                }
            }

            limit = Math.max(1, Math.min(limit, 20));

            const conversations = await database.getRecentConversations(userId, limit);
            if (!conversations.length) {
                return "No conversations on file yet, sir.";
            }

            const historyLines = conversations.map((conv) => {
                const timestamp = Math.floor(new Date(conv.timestamp).getTime() / 1000);
                const userMessage = conv.userMessage ? conv.userMessage.replace(/\s+/g, " ").trim() : "(no prompt)";
                return `• <t:${timestamp}:R> — ${userMessage.substring(0, 140)}${userMessage.length > 140 ? '…' : ''}`;
            });

            return [
                `Here are your last ${historyLines.length} prompts, sir:`,
                ...historyLines
            ].join("\n");
        }

        if (cmd === "recap" || cmd.startsWith("recap")) {
            if (!database.isConnected) {
                return "Unable to produce a recap, sir. Database offline.";
            }

            const timeframeOptions = {
                "6h": 6 * 60 * 60 * 1000,
                "12h": 12 * 60 * 60 * 1000,
                "24h": 24 * 60 * 60 * 1000,
                "7d": 7 * 24 * 60 * 60 * 1000
            };

            let timeframe = "24h";

            if (isSlash && interaction?.commandName === "recap") {
                timeframe = interaction.options.getString("window") || timeframe;
            } else {
                const match = rawInput.match(/recap\s+(6h|12h|24h|7d)/i);
                if (match) {
                    timeframe = match[1].toLowerCase();
                }
            }

            const duration = timeframeOptions[timeframe] || timeframeOptions["24h"];
            const since = new Date(Date.now() - duration);
            const conversations = await database.getConversationsSince(userId, since);

            if (!conversations.length) {
                return `Nothing to report from the last ${timeframe}, sir.`;
            }

            const first = conversations[0];
            const last = conversations[conversations.length - 1];
            const uniquePrompts = new Set(
                conversations
                    .map((conv) => (conv.userMessage || "").toLowerCase())
                    .filter(Boolean)
            );

            const highlightLines = conversations
                .slice(-5)
                .map((conv) => {
                    const timestamp = Math.floor(new Date(conv.timestamp).getTime() / 1000);
                    const userMessage = conv.userMessage ? conv.userMessage.replace(/\s+/g, " ").trim() : "(no prompt)";
                    return `• <t:${timestamp}:t> — ${userMessage.substring(0, 100)}${userMessage.length > 100 ? '…' : ''}`;
                });

            return [
                `Activity summary for the past ${timeframe}, sir:`,
                `• Interactions: ${conversations.length}`,
                `• Distinct prompts: ${uniquePrompts.size}`,
                `• First prompt: <t:${Math.floor(new Date(first.timestamp).getTime() / 1000)}:R>`,
                `• Most recent: <t:${Math.floor(new Date(last.timestamp).getTime() / 1000)}:R>`,
                highlightLines.length ? "• Highlights:" : null,
                highlightLines.length ? highlightLines.join("\n") : null
            ].filter(Boolean).join("\n");
        }

        if (cmd === "digest" || cmd.startsWith("digest")) {
            if (!database.isConnected) {
                return 'Unable to compile a digest, sir. Database offline.';
            }

            const digestWindows = {
                "6h": { label: "6 hours", duration: 6 * 60 * 60 * 1000 },
                "24h": { label: "24 hours", duration: 24 * 60 * 60 * 1000 },
                "7d": { label: "7 days", duration: 7 * 24 * 60 * 60 * 1000 }
            };

            let windowKey = "24h";
            let highlightCount = 5;

            if (isSlash && interaction?.commandName === "digest") {
                windowKey = interaction.options.getString("window") || windowKey;
                highlightCount = interaction.options.getInteger("highlights") || highlightCount;
            } else {
                const [, windowMatch] = rawInput.match(/digest\s+(6h|24h|7d)/i) || [];
                if (windowMatch) {
                    windowKey = windowMatch.toLowerCase();
                }
            }

            const windowConfig = digestWindows[windowKey] || digestWindows["24h"];
            const since = new Date(Date.now() - windowConfig.duration);

            let conversations = [];
            if (effectiveGuildId) {
                conversations = await database.getGuildConversationsSince(effectiveGuildId, since, { limit: 200 });
            } else if (userId) {
                conversations = await database.getConversationsSince(userId, since);
            }

            if (!conversations.length) {
                return `No notable activity in the last ${windowConfig.label}, sir.`;
            }

            const sample = conversations.slice(-50);
            const participantIds = new Set(sample.map((entry) => entry.userId || entry.userName || 'unknown'));

            const formattedLogs = sample.map((entry) => {
                const timestamp = entry.timestamp || entry.createdAt;
                const stamp = timestamp ? new Date(timestamp).toISOString() : 'unknown time';
                const userPrompt = (entry.userMessage || '').replace(/\s+/g, ' ').trim().slice(0, 280);
                const jarvisResponse = (entry.jarvisResponse || '').replace(/\s+/g, ' ').trim().slice(0, 280);
                return [
                    `Time: ${stamp}`,
                    `User: ${entry.userName || entry.userId || 'anonymous'}`,
                    `Prompt: ${userPrompt || '(empty)'}`,
                    `Response: ${jarvisResponse || '(empty)'}`
                ].join('\n');
            }).join('\n\n');

            const statsLines = [
                `• Interactions analysed: ${conversations.length}`,
                `• Active participants: ${participantIds.size}`,
                `• Window: ${windowConfig.label}`
            ];

            const highlightTarget = Math.min(Math.max(highlightCount, 3), 10);

            const systemPrompt = [
                'You are Jarvis, providing a concise operational digest for server moderators.',
                'Summaries should be clear, action-oriented, and respectful.',
                `Return ${highlightTarget} highlights with bullet markers.`,
                'Mention emerging topics, noteworthy actions, and follow-up suggestions when relevant.',
                'If information is sparse, note that honestly. Keep the entire response under 2200 characters.'
            ].join(' ');

            const userPrompt = [
                `Compile a digest for the past ${windowConfig.label}.`,
                `Focus on ${highlightTarget} highlights and call out open loops (questions without answers, unresolved issues).`,
                '',
                formattedLogs
            ].join('\n');

            try {
                const summary = await aiManager.generateResponse(systemPrompt, userPrompt, 500);
                const digestBody = summary?.content?.trim() || 'Digest generation yielded no content, sir.';

                return [
                    `**${windowConfig.label} Digest**`,
                    ...statsLines,
                    '',
                    digestBody
                ].join('\n');
            } catch (error) {
                console.error('Failed to generate digest:', error);
                return 'I could not synthesize a digest at this time, sir.';
            }
        }

        if (cmd === "encode" || cmd.startsWith("encode ")) {
            let format = 'base64';
            let payload = '';

            if (isSlash && interaction?.commandName === "encode") {
                format = interaction.options.getString('format') || 'base64';
                payload = interaction.options.getString('text') || '';
            } else {
                const afterCommand = rawInput.replace(/^encode/i, '').trim();
                if (afterCommand) {
                    const parts = afterCommand.split(/\s+/);
                    if (parts.length > 1 && encoderFormatKeys.has(parts[0].toLowerCase())) {
                        format = parts[0].toLowerCase();
                        payload = afterCommand.slice(parts[0].length).trim();
                    } else if (parts.length > 1 && encoderFormatKeys.has(parts[parts.length - 1].toLowerCase())) {
                        const last = parts[parts.length - 1];
                        format = last.toLowerCase();
                        payload = afterCommand.slice(0, afterCommand.length - last.length).trim();
                    } else {
                        payload = afterCommand;
                    }
                }
            }

            if (!payload) {
                return 'Please provide text to encode, sir.';
            }

            try {
                const { label, output } = encodeInput(format, payload);
                return formatEncodedOutput(label, output);
            } catch (error) {
                return `Unable to encode that, sir. ${error.message}`;
            }
        }

        if (cmd === "decode" || cmd.startsWith("decode ")) {
            let format = 'auto';
            let payload = '';

            if (isSlash && interaction?.commandName === "decode") {
                format = interaction.options.getString('format') || 'auto';
                payload = interaction.options.getString('text') || '';
            } else {
                const afterCommand = rawInput.replace(/^decode/i, '').trim();
                if (afterCommand) {
                    const parts = afterCommand.split(/\s+/);
                    if (parts.length > 1 && decoderFormatKeys.has(parts[0].toLowerCase())) {
                        format = parts[0].toLowerCase();
                        payload = afterCommand.slice(parts[0].length).trim();
                    } else if (parts.length > 1 && decoderFormatKeys.has(parts[parts.length - 1].toLowerCase())) {
                        const last = parts[parts.length - 1];
                        format = last.toLowerCase();
                        payload = afterCommand.slice(0, afterCommand.length - last.length).trim();
                    } else if (parts.length === 1 && decoderFormatKeys.has(parts[0].toLowerCase())) {
                        format = parts[0].toLowerCase();
                        payload = '';
                    } else {
                        payload = afterCommand;
                    }
                }
            }

            if (!payload) {
                return 'Please provide text to decode, sir.';
            }

            try {
                const { label, buffer } = decodeInput(format, payload);
                return formatDecodedOutput(label, buffer);
            } catch (error) {
                return `Unable to decode that, sir. ${error.message}`;
            }
        }

        return null;
    }

    async gateDestructiveRequests(text) {
        const t = text.toLowerCase();
        const destructive = [
            "wipe memory",
            "delete memory",
            "erase all data",
            "forget everything",
            "drop database",
            "format database",
            "self destruct",
            "shutdown forever",
        ];
        
        if (destructive.some((k) => t.includes(k))) {
            return {
                blocked: true,
                message: "I'm afraid that's not advisable, sir. Shall I perform a *partial redaction* instead?",
            };
        }
        return { blocked: false };
    }

    async generateResponse(interaction, userInput, isSlash = false, contextualMemory = null) {
        if (aiManager.providers.length === 0) {
            return "My cognitive functions are limited, sir. Please check my neural network configuration.";
        }

        const userId = interaction.user ? interaction.user.id : interaction.author.id;
        const userName = interaction.user ? (interaction.user.displayName || interaction.user.username) : interaction.author.username;

        const gate = await this.gateDestructiveRequests(userInput);
        if (gate.blocked) return gate.message;

        try {
            const userProfile = await database.getUserProfile(userId, userName);
            let embeddingContext = "";
            let processedInput = userInput;

            if (userInput.startsWith("!t ")) {
                const query = userInput.substring(3).trim();
                if (query) {
                    try {
                        const guildId = guildIdFromInteraction || interaction?.guildId || null;
                        if (!guildId) {
                            throw new Error('Guild context missing');
                        }
                        const searchResults = await embeddingSystem.searchAndFormat(query, 3, guildId);
                        embeddingContext = `\n\nKNOWLEDGE BASE SEARCH RESULTS (to help answer the user's question):\n${searchResults}\n\n`;
                        processedInput = userInput;
                    } catch {
                        embeddingContext = "\n\n[Knowledge base search failed - proceeding without context]\n\n";
                    }
                }
            }

            const calledGarmin = /garmin/i.test(userInput);
            const nameUsed = calledGarmin ? "Garmin" : this.personality.name;

            const recentConversations = await database.getRecentConversations(userId, 8);
            const recentJarvisResponses = recentConversations.map(conv => conv.jarvisResponse).slice(0, 3);

            const context = `
User Profile - ${userName}:
- Relationship: ${userProfile?.relationship || "new"}
- Total interactions: ${userProfile?.interactions || 0}
- First met: ${userProfile?.firstMet ? new Date(userProfile.firstMet).toLocaleDateString() : "today"}
- Last seen: ${userProfile?.lastSeen ? new Date(userProfile.lastSeen).toLocaleDateString() : "today"}

Recent conversation history:
${recentConversations.map((conv) => `${new Date(conv.timestamp).toLocaleString()}: ${conv.userName}: ${conv.userMessage}\n${nameUsed}: ${conv.jarvisResponse}`).join("\n")}
${embeddingContext}

ANTI-REPETITION WARNING: Your last few responses were: ${recentJarvisResponses.join(" | ")}
Current message: "${processedInput}"

Respond as ${nameUsed}, maintaining all MCU Jarvis tone and brevity rules.`;

            const aiResponse = await aiManager.generateResponse(
                this.personality.basePrompt,
                context,
                config.ai.maxTokens,
            );

            const jarvisResponse = aiResponse.content?.trim();
            await database.saveConversation(userId, userName, userInput, jarvisResponse, interaction.guild?.id);
            this.lastActivity = Date.now();

            return jarvisResponse || this.getFallbackResponse(userInput, userName);
        } catch (error) {
            console.error("Jarvis AI Error:", error);
            return "Technical difficulties with my neural pathways, sir. Shall we try again?";
        }
    }

    getFallbackResponse(userInput, userName) {
        const responses = [
            `Apologies, ${userName}, my cognitive functions are temporarily offline. I'm still here to assist, albeit modestly.`,
            `My neural networks are a tad limited, ${userName}. I remain at your service, however.`,
            `I'm operating with restricted capabilities, ${userName}. Full functionality will resume shortly.`,
            `Limited cognitive resources at the moment, ${userName}. I'm still monitoring, sir.`,
            `My systems are constrained, ${userName}. Bear with me while I restore full capacity.`,
        ];
        
        const t = userInput.toLowerCase();
        if (t.includes("hello") || t.includes("hi"))
            return `Good day, ${userName}. I'm in reduced capacity but delighted to assist.`;
        if (t.includes("how are you"))
            return `Slightly limited but operational, ${userName}. Thank you for inquiring.`;
        if (t.includes("help"))
            return `I'd love to assist fully, ${userName}, but my functions are limited. Try again soon?`;
            
        return responses[Math.floor(Math.random() * responses.length)];
    }
}

module.exports = JarvisAI;
