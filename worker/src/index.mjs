import { ChromeBrowser, wait } from './browser.mjs';
import { ControlPlaneClient, randomId } from './control-plane.mjs';
import { allowsExternalAutomation, assertProviderUrl, clickLike, confirmBlockAction, detectCheckpoint, discoverCandidates, discoverConversationLinks, fillRegistrationCredentials, fillRegistrationPhoto, fillRegistrationProfile, fillVerificationCode, openBlockAction, readConversationSnapshot, sendChatMessage } from './adapters.mjs';
import { generateReply, ReplySafetyError } from './ai.mjs';
import { extractContactExchange } from '../../lib/automation/contact-extraction.mjs';
import { JobJournal } from './journal.mjs';
import { buildWorkerReadiness, effectiveHeartbeatStatus } from './readiness.mjs';
import { lineBlockExecutionState } from '../../lib/automation/line-block-window.mjs';

const config = readConfig();
let aiRuntime = { apiKey: config.openaiApiKey, model: config.openaiModel };
let workerReadiness = buildWorkerReadiness({ ...config, openaiApiKey: aiRuntime.apiKey });
const client = new ControlPlaneClient({ ...config, version: '0.11.0', capabilities: workerReadiness.capabilities });
const browser = new ChromeBrowser({
  executablePath: config.chromeExecutablePath,
  dataDir: config.dataDir,
  headless: config.headless,
});
const journal = new JobJournal(config.dataDir);
const activeConnections = new Map();
const pendingConnections = new Map();
let stopping = false;
let automationEnabled = false;

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

await journal.load();
await browser.start();
syncConnections(await client.heartbeat(effectiveHeartbeatStatus('online', workerReadiness)));
await refreshAiSettings();
syncConnections(await client.heartbeat(effectiveHeartbeatStatus('online', workerReadiness)));
let lastHeartbeat = Date.now();
let lastAiRefresh = Date.now();
let lastScan = 0;
let lastSummaryCheck = 0;
let lastPendingCheck = 0;

