export type OpenAiProbeCode =
  | 'ok'
  | 'invalid_api_key'
  | 'insufficient_quota'
  | 'model_unavailable'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'connection_failed';

export type OpenAiProbeResult = {
  ok: boolean;
  code: OpenAiProbeCode;
  detail: string;
  model: string;
  latencyMs: number;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function probeOpenAiConnection(
  apiKey: string,
  model: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 15_000,
): Promise<OpenAiProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: 'Reply with exactly: OK',
        store: false,
        reasoning: { effort: 'none' },
        max_output_tokens: 16,
      }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (response.ok) return result(true, 'ok', 'OpenAIから正常応答を確認しました', model, latencyMs);

    const providerCode = await readProviderErrorCode(response);
    if (response.status === 401 || response.status === 403 || providerCode === 'invalid_api_key') {
      return result(false, 'invalid_api_key', 'APIキーまたはプロジェクト権限を確認してください', model, latencyMs);
    }
    if (providerCode === 'insufficient_quota' || providerCode === 'billing_hard_limit_reached') {
      return result(false, 'insufficient_quota', 'API残高または利用上限を確認してください', model, latencyMs);
    }
    if (response.status === 404 || providerCode === 'model_not_found' || providerCode === 'unsupported_model') {
      return result(false, 'model_unavailable', 'モデル名またはプロジェクトのモデル権限を確認してください', model, latencyMs);
    }
    if (response.status === 429) {
      return result(false, 'rate_limited', '一時的な利用上限です。少し待って再試行してください', model, latencyMs);
    }
    if (response.status >= 500) {
      return result(false, 'provider_unavailable', 'OpenAI側が一時的に応答できません', model, latencyMs);
    }
    return result(false, 'connection_failed', 'OpenAI接続を確認できませんでした', model, latencyMs);
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === 'AbortError') {
      return result(false, 'timeout', 'OpenAIへの接続がタイムアウトしました', model, latencyMs);
    }
    return result(false, 'connection_failed', 'OpenAIへ接続できませんでした', model, latencyMs);
  } finally {
    clearTimeout(timeout);
  }
}

function result(ok: boolean, code: OpenAiProbeCode, detail: string, model: string, latencyMs: number): OpenAiProbeResult {
  return { ok, code, detail, model, latencyMs };
}

async function readProviderErrorCode(response: Response) {
  try {
    const payload = await response.json() as { error?: { code?: unknown; type?: unknown } };
    const code = payload.error?.code ?? payload.error?.type;
    return typeof code === 'string' ? code : '';
  } catch {
    return '';
  }
}
