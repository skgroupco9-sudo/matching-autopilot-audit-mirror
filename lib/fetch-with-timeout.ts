export const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export class RequestTimeoutError extends Error {
  readonly code = 'request_timeout';

  constructor() {
    super('通信に時間がかかっています。接続を確認して、もう一度お試しください。');
    this.name = 'RequestTimeoutError';
  }
}

/**
 * fetch に必ず上限時間を設け、呼び出し元の AbortSignal も維持する。
 * タイマーとイベントリスナーは成功・失敗にかかわらず解放する。
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;

  const relayAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    relayAbort();
  } else {
    callerSignal?.addEventListener('abort', relayAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new RequestTimeoutError());
  }, Math.max(1, timeoutMs));

  try {
    return await globalThis.fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new RequestTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', relayAbort);
  }
}
