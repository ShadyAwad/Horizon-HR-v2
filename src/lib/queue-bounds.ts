export async function boundedQueueOperation<T>(operation: Promise<T>, timeoutMs = 3000): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try {
    return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Queue unavailable'), { code: 'QUEUE_UNAVAILABLE', statusCode: 503 })), timeoutMs); })]);
}
finally {
    clearTimeout(timer);
} }
