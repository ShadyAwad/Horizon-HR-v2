type FeedSubmissionSuccess<T> = {
  ok: true;
  status: number;
  post: T;
};

type FeedSubmissionFailure = {
  ok: false;
  status: number | null;
  error: string;
};

export type FeedSubmissionResult<T> = FeedSubmissionSuccess<T> | FeedSubmissionFailure;

export type FeedSubmissionRunResult<T> =
  | { started: false }
  | { started: true; result: T };

type FeedSubmissionResponse<T> = {
  success?: boolean;
  post?: T;
  error?: unknown;
  message?: unknown;
};

export function hasValidFeedSubmissionContent(title: string, contentText: string) {
  return Boolean(title.trim() && contentText.trim());
}

export function isFeedPublishBlocked({
  submitting,
  imageUploadPending,
}: {
  submitting: boolean;
  imageUploadPending: boolean;
}) {
  return submitting || imageUploadPending;
}

export function getFeedPublishInteractionState({
  submitting,
  imageUploadPending,
}: {
  submitting: boolean;
  imageUploadPending: boolean;
}) {
  return {
    disabled: isFeedPublishBlocked({ submitting, imageUploadPending }),
    showSpinner: submitting,
    cursor: submitting ? 'wait' : imageUploadPending ? 'progress' : 'pointer',
  } as const;
}

export function createFeedSubmissionController(
  onPendingChange: (pending: boolean) => void,
) {
  let pending = false;
  let activeController: AbortController | null = null;

  return {
    isPending() {
      return pending;
    },
    async run<T>(
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<FeedSubmissionRunResult<T>> {
      if (pending) return { started: false };

      const controller = new AbortController();
      activeController = controller;
      pending = true;
      onPendingChange(true);

      try {
        return {
          started: true,
          result: await operation(controller.signal),
        };
      } finally {
        if (activeController === controller) {
          activeController = null;
          pending = false;
          onPendingChange(false);
        }
      }
    },
    dispose() {
      activeController?.abort();
      activeController = null;
      if (pending) {
        pending = false;
        onPendingChange(false);
      }
    },
  };
}

function responseError(body: FeedSubmissionResponse<unknown>, fallbackError: string) {
  if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
  if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
  return fallbackError;
}

export async function executeFeedSubmission<T>(
  request: (signal: AbortSignal) => Promise<Response>,
  {
    fallbackError,
    timeoutError,
    timeoutMs = 15_000,
    signal,
  }: {
    fallbackError: string;
    timeoutError: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<FeedSubmissionResult<T>> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await request(controller.signal);
    const body = await response.json().catch(() => ({})) as FeedSubmissionResponse<T>;

    if (!response.ok || body.success !== true || !body.post) {
      return {
        ok: false,
        status: response.status,
        error: responseError(body, fallbackError),
      };
    }

    return { ok: true, status: response.status, post: body.post };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof DOMException && error.name === 'AbortError'
        ? timeoutError
        : fallbackError,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
