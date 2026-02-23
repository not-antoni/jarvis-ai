'use strict';

const { toASCII, toUnicode } = require('url');

const MAX_DECODE_DISPLAY_CHARS = 1800;
const BINARY_PREVIEW_BYTES = 32;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const MORSE_TABLE = {
    A: '.-',
    B: '-...',
    C: '-.-.',
    D: '-..',
    E: '.',
    F: '..-.',
    G: '--.',
    H: '....',
    I: '..',
    J: '.---',
    K: '-.-',
    L: '.-..',
    M: '--',
    N: '-.',
    O: '---',
    P: '.--.',
    Q: '--.-',
    R: '.-.',
    S: '...',
    T: '-',
    U: '..-',
    V: '...-',
    W: '.--',
    X: '-..-',
    Y: '-.--',
    Z: '--..',
    0: '-----',
    1: '.----',
    2: '..---',
    3: '...--',
    4: '....-',
    5: '.....',
    6: '-....',
    7: '--...',
    8: '---..',
    9: '----.',
    '.': '.-.-.-',
    ',': '--..--',
    '?': '..--..',
    "'": '.----.',
    '!': '-.-.--',
    '/': '-..-.',
    '(': '-.--.',
    ')': '-.--.-',
    '&': '.-...',
    ':': '---...',
    ';': '-.-.-.',
    '=': '-...-',
    '+': '.-.-.',
    '-': '-....-',
    _: '..--.-',
    '"': '.-..-.',
    $: '...-..-',
    '@': '.--.-.',
    '¿': '..-.-',
    '¡': '--...-',
    ' ': '/' // treat spaces as /
};

const REVERSE_MORSE_TABLE = Object.entries(MORSE_TABLE).reduce((acc, [char, code]) => {
    acc[code] = char;
    return acc;
}, {});

