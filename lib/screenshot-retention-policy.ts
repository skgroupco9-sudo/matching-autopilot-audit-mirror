export const SCREENSHOT_RETENTION_DAYS = 30;

export function screenshotRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - SCREENSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function screenshotPrefixForUser(userId: string) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `screenshots/${safeUserId}/`;
}