while (!stopping) {
  try {
    if (Date.now() - lastAiRefresh > 60_000) {
      await refreshAiSettings();
      lastAiRefresh = Date.now();
    }
    if (Date.now() - lastHeartbeat > 25_000) {
      syncConnections(await client.heartbeat(effectiveHeartbeatStatus('online', workerReadiness)));
      lastHeartbeat = Date.now();
    }
    const job = await client.leaseJob();
    if (job) {
      syncConnections(await client.heartbeat(effectiveHeartbeatStatus('busy', workerReadiness)));
      if (!journal.has(job.id)) {
        await executeJob(job);
        await journal.add(job.id);
      }
      await client.finishJob(job.id, 'completed');
      await journal.remove(job.id);
      syncConnections(await client.heartbeat(effectiveHeartbeatStatus('online', workerReadiness)));
      lastHeartbeat = Date.now();
      continue;
    }
    if (automationEnabled && Date.now() - lastScan > config.scanIntervalMs) {
      await scanKnownConnections();
      lastScan = Date.now();
    }
    if (Date.now() - lastPendingCheck > 12_000) {
      await recheckPendingConnections();
      lastPendingCheck = Date.now();
    }
    if (Date.now() - lastSummaryCheck > 60_000) {
      await maybeSendDailySummary();
      lastSummaryCheck = Date.now();
    }
    await wait(2500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[worker] ${new Date().toISOString()} ${message}\n`);
    await wait(5000);
  }
}

await client.heartbeat('offline').catch(() => undefined);
await browser.stop();

async function executeJob(job) {
  try {
    const payload = job.payload ?? {};
    switch (job.type) {
      case 'start_session': {
        const provider = requiredString(payload.provider, 'provider');
        const entryUrl = assertProviderUrl(provider, requiredString(payload.entryUrl, 'entryUrl'));
        const page = await browser.page(job.connectionId);
        await page.navigate(entryUrl);
        let identity;
        if (payload.useIdentityProfile === true) {
          identity = await client.getRegistrationIdentity(provider).catch(() => null);
          if (identity?.profile) {
            const prepared = await fillRegistrationProfile(page, identity.profile);
            const credentialPrepared = payload.intent === 'new' && identity.credential
              ? await fillRegistrationCredentials(page, identity.credential)
              : { filledFields: [] };
            let photoPrepared = { filled: false };
            if (payload.intent === 'new' && identity.primaryPhoto) {
              const photo = await client.downloadRegistrationPhoto(identity.primaryPhoto.id).catch(() => null);
              if (photo) {
                photoPrepared = await browser.withTemporaryUpload(photo.bytes, photo.contentType, (filePath) => fillRegistrationPhoto(page, filePath));
              }
            }
            await client.sendEvent({ id: randomId(), connectionId: job.connectionId, type: 'registration_profile_prepared', payload: { provider, filledFields: [...prepared.filledFields, ...credentialPrepared.filledFields, ...(photoPrepared.filled ? ['primaryPhoto'] : [])] } });
          }
        }
        const checkpoint = await detectCheckpoint(page);
        if (checkpoint) {
          pendingConnections.set(job.connectionId, { provider, entryUrl, page });
          await reportCheckpoint(page, job, provider, checkpoint);
          if (checkpoint === 'email_or_sms_otp' && identity?.gmailCodeAssistEnabled) {
            const codeResult = await client.getVerificationCodes('').catch(() => null);
            if (codeResult?.codes?.length === 1) {
              const filled = await fillVerificationCode(page, codeResult.codes[0].code);
              if (filled.filled) await client.sendEvent({ id: randomId(), connectionId: job.connectionId, type: 'verification_code_prepared', payload: { provider, source: 'gmail' } });
            }
          }
          return;
        }
        activeConnections.set(job.connectionId, { provider, entryUrl });
        await client.sendEvent({ id: randomId(), connectionId: job.connectionId, type: 'session_ready', payload: { provider } });
        await scanConnection(job.connectionId, provider, entryUrl);
        return;
      }
      case 'like_contact': {
        const provider = requiredString(payload.provider, 'provider');
        if (!allowsExternalAutomation(provider)) throw new NonRetryableError(`external_automation_not_permitted:${provider}`);
        const profileUrl = assertProviderUrl(provider, requiredString(payload.profileUrl, 'profileUrl'));
        const page = await browser.page(job.connectionId);
        await page.navigate(profileUrl);
        const checkpoint = await detectCheckpoint(page);
        if (checkpoint) {
          pendingConnections.set(job.connectionId, { provider, entryUrl: profileUrl, page });
          return reportCheckpoint(page, job, provider, checkpoint);
        }
        const clicked = await clickLike(page);
        if (!clicked.ok) throw new NonRetryableError(clicked.reason);
        await journal.add(job.id);
        return;
      }
      case 'send_message':
      case 'send_approved_reply': {
        const connection = activeConnections.get(job.connectionId);
        const provider = requiredString(payload.provider ?? connection?.provider, 'provider');
        if (!allowsExternalAutomation(provider)) throw new NonRetryableError(`external_automation_not_permitted:${provider}`);
        const threadUrl = assertProviderUrl(provider, requiredString(payload.threadUrl, 'threadUrl'));
        const body = requiredString(payload.body, 'body').slice(0, 2000);
        const page = await browser.page(job.connectionId);
        await page.navigate(threadUrl);
        const checkpoint = await detectCheckpoint(page);
        if (checkpoint) {
          pendingConnections.set(job.connectionId, { provider, entryUrl: threadUrl, page });
          return reportCheckpoint(page, job, provider, checkpoint, payload.conversationId, body);
        }
        const sent = await sendChatMessage(page, body);
        if (!sent.ok) throw new NonRetryableError(sent.reason);
        await journal.add(job.id);
        await client.sendEvent({
          id: randomId(),
          connectionId: job.connectionId,
          conversationId: payload.conversationId,
          type: 'outgoing_message',
          payload: { provider, messageId: payload.messageId, body },
        }).catch((error) => {
          process.stderr.write(`[worker] sent_message_event_report_failed ${error.message}\n`);
        });
        return;
      }
      case 'block_contact': {
        await executeLineBlock(job, payload);
        return;
      }
      case 'generate_reply': {
        const incomingBody = requiredString(payload.incomingBody, 'incomingBody');
        const goalKeywords = Array.isArray(payload.goalKeywords) ? payload.goalKeywords.filter((keyword) => typeof keyword === 'string') : [];
        const conversation = Array.isArray(payload.conversation) && payload.conversation.length
          ? payload.conversation
              .filter((message) => message && typeof message === 'object' && ['incoming', 'outgoing'].includes(message.direction) && typeof message.body === 'string')
              .slice(-12)
          : [{ direction: 'incoming', body: incomingBody }];
        const generated = await generateReply({
          apiKey: aiRuntime.apiKey,
          model: aiRuntime.model,
          persona: config.persona,
          conversation,
          styleExamples: Array.isArray(payload.styleExamples)
            ? payload.styleExamples.filter((example) => typeof example === 'string').slice(0, 6)
            : [],
          avoidExamples: Array.isArray(payload.avoidExamples)
            ? payload.avoidExamples.filter((example) => typeof example === 'string').slice(0, 24)
            : [],
          allowedTopics: Array.isArray(payload.allowedTopics) ? payload.allowedTopics.filter((topic) => typeof topic === 'string') : [],
          goalKeywords,
          guidance: payload.conversationGuidance && typeof payload.conversationGuidance === 'object' ? payload.conversationGuidance : {},
        });
        const contact = payload.contact && typeof payload.contact === 'object' ? payload.contact : {};
        const receivedContact = [...conversation]
          .reverse()
          .filter((message) => message.direction === 'incoming')
          .map((message) => extractContactExchange(message.body))
          .find((value) => value.detected) ?? extractContactExchange(incomingBody);
        const goalReached = goalKeywords.length > 0
          && generated.marriageIntentStatus === 'confirmed'
          && receivedContact.detected;
        let screenshotObjectKey;
        if (goalReached && typeof payload.threadUrl === 'string' && typeof payload.provider === 'string' && allowsExternalAutomation(payload.provider)) {
          const page = await browser.page(job.connectionId);
          await page.navigate(assertProviderUrl(payload.provider, payload.threadUrl));
          const checkpoint = await detectCheckpoint(page);
          if (!checkpoint) {
            const uploaded = await client.uploadScreenshot(await page.screenshot(), `goal_${requiredString(payload.sourceEventId, 'sourceEventId')}`.slice(0, 40));
            screenshotObjectKey = uploaded.objectKey;
          }
        }
        await client.sendEvent({
          id: `reply_${requiredString(payload.sourceEventId, 'sourceEventId')}`.slice(0, 40),
          connectionId: job.connectionId,
          conversationId: payload.conversationId,
          type: 'incoming_message',
          payload: {
            ...contact,
            provider: payload.provider,
            threadUrl: payload.threadUrl,
            messageId: payload.messageId,
            body: incomingBody,
            suggestedReply: generated.reply,
            summary: generated.summary,
            confidence: generated.shouldEscalate ? 0 : payload.sourceReliability === 'verified' ? generated.confidence : Math.min(payload.automationMode === 'full_auto' ? 90 : 70, generated.confidence),
            automationMode: payload.automationMode,
            sourceReliability: payload.sourceReliability,
            modelClass: aiRuntime.model,
            generationReasons: generated.reasons,
            detectedTopics: generated.detectedTopics,
            goalReached,
            goalReason: goalReached ? '相手の婚活意思を確認し、相手からLINEを受領しました' : generated.goalReason,
            marriageIntentStatus: generated.marriageIntentStatus,
            missingRequiredFields: generated.missingRequiredFields,
            contactExchange: receivedContact,
            lineReceivedAt: payload.lineReceivedAt,
            screenshotObjectKey,
          },
        });
        return;
      }
      case 'resume_all':
        await scanKnownConnections();
        return;
      case 'pause_all':
      case 'pause_conversation':
      case 'resume_conversation':
      case 'sync_rules':
        return;
      default:
        throw new NonRetryableError(`unsupported_job:${job.type}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.finishJob(job.id, 'failed', message, !(error instanceof NonRetryableError) && !(error instanceof ReplySafetyError));
    throw error;
  }
}

async function executeLineBlock(job, payload) {
  const provider = requiredString(payload.provider, 'provider');
  const receivedAt = requiredString(payload.lineReceivedAt, 'lineReceivedAt');
  const window = lineBlockExecutionState(new Date(), receivedAt);
  const sharedPayload = {
    provider,
    contactId: payload.contactId,
    contactExternalReference: payload.contactExternalReference,
    displayName: payload.displayName,
    profileUrl: payload.profileUrl,
    threadUrl: payload.threadUrl,
    blockNotBefore: window.notBefore.toISOString(),
    blockDeadline: window.deadline.toISOString(),
  };
  if (window.state === 'too_early') {
    throw new NonRetryableError('line_block_before_36_hours_rejected');
  }
  if (window.state === 'expired') {
    await client.sendEvent({
      id: randomId(),
      connectionId: job.connectionId,
      conversationId: payload.conversationId,
      type: 'block_failed',
      payload: { ...sharedPayload, summary: 'LINE受領から48時間を超過したため、ブロック操作を実行せず対応NGとして記録しました。' },
    }).catch(() => undefined);
    throw new NonRetryableError('line_block_after_48_hours_rejected');
  }

  try {
    if (!allowsExternalAutomation(provider)) throw new NonRetryableError(`external_automation_not_permitted:${provider}`);
    const targetUrl = typeof payload.threadUrl === 'string' && payload.threadUrl
      ? payload.threadUrl
      : requiredString(payload.profileUrl, 'profileUrl');
    const page = await browser.page(job.connectionId);
    await page.navigate(assertProviderUrl(provider, targetUrl));
    const checkpoint = await detectCheckpoint(page);
    if (checkpoint) throw new NonRetryableError(`block_checkpoint_required:${checkpoint}`);
    const uploaded = await client.uploadScreenshot(await page.screenshot(), `block_${job.id}`.slice(0, 40));
    let action = await openBlockAction(page);
    if (action.ok && action.stage === 'menu_opened') {
      await wait(500);
      action = await openBlockAction(page);
    }
    if (!action.ok || action.stage !== 'block_clicked') throw new NonRetryableError(action.reason ?? 'block_action_not_confirmed');
    await wait(500);
    const confirmation = await confirmBlockAction(page);
    if (!confirmation.ok) throw new NonRetryableError(confirmation.reason);
    await journal.add(job.id);
    await client.sendEvent({
      id: randomId(),
      connectionId: job.connectionId,
      conversationId: payload.conversationId,
      type: 'block_completed',
      payload: { ...sharedPayload, screenshotObjectKey: uploaded.objectKey, summary: 'LINE受領から36〜48時間の指定時間内にブロック操作を完了しました。' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.sendEvent({
      id: randomId(),
      connectionId: job.connectionId,
      conversationId: payload.conversationId,
      type: 'block_failed',
      payload: { ...sharedPayload, summary: `指定時間内のブロック操作が完了しませんでした: ${message.slice(0, 180)}` },
    }).catch(() => undefined);
    throw error;
  }
}

async function reportCheckpoint(page, job, provider, checkpoint, conversationId, suggestedReply) {
  const eventId = randomId();
  const screenshot = await page.screenshot();
  const uploaded = await client.uploadScreenshot(screenshot, eventId);
  await client.sendEvent({
    id: eventId,
    connectionId: job.connectionId,
    conversationId,
    type: 'checkpoint_required',
    payload: {
      provider,
      checkpoint,
      suggestedReply,
      screenshotObjectKey: uploaded.objectKey,
      summary: checkpointLabel(checkpoint),
      approvalAllowed: Boolean(suggestedReply),
    },
  });
}

async function scanKnownConnections() {
  for (const [connectionId, connection] of activeConnections) {
    if (stopping) break;
    await scanConnection(connectionId, connection.provider, connection.entryUrl).catch((error) => {
      process.stderr.write(`[scan] ${connection.provider} ${error.message}\n`);
    });
  }
}

async function recheckPendingConnections() {
  for (const [connectionId, connection] of pendingConnections) {
    if (stopping) break;
    const checkpoint = await detectCheckpoint(connection.page).catch(() => 'initial_login');
    if (checkpoint) continue;
    const resumedUrl = assertProviderUrl(connection.provider, await connection.page.currentUrl());
    pendingConnections.delete(connectionId);
    activeConnections.set(connectionId, { provider: connection.provider, entryUrl: resumedUrl });
    await client.sendEvent({ id: randomId(), connectionId, type: 'session_ready', payload: { provider: connection.provider, resumedAfterCheckpoint: true } });
    await scanConnection(connectionId, connection.provider, resumedUrl).catch((error) => {
      process.stderr.write(`[resume] ${connection.provider} ${error.message}\n`);
    });
  }
}

async function maybeSendDailySummary() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year}-${values.month}-${values.day}`;
  const journalId = `daily_summary_${date}`;
  if (Number(values.hour) < config.summaryHour || journal.has(journalId)) return;
  const result = await client.sendDailySummary(date);
  if (result.ok) await journal.add(journalId);
}

function syncConnections(heartbeat) {
  automationEnabled = heartbeat.automationState === 'active';
  for (const connection of heartbeat.connections ?? []) {
    if (!connection.id || !connection.provider || !connection.entryUrl) continue;
    if (connection.status !== 'connected') {
      activeConnections.delete(connection.id);
      continue;
    }
    activeConnections.set(connection.id, { provider: connection.provider, entryUrl: connection.entryUrl });
  }
}

async function refreshAiSettings() {
  const remote = await client.getAiSettings().catch(() => null);
  aiRuntime = remote?.configured && remote.enabled && typeof remote.apiKey === 'string'
    ? { apiKey: remote.apiKey, model: typeof remote.model === 'string' && remote.model ? remote.model : config.openaiModel }
    : { apiKey: config.openaiApiKey, model: config.openaiModel };
  workerReadiness = buildWorkerReadiness({ ...config, openaiApiKey: aiRuntime.apiKey });
  client.setCapabilities(workerReadiness.capabilities);
}

async function scanConnection(connectionId, provider, entryUrl) {
  if (!allowsExternalAutomation(provider)) return;
  const page = await browser.page(connectionId);
  await page.navigate(assertProviderUrl(provider, entryUrl));
  const checkpoint = await detectCheckpoint(page);
  if (checkpoint) {
    pendingConnections.set(connectionId, { provider, entryUrl, page });
    await reportCheckpoint(page, { connectionId }, provider, checkpoint);
    activeConnections.delete(connectionId);
    return;
  }
  const candidates = await discoverCandidates(page, provider);
  for (const candidate of candidates) {
    const stableId = await shortHash(`${provider}:${candidate.externalReference}`);
    await client.sendEvent({
      id: stableId,
      connectionId,
      type: 'candidate_discovered',
      payload: {
        provider,
        contactExternalReference: candidate.externalReference,
        displayName: candidate.displayName,
        age: candidate.age,
        distanceKm: candidate.distanceKm,
        location: candidate.location,
        profileSnippet: candidate.profileSnippet,
        profileUrl: candidate.profileUrl,
        annualIncomeMinimum: candidate.annualIncomeMinimum,
        likesCount: candidate.likesCount,
        hasNewBadge: candidate.hasNewBadge,
        hasFacePhoto: candidate.hasFacePhoto,
        isPaidMember: candidate.isPaidMember,
        sourceReliability: candidate.sourceReliability,
      },
    });
  }
  const conversationLinks = await discoverConversationLinks(page, provider);
  for (const rawLink of conversationLinks.slice(0, 5)) {
    const threadUrl = assertProviderUrl(provider, rawLink);
    await page.navigate(threadUrl);
    const snapshot = await readConversationSnapshot(page, provider);
    if (!snapshot) continue;
    const stableId = await shortHash(`${provider}:${snapshot.conversationExternalReference}:${snapshot.body}`);
    const contactExchange = extractContactExchange(snapshot.body);
    let screenshotObjectKey;
    if (contactExchange.detected) {
      try {
        const uploaded = await client.uploadScreenshot(await page.screenshot(), `line_${stableId}`.slice(0, 40));
        screenshotObjectKey = uploaded.objectKey;
      } catch (error) {
        process.stderr.write(`[scan] line_screenshot_failed ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
    await client.sendEvent({
      id: stableId,
      connectionId,
      conversationId: `conversation_${await shortHash(`${provider}:${snapshot.conversationExternalReference}`)}`,
      type: 'incoming_message',
      payload: {
        provider,
        contactExternalReference: snapshot.conversationExternalReference,
        displayName: snapshot.displayName,
        conversationExternalReference: snapshot.conversationExternalReference,
        threadUrl: snapshot.threadUrl,
        profileUrl: snapshot.profileUrl,
        body: snapshot.body,
        messageId: `incoming_${stableId}`,
        sourceReliability: snapshot.sourceReliability,
        contactExchange,
        goalReached: false,
        goalReason: undefined,
        summary: contactExchange.detected ? '相手からLINEの連絡先情報を受領。婚活意思の確認後に達成判定します。' : undefined,
        screenshotObjectKey,
      },
    });
  }
}

function readConfig() {
  const baseUrl = requiredEnv('CONTROL_PLANE_URL');
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/localhost(?::\d+)?$/.test(baseUrl)) throw new Error('CONTROL_PLANE_URL_must_be_https');
  return {
    baseUrl,
    secret: requiredEnv('WORKER_SHARED_SECRET'),
    token: requiredEnv('WORKER_BINDING_TOKEN'),
    userId: requiredEnv('WORKER_USER_ID'),
    workerId: process.env.WORKER_ID || 'personal-worker-1',
    chromeExecutablePath: requiredEnv('CHROME_EXECUTABLE_PATH'),
    dataDir: process.env.WORKER_DATA_DIR || './data/chrome-profile',
    headless: process.env.HEADLESS === 'true',
    scanIntervalMs: Math.max(5, Number(process.env.SCAN_INTERVAL_MINUTES || 15)) * 60_000,
    summaryHour: Math.min(23, Math.max(0, Number(process.env.SUMMARY_HOUR || 21))),
    openaiApiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
    openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-5.4-mini',
    persona: process.env.PERSONA_TEXT?.trim() || '自然体で丁寧。短く質問を一つ返す。知らない事実や経験は作らない。',
  };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_missing`);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new NonRetryableError(`${name}_missing`);
  return value.trim();
}

function checkpointLabel(checkpoint) {
  return ({ initial_login: 'ログイン操作が必要です', email_or_sms_otp: '認証コードの入力が必要です', captcha: 'CAPTCHAの操作が必要です', identity_verification: '本人確認が必要です', account_restricted: 'アカウントの利用制限を検知したため自動操作を停止しました。公式サポートで状態を確認してください' })[checkpoint] ?? '手動操作が必要です';
}

async function shortHash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

class NonRetryableError extends Error {}
