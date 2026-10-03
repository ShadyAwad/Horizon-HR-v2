import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
export const requestContext = new AsyncLocalStorage<{
    requestId: string;
}>();
export const requestIds: RequestHandler = (req, res, next) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    if (req.path.startsWith('/api'))
        res.setHeader('Cache-Control', 'private, no-store');
    const started = performance.now();
    // Capture before mounted middleware can strip /api from req.path.
    const isApi = req.path === '/api' || req.path.startsWith('/api/');
    res.once('finish', () => {
        const route = req.route?.path || 'unmatched';
        const successfulFrontend = !isApi && ['GET', 'HEAD'].includes(req.method)
            && (route === 'unmatched' || route === '*')
            && (res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 304);
        // Vite/static/SPA successes are noise locally; production retains them.
        if (process.env.NODE_ENV === 'development' && successfulFrontend) return;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        console[level](JSON.stringify({ level, operation: 'http_request', requestId, method: req.method, route, status: res.statusCode, durationMs: Math.round(performance.now() - started) }));
    });
    requestContext.run({ requestId }, next);
};
