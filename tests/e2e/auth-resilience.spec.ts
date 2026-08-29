import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function mockSignedOut(context: BrowserContext) {
  await context.route('**/api/dashboard', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"authentication_required"}' }));
  await context.route('**/api/auth/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"authConfigured":true,"registrationOpen":false}' }));
}

async function openLogin(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'おかえりなさい' })).toBeVisible();
}

test.beforeEach(async ({ context }) => {
  await mockSignedOut(context);
});

test('malicious strings never execute as HTML or JavaScript', async ({ page, context }) => {
  let dialogOpened = false;
  page.on('dialog', async (dialog) => { dialogOpened = true; await dialog.dismiss(); });
  await context.route('**/api/auth/login', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"invalid_credentials"}' }));
  await openLogin(page);
  await page.getByLabel('メールアドレス').fill('attacker@example.com');
  await page.getByLabel('パスワード', { exact: true }).fill(`<script>alert(1)</script>'; DROP TABLE users; -- ../../../etc/passwd javascript:alert(document.cookie)`);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('メールアドレスまたはパスワードが違います');
  expect(dialogOpened).toBe(false);
  await expect(page.locator('script').filter({ hasText: 'alert(1)' })).toHaveCount(0);
});

test('twenty rapid submissions produce one network mutation', async ({ page, context }) => {
  let requests = 0;
  let releaseResponse: () => void = () => {};
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  await context.route('**/api/auth/login', async (route) => {
    requests += 1;
    await responseGate;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"invalid_credentials"}' });
  });
  await openLogin(page);
  await page.getByLabel('メールアドレス').fill('person@example.com');
  await page.getByLabel('パスワード', { exact: true }).fill('SafePassword123!');
  const submitButton = page.getByRole('button', { name: /確認中|ログイン/ });
  await submitButton.evaluate((button) => {
    for (let index = 0; index < 20; index += 1) (button as HTMLButtonElement).click();
  });
  await expect.poll(() => requests).toBe(1);
  await expect(submitButton).toBeDisabled();
  releaseResponse();
  await expect(submitButton).toBeEnabled();
});

for (const scenario of [
  { status: 429, body: '{"error":"too_many_attempts"}', expected: '15分後に再試行' },
  { status: 500, body: '{"error":"server_error"}', expected: 'メールアドレスまたはパスワードが違います' },
  { status: 503, body: '{"error":"temporarily_unavailable"}', expected: 'メールアドレスまたはパスワードが違います' },
]) {
  test(`API ${scenario.status} is handled without a crash`, async ({ page, context }) => {
    await context.route('**/api/auth/login', (route) => route.fulfill({ status: scenario.status, contentType: 'application/json', body: scenario.body }));
    await openLogin(page);
    await page.getByLabel('メールアドレス').fill('person@example.com');
    await page.getByLabel('パスワード', { exact: true }).fill('SafePassword123!');
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(scenario.expected);
  });
}

test('offline failure and navigation during a slow request stay recoverable', async ({ page, context }) => {
  await openLogin(page);
  await page.getByLabel('メールアドレス').fill('person@example.com');
  await page.getByLabel('パスワード', { exact: true }).fill('SafePassword123!');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('接続を確認');
  await context.setOffline(false);

  await context.route('**/api/auth/login', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"invalid_credentials"}' }).catch(() => undefined);
  });
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.goto('/services');
  await expect(page.getByRole('heading').first()).toBeVisible();
});

test('five tabs keep independent UI state without page errors', async ({ context }) => {
  test.slow();
  const errors: string[] = [];
  const pages = await Promise.all(Array.from({ length: 5 }, () => context.newPage()));
  for (const page of pages) page.on('pageerror', (error) => errors.push(error.message));
  for (const page of pages) await openLogin(page);
  await Promise.all(pages.map((page, index) => page.getByLabel('メールアドレス').fill(`person${index}@example.com`)));
  await Promise.all(pages.map((page, index) => expect(page.getByLabel('メールアドレス')).toHaveValue(`person${index}@example.com`)));
  expect(errors).toEqual([]);
});

test('login page has no serious accessibility violations', async ({ page }) => {
  await openLogin(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
});
