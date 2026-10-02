import { logServerError } from './server-logging';
export function installShutdown(cleanup: () => Promise<void>, timeoutMs = 15000) {
    let stopping = false;
    const stop = (reason: string, code = 0) => { if (stopping)
        return; stopping = true; console.info(JSON.stringify({ level: 'info', operation: 'shutdown_requested', reason })); const timer = setTimeout(() => process.exit(1), timeoutMs); void cleanup().then(() => { clearTimeout(timer); console.info(JSON.stringify({ level: 'info', operation: 'shutdown_complete' })); process.exit(code); }, error => { logServerError('shutdown_failed', error); process.exit(1); }); };
    process.once('SIGTERM', () => stop('SIGTERM'));
    process.once('SIGINT', () => stop('SIGINT'));
    process.once('uncaughtException', error => { logServerError('uncaught_exception', error); stop('fatal', 1); });
    process.once('unhandledRejection', error => { logServerError('unhandled_rejection', error); stop('fatal', 1); });
    return () => stopping;
}
