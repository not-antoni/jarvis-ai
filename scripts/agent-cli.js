#!/usr/bin/env node
/**
 * Jarvis Smart Agent - Live CLI Testing Interface
 * Interactive terminal for testing tool discovery, execution, and capabilities
 * Codex-inspired command interface with live agent testing
 */

const readline = require('readline');
const CodexIntegrationAdapter = require('./src/core/CodexIntegrationAdapter');
const https = require('https');
const http = require('http');

// Initialize agent
const codex = new CodexIntegrationAdapter();
let sessionActive = true;

// Output formatting (no weird symbols)
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m'
};

const log = {
    title: text => console.log(`\n${colors.bright}${colors.cyan}[ ${text} ]${colors.reset}`),
    success: text => console.log(`${colors.green}✓${colors.reset} ${text}`),
    error: text => console.log(`${colors.red}✗${colors.reset} ${text}`),
    info: text => console.log(`${colors.blue}i${colors.reset} ${text}`),
    warn: text => console.log(`${colors.yellow}!${colors.reset} ${text}`),
    separator: () => console.log(`\n${colors.dim}${'─'.repeat(80)}${colors.reset}\n`),
    agent: text => console.log(`${colors.magenta}Agent${colors.reset}: ${text}`),
    user: text => console.log(`${colors.cyan}You${colors.reset}: ${text}`)
};

// Tool registry
const tools = {};

const registerDefaultTools = () => {
    // Web scraping
    codex.registerJarvisTool(
        'fetch_webpage',
        'Fetch and parse web pages for content',
        {
            type: 'object',
            properties: { url: { type: 'string' }, timeout: { type: 'number', default: 5000 } },
            required: ['url']
        },
        async args => {
            return new Promise((resolve, reject) => {
                const protocol = args.url.startsWith('https') ? https : http;
                const timeout = args.timeout || 5000;

                const request = protocol
                    .get(args.url, { timeout }, res => {
                        let data = '';
                        res.on('data', chunk => (data += chunk));
                        res.on('end', () =>
                            resolve({
                                url: args.url,
                                status: res.statusCode,
                                contentType: res.headers['content-type'],
                                size: data.length,
                                preview: data.slice(0, 500)
                            })
                        );
                    })
                    .on('error', reject);

                request.setTimeout(timeout, () => {
                    request.destroy();
                    reject(new Error(`Timeout fetching ${args.url}`));
                });
            });
        },
        { timeout: 10000, category: 'web' }
    );
    tools.fetch_webpage = 'Fetch web pages';

    // Web search
    codex.registerJarvisTool(
        'web_search',
        'Search the web for information and results',
        {
            type: 'object',
            properties: { query: { type: 'string' }, limit: { type: 'number', default: 5 } },
            required: ['query']
        },
        async args => {
            return { query: args.query, limit: args.limit, results: [], status: 'simulated' };
        },
        { timeout: 5000, category: 'search' }
    );
    tools.web_search = 'Search the web';

    // Image retrieval
    codex.registerJarvisTool(
        'get_images',
        'Find and retrieve images for a query',
        {
            type: 'object',
            properties: { query: { type: 'string' }, count: { type: 'number', default: 10 } },
            required: ['query']
        },
        async args => {
            return { query: args.query, count: args.count, images: [], status: 'ready' };
        },
        { timeout: 8000, category: 'media', parallel: true }
    );
    tools.get_images = 'Get images';

    // Text analysis
    codex.registerJarvisTool(
        'analyze_text',
        'Analyze text for sentiment, keywords, and structure',
        {
            type: 'object',
            properties: { text: { type: 'string' }, type: { type: 'string', default: 'summary' } },
            required: ['text']
        },
        async args => {
            return {
                text_length: args.text.length,
                analysis_type: args.type,
                results: { keywords: [], sentiment: 'neutral', entities: [] }
            };
        },
        { timeout: 3000, category: 'analysis' }
    );
    tools.analyze_text = 'Analyze text';

    // Solve math
    codex.registerJarvisTool(
        'solve_math',
        'Solve mathematical expressions and equations',
        {
            type: 'object',
            properties: { expression: { type: 'string' } },
            required: ['expression']
        },
        async args => {
            try {
                const result = eval(args.expression);
                return { expression: args.expression, result, status: 'solved' };
            } catch (e) {
                return { expression: args.expression, error: e.message, status: 'error' };
            }
        },
        { timeout: 2000, category: 'utility' }
    );
    tools.solve_math = 'Solve math';

    // Translate
    codex.registerJarvisTool(
        'translate',
        'Translate text between languages',
        {
            type: 'object',
            properties: { text: { type: 'string' }, language: { type: 'string' } },
            required: ['text', 'language']
        },
        async args => {
            return {
                text: args.text,
                target_language: args.language,
                translated: `[${args.language}] ${args.text}`
            };
        },
        { timeout: 3000, category: 'utility' }
    );
    tools.translate = 'Translate text';

    log.success('Loaded 6 default tools');
};

