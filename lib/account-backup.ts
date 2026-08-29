import { getD1, getFilesBucket } from '@/db';
import { decryptVaultBytes, encryptVaultBytes } from '@/lib/identity-vault';
import { AUTOMATIC_BACKUP_RETENTION_COUNT, backupPrefixForUser, japanDateKey } from '@/lib/backup-policy';

const backupQueries = [
  ['user', 'SELECT * FROM users WHERE id = ?'],
  ['passwordAccount', 'SELECT * FROM password_accounts WHERE user_id = ?'],
  ['identityProfile', 'SELECT * FROM identity_profiles WHERE user_id = ?'],
  ['identityPhotos', 'SELECT * FROM identity_profile_photos WHERE user_id = ?'],
  ['identityDocuments', 'SELECT * FROM identity_documents WHERE user_id = ?'],
  ['serviceCredentials', 'SELECT * FROM service_credentials WHERE user_id = ?'],
  ['gmailConnection', 'SELECT * FROM gmail_connections WHERE user_id = ?'],
  ['aiCredential', 'SELECT * FROM ai_credentials WHERE user_id = ?'],
  ['billingCustomer', 'SELECT * FROM billing_customers WHERE user_id = ?'],
  ['billingSubscription', 'SELECT * FROM billing_subscriptions WHERE user_id = ?'],
  ['connections', 'SELECT * FROM app_connections WHERE user_id = ?'],
  ['contacts', 'SELECT * FROM contacts WHERE user_id = ?'],
  ['conversations', 'SELECT * FROM conversations WHERE user_id = ?'],
  ['messages', 'SELECT messages.* FROM messages INNER JOIN conversations ON conversations.id = messages.conversation_id WHERE conversations.user_id = ?'],
  ['rules', 'SELECT * FROM automation_rules WHERE user_id = ?'],
  ['jobs', 'SELECT * FROM automation_jobs WHERE user_id = ?'],
  ['reports', 'SELECT * FROM reports WHERE user_id = ?'],
  ['telegramLearning', 'SELECT * FROM telegram_learning_items WHERE user_id = ?'],
  ['workerBindings', 'SELECT * FROM worker_bindings WHERE user_id = ?'],
  ['workerHeartbeats', 'SELECT * FROM worker_heartbeats WHERE user_id = ?'],
] as const;

export async function createEncryptedAccountBackup(userId: string, now = new Date()) {
  const bucket = getFilesBucket();
  const prefix = backupPrefixForUser(userId);
  const dateKey = japanDateKey(now);
  const existing = await bucket.list({ prefix: `${prefix}${dateKey}-`, limit: 1 });
  if (existing.objects[0]) {
    await touchBackupTimestamp(userId, now);
    return { objectKey: existing.objects[0].key, created: false };
  }

  const d1 = getD1();
  const results = await d1.batch(backupQueries.map(([, sql]) => d1.prepare(sql).bind(userId)));
  const tables = Object.fromEntries(backupQueries.map(([name], index) => [name, results[index]?.results ?? []]));
  const payload = new TextEncoder().encode(JSON.stringify({
    format: 'matchpilot-encrypted-backup-v1',
    userId,
    createdAt: now.toISOString(),
    tables,
  }));
  const encrypted = await encryptVaultBytes(payload, `account_backup:${userId}`);
  const objectKey = `${prefix}${dateKey}-${crypto.randomUUID()}.bin`;
  await bucket.put(objectKey, encrypted, {
    httpMetadata: { contentType: 'application/octet-stream' },
    customMetadata: { userId, dateKey, encrypted: 'aes-gcm' },
  });
  await touchBackupTimestamp(userId, now);
  await retainLatestBackups(userId);
  return { objectKey, created: true };
}

export async function verifyLatestEncryptedAccountBackup(userId: string) {
  const bucket = getFilesBucket();
  const listed = await bucket.list({ prefix: backupPrefixForUser(userId), limit: 1000 });
  const latest = listed.objects.toSorted((left, right) => right.uploaded.getTime() - left.uploaded.getTime())[0];
  if (!latest) return { ok: false, detail: 'バックアップがありません' };
  const stored = await bucket.get(latest.key);
  if (!stored) return { ok: false, detail: '最新バックアップを読み込めません' };
  try {
    const decrypted = await decryptVaultBytes(await stored.arrayBuffer(), `account_backup:${userId}`);
    const payload = JSON.parse(new TextDecoder().decode(decrypted)) as { format?: unknown; userId?: unknown; createdAt?: unknown; tables?: unknown };
    const ok = payload.format === 'matchpilot-encrypted-backup-v1'
      && payload.userId === userId
      && typeof payload.createdAt === 'string'
      && Boolean(payload.tables)
      && typeof payload.tables === 'object';
    return { ok, detail: ok ? '最新バックアップの復号・形式・所有者を確認' : '復号後の形式または所有者が一致しません' };
  } catch {
    return { ok: false, detail: '最新バックアップを復号・検証できません' };
  }
}

async function touchBackupTimestamp(userId: string, now: Date) {
  await getD1().prepare('UPDATE users SET last_backup_at = ?, updated_at = ? WHERE id = ?').bind(now.getTime(), now.getTime(), userId).run();
}

async function retainLatestBackups(userId: string) {
  const bucket = getFilesBucket();
  const listed = await bucket.list({ prefix: backupPrefixForUser(userId), limit: 1000 });
  const obsolete = listed.objects
    .toSorted((left, right) => right.uploaded.getTime() - left.uploaded.getTime())
    .slice(AUTOMATIC_BACKUP_RETENTION_COUNT)
    .map((object) => object.key);
  if (obsolete.length) await bucket.delete(obsolete);
}
