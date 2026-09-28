export class ApiResponseError extends Error {
  constructor(message: string, public readonly code: 'UNEXPECTED_RESPONSE' | 'INVALID_JSON' | 'AUTH_REQUIRED' | 'API_ERROR', public readonly status: number) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

/** Read JSON without ever presenting a proxy/SPA HTML document to the user. */
export async function readApiJson(response: Response, service = 'Attendance service', options: { allowErrorResponse?: boolean } = {}): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const fail = (code: ApiResponseError['code'], message: string): never => {
    if (import.meta.env?.DEV) {
      // No response body or query parameters (which can contain personal data).
      console.warn('[API response]', { url: response.url.split('?')[0], status: response.status, contentType, code });
    }
    throw new ApiResponseError(message, code, response.status);
  };
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(contentType)) {
    return fail('UNEXPECTED_RESPONSE', `${service} returned an unexpected response.`);
  }
  let data: any;
  try { data = await response.json(); }
  catch { return fail('INVALID_JSON', `${service} returned invalid JSON.`); }
  if (!response.ok && !options.allowErrorResponse) {
    const message = typeof data?.error === 'string' ? data.error : undefined;
    return fail(response.status === 401 ? 'AUTH_REQUIRED' : 'API_ERROR', message || (response.status === 401 ? 'Your session is unavailable or expired. Please sign in again.' : `${service} request failed.`));
  }
  return data;
}