// Command handlers
const commands = {
    async help() {
        log.agent('Available commands:');
        console.log(`
  ${colors.cyan}/tools${colors.reset}           - List all registered tools
  ${colors.cyan}/discover${colors.reset}        - Discover tools for a query: /discover <query>
  ${colors.cyan}/run${colors.reset}             - Execute a tool: /run <tool_name> <json_args>
  ${colors.cyan}/fetch${colors.reset}           - Fetch a webpage: /fetch <url>
  ${colors.cyan}/search${colors.reset}          - Web search: /search <query>
  ${colors.cyan}/images${colors.reset}          - Get images: /images <query>
  ${colors.cyan}/analyze${colors.reset}         - Analyze text: /analyze <text>
  ${colors.cyan}/math${colors.reset}            - Solve math: /math <expression>
  ${colors.cyan}/translate${colors.reset}       - Translate: /translate <text> <language>
  ${colors.cyan}/parallel${colors.reset}        - Run tools in parallel: /parallel <tool1> <tool2>...
  ${colors.cyan}/batch${colors.reset}           - Batch execute: /batch <query1>,<query2>
  ${colors.cyan}/stats${colors.reset}           - Show execution statistics
  ${colors.cyan}/clear${colors.reset}           - Clear console
  ${colors.cyan}/exit${colors.reset}            - Exit agent
  ${colors.cyan}/help${colors.reset}            - Show this help`);
    },

    async tools() {
        log.agent('Registered tools:');
        const allTools = codex.registry.getAllTools();
        allTools.forEach((t, i) => {
            console.log(`  ${i + 1}. ${colors.cyan}${t.name}${colors.reset} - ${t.description}`);
        });
    },

    async discover(query) {
        if (!query) {
            log.error('Usage: /discover <query>');
            return;
        }
        log.agent(`Discovering tools for: "${query}"`);
        const discovered = codex.discoverTools(query, { limit: 5 });
        if (discovered.length === 0) {
            log.warn('No tools discovered for this query');
            return;
        }
        discovered.forEach((t, i) => {
            console.log(
                `  ${i + 1}. ${colors.cyan}${t.name}${colors.reset} (relevance: ${t.relevanceScore})`
            );
        });
    },

    async run(toolName, argsJson) {
        if (!toolName) {
            log.error('Usage: /run <tool_name> <json_args>');
            return;
        }
        try {
            const args = argsJson ? JSON.parse(argsJson) : {};
            log.agent(`Executing tool: ${colors.cyan}${toolName}${colors.reset}`);
            const result = await codex.executeTool(toolName, args);
            if (result.success) {
                log.success(`Tool executed`);
                console.log(JSON.stringify(result.result, null, 2));
            } else {
                log.error(`Tool failed: ${result.error}`);
            }
        } catch (e) {
            log.error(`Error: ${e.message}`);
        }
    },

    async fetch(url) {
        if (!url) {
            log.error('Usage: /fetch <url>');
            return;
        }
        log.agent(`Fetching: ${url}`);
        try {
            const result = await codex.executeTool('fetch_webpage', { url, timeout: 10000 });
            if (result.success) {
                log.success('Fetched successfully');
                console.log(`  Status: ${result.result.status}`);
                console.log(`  Type: ${result.result.contentType}`);
                console.log(`  Size: ${result.result.size} bytes`);
                console.log(`  Preview:\n${result.result.preview}...\n`);
            } else {
                log.error(`Failed: ${result.error}`);
            }
        } catch (e) {
            log.error(`Error: ${e.message}`);
        }
    },

    async search(query) {
        if (!query) {
            log.error('Usage: /search <query>');
            return;
        }
        log.agent(`Searching: ${query}`);
        const result = await codex.executeTool('web_search', { query, limit: 5 });
        if (result.success) {
            log.success('Search ready');
            console.log(JSON.stringify(result.result, null, 2));
        } else {
            log.error(`Search failed: ${result.error}`);
        }
    },

    async images(query) {
        if (!query) {
            log.error('Usage: /images <query>');
            return;
        }
        log.agent(`Getting images for: ${query}`);
        const result = await codex.executeTool('get_images', { query, count: 10 });
        if (result.success) {
            log.success(`Retrieved image data`);
            console.log(JSON.stringify(result.result, null, 2));
        } else {
            log.error(`Failed: ${result.error}`);
        }
    },

    async analyze(text) {
        if (!text) {
            log.error('Usage: /analyze <text>');
            return;
        }
        log.agent(`Analyzing text...`);
        const result = await codex.executeTool('analyze_text', { text });
        if (result.success) {
            log.success('Analysis complete');
            console.log(JSON.stringify(result.result, null, 2));
        } else {
            log.error(`Analysis failed: ${result.error}`);
        }
    },

    async math(expression) {
        if (!expression) {
            log.error('Usage: /math <expression>');
            return;
        }
        log.agent(`Solving: ${expression}`);
        const result = await codex.executeTool('solve_math', { expression });
        if (result.success) {
            log.success(`Result: ${colors.green}${result.result.result}${colors.reset}`);
        } else {
            log.error(`Error: ${result.result.error}`);
        }
    },

    async translate(args) {
        if (!args || !args.includes(' ')) {
            log.error('Usage: /translate <text> <language>');
            return;
        }
        const parts = args.rsplit(' ', 1);
        const text = parts[0];
        const language = parts[1];
        log.agent(`Translating to ${language}...`);
        const result = await codex.executeTool('translate', { text, language });
        if (result.success) {
            log.success('Translation:');
            console.log(`  ${result.result.translated}`);
        } else {
            log.error(`Failed: ${result.error}`);
        }
    },

    async parallel(toolsStr) {
        if (!toolsStr) {
            log.error('Usage: /parallel <tool1> <tool2> ...');
            return;
        }
        const toolNames = toolsStr.split(' ').filter(t => t);
        log.agent(`Executing ${toolNames.length} tools in parallel...`);
        try {
            const toolCalls = toolNames.map(name => ({
                name,
                args: {}
            }));
            const start = Date.now();
            const results = await codex.registry.executeParallel(toolCalls);
            const duration = Date.now() - start;
            log.success(`Completed in ${duration}ms`);
            results.forEach((r, i) => {
                console.log(`  ${i + 1}. ${toolNames[i]}: ${r.success ? 'Success' : 'Failed'}`);
            });
        } catch (e) {
            log.error(`Error: ${e.message}`);
        }
    },

    async batch(queries) {
        if (!queries) {
            log.error('Usage: /batch <query1>,<query2>,...');
            return;
        }
        const queryList = queries.split(',').map(q => q.trim());
        log.agent(`Executing ${queryList.length} queries in batch mode...`);
        try {
            const results = await codex.batchExecute(queryList);
            log.success(`Batch complete`);
            results.forEach((r, i) => {
                console.log(`  ${i + 1}. ${r.query}`);
            });
        } catch (e) {
            log.error(`Error: ${e.message}`);
        }
    },

    stats() {
        const insights = codex.getExecutionInsights();
        log.agent('Execution Statistics:');
        console.log(`
  Tools Registered: ${colors.cyan}${insights.stats.toolCount}${colors.reset}
  Total Executions: ${colors.cyan}${insights.stats.totalExecutions}${colors.reset}
  Success Rate: ${colors.cyan}${(insights.stats.successRate * 100).toFixed(1)}%${colors.reset}
  Cache Hits: ${colors.cyan}${insights.stats.cacheHits}${colors.reset}
  Cache Hit Rate: ${colors.cyan}${insights.stats.cacheHitRate ? (insights.stats.cacheHitRate * 100).toFixed(1) + '%' : 'N/A'}${colors.reset}
        `);
    },

    clear() {
        console.clear();
        showBanner();
    },

    async exit() {
        log.agent('Shutting down...');
        sessionActive = false;
        process.exit(0);
    }
};

