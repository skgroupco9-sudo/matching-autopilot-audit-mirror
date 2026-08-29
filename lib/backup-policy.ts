export const AUTOMATIC_BACKUP_RETENTION_COUNT = 7;

export function backupPrefixForUser(userId: string) {
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `backups/${safeUserId}/`;
}

export function japanDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
