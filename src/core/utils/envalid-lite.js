'use strict';

const createError = (key, message) => {
    const error = new Error(`Invalid environment variable ${key}: ${message}`);
    error.name = 'EnvValidationError';
    return error;
};

const normalizeOptions = (options = {}) => ({
    default: options.default,
    desc: options.desc,
    choices: options.choices,
    devDefault: options.devDefault,
    example: options.example
});

const str = (options = {}) => ({ type: 'string', ...normalizeOptions(options) });
const num = (options = {}) => ({ type: 'number', ...normalizeOptions(options) });
const bool = (options = {}) => ({ type: 'boolean', ...normalizeOptions(options) });

const coerceBoolean = value => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
            return false;
        }
    }
    if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    throw createError('UNKNOWN', `Value "${value}" cannot be coerced to boolean.`);
};

const enforceChoices = (key, value, choices) => {
    if (choices && !choices.includes(value)) {
        throw createError(key, `Value must be one of: ${choices.join(', ')}`);
    }
    return value;
};

const cleanEnv = (env, specs, { strict = false } = {}) => {
    if (typeof env !== 'object' || env === null) {
        throw new TypeError('Expected env to be an object.');
    }

    const cleaned = {};

    for (const [key, spec] of Object.entries(specs)) {
        const raw = Object.prototype.hasOwnProperty.call(env, key) ? env[key] : undefined;
        let value = raw;

        if (value === undefined || value === null || value === '') {
            if (spec.default !== undefined) {
                value = spec.default;
            } else {
                throw createError(key, 'Value is required but was not provided.');
            }
        }

        switch (spec.type) {
            case 'string':
                if (typeof value !== 'string') {
                    value = value != null ? String(value) : value;
                }
                value = enforceChoices(key, value, spec.choices);
                break;
            case 'number':
                if (typeof value === 'string' && value.trim() !== '') {
                    const parsed = Number(value);
                    if (!Number.isFinite(parsed)) {
                        throw createError(key, 'Value must be a finite number.');
                    }
                    value = parsed;
                } else if (typeof value !== 'number' || !Number.isFinite(value)) {
                    throw createError(key, 'Value must be a finite number.');
                }
                value = enforceChoices(key, value, spec.choices);
                break;
            case 'boolean':
                try {
                    value = coerceBoolean(value);
                } catch (error) {
                    throw createError(key, 'Value must be boolean-like.');
                }
                value = enforceChoices(key, value, spec.choices);
                break;
            default:
                throw new Error(`Unsupported validator type: ${spec.type}`);
        }

        cleaned[key] = value;
    }

    if (strict) {
        for (const key of Object.keys(env)) {
            if (!Object.prototype.hasOwnProperty.call(specs, key)) {
                throw createError(key, 'Unexpected environment variable in strict mode.');
            }
        }
    }

    return Object.freeze(cleaned);
};

module.exports = { cleanEnv, str, num, bool };
