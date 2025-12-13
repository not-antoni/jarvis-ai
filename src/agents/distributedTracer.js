/**
 * Distributed Tracer - Request ID propagation, trace logging, timeline visualization
 * Enables end-to-end operation tracing for debugging and performance analysis
 */

class DistributedTracer {
    constructor(config = {}) {
        this.traces = new Map(); // traceId -> traceData
        this.spans = new Map(); // spanId -> spanData
        this.maxTraces = config.maxTraces || 1000;
        this.maxSpansPerTrace = config.maxSpansPerTrace || 100;

        this.stats = {
            totalTraces: 0,
            totalSpans: 0,
            activeTraces: 0
        };
    }

    /**
     * Generate trace ID
     */
    generateTraceId() {
        return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    /**
     * Generate span ID
     */
    generateSpanId() {
        return `span_${Math.random().toString(36).slice(2, 9)}`;
    }

    /**
     * Start new trace
     */
    startTrace(operationName, metadata = {}) {
        const traceId = this.generateTraceId();

        const trace = {
            traceId,
            operationName,
            startTime: Date.now(),
            spans: [],
            metadata,
            status: 'in_progress'
        };

        this.traces.set(traceId, trace);
        this.stats.totalTraces++;
        this.stats.activeTraces++;

        // Cleanup if too many
        if (this.traces.size > this.maxTraces) {
            const oldest = Array.from(this.traces.entries()).sort(
                (a, b) => a[1].startTime - b[1].startTime
            )[0];
            this.traces.delete(oldest[0]);
        }

        return traceId;
    }

    /**
     * Start span within trace
     */
    startSpan(traceId, spanName, parentSpanId = null) {
        const trace = this.traces.get(traceId);
        if (!trace) {
            console.warn(`[DistributedTracer] Trace ${traceId} not found`);
            return null;
        }

        if (trace.spans.length >= this.maxSpansPerTrace) {
            console.warn(`[DistributedTracer] Max spans reached for trace ${traceId}`);
            return null;
        }

        const spanId = this.generateSpanId();

        const span = {
            spanId,
            traceId,
            spanName,
            parentSpanId,
            startTime: Date.now(),
            duration: 0,
            status: 'active',
            attributes: {},
            events: [],
            children: []
        };

        trace.spans.push(spanId);
        this.spans.set(spanId, span);
        this.stats.totalSpans++;

        // Link parent
        if (parentSpanId) {
            const parentSpan = this.spans.get(parentSpanId);
            if (parentSpan) {
                parentSpan.children.push(spanId);
            }
        }

        return spanId;
    }

    /**
     * End span
     */
    endSpan(spanId, status = 'completed', error = null) {
        const span = this.spans.get(spanId);
        if (!span) return;

        span.duration = Date.now() - span.startTime;
        span.status = status;
        if (error) {
            span.error = {
                message: error.message,
                stack: error.stack
            };
        }
    }

    /**
     * Add attribute to span
     */
    addSpanAttribute(spanId, key, value) {
        const span = this.spans.get(spanId);
        if (!span) return;

        span.attributes[key] = {
            value,
            timestamp: Date.now()
        };
    }

    /**
     * Record event in span
     */
    recordSpanEvent(spanId, eventName, metadata = {}) {
        const span = this.spans.get(spanId);
        if (!span) return;

        span.events.push({
            name: eventName,
            timestamp: Date.now(),
            metadata
        });

        // Keep only last 50 events
        if (span.events.length > 50) {
            span.events.shift();
        }
    }

    /**
     * End trace
     */
    endTrace(traceId, status = 'completed', error = null) {
        const trace = this.traces.get(traceId);
        if (!trace) return;

        trace.endTime = Date.now();
        trace.duration = trace.endTime - trace.startTime;
        trace.status = status;
        if (error) {
            trace.error = error.message;
        }

        this.stats.activeTraces--;
    }

    /**
     * Get trace with all spans
     */
    getTrace(traceId) {
        const trace = this.traces.get(traceId);
        if (!trace) return null;

        const spans = trace.spans.map(spanId => this.spans.get(spanId));

        return {
            ...trace,
            spans,
            spanCount: spans.length,
            slowestSpan:
                spans.length > 0 ? spans.reduce((a, b) => (a.duration > b.duration ? a : b)) : null
        };
    }

    /**
     * Get trace timeline
     */
    getTraceTimeline(traceId) {
        const trace = this.traces.get(traceId);
        if (!trace) return null;

        const spans = trace.spans.map(spanId => this.spans.get(spanId));
        const timeline = [];

        // Sort by start time
        spans.sort((a, b) => a.startTime - b.startTime);

        for (const span of spans) {
            const indent = span.parentSpanId ? 2 : 0;
            timeline.push({
                indent,
                spanName: span.spanName,
                duration: span.duration,
                status: span.status,
                startTime: span.startTime,
                endTime: span.startTime + span.duration,
                events: span.events.length
            });
        }

        return {
            traceId,
            operationName: trace.operationName,
            totalDuration: trace.duration,
            timeline,
            spanCount: spans.length
        };
    }

    /**
     * Get critical path (slowest path through spans)
     */
    getCriticalPath(traceId) {
        const trace = this.traces.get(traceId);
        if (!trace) return null;

        const spans = trace.spans.map(spanId => this.spans.get(spanId));
        const path = [];

        // Find root spans
        const roots = spans.filter(s => !s.parentSpanId);

        let current = roots.length > 0 ? roots[0] : null;

        while (current) {
            path.push({
                spanName: current.spanName,
                duration: current.duration,
                status: current.status
            });

            // Find slowest child
            const children = spans.filter(s => s.parentSpanId === current.spanId);
            current =
                children.length > 0
                    ? children.reduce((a, b) => (a.duration > b.duration ? a : b))
                    : null;
        }

        return {
            traceId,
            criticalPath: path,
            totalCriticalDuration: path.reduce((sum, s) => sum + s.duration, 0)
        };
    }

    /**
     * Identify bottlenecks in trace
     */
    identifyBottlenecks(traceId, percentileThreshold = 95) {
        const trace = this.traces.get(traceId);
        if (!trace) return null;

        const spans = trace.spans.map(spanId => this.spans.get(spanId));
        const durations = spans.map(s => s.duration).sort((a, b) => a - b);

        const threshold = durations[Math.floor(durations.length * (percentileThreshold / 100))];
        const bottlenecks = spans.filter(s => s.duration >= threshold);

        return {
            traceId,
            threshold,
            bottlenecks: bottlenecks
                .map(s => ({
                    spanName: s.spanName,
                    duration: s.duration,
                    percentage: ((s.duration / trace.duration) * 100).toFixed(2)
                }))
                .sort((a, b) => b.duration - a.duration)
        };
    }

    /**
     * Export trace as JSON
     */
    exportTrace(traceId) {
        const trace = this.getTrace(traceId);
        if (!trace) return null;

        return JSON.stringify(trace, null, 2);
    }

    /**
     * Export all traces as NDJSON (one trace per line)
     */
    exportAllTraces() {
        const lines = [];

        for (const traceId of this.traces.keys()) {
            const trace = this.getTrace(traceId);
            lines.push(JSON.stringify(trace));
        }

        return lines.join('\n');
    }

    /**
     * Get tracer statistics
     */
    getStats() {
        return {
            ...this.stats,
            tracesInMemory: this.traces.size,
            spansInMemory: this.spans.size,
            averageSpansPerTrace:
                this.traces.size > 0
                    ? Array.from(this.traces.values()).reduce((sum, t) => sum + t.spans.length, 0) /
                      this.traces.size
                    : 0
        };
    }

    /**
     * Clear traces older than age
     */
    clearOldTraces(ageMs = 3600000) {
        // 1 hour default
        const now = Date.now();
        const toDelete = [];

        for (const [traceId, trace] of this.traces.entries()) {
            if (trace.endTime && now - trace.endTime > ageMs) {
                toDelete.push(traceId);
            }
        }

        for (const traceId of toDelete) {
            const trace = this.traces.get(traceId);
            for (const spanId of trace.spans) {
                this.spans.delete(spanId);
            }
            this.traces.delete(traceId);
        }

        return toDelete.length;
    }

    /**
     * Clear all traces
     */
    clear() {
        this.traces.clear();
        this.spans.clear();
        this.stats = {
            totalTraces: 0,
            totalSpans: 0,
            activeTraces: 0
        };
    }
}

module.exports = DistributedTracer;
