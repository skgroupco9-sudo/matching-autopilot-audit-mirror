import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { launch as launchChrome } from 'chrome-launcher';

const url = process.env.LIGHTHOUSE_URL || 'http://localhost:3000';
const outputPath = path.resolve(process.env.LIGHTHOUSE_OUTPUT || 'outputs/lighthouse-after.json');
const chromePath = process.env.LIGHTHOUSE_CHROME_PATH || process.env.PLAYWRIGHT_CHROME_PATH;
const chrome = await launchChrome({
  chromePath,
  chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
});

try {
  const result = await lighthouse(url, {
    port: chrome.port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['performance', 'accessibility', 'best-practices'],
  }, desktopConfig);
  if (!result) throw new Error('Lighthouse did not return a result.');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.report, 'utf8');
  const scores = Object.fromEntries(Object.entries(result.lhr.categories).map(([key, category]) => [key, Math.round((category.score ?? 0) * 100)]));
  console.log(JSON.stringify({ url, outputPath, scores }));
  if (process.env.CI && Object.values(scores).some((score) => score < 95)) process.exitCode = 1;
} finally {
  try {
    await chrome.kill();
  } catch {
    // Windows can briefly keep Chrome's temporary profile locked after exit.
    // The report is already written; cleanup failure must not invalidate it.
  }
}
