const workerIdPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const workerTokenPattern = /^[a-f0-9]{64}$/;

export function isValidWorkerId(value: string) {
  return workerIdPattern.test(value);
}

export function isValidWorkerToken(value: string) {
  return workerTokenPattern.test(value);
}

export async function hashWorkerToken(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
