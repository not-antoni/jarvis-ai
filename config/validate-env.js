/**
 * Environment Variable Validation
 * Validates all required and optional environment variables on startup
 */

// Logger will be imported after it's created to avoid circular dependency
let logger = null;
try {
    logger = require('../src/utils/logger');
} catch (e) {
    // Fallback to console if logger not available yet
    logger = {
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.log.bind(console)
    };
}

/**
 * Required environment variables
 */
const REQUIRED_VARS = [
    'DISCORD_TOKEN'
];

/**
 * Optional environment variables with validation rules
 */
const OPTIONAL_VARS = {
    'MONGO_URI_MAIN': {
        validate: (value) => {
            if (!value) return { valid: true, message: 'Optional' };
            if (!value.startsWith('mongodb://') && !value.startsWith('mongodb+srv://')) {
                return { valid: false, message: 'Must start with mongodb:// or mongodb+srv://' };
            }
            return { valid: true };
        }
    },
    'MONGO_URI_VAULT': {
        validate: (value) => {
            if (!value) return { valid: true, message: 'Optional' };
            if (!value.startsWith('mongodb://') && !value.startsWith('mongodb+srv://')) {
                return { valid: false, message: 'Must start with mongodb:// or mongodb+srv://' };
            }
            return { valid: true };
        }
    },
    'DISCORD_TOKEN': {
        validate: (value) => {
            if (!value) return { valid: false, message: 'Required' };
            if (value.length < 20) {
                return { valid: false, message: 'Token appears too short' };
            }
            return { valid: true };
        }
    },
    'MASTER_KEY_BASE64': {
        validate: (value) => {
            if (!value) return { valid: true, message: 'Optional' };
            try {
                Buffer.from(value, 'base64');
                return { valid: true };
            } catch {
                return { valid: false, message: 'Must be valid base64' };
            }
        }
    },
    'DISCORD_WEBHOOK_PUBLIC_KEY': {
        validate: (value) => {
            if (!value) return { valid: true, message: 'Optional' };
            if (value.length !== 64) {
                return { valid: false, message: 'Public key must be 64 characters (hex)' };
            }
            return { valid: true };
        }
    }
};

/**
 * Validate all environment variables
 * @returns {Object} Validation result with errors and warnings
 */
function validateEnv() {
    const errors = [];
    const warnings = [];
    const validated = {};

    // Check required variables
    for (const varName of REQUIRED_VARS) {
        const value = process.env[varName];
        if (!value) {
            errors.push(`Missing required environment variable: ${varName}`);
        } else {
            // Validate format if validator exists
            const validator = OPTIONAL_VARS[varName];
            if (validator && validator.validate) {
                const result = validator.validate(value);
                if (!result.valid) {
                    errors.push(`${varName}: ${result.message}`);
                }
            }
            validated[varName] = value;
        }
    }

    // Check optional variables (validate format if present)
    for (const [varName, config] of Object.entries(OPTIONAL_VARS)) {
        if (REQUIRED_VARS.includes(varName)) continue; // Already checked
        
        const value = process.env[varName];
        if (value && config.validate) {
            const result = config.validate(value);
            if (!result.valid) {
                warnings.push(`${varName}: ${result.message}`);
            } else {
                validated[varName] = value;
            }
        }
    }

    // Check for common misconfigurations
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.MONGO_URI_MAIN) {
            warnings.push('MONGO_URI_MAIN not set in production - using LOCAL_DB_MODE');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        validated
    };
}

/**
 * Validate and throw if invalid
 * @throws {Error} If validation fails
 */
function validateEnvOrThrow() {
    const result = validateEnv();
    
    if (result.warnings.length > 0) {
        logger.warn('Environment variable warnings:', { warnings: result.warnings });
    }
    
    if (!result.valid) {
        const errorMsg = `Environment validation failed:\n${result.errors.join('\n')}`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
    }
    
    return result.validated;
}

module.exports = {
    validateEnv,
    validateEnvOrThrow,
    REQUIRED_VARS,
    OPTIONAL_VARS
};

