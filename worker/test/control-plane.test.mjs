import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlPlaneClient } from '../src/control-plane.mjs';

test('control-plane requests include both deployment and user-scoped worker credentials', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return Response.json({ ok: true, automationState: 'paused', connections: [] });
  };
  try {
    const client = new ControlPlaneClient({
      baseUrl: 'https://example.test',
      secret: 'shared-secret',
      token: 'ab'.repeat(32),
      userId: 'personal_owner',
      workerId: 'personal-windows-1',
    });
    await client.heartbeat('online');
    assert.equal(captured.url, 'https://example.test/api/worker/heartbeat');
    assert.equal(captured.options.headers.authorization, 'Bearer shared-secret');
    assert.equal(captured.options.headers['x-worker-id'], 'personal-windows-1');
    assert.equal(captured.options.headers['x-worker-token'], 'ab'.repeat(32));
    const body = JSON.parse(captured.options.body);
    assert.equal(body.userId, 'personal_owner');
    assert.equal(body.workerId, 'personal-windows-1');
    assert.equal('token' in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registration photo download stays user-scoped and returns image bytes', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } });
  };
  try {
    const client = new ControlPlaneClient({
      baseUrl: 'https://example.test',
      secret: 'shared-secret',
      token: 'cd'.repeat(32),
      userId: 'personal_owner',
      workerId: 'personal-windows-1',
    });
    const photo = await client.downloadRegistrationPhoto('pphoto_test');
    assert.equal(captured.url, 'https://example.test/api/worker/identity/photos/pphoto_test?user_id=personal_owner');
    assert.equal(captured.options.headers['x-worker-id'], 'personal-windows-1');
    assert.equal(photo.contentType, 'image/jpeg');
    assert.deepEqual([...photo.bytes], [0xff, 0xd8, 0xff]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI settings stay user-scoped and never place credentials in the URL', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return Response.json({ configured: true, enabled: true, apiKey: `sk-${'a'.repeat(48)}`, model: 'gpt-5.4-mini' });
  };
  try {
    const client = new ControlPlaneClient({
      baseUrl: 'https://example.test',
      secret: 'shared-secret',
      token: 'ef'.repeat(32),
      userId: 'personal_owner',
      workerId: 'personal-windows-1',
    });
    const settings = await client.getAiSettings();
    assert.equal(captured.url, 'https://example.test/api/worker/ai-settings?user_id=personal_owner');
    assert.equal(captured.options.headers['x-worker-token'], 'ef'.repeat(32));
    assert.equal(captured.url.includes('sk-'), false);
    assert.equal(settings.configured, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
