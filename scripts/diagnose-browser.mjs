import { chromium } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROME_PATH;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const startedAt = Date.now();
const elapsed = () => `${Date.now() - startedAt}ms`;

page.on('console', (message) => console.log(`[console:${message.type()} ${elapsed()}] ${message.text()}`));
page.on('pageerror', (error) => console.log(`[pageerror ${elapsed()}] ${error.message}`));
page.on('requestfailed', (request) => console.log(`[requestfailed ${elapsed()}] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
page.on('response', (response) => {
  if (response.status() >= 400 || response.url().includes('/api/')) {
    console.log(`[response ${elapsed()}] ${response.status()} ${response.url()}`);
  }
});

await context.route('**/api/dashboard', (route) => route.fulfill({
  status: 401,
  contentType: 'application/json',
  body: '{"error":"authentication_required"}',
}));
await context.route('**/api/auth/status', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: '{"authConfigured":true,"registrationOpen":false}',
}));

await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
for (let attempt = 0; attempt < 12; attempt += 1) {
  await page.waitForTimeout(5_000);
  const heading = await page.getByRole('heading').first().textContent().catch(() => null);
  console.log(`[state ${elapsed()}] heading=${JSON.stringify(heading)}`);
  if (heading === 'おかえりなさい') break;
}

await browser.close();
