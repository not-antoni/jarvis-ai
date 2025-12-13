/**
 * Error Context Debugger - Captures network requests, screenshots on error,
 * browser console logs, and HTML snapshots for debugging
 */

class ErrorContextDebugger {
    constructor(page = null) {
        this.page = page;
        this.networkRequests = [];
        this.consoleLogs = [];
        this.errorSnapshots = [];
        this.jsErrors = [];

        this.config = {
            captureNetworkRequests: true,
            captureConsoleLogs: true,
            captureScreenshots: true,
            captureHTMLSnapshots: true,
            maxRequestsPerSession: 1000,
            maxLogsPerSession: 500
        };
    }

    /**
     * Setup debugging listeners on page
     */
    async setupListeners(page) {
        this.page = page;

        if (this.config.captureNetworkRequests) {
            this.setupNetworkListener();
        }

        if (this.config.captureConsoleLogs) {
            this.setupConsoleListener();
        }

        // Listen for page errors
        page.on('error', error => this.recordJSError(error));
        page.on('pageerror', error => this.recordJSError(error));
    }

    /**
     * Setup network request capture
     */
    setupNetworkListener() {
        if (!this.page) return;

        this.page.on('request', request => {
            this.recordNetworkRequest({
                url: request.url(),
                method: request.method(),
                resourceType: request.resourceType(),
                timestamp: Date.now(),
                status: 'pending'
            });
        });

        this.page.on('response', response => {
            this.recordNetworkResponse({
                url: response.url(),
                status: response.status(),
                statusText: response.statusText(),
                timestamp: Date.now()
            });
        });

        this.page.on('requestfailed', request => {
            this.recordNetworkFailure({
                url: request.url(),
                failure: request.failure().errorText,
                timestamp: Date.now()
            });
        });
    }

    /**
     * Setup console log capture
     */
    setupConsoleListener() {
        if (!this.page) return;

        this.page.on('console', msg => {
            this.recordConsoleLog({
                type: msg.type(),
                text: msg.text(),
                location: msg.location(),
                timestamp: Date.now(),
                args: msg.args().length
            });
        });
    }

    /**
     * Record network request
     */
    recordNetworkRequest(request) {
        if (this.networkRequests.length >= this.config.maxRequestsPerSession) {
            this.networkRequests.shift();
        }

        this.networkRequests.push(request);
    }

    /**
     * Record network response
     */
    recordNetworkResponse(response) {
        // Find matching request and update
        const request = this.networkRequests.find(r => r.url === response.url);
        if (request) {
            request.status = response.status;
            request.statusText = response.statusText;
            request.responseTime = response.timestamp - request.timestamp;
        }
    }

    /**
     * Record network failure
     */
    recordNetworkFailure(failure) {
        const request = this.networkRequests.find(r => r.url === failure.url);
        if (request) {
            request.failed = true;
            request.failureReason = failure.failure;
        }
    }

    /**
     * Record console log
     */
    recordConsoleLog(log) {
        if (this.consoleLogs.length >= this.config.maxLogsPerSession) {
            this.consoleLogs.shift();
        }

        // Only track important logs
        if (['error', 'warn', 'info'].includes(log.type)) {
            this.consoleLogs.push(log);
        }
    }

    /**
     * Record JavaScript error
     */
    recordJSError(error) {
        this.jsErrors.push({
            message: error.message,
            stack: error.stack,
            timestamp: Date.now()
        });

        // Keep only last 50
        if (this.jsErrors.length > 50) {
            this.jsErrors.shift();
        }
    }

    /**
     * Capture screenshot on error
     */
    async captureErrorScreenshot(operation, error) {
        if (!this.page || !this.config.captureScreenshots) return null;

        try {
            const buffer = await this.page.screenshot({ type: 'png' });

            this.errorSnapshots.push({
                operation,
                error: error.message,
                timestamp: Date.now(),
                screenshotBuffer: buffer,
                url: this.page.url()
            });

            // Keep only last 10 screenshots
            if (this.errorSnapshots.length > 10) {
                this.errorSnapshots.shift();
            }

            return buffer;
        } catch (screenshotError) {
            console.error(
                '[ErrorContextDebugger] Screenshot capture failed:',
                screenshotError.message
            );
            return null;
        }
    }

