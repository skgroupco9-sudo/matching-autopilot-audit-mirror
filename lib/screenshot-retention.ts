import { getFilesBucket } from '@/db';
import { screenshotPrefixForUser, screenshotRetentionCutoff } from '@/lib/screenshot-retention-policy';

export { SCREENSHOT_RETENTION_DAYS, screenshotPrefixForUser, screenshotRetentionCutoff } from '@/lib/screenshot-retention-policy';

export async function purgeExpiredScreenshots(userId: string, now = new Date()) {
  const bucket = getFilesBucket();
  const prefix = screenshotPrefixForUser(userId);
  const cutoff = screenshotRetentionCutoff(now).getTime();
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const expiredKeys = page.objects
      .filter((object) => object.uploaded.getTime() < cutoff)
      .map((object) => object.key);
    if (expiredKeys.length > 0) {
      await bucket.delete(expiredKeys);
      deleted += expiredKeys.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return deleted;
}
