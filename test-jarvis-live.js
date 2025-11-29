#!/usr/bin/env node
/**
 * JARVIS CODEX - Live Demo
 * Tests browsing, screenshots, tools WITHOUT heavy AI usage
 */

require('dotenv').config();

const AgentToolRegistry = require('./src/core/AgentToolRegistry');
const { ScreenshotTool } = require('./src/core/tools/ScreenshotTool');
const BrowserAgent = require('./src/agents/browserAgent');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    red: '\x1b[31m',
    dim: '\x1b[2m'
};

const log = {
    header: (msg) => console.log(`\n${colors.bright}${colors.cyan}╔${'═'.repeat(58)}╗${colors.reset}`),
    title: (msg) => console.log(`${colors.bright}${colors.cyan}║  ${msg.padEnd(56)}║${colors.reset}`),
    footer: () => console.log(`${colors.bright}${colors.cyan}╚${'═'.repeat(58)}╝${colors.reset}\n`),
    step: (msg) => console.log(`${colors.magenta}▸${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}!${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
    result: (label, value) => console.log(`  ${colors.dim}${label}:${colors.reset} ${value}`),
    code: (code) => console.log(`${colors.dim}  │ ${code}${colors.reset}`)
};

// Demo sites to test
const TEST_SITES = [
    { url: 'https://example.com', name: 'Example.com' },
    { url: 'https://httpbin.org/html', name: 'HTTPBin HTML' },
    { url: 'https://news.ycombinator.com', name: 'Hacker News' }
];

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function testToolRegistry() {
    log.header();
    log.title('🛠️  JARVIS CODEX - Tool Registry Test');
    log.footer();
    
    const registry = new AgentToolRegistry();
    
    // Register built-in tools
    log.step('Registering tools...');
    
    // Calculator
    registry.registerFunction(
        'calculate',
        'Evaluate math expressions',
        { expression: { type: 'string', required: true } },
        async ({ expression }) => {
            const result = Function(`"use strict"; return (${expression})`)();
            return { expression, result };
        }
    );
    
    // Time tool
    registry.registerFunction(
        'current_time',
        'Get current date/time',
        {},
        async () => ({
            iso: new Date().toISOString(),
            local: new Date().toLocaleString(),
            unix: Date.now()
        })
    );
    
    // Code runner (sandboxed)
    registry.registerFunction(
        'run_code',
        'Execute JavaScript code safely',
        { code: { type: 'string', required: true } },
        async ({ code }) => {
            try {
                const result = eval(code);
                return { success: true, result: String(result) };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    );
    
    // Text tools
    registry.registerFunction(
        'text_stats',
        'Analyze text',
        { text: { type: 'string', required: true } },
        async ({ text }) => ({
            chars: text.length,
            words: text.split(/\s+/).filter(Boolean).length,
            lines: text.split('\n').length,
            sentences: text.split(/[.!?]+/).filter(Boolean).length
        })
    );
    
    log.success(`Registered ${registry.handlers.size} tools`);
    
    // Test each tool
    log.step('Testing tools...\n');
    
    // Calculator
    log.info('calculate: 42 * 1337');
    const calcOutput = await registry.executeTool('calculate', { expression: '42 * 1337' });
    const calcResult = calcOutput.data || calcOutput;
    log.result('Result', calcResult.result || JSON.stringify(calcResult));
    
    // Time
    log.info('current_time');
    const timeOutput = await registry.executeTool('current_time', {});
    const timeResult = timeOutput.data || timeOutput;
    log.result('Local', timeResult.local || JSON.stringify(timeResult));
    
    // Code runner
    log.info('run_code: Array.from({length: 5}, (_, i) => i * i)');
    const codeOutput = await registry.executeTool('run_code', { 
        code: 'Array.from({length: 5}, (_, i) => i * i).join(", ")' 
    });
    const codeResult = codeOutput.data || codeOutput;
    log.result('Output', codeResult.result || JSON.stringify(codeResult));
    
    // Text stats
    log.info('text_stats: "Hello JARVIS CODEX!"');
    const textOutput = await registry.executeTool('text_stats', { text: 'Hello JARVIS CODEX! How are you doing today?' });
    const textResult = textOutput.data || textOutput;
    log.result('Stats', `${textResult.words} words, ${textResult.chars} chars`);
    
    return registry;
}

async function testBrowserAgent() {
    log.header();
    log.title('🌐  JARVIS CODEX - Browser Agent Test');
    log.footer();
    
    // Force enable by passing config directly
    const config = require('./config');
    const browserConfig = {
        ...config,
        deployment: {
            ...config.deployment,
            target: 'selfhost',
            headlessBrowser: true
        }
    };
    
    const browser = new BrowserAgent(browserConfig);
    
    if (!browser.enabled) {
        log.warn('Browser agent disabled in config');
        log.info('Set HEADLESS_BROWSER_ENABLED=true to enable');
        return;
    }
    
    try {
        for (const site of TEST_SITES) {
            log.step(`Opening ${site.name}...`);
            
            const sessionKey = `test-${Date.now()}`;
            
            try {
                const startTime = Date.now();
                await browser.startSession(sessionKey);
                
                // Get page and navigate
                const session = browser.getSession(sessionKey);
                if (session?.page) {
                    const page = session.page;
                    
                    // Set viewport for proper rendering
                    await page.setViewport({ width: 1280, height: 800 });
                    
                    // Navigate and wait for content
                    await page.goto(site.url, { 
                        waitUntil: 'networkidle2',
                        timeout: 15000 
                    });
                    
                    const loadTime = Date.now() - startTime;
                    log.success(`Loaded in ${loadTime}ms`);
                    
                    const title = await page.title();
                    log.result('Title', title || '(no title)');
                    
                    // Take screenshot
                    log.info('Taking screenshot...');
                    try {
                        const screenshot = await page.screenshot({ 
                            type: 'png',
                            fullPage: false 
                        });
                        if (screenshot) {
                            const filename = `demo-${site.name.toLowerCase().replace(/\s+/g, '-')}.png`;
                            require('fs').writeFileSync(filename, screenshot);
                            log.success(`Saved: ${filename} (${Math.round(screenshot.length / 1024)}KB)`);
                        }
                    } catch (e) {
                        log.warn(`Screenshot failed: ${e.message}`);
                    }
                }
                
                await browser.closeSession(sessionKey);
            } catch (e) {
                log.warn(`${site.name}: ${e.message}`);
            }
            
            await sleep(500);
        }
        
    } catch (error) {
        log.error(`Browser error: ${error.message}`);
    } finally {
        log.step('Cleaning up browser...');
        await browser.shutdown();
        log.success('Browser closed');
    }
}

async function testWebFetch() {
    log.header();
    log.title('🔗  JARVIS CODEX - Web Fetch Test');
    log.footer();
    
    const https = require('https');
    const http = require('http');
    
    const fetchUrl = (url) => new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const start = Date.now();
        
        protocol.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    url,
                    status: res.statusCode,
                    contentType: res.headers['content-type'],
                    size: data.length,
                    time: Date.now() - start,
                    preview: data.slice(0, 200).replace(/\s+/g, ' ')
                });
            });
        }).on('error', reject);
    });
    
    const testUrls = [
        'https://api.github.com/zen',
        'https://httpbin.org/json',
        'https://jsonplaceholder.typicode.com/todos/1'
    ];
    
    for (const url of testUrls) {
        log.step(`Fetching ${url}...`);
        try {
            const result = await fetchUrl(url);
            log.success(`${result.status} in ${result.time}ms`);
            log.result('Type', result.contentType);
            log.result('Size', `${result.size} bytes`);
            log.code(result.preview.slice(0, 80) + '...');
        } catch (e) {
            log.error(e.message);
        }
    }
}

async function testCodeExecution() {
    log.header();
    log.title('💻  JARVIS CODEX - Code Execution Demo');
    log.footer();
    
    const demos = [
        {
            name: 'Fibonacci sequence',
            code: `
const fib = n => n <= 1 ? n : fib(n-1) + fib(n-2);
Array.from({length: 10}, (_, i) => fib(i));`
        },
        {
            name: 'Prime numbers',
            code: `
const isPrime = n => n > 1 && [...Array(Math.floor(Math.sqrt(n)))].every((_, i) => n % (i + 2));
[...Array(50)].map((_, i) => i + 2).filter(isPrime);`
        },
        {
            name: 'String manipulation',
            code: `
const str = "jarvis codex is awesome";
str.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');`
        },
        {
            name: 'Object transformation',
            code: `
const data = [{name: 'Alice', age: 30}, {name: 'Bob', age: 25}];
data.reduce((acc, p) => ({...acc, [p.name]: p.age}), {});`
        }
    ];
    
    for (const demo of demos) {
        log.step(demo.name);
        log.code(demo.code.trim().split('\n').pop());
        
        try {
            const result = eval(demo.code);
            log.success(`Result: ${JSON.stringify(result)}`);
        } catch (e) {
            log.error(e.message);
        }
        console.log();
    }
}

