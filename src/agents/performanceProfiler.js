/**
 * Performance Profiler - Tracks operation timing, resource usage, and identifies bottlenecks
 * Collects histograms, percentiles, and resource metrics
 */

class PerformanceProfiler {
    constructor(config = {}) {
        this.windowSizeMs = config.windowSizeMs || 60 * 60 * 1000; // 1 hour rolling window
        this.sampleInterval = config.sampleInterval || 1000; // Check every 1s

        this.operations = []; // All operations with timing
        this.resourceUsage = []; // CPU, memory per operation
        this.pageLoadTimes = new Map(); // url -> [times]
        this.slowOperations = []; // Detected bottlenecks

        this.metrics = {
            totalOperations: 0,
            totalSuccessful: 0,
            totalFailed: 0,
            averageOperationMs: 0,
            p50Ms: 0,
            p95Ms: 0,
            p99Ms: 0,
            slowestOperation: null,
            fastestOperation: null
        };

        this.startTime = Date.now();
    }

    /**
     * Record operation with timing
     */
    recordOperation(name, durationMs, success = true, metadata = {}) {
        const record = {
            name,
            durationMs,
            success,
            timestamp: Date.now(),
            metadata
        };

        this.operations.push(record);
        this.metrics.totalOperations++;

        if (success) {
            this.metrics.totalSuccessful++;
        } else {
            this.metrics.totalFailed++;
        }

        // Update percentiles
        this.updateMetrics();

        // Detect if slow
        if (durationMs > this.metrics.p95Ms * 1.5) {
            this.slowOperations.push({
                name,
                durationMs,
                timestamp: Date.now(),
                metadata
            });
            if (this.slowOperations.length > 100) {
                this.slowOperations.shift();
            }
        }

        return record;
    }

    /**
     * Record page load time for URL
     */
    recordPageLoadTime(url, durationMs, bytesTransferred = 0) {
        if (!this.pageLoadTimes.has(url)) {
            this.pageLoadTimes.set(url, []);
        }

        this.pageLoadTimes.get(url).push({
            durationMs,
            bytesTransferred,
            timestamp: Date.now()
        });

        // Keep only last 100 loads per URL
        if (this.pageLoadTimes.get(url).length > 100) {
            this.pageLoadTimes.get(url).shift();
        }

        this.recordOperation(`page_load:${url}`, durationMs, true, { bytesTransferred });
    }

    /**
     * Record resource usage (CPU, memory)
     */
    recordResourceUsage(cpuPercent, memoryMb, operationName = null) {
        this.resourceUsage.push({
            cpuPercent,
            memoryMb,
            operationName,
            timestamp: Date.now()
        });

        // Keep last 1000 samples
        if (this.resourceUsage.length > 1000) {
            this.resourceUsage.shift();
        }
    }

    /**
     * Update calculated metrics
     */
    updateMetrics() {
        const recent = this.getRecentOperations();
        if (recent.length === 0) return;

        const durations = recent.map(op => op.durationMs).sort((a, b) => a - b);

        this.metrics.averageOperationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
        this.metrics.p50Ms = durations[Math.floor(durations.length * 0.5)];
        this.metrics.p95Ms = durations[Math.floor(durations.length * 0.95)];
        this.metrics.p99Ms = durations[Math.floor(durations.length * 0.99)];
        this.metrics.slowestOperation = durations[durations.length - 1];
        this.metrics.fastestOperation = durations[0];
    }

    /**
     * Get operations from last N ms
     */
    getRecentOperations(windowMs = null) {
        windowMs = windowMs || this.windowSizeMs;
        const cutoff = Date.now() - windowMs;
        return this.operations.filter(op => op.timestamp > cutoff);
    }

    /**
     * Get histogram of operation durations
     */
    getHistogram(bucketSizeMs = 100) {
        const recent = this.getRecentOperations();
        const histogram = {};

        for (const op of recent) {
            const bucket = Math.floor(op.durationMs / bucketSizeMs) * bucketSizeMs;
            histogram[bucket] = (histogram[bucket] || 0) + 1;
        }

        return Object.entries(histogram)
            .map(([bucket, count]) => ({ bucketMs: parseInt(bucket), count }))
            .sort((a, b) => a.bucketMs - b.bucketMs);
    }