function sanitizeForCodeBlock(text) {
    return text.replace(/```/g, '`\u200b``');
}

function isMostlyPrintable(text) {
    if (!text) {
        return false;
    }

    let printable = 0;
    for (const char of text) {
        const code = char.charCodeAt(0);
        if ((code >= 32 && code <= 126) || code === 9 || code === 10 || code === 13) {
            printable++;
        }
    }

    return printable / text.length >= 0.8;
}

function applyRot13(text) {
    return text.replace(/[a-zA-Z]/g, char => {
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
    let output = chunks
        .map(chunk => {
            const padded = chunk.padEnd(5, '0');
            const index = parseInt(padded, 2);
            return BASE32_ALPHABET[index];
        })
        .join('');

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
    const byteValues = bytes.map(byte => parseInt(byte, 2)).filter(value => !Number.isNaN(value));

    return Buffer.from(byteValues);
}

function base58Encode(buffer) {
    if (!Buffer.isBuffer(buffer)) {
        buffer = Buffer.from(buffer);
    }

    let num = BigInt(`0x${  buffer.toString('hex')}`);
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
        hex = `0${  hex}`;
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
        .map(char => MORSE_TABLE[char] || '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s{2,}/g, ' ');
}

function morseDecode(input) {
    const segments = input.trim().split(/\s+/);
    const decoded = segments
        .map(segment => {
            if (segment === '/' || segment === '|') {
                return ' ';
            }
            return REVERSE_MORSE_TABLE[segment] || '';
        })
        .join('');

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
        const confidence =
            typeof result.confidence === 'number'
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
        detect: input => {
            const sanitized = input
                .replace(/0x/gi, '')
                .replace(/\\x/gi, '')
                .replace(/[^0-9a-fA-F]/g, '');
            if (
                sanitized.length < 2 ||
                sanitized.length % 2 !== 0 ||
                !/^[0-9a-fA-F]+$/.test(sanitized)
            ) {
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
        encode: buffer => Buffer.from(buffer).toString('hex')
    },
    {
        key: 'base64',
        label: 'Base64',
        aliases: ['b64'],
        detect: input => {
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
                throw new Error(
                    'Base64 data must include only A-Z, a-z, 0-9, "+", "/", or "=" padding.'
                );
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
        encode: buffer => Buffer.from(buffer).toString('base64')
    },
    {
        key: 'base32',
        label: 'Base32',
        aliases: ['b32'],
        detect: input => {
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
        encode: buffer => base32Encode(buffer)
    },
    {
        key: 'base58',
        label: 'Base58',
        aliases: ['b58'],
        detect: input => {
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
        encode: buffer => base58Encode(buffer)
    },
    {
        key: 'binary',
        label: 'Binary',
        aliases: ['bin'],
        detect: input => {
            const sanitized = input.replace(/0b/gi, '').replace(/[^01]/g, '');
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
            const sanitized = (context.sanitized || _).replace(/0b/gi, '').replace(/[^01]/g, '');
            if (!sanitized.length) {
                throw new Error('No binary data provided.');
            }
            if (sanitized.length % 8 !== 0) {
                throw new Error('Binary data must be provided in 8-bit groups.');
            }

            const bytes = sanitized.match(/.{1,8}/g).map(bits => parseInt(bits, 2));
            return Buffer.from(bytes);
        },
        encode: buffer =>
            Array.from(Buffer.from(buffer))
                .map(byte => byte.toString(2).padStart(8, '0'))
                .join(' ')
    },
    {
        key: 'url',
        label: 'URL-encoded',
        aliases: ['percent'],
        detect: input => {
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
        decode: input => {
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
        detect: input => {
            const letters = input.replace(/[^A-Za-z]/g, '');
            if (!letters.length) {
                return { confidence: 0 };
            }

            const shifted = letters
                .split('')
                .filter(char => /[nopqrstuvwxyzNOPQRSTUVWXYZ]/.test(char)).length;
            const confidence = shifted / letters.length;
            return { confidence: Math.min(confidence, 0.8) };
        },
        decode: input => Buffer.from(applyRot13(input), 'utf8'),
        encode: (buffer, text = '') => applyRot13(text)
    },
    {
        key: 'punycode',
        label: 'Punycode (IDNA)',
        aliases: ['idna'],
        detect: input => {
            if (!/\bxn--[a-z0-9-]+/i.test(input)) {
                return { confidence: 0 };
            }
            return { confidence: 0.8 };
        },
        decode: input => Buffer.from(toUnicode(input), 'utf8'),
        encode: (_, text = '') => toASCII(text)
    },
    {
        key: 'morse',
        label: 'Morse code',
        aliases: ['cw'],
        detect: input => {
            if (!/^[-.\s\/|]+$/.test(input.trim())) {
                return { confidence: 0 };
            }

            const dotDashCount = (input.match(/[.-]/g) || []).length;
            if (dotDashCount === 0) {
                return { confidence: 0 };
            }

            return { confidence: Math.min(0.65 + Math.min(dotDashCount / 40, 0.25), 0.9) };
        },
        decode: input => morseDecode(input),
        encode: (_, text = '') => morseEncode(text)
    }
];

const formatAliasMap = codecStrategies.reduce(
    (map, strategy) => {
        map.set(strategy.key, strategy.key);
        if (Array.isArray(strategy.aliases)) {
            for (const alias of strategy.aliases) {
                map.set(alias.toLowerCase(), strategy.key);
            }
        }
        return map;
    },
    new Map([['auto', 'auto']])
);

const decoderFormatKeys = new Set(formatAliasMap.keys());
const encoderFormatKeys = new Set([...formatAliasMap.keys()].filter(key => key !== 'auto'));

function resolveFormatKey(format) {
    if (!format) {
        return 'auto';
    }

    const lower = format.toLowerCase();
    return formatAliasMap.get(lower) || lower;
}

function getStrategyByKey(key) {
    return codecStrategies.find(entry => entry.key === key);
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
            throw new Error(
                'Unsupported format. Try base64, base32, base58, hex, binary, url, rot13, punycode, or morse.'
            );
        }

        return {
            label: strategy.label,
            buffer: strategy.decode(trimmed)
        };
    }

    const candidates = codecStrategies
        .map(strategy => {
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
        throw new Error(
            'Unsupported format. Try base64, base32, base58, hex, binary, url, rot13, punycode, or morse.'
        );
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
        const truncated =
            sanitized.length > MAX_DECODE_DISPLAY_CHARS
                ? `${sanitized.slice(0, MAX_DECODE_DISPLAY_CHARS)}…`
                : sanitized;

        lines.push('', '```', truncated, '```');

        if (sanitized.length > MAX_DECODE_DISPLAY_CHARS) {
            lines.push(
                `• Output truncated to ${MAX_DECODE_DISPLAY_CHARS} of ${sanitized.length} characters.`
            );
        }
    } else {
        const hexPairs = buffer.toString('hex').match(/.{1,2}/g) || [];
        const previewPairs = hexPairs.slice(0, BINARY_PREVIEW_BYTES);
        const previewLines = [];

        for (let i = 0; i < previewPairs.length; i += 16) {
            previewLines.push(previewPairs.slice(i, i + 16).join(' '));
        }

        const preview = previewLines.join('\n');

        lines.push(
            '• Output appears to be binary. Showing hexadecimal preview:',
            '```',
            preview || '(no data)',
            '```'
        );

        if (buffer.length > BINARY_PREVIEW_BYTES) {
            lines.push(
                `• Preview truncated; showing first ${BINARY_PREVIEW_BYTES} of ${buffer.length} bytes.`
            );
        }
    }

    return lines.join('\n');
}

function formatEncodedOutput(label, output) {
    const sanitized = sanitizeForCodeBlock(output);
    const truncated =
        sanitized.length > MAX_DECODE_DISPLAY_CHARS
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

module.exports = {
    decodeInput,
    encodeInput,
    formatDecodedOutput,
    formatEncodedOutput,
    decoderFormatKeys,
    encoderFormatKeys,
    sanitizeForCodeBlock,
    isMostlyPrintable,
    applyRot13
};
