export default {
    async fetch(request, env) {
        const requestUrl = new URL(request.url);
        const targetUrlRaw = requestUrl.searchParams.get('url');

        if (!targetUrlRaw) {
            return new Response('Missing url', { status: 400 });
        }

        let targetUrl;
        try {
            targetUrl = new URL(targetUrlRaw);
        } catch {
            return new Response('Invalid url', { status: 400 });
        }

        if (targetUrl.protocol !== 'https:' && targetUrl.protocol !== 'http:') {
            return new Response('Invalid protocol', { status: 400 });
        }

        const tokenHeader = request.headers.get('x-jarvis-proxy-token') || '';
        const expectedToken = (env && env.AI_PROXY_TOKEN ? String(env.AI_PROXY_TOKEN) : '').trim();
        if (expectedToken && tokenHeader !== expectedToken) {
            return new Response('Unauthorized', { status: 401 });
        }

        const allowedHostsRaw = (env && env.AI_PROXY_ALLOWED_HOSTS ? String(env.AI_PROXY_ALLOWED_HOSTS) : '').trim();
        const allowedHosts = allowedHostsRaw
            ? allowedHostsRaw
                  .split(',')
                  .map(value => value.trim().toLowerCase())
                  .filter(Boolean)
            : [];

        if (allowedHosts.length > 0) {
            const hostname = targetUrl.hostname.toLowerCase();
            if (!allowedHosts.includes(hostname)) {
                return new Response('Target host not allowed', { status: 403 });
            }
        }

        const headers = new Headers(request.headers);

        const proxyChoice = headers.get('x-jarvis-proxy-choice');
        const proxyTarget = headers.get('x-jarvis-proxy-target');

        headers.delete('host');
        headers.delete('content-length');

        headers.delete('x-jarvis-proxy-token');
        headers.delete('x-jarvis-proxy-target');
        headers.delete('x-jarvis-proxy-choice');

        const init = {
            method: request.method,
            headers,
            body: ['GET', 'HEAD'].includes(request.method) ? null : request.body,
            redirect: 'manual'
        };

        const upstreamResponse = await fetch(targetUrl.toString(), init);

        const responseHeaders = new Headers(upstreamResponse.headers);
        responseHeaders.set('x-jarvis-proxy', 'cloudflare-worker');

        if (proxyChoice) {
            responseHeaders.set('x-jarvis-proxy-choice', proxyChoice);
        }
        if (proxyTarget) {
            responseHeaders.set('x-jarvis-proxy-target', proxyTarget);
        }

        return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: responseHeaders
        });
    }
};