    /**
     * Get page load statistics by URL
     */
    getPageLoadStats(url = null) {
        if (url) {
            const times = this.pageLoadTimes.get(url) || [];
            if (times.length === 0) return null;

            const durations = times.map(t => t.durationMs).sort((a, b) => a - b);
            return {
                url,
                samples: times.length,
                averageMs: durations.reduce((a, b) => a + b, 0) / durations.length,
                minMs: durations[0],
                maxMs: durations[durations.length - 1],
                p50Ms: durations[Math.floor(durations.length * 0.5)],
                p95Ms: durations[Math.floor(durations.length * 0.95)]
            };
        }

        // Return stats for all URLs
        return Array.from(this.pageLoadTimes.entries()).map(([url, times]) => {
            const durations = times.map(t => t.durationMs).sort((a, b) => a - b);
            return {
                url,
                samples: times.length,
                averageMs: durations.reduce((a, b) => a + b, 0) / durations.length,
                minMs: durations[0],
                maxMs: durations[durations.length - 1],
                p50Ms: durations[Math.floor(durations.length * 0.5)],
                p95Ms: durations[Math.floor(durations.length * 0.95)]
            };
        });
    }

    /**
     * Identify bottlenecks
     */
    identifyBottlenecks(topN = 10) {
        const nameGroups = {};

        for (const op of this.getRecentOperations()) {
            if (!nameGroups[op.name]) {
                nameGroups[op.name] = [];
            }
            nameGroups[op.name].push(op.durationMs);
        }

        const bottlenecks = Object.entries(nameGroups)
            .map(([name, durations]) => {
                durations.sort((a, b) => a - b);
                return {
                    name,
                    samples: durations.length,
                    averageMs: durations.reduce((a, b) => a + b, 0) / durations.length,
                    p95Ms: durations[Math.floor(durations.length * 0.95)],
                    slowCount: durations.filter(d => d > this.metrics.p95Ms).length
                };
            })
            .sort((a, b) => b.averageMs - a.averageMs)
            .slice(0, topN);

        return bottlenecks;
    }

    /**
     * Get resource usage statistics
     */
    getResourceStats(operationName = null) {
        const resources = operationName
            ? this.resourceUsage.filter(r => r.operationName === operationName)
            : this.resourceUsage;

        if (resources.length === 0) return null;

        const cpuValues = resources.map(r => r.cpuPercent).sort((a, b) => a - b);
        const memValues = resources.map(r => r.memoryMb).sort((a, b) => a - b);

        return {
            samples: resources.length,
            cpu: {
                averagePercent: cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length,
                maxPercent: cpuValues[cpuValues.length - 1],
                p95Percent: cpuValues[Math.floor(cpuValues.length * 0.95)]
            },
            memory: {
                averageMb: memValues.reduce((a, b) => a + b, 0) / memValues.length,
                maxMb: memValues[memValues.length - 1],
                p95Mb: memValues[Math.floor(memValues.length * 0.95)]
            }
        };
    }

    /**
     * Get comprehensive performance report
     */
    getReport() {
        return {
            metrics: this.metrics,
            bottlenecks: this.identifyBottlenecks(10),
            histogram: this.getHistogram(100),
            pageLoadStats: this.getPageLoadStats(),
            resourceStats: this.getResourceStats(),
            slowOperations: this.slowOperations.slice(-20),
            uptime: Date.now() - this.startTime
        };
    }

    /**
     * Export as Prometheus metrics
     */
    toPrometheus() {
        const lines = [];
        lines.push(`# HELP operation_duration_seconds Operation duration in seconds`);
        lines.push(`# TYPE operation_duration_seconds summary`);
        lines.push(
            `operation_duration_seconds_sum ${(this.metrics.averageOperationMs * this.metrics.totalOperations) / 1000}`
        );
        lines.push(`operation_duration_seconds_count ${this.metrics.totalOperations}`);
        lines.push(`operation_duration_seconds{quantile="0.5"} ${this.metrics.p50Ms / 1000}`);
        lines.push(`operation_duration_seconds{quantile="0.95"} ${this.metrics.p95Ms / 1000}`);
        lines.push(`operation_duration_seconds{quantile="0.99"} ${this.metrics.p99Ms / 1000}`);

        lines.push(`# HELP operation_total Total operations`);
        lines.push(`# TYPE operation_total counter`);
        lines.push(`operation_total{status="successful"} ${this.metrics.totalSuccessful}`);
        lines.push(`operation_total{status="failed"} ${this.metrics.totalFailed}`);

        return lines.join('\n');
    }
}

module.exports = PerformanceProfiler;