async function lightAITest() {
    log.header();
    log.title('🤖  JARVIS CODEX - Light AI Test (1 call only)');
    log.footer();
    
    const { FreeAIProvider } = require('./src/core/FreeAIProvider');
    const ai = new FreeAIProvider();
    
    if (!ai.isAvailable()) {
        log.warn('No AI providers configured, skipping');
        return;
    }
    
    log.info(`Provider: ${ai.currentProvider} (${ai.currentModel})`);
    log.step('Sending single lightweight request...');
    log.info('Prompt: "In 10 words or less: what is JARVIS?"');
    
    try {
        const start = Date.now();
        const response = await ai.generateResponse(
            'Be extremely brief. Max 10 words.',
            'What is JARVIS from Iron Man?',
            50
        );
        
        log.success(`Response in ${Date.now() - start}ms`);
        // Handle various response formats
        const text = typeof response === 'string' ? response : 
                     response?.content || response?.text || response?.message || 
                     JSON.stringify(response);
        log.result('AI says', text);
    } catch (e) {
        log.error(`AI error: ${e.message}`);
    }
}

async function main() {
    console.clear();
    console.log(`
${colors.cyan}${colors.bright}
       ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
       ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
       ██║███████║██████╔╝██║   ██║██║███████╗
  ██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
  ╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
   ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
                   ${colors.magenta}C O D E X${colors.reset}
${colors.dim}          Live Agent Demonstration${colors.reset}
`);

    const startTime = Date.now();
    
    // Run all tests
    await testToolRegistry();
    await sleep(500);
    
    await testWebFetch();
    await sleep(500);
    
    await testCodeExecution();
    await sleep(500);
    
    // Browser test (might fail if no Puppeteer)
    try {
        await testBrowserAgent();
    } catch (e) {
        log.warn(`Browser test skipped: ${e.message}`);
    }
    await sleep(500);
    
    // One light AI call
    await lightAITest();
    
    // Summary
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    log.header();
    log.title('📊  Demo Complete!');
    log.footer();
    
    console.log(`${colors.dim}  Total time: ${totalTime}s${colors.reset}`);
    console.log(`${colors.dim}  AI calls: 1 (lightweight)${colors.reset}`);
    console.log(`${colors.green}
  JARVIS CODEX capabilities demonstrated:
  • Tool registry & execution
  • Web fetching & API calls  
  • Browser automation & screenshots
  • Code execution (sandboxed)
  • AI integration (minimal)
${colors.reset}`);
}

main().catch(console.error);

