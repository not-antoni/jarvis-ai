const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const metadata = require('../../image-command-metadata.json');

const esmRoot = path.resolve(__dirname, '../../external/esmBot');

const commandEntries = metadata.map((entry) => {
    const slashName = entry.file
        .replace(/\.js$/, '')
        .replace(/\//g, '-')
        .toLowerCase();
    return { ...entry, slashName };
});

const commandByName = new Map(commandEntries.map((entry) => [entry.slashName, entry]));
const commandClassCache = new Map();
let imageModulePromise = null;

async function ensureImageModule() {
    if (!imageModulePromise) {
        const modulePath = pathToFileURL(path.join(esmRoot, 'dist/utils/image.js')).href;
        imageModulePromise = import(modulePath).then((mod) => {
            if (typeof mod.initImageLib === 'function') {
                mod.initImageLib();
            }
            return mod;
        });
    }
    return imageModulePromise;
}

async function loadCommandClass(entry) {
    if (commandClassCache.has(entry.file)) {
        return commandClassCache.get(entry.file);
    }
    const modulePath = pathToFileURL(
        path.join(esmRoot, 'commands', 'image-editing', entry.file)
    ).href;
    const mod = await import(modulePath);
    if (!mod?.default) {
        throw new Error(`Failed to load esmBot command for ${entry.file}`);
    }
    const CommandClass = mod.default;
    if (typeof CommandClass.init === 'function') {
        CommandClass.init();
    }
    commandClassCache.set(entry.file, CommandClass);
    return CommandClass;
}

class OptionResolver {
    constructor(values) {
        this.values = values;
        this.raw = [];
    }

    getString(name) {
        const value = this.values[name];
        return typeof value === 'string' ? value : null;
    }

    getBoolean(name) {
        const value = this.values[name];
        return typeof value === 'boolean' ? value : null;
    }

    getNumber(name) {
        const value = this.values[name];
        return typeof value === 'number' ? value : null;
    }

    getInteger(name) {
        const value = this.values[name];
        return Number.isInteger(value) ? value : null;
    }

    getAttachment(name) {
        return this.values[name] || null;
    }

    getUser() {
        return null;
    }

    getMember() {
        return null;
    }

    getChannel() {
        return null;
    }

    getRole() {
        return null;
    }

    getMentionable() {
        return null;
    }

    getSubCommand() {
        return [];
    }

    getSubCommandGroup() {
        return [];
    }
}

function buildInteractionStub(commandName, optionValues, userId, userName) {
    return {
        id: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
        locale: 'en-US',
        data: {
            name: commandName,
            options: new OptionResolver(optionValues)
        },
        authorizingIntegrationOwners: [undefined],
        user: { id: userId || '0', username: userName || 'User' },
        member: null,
        guild: null,
        channel: null,
        appPermissions: {
            has: () => true
        },
        memberPermissions: {
            has: () => true
        },
        token: null
    };
}

function deepClone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : {};
}

function createCommandInstance(CommandClass, slashName, optionValues, userId, userName) {
    const clientStub = {
        rest: {
            channels: {
                get: async () => null
            }
        }
    };

    const interaction = buildInteractionStub(slashName, optionValues, userId, userName);
    const options = { type: 'application', interaction };
    const instance = new CommandClass(clientStub, null, options);

    if (!instance.clean) {
        instance.clean = (value) => (value ?? '').toString();
    }

    return instance;
}

async function executeCommand(commandName, context) {
    const entry = commandByName.get(commandName);
    if (!entry) {
        throw new Error(`Unknown image command: ${commandName}`);
    }

    const CommandClass = await loadCommandClass(entry);
    const optionValues = context.optionValues || {};
    const instance = createCommandInstance(
        CommandClass,
        commandName,
        optionValues,
        context.userId,
        context.userName
    );

    let textInput = null;
    if (entry.requiresParam && entry.requiredParam) {
        textInput = optionValues[entry.requiredParam] || null;
        if (!textInput) {
            throw new Error('This effect requires text input.');
        }
        if (typeof instance.criteria === 'function') {
            const passed = await instance.criteria(textInput, context.attachment?.url);
            if (!passed) {
                throw new Error('The provided text is invalid for this effect.');
            }
        }
    }

    let params = {};
    if (instance.params && typeof instance.params === 'object') {
        params = deepClone(instance.params);
    }

    let dynamicParams = {};
    if (typeof instance.paramsFunc === 'function') {
        const attachmentName = context.attachment?.name || 'image';
        const attachmentUrl = optionValues.link || context.attachment?.url || '';
        dynamicParams = instance.paramsFunc(attachmentUrl, attachmentName) || {};
    }

    const finalParams = { ...params, ...dynamicParams };
    const module = await ensureImageModule();

    const jobPayload = {
        cmd: entry.command,
        params: finalParams,
        id: context.jobId || `${Date.now()}`,
        input: context.attachment
            ? {
                  data: context.attachment.buffer,
                  type: context.attachment.contentType || context.attachment.type || 'image/png'
              }
            : undefined
    };

    const result = await module.runImageJob(jobPayload);
    return result;
}

function getRegisteredCommands() {
    return commandEntries;
}

function isEsmCommand(name) {
    return commandByName.has(name);
}

function getCommandDefinition(name) {
    return commandByName.get(name) || null;
}

module.exports = {
    getRegisteredCommands,
    isEsmCommand,
    executeCommand,
    getCommandDefinition
};
