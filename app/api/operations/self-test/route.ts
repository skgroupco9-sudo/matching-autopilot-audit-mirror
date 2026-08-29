import { getPersonalUser } from '@/app/personal-auth';
import { getDb, getFilesBucket } from '@/db';
import { aiCredentials, appConnections, automationJobs, users, workerHeartbeats } from '@/db/schema';
import { aiCredentialVaultContext } from '@/lib/ai-credentials';
import { decryptVaultValue } from '@/lib/identity-vault';
import { probeOpenAiConnection } from '@/lib/openai-connection';
import { validateSameOriginMutation } from '@/lib/request-security';
import { sendTelegramReport } from '@/lib/telegram';
import { and, desc, eq } from 'drizzle-orm';
import { createEncryptedAccountBackup, verifyLatestEncryptedAccountBackup } from '@/lib/account-backup';
import { evaluateOperationsSelfTest } from '@/lib/operations-self-test';

type Check = { id: 'database' | 'storage' | 'backup' | 'worker' | 'ai' | 'service' | 'telegram'; label: string; ok: boolean; detail: string; required: boolean };

export async function POST(request: Request) {
  const requestError = validateSameOriginMutation(request);
  if (requestError) return requestError;
  const user = await getPersonalUser();
  if (!user) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const notifyTelegram = new URL(request.url).searchParams.get('notify') === '1';

  const db = getDb();
  const now = new Date();
  const [ownerRows, aiRows, connectionRows, workerRows] = await Promise.all([
    db.select({ id: users.id, chatId: users.telegramChatId }).from(users).where(eq(users.id, user.userId)).limit(1),
    db.select({ enabled: aiCredentials.enabled, apiKeyCiphertext: aiCredentials.apiKeyCiphertext, model: aiCredentials.model }).from(aiCredentials).where(eq(aiCredentials.userId, user.userId)).limit(1),
    db.select({ id: appConnections.id }).from(appConnections).where(and(eq(appConnections.userId, user.userId), eq(appConnections.status, 'connected'))).limit(1),
    db.select({ status: workerHeartbeats.status, lastSeenAt: workerHeartbeats.lastSeenAt }).from(workerHeartbeats).where(eq(workerHeartbeats.userId, user.userId)).orderBy(desc(workerHeartbeats.lastSeenAt)).limit(1),
  ]);
  const worker = workerRows[0];
  const workerFresh = Boolean(worker && now.getTime() - worker.lastSeenAt.getTime() < 120_000 && ['online', 'busy'].includes(worker.status));
  let aiOk = false;
  let aiDetail = 'AIキーが未設定です';
  if (aiRows[0]?.enabled) {
    try {
      const apiKey = await decryptVaultValue(aiRows[0].apiKeyCiphertext, aiCredentialVaultContext(user.userId));
      const probe = await probeOpenAiConnection(apiKey, aiRows[0].model);
      aiOk = probe.ok;
      aiDetail = probe.ok ? `OpenAI実接続OK（${probe.model}・${probe.latencyMs}ms）` : probe.detail;
    } catch {
      aiDetail = '暗号化AIキーを読み込めませんでした';
    }
  }
  const checks: Check[] = [
    { id: 'database', label: 'データベース', ok: Boolean(ownerRows[0]), detail: ownerRows[0] ? '読込・所有者確認OK' : '所有者データを確認できません', required: true },
    { id: 'worker', label: '常駐ワーカー', ok: workerFresh, detail: workerFresh ? '120秒以内に正常応答' : 'オフラインまたは設定不足', required: true },
    { id: 'ai', label: 'AI実接続', ok: aiOk, detail: aiDetail, required: true },
    { id: 'service', label: '実サービス', ok: Boolean(connectionRows[0]), detail: connectionRows[0] ? 'ログイン済み接続あり' : '接続後に実地試験します', required: false },
  ];

  let storageOk = false;
  try {
    const bucket = getFilesBucket();
    const key = `self-tests/${user.userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)}/${crypto.randomUUID()}.txt`;
    const probe = new TextEncoder().encode('matchpilot-storage-probe');
    await bucket.put(key, probe, { httpMetadata: { contentType: 'text/plain' } });
    const stored = await bucket.get(key);
    storageOk = Boolean(stored && new Uint8Array(await stored.arrayBuffer()).length === probe.length);
    await bucket.delete(key);
  } catch {
    storageOk = false;
  }
  checks.splice(1, 0, { id: 'storage', label: '暗号化ファイル保管', ok: storageOk, detail: storageOk ? '書込・読込・削除OK' : '保管領域を確認できません', required: true });

  let backupCheck: { ok: boolean; detail: string } = { ok: false, detail: 'バックアップを検証できません' };
  try {
    await createEncryptedAccountBackup(user.userId, now);
    backupCheck = await verifyLatestEncryptedAccountBackup(user.userId);
  } catch {
    backupCheck = { ok: false, detail: 'バックアップの作成・復号テストに失敗しました' };
  }
  checks.splice(2, 0, { id: 'backup', label: 'バックアップ復旧検査', ok: backupCheck.ok, detail: backupCheck.detail, required: true });

  let telegramOk = false;
  if (notifyTelegram && ownerRows[0]?.chatId) {
    telegramOk = await sendTelegramReport({
      chatId: ownerRows[0].chatId,
      text: ['✅ MatchPilot総合セルフテスト', '', ...checks.map((check) => `${check.ok ? '✓' : '×'} ${check.label}：${check.detail}`), '', '外部サービスの実送信は、相手の同意がある実地試験でのみ確認します。'].join('\n'),
    }).then(() => true).catch(() => false);
  }
  checks.push({
    id: 'telegram',
    label: 'Telegram通知',
    ok: notifyTelegram ? telegramOk : Boolean(ownerRows[0]?.chatId),
    detail: notifyTelegram
      ? telegramOk ? 'テスト通知を送信しました' : ownerRows[0]?.chatId ? '通知送信に失敗しました' : 'Telegramが未接続です'
      : ownerRows[0]?.chatId ? '接続済み（今回は送信なし）' : 'Telegramが未接続です',
    required: false,
  });
  const { ok, operationalReady, failedRequiredIds } = evaluateOperationsSelfTest(checks);
  if (ok) await db.update(users).set({ lastSelfTestAt: now, updatedAt: now }).where(eq(users.id, user.userId));
  await db.insert(automationJobs).values({
    id: `self_test_${crypto.randomUUID()}`,
    userId: user.userId,
    connectionId: null,
    type: 'operations_self_test',
    payloadJson: JSON.stringify({ checks, notifyTelegram, operationalReady }),
    status: ok ? 'completed' : 'failed',
    priority: 0,
    attempts: 1,
    lastError: ok ? null : failedRequiredIds.join(','),
    runAfter: now,
    createdAt: now,
    updatedAt: now,
  });
  return Response.json({ ok, operationalReady, notified: notifyTelegram && telegramOk, checkedAt: now.toISOString(), checks });
}