function showBanner() {
    console.log(`
${colors.cyan}${colors.bright}
  ╔════════════════════════════════════════════════════════════╗
  ║                                                            ║
  ║        JARVIS SMART AGENT - LIVE CLI TESTING              ║
  ║                                                            ║
  ║  Type /help for available commands                        ║
  ║  Type /exit to quit                                       ║
  ║                                                            ║
  ╚════════════════════════════════════════════════════════════╝
${colors.reset}
    `);
}

async function handleCommand(input) {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
        const [cmd, ...args] = trimmed.slice(1).split(' ');
        const argStr = args.join(' ');

        if (commands[cmd]) {
            try {
                await commands[cmd](argStr);
            } catch (e) {
                log.error(`Command error: ${e.message}`);
            }
        } else {
            log.error(`Unknown command: /${cmd}. Type /help for available commands.`);
        }
    } else {
        // Natural language query
        log.user(input);
        log.agent(`Processing natural language query...`);
        try {
            const discovered = codex.discoverTools(input, { limit: 3 });
            if (discovered.length === 0) {
                log.warn('No suitable tools found for this query');
            } else {
                log.success(`Found ${discovered.length} relevant tool(s):`);
                for (const tool of discovered) {
                    console.log(
                        `  - ${colors.cyan}${tool.name}${colors.reset} (relevance: ${tool.relevanceScore})`
                    );
                }
            }
        } catch (e) {
            log.error(`Error: ${e.message}`);
        }
    }
}

async function main() {
    showBanner();
    registerDefaultTools();
    log.separator();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${colors.bright}${colors.cyan}jarvis${colors.reset}> `
    });

    rl.prompt();

    rl.on('line', async line => {
        await handleCommand(line);
        rl.prompt();
    });

    rl.on('close', () => {
        process.exit(0);
    });
}

main().catch(console.error);
