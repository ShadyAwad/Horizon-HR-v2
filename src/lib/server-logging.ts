/** Error metadata for operational logs; never serialize SQL details or request data. */
export function safeErrorCode(error: unknown): string {
    const metadata = error && typeof error === 'object' ? error as {
        code?: unknown;
        statusCode?: unknown;
    } : {};
    if (typeof metadata.code === 'string' && /^(?:[A-Z][A-Z0-9_]{1,63}|[0-9]{5})$/.test(metadata.code))
        return metadata.code;
    if (typeof metadata.statusCode === 'number' && Number.isInteger(metadata.statusCode) && metadata.statusCode >= 400 && metadata.statusCode <= 599)
        return 'HTTP_' + metadata.statusCode;
    return 'INTERNAL_ERROR';
}
export function logServerError(context: string, error: unknown) {
    console.error(context, safeErrorCode(error));
}
