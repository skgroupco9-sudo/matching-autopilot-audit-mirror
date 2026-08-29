import { expect, test } from '@playwright/test';

test('security headers are present and secrets are absent', async ({ request }) => {
  const response = await request.get('/');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  const body = await response.text();
  expect(body).not.toMatch(/(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/);
  expect(body).not.toMatch(/sk-proj-[A-Za-z0-9_-]{16,}/);
});

test('direct mutation without browser origin metadata is rejected', async ({ request }) => {
  const response = await request.post('/api/auth/login', {
    headers: { 'content-type': 'application/json' },
    data: { email: 'person@example.com', password: 'SafePassword123!' },
  });
  expect(response.status()).toBe(403);
  await expect(response.json()).resolves.toMatchObject({ error: 'cross_origin_request_rejected' });
});
