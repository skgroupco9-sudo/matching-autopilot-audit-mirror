'use client';

import { useCallback, useEffect, useRef } from 'react';
import { fetchWithTimeout } from './fetch-with-timeout';

/**
 * 同じ画面から同一メソッド・同一URLへ行う通信を single-flight にする。
 * 画面を離れた場合は進行中の通信を中断し、古いレスポンスによる状態上書きを防ぐ。
 */
export function useGuardedFetch() {
  const activeRequests = useRef(new Map<string, { controller: AbortController; response: Promise<Response> }>());
  const bodyIdentities = useRef(new WeakMap<object, number>());
  const nextBodyIdentity = useRef(1);

  useEffect(() => () => {
    for (const request of activeRequests.current.values()) request.controller.abort();
    activeRequests.current.clear();
  }, []);

  return useCallback(async (input: RequestInfo | URL, init: RequestInit = {}, timeoutMs?: number) => {
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = input instanceof Request ? input.url : String(input);
    const key = requestKey(method, url, init.body, bodyIdentities.current, () => nextBodyIdentity.current++);
    const activeRequest = activeRequests.current.get(key);
    if (activeRequest) return (await activeRequest.response).clone();

    const controller = new AbortController();
    const callerSignal = init.signal;
    const relayAbort = () => controller.abort(callerSignal?.reason);
    if (callerSignal?.aborted) relayAbort();
    else callerSignal?.addEventListener('abort', relayAbort, { once: true });
    const response = fetchWithTimeout(input, { ...init, signal: controller.signal }, timeoutMs);
    activeRequests.current.set(key, { controller, response });

    try {
      return (await response).clone();
    } finally {
      callerSignal?.removeEventListener('abort', relayAbort);
      if (activeRequests.current.get(key)?.response === response) activeRequests.current.delete(key);
    }
  }, []);
}

function requestKey(
  method: string,
  url: string,
  body: BodyInit | null | undefined,
  bodyIdentities: WeakMap<object, number>,
  allocateBodyIdentity: () => number,
) {
  if (method === 'GET' || method === 'HEAD' || body == null) return `${method}:${url}`;
  if (typeof body === 'string') return `${method}:${url}:text:${body}`;
  if (body instanceof URLSearchParams) return `${method}:${url}:params:${body.toString()}`;
  const objectBody = body as object;
  let identity = bodyIdentities.get(objectBody);
  if (!identity) {
    identity = allocateBodyIdentity();
    bodyIdentities.set(objectBody, identity);
  }
  return `${method}:${url}:body:${identity}`;
}
