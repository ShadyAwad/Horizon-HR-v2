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
    res.once('finish', () => console.info(JSON.stringify({ level: 'info', operation: 'http_request', requestId, method: req.method, route: req.route?.path || 'unmatched', status: res.statusCode, durationMs: Math.round(performance.now() - started) })));
    requestContext.run({ requestId }, next);
};