    /**
     * Capture HTML snapshot on error
     */
    async captureHTMLSnapshot(operation, error) {
        if (!this.page || !this.config.captureHTMLSnapshots) return null;

        try {
            const html = await this.page.content();

            return {
                operation,
                error: error.message,
                timestamp: Date.now(),
                html,
                url: this.page.url(),
                title: await this.page.title(),
                size: html.length
            };
        } catch (htmlError) {
            console.error('[ErrorContextDebugger] HTML snapshot failed:', htmlError.message);
            return null;
        }
    }

    /**
     * Get failed network requests
     */
    getFailedRequests() {
        return this.networkRequests.filter(r => r.failed || r.status >= 400);
    }

    /**
     * Get slow requests
     */
    getSlowRequests(thresholdMs = 5000) {
        return this.networkRequests
            .filter(r => r.responseTime && r.responseTime > thresholdMs)
            .sort((a, b) => b.responseTime - a.responseTime);
    }

    /**
     * Get error logs
     */
    getErrorLogs() {
        return this.consoleLogs.filter(log => log.type === 'error');
    }

    /**
     * Get resource type breakdown
     */
    getResourceBreakdown() {
        const breakdown = {};

        for (const request of this.networkRequests) {
            const type = request.resourceType;
            breakdown[type] = (breakdown[type] || 0) + 1;
        }

        return breakdown;
    }

    /**
     * Get bandwidth usage
     */
    async getBandwidthStats() {
        // Query page for response sizes if available
        try {
            const stats = await this.page.evaluate(() => {
                const resources = performance.getEntriesByType('resource');
                let totalSize = 0;

                for (const resource of resources) {
                    if (resource.transferSize) {
                        totalSize += resource.transferSize;
                    }
                }

                return {
                    totalResources: resources.length,
                    totalSizeBytes: totalSize,
                    averageSizeBytes: totalSize / resources.length
                };
            });

            return stats;
        } catch {
            return null;
        }
    }

    /**
     * Generate error report
     */
    async generateErrorReport(operation, error) {
        const screenshot = await this.captureErrorScreenshot(operation, error);
        const htmlSnapshot = await this.captureHTMLSnapshot(operation, error);
        const bandwidthStats = await this.getBandwidthStats();

        return {
            operation,
            error: {
                message: error.message,
                stack: error.stack,
                timestamp: Date.now()
            },
            networkDebug: {
                totalRequests: this.networkRequests.length,
                failedRequests: this.getFailedRequests(),
                slowRequests: this.getSlowRequests(3000),
                resourceBreakdown: this.getResourceBreakdown(),
                bandwidthStats
            },
            consoleDebug: {
                totalLogs: this.consoleLogs.length,
                errorLogs: this.getErrorLogs(),
                jsErrors: this.jsErrors.slice(-10)
            },
            snapshots: {
                hasScreenshot: !!screenshot,
                hasHTMLSnapshot: !!htmlSnapshot,
                htmlSize: htmlSnapshot?.size,
                url: this.page?.url()
            }
        };
    }

    /**
     * Export debug logs
     */
    exportDebugLogs() {
        return {
            networkRequests: this.networkRequests,
            consoleLogs: this.consoleLogs,
            jsErrors: this.jsErrors,
            errorSnapshots: this.errorSnapshots.map(snap => ({
                ...snap,
                screenshotBuffer: snap.screenshotBuffer
                    ? `<buffer ${snap.screenshotBuffer.length} bytes>`
                    : null
            }))
        };
    }

    /**
     * Clear debug data
     */
    clear() {
        this.networkRequests = [];
        this.consoleLogs = [];
        this.jsErrors = [];
        this.errorSnapshots = [];
    }
}

module.exports = ErrorContextDebugger;
