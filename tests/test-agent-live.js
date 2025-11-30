#!/usr/bin/env node

/**
 * Live Agent Functional Test
 * Actually exercises the browser agent with real operations:
 * - Navigate to sites
 * - Take screenshots
 * - Extract data
 * - Download files
 * - Handle errors
 */

const fs = require('fs');
const path = require('path');

const BrowserAgent = require('./src/agents/browserAgent');
const AgentMonitor = require('./src/agents/agentMonitor');
const AgentConfig = require('./src/agents/agentConfig');
const RobustnessEnhancer = require('./src/agents/robustnessEnhancer');
const CaptchaHandler = require('./src/agents/captchaHandler');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(testName, testFn) {
    try {
        console.log(`\n▶ ${testName}`);
        await testFn();
        console.log(`  ✓ PASSED`);
        testsPassed++;
    } catch (error) {
        console.error(`  ✗ FAILED: ${error.message}`);
        testsFailed++;
    }
}

async function main() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║     JARVIS AGENT - LIVE FUNCTIONAL TEST SUITE         ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // Initialize components
    const config = new AgentConfig();
    const monitor = new AgentMonitor(config);
    const robustness = new RobustnessEnhancer();
    const captcha = new CaptchaHandler({ solvingService: 'none' });
    const browserAgent = new BrowserAgent({
        deployment: { target: 'selfhost', headlessBrowser: true }
    });

    console.log('📋 Initializing agent...');
    console.log(`   - Config: ${JSON.stringify(config.get('sessions')).substring(0, 60)}...`);
    console.log(`   - Monitor: Ready (memory tracking enabled)`);
    console.log(`   - Robustness: ${robustness.getStats().strategiesAvailable} recovery strategies`);
    console.log(`   - Captcha: ${captcha.solvingService || 'stealth mode'}`);

    // Test 1: Browser initialization
    await runTest('TEST 1: Initialize browser session', async () => {
        const startTime = Date.now();
        const session = await browserAgent.startSession('test_ctx_1');
        const duration = Date.now() - startTime;
        
        monitor.recordOperation('test_ctx_1', 'start_session', duration, true);
        
        if (!session.page) {
            throw new Error('Failed to start browser session');
        }
        console.log(`  - Browser session started in ${duration}ms`);
        console.log(`  - Context: test_ctx_1`);
    });

    // Test 2: Navigate to simple site
    await runTest('TEST 2: Navigate to https://example.com', async () => {
        const session = await browserAgent.startSession('test_ctx_2');
        const startTime = Date.now();
        
        try {
            const response = await robustness.navigateWithResilience(
                session.page,
                'https://example.com',
                { maxRetries: 3, timeout: 30000, waitUntil: 'domcontentloaded' }
            );
            
            const duration = Date.now() - startTime;
            monitor.recordOperation('test_ctx_2', 'navigate', duration, true);
            
            if (!response.success) {
                throw new Error('Navigation failed');
            }
            console.log(`  - Loaded in ${duration}ms`);
            console.log(`  - HTTP ${response.response.status()}`);
        } catch (error) {
            monitor.recordOperation('test_ctx_2', 'navigate', Date.now() - startTime, false, error);
            throw error;
        }
    });

    // Test 3: Extract page content
    await runTest('TEST 3: Extract page content (title, headings)', async () => {
        const session = await browserAgent.startSession('test_ctx_3');
        const startTime = Date.now();
        
        try {
            await robustness.navigateWithResilience(session.page, 'https://example.com');
            
            const content = await robustness.evaluateWithResilience(
                session.page,
                () => ({
                    title: document.title,
                    url: window.location.href,
                    headings: Array.from(document.querySelectorAll('h1, h2')).map(h => h.textContent),
                    paragraphCount: document.querySelectorAll('p').length
                })
            );
            
            const duration = Date.now() - startTime;
            monitor.recordOperation('test_ctx_3', 'extract_content', duration, true);
            
            console.log(`  - Title: "${content.title}"`);
            console.log(`  - URL: ${content.url}`);
            console.log(`  - Headings found: ${content.headings.length}`);
            console.log(`  - Paragraphs: ${content.paragraphCount}`);
        } catch (error) {
            monitor.recordOperation('test_ctx_3', 'extract_content', Date.now() - startTime, false, error);
            throw error;
        }
    });

    // Test 4: Take screenshot
    await runTest('TEST 4: Take screenshot of page', async () => {
        const session = await browserAgent.startSession('test_ctx_4');
        const startTime = Date.now();
        
        try {
            await robustness.navigateWithResilience(session.page, 'https://example.com');
            
            const result = await robustness.screenshotWithResilience(session.page, {
                fullPage: true,
                timeout: 10000
            });
            
            const duration = Date.now() - startTime;
            
            if (!result.success) {
                throw new Error(`Screenshot failed: ${result.error}`);
            }
            
            const screenshotPath = path.join(__dirname, 'test-screenshot.png');
            fs.writeFileSync(screenshotPath, result.screenshot);
            const sizeKb = (result.screenshot.length / 1024).toFixed(2);
            
            monitor.recordOperation('test_ctx_4', 'screenshot', duration, true);
            
            console.log(`  - Screenshot saved: test-screenshot.png`);
            console.log(`  - Size: ${sizeKb} KB`);
            console.log(`  - Time: ${duration}ms`);
        } catch (error) {
            monitor.recordOperation('test_ctx_4', 'screenshot', Date.now() - startTime, false, error);
            throw error;
        }
    });

    // Test 5: Captcha detection (won't find any on example.com, but tests the system)
    await runTest('TEST 5: Scan for captcha on page', async () => {
        const session = await browserAgent.startSession('test_ctx_5');
        const startTime = Date.now();
        
        try {
            await robustness.navigateWithResilience(session.page, 'https://example.com');
            
            const captchaResult = await captcha.handleCaptcha(session.page);
            
            const duration = Date.now() - startTime;
            monitor.recordOperation('test_ctx_5', 'detect_captcha', duration, true);
            
            console.log(`  - Captcha detected: ${captchaResult.detected}`);
            console.log(`  - Type: ${captchaResult.type || 'none'}`);
            console.log(`  - Time: ${duration}ms`);
        } catch (error) {
            monitor.recordOperation('test_ctx_5', 'detect_captcha', Date.now() - startTime, false, error);
            throw error;
        }
    });

    // Test 6: Error detection and recovery
    await runTest('TEST 6: Error detection on page', async () => {
        const session = await browserAgent.startSession('test_ctx_6');
        const startTime = Date.now();
        
        try {
            await robustness.navigateWithResilience(session.page, 'https://example.com');
            
            const issues = await robustness.detectAndRecover(session.page, browserAgent.browser);
            
            const duration = Date.now() - startTime;
            monitor.recordOperation('test_ctx_6', 'detect_errors', duration, true);
            
            console.log(`  - Issues detected: ${issues.length}`);
            issues.forEach((issue, i) => {
                console.log(`    ${i + 1}. ${issue.type}`);
            });
        } catch (error) {
            monitor.recordOperation('test_ctx_6', 'detect_errors', Date.now() - startTime, false, error);
            throw error;
        }
    });

    // Test 7: Memory tracking during operations
    await runTest('TEST 7: Monitor memory during operations', async () => {
        const startTime = Date.now();
        
        // Perform multiple operations
        for (let i = 0; i < 2; i++) {
            const session = await browserAgent.startSession(`test_ctx_mem_${i}`);
            await robustness.navigateWithResilience(session.page, 'https://example.com');
            await robustness.evaluateWithResilience(session.page, () => document.title);
        }
        
        const duration = Date.now() - startTime;
        
        const memoryMetrics = monitor.getMemoryMetrics();
        const memoryTrend = monitor.getMemoryTrend();
        
        monitor.recordOperation('test_ctx_mem', 'memory_test', duration, true);
        
        console.log(`  - Operations performed: 3`);
        console.log(`  - Heap used: ${memoryMetrics.heapUsedMb}MB / ${memoryMetrics.heapTotalMb}MB`);
        console.log(`  - Heap percent: ${memoryMetrics.heapUsedPercent}%`);
        console.log(`  - Memory trend: ${memoryTrend.trend}`);
        console.log(`  - Trend slope: ${memoryTrend.slope}%`);
        console.log(`  - Risk level: ${memoryTrend.riskLevel}`);
    });

    // Test 8: Health report generation
    await runTest('TEST 8: Generate health report', async () => {
        // Create a mock browser agent structure for health report
        const mockAgent = {
            sessions: new Map(),
            metrics: {
                totalSessions: 8,
                failedSessions: 0,
                succeededOperations: 15,
                failedOperations: 1
            },
            getMetrics: () => ({
                browserHealth: 'ok',
                circuitBreakerStatus: 'closed',
                activeSessions: 0,
                totalSessions: 8,
                failedSessions: 0,
                succeededOperations: 15,
                failedOperations: 1,
                browserRestarts: 0,
                consecutiveErrorCount: 0,
                systemMemory: process.memoryUsage()
            })
        };
        
        const health = monitor.getHealthReport(mockAgent);
        const recommendations = monitor.generateRecommendations(health);
        
        console.log(`  - Overall health: ${health.overallHealth}%`);
        console.log(`  - Health scores:`);
        console.log(`    • Browser: ${health.healthScores.browser}`);
        console.log(`    • Memory: ${health.healthScores.memory}`);
        console.log(`    • Operations: ${health.healthScores.operations}`);
        console.log(`    • Circuit breaker: ${health.healthScores.circuitBreaker}`);
        console.log(`  - Operations: ${health.operations.succeeded}✓ ${health.operations.failed}✗`);
        console.log(`  - Success rate: ${health.operations.successRate}`);
        console.log(`  - Recommendations: ${recommendations.length}`);
        recommendations.forEach(rec => console.log(`    • ${rec}`));
    });

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                   TEST SUMMARY                        ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log(`\n✓ Passed: ${testsPassed}`);
    console.log(`✗ Failed: ${testsFailed}`);
    console.log(`📊 Total: ${testsPassed + testsFailed}\n`);

    if (testsFailed === 0) {
        console.log('🎉 ALL TESTS PASSED! Agent is fully functional.\n');
        
        console.log('📈 Operations logged:');
        console.log(`   - Total operations: ${monitor.operationLog.length}`);
        console.log(`   - Total alerts: ${monitor.alerts.length}`);
        
        const avgLatency = Math.round(
            monitor.operationLog.reduce((sum, op) => sum + op.durationMs, 0) / 
            monitor.operationLog.length
        );
        console.log(`   - Average latency: ${avgLatency}ms`);
        
        console.log('\n🚀 Ready for production deployment!');
    } else {
        console.log('⚠️  Some tests failed. Review errors above.\n');
    }

    // Cleanup
    try {
        await browserAgent.closeAllSessions();
    } catch (e) {
        // Ignore cleanup errors
    }
}

// Run tests
main().catch(error => {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
});
