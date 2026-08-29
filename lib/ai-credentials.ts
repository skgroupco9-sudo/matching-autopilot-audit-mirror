export const defaultOpenAiModel = 'gpt-5.6-luna';

export function validOpenAiApiKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 20
    && value.length <= 256
    && value.startsWith('sk-')
    && !/\s/.test(value);
}

export function normalizeOpenAiModel(value: unknown) {
  if (typeof value !== 'string') return defaultOpenAiModel;
  const normalized = value.trim();
  return /^[a-z0-9][a-z0-9._-]{1,79}$/i.test(normalized) ? normalized : defaultOpenAiModel;
}

export function aiCredentialVaultContext(userId: string) {
  return `${userId}:ai:openai:api_key`;
}

export function openAiKeyHint(apiKey: string) {
  return `••••${apiKey.slice(-4)}`;
}
