import { getPersonalUser } from '@/app/personal-auth';
import { getDb } from '@/db';
import { aiCredentials, telegramLearningItems } from '@/db/schema';
import { aiCredentialVaultContext } from '@/lib/ai-credentials';
import { detectIdentityProfilePhotoContentType } from '@/lib/identity-profile-photos';
import { decryptVaultValue } from '@/lib/identity-vault';
import { validateMultipartMutation } from '@/lib/request-security';
import {
  parseSubmittedText,
  parseTelegramExportJson,
  telegramImportLimits,
  telegramImportMessageId,
  type TelegramImportCandidate,
} from '@/lib/telegram-import';
import { analyzeTelegramLearningImages } from '@/lib/telegram-image-analysis';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const user = await getPersonalUser();
  if (!user) return json({ error: 'authentication_required' }, 401);
  const requestError = validateMultipartMutation(request);
  if (requestError) return requestError;

  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > telegramImportLimits.maximumCombinedBytes + 512 * 1024) {
    return json({ error: 'import_too_large' }, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'invalid_form_data' }, 400);
  }
  if (formData.get('consent') !== 'true') return json({ error: 'participant_consent_required' }, 400);

  const history = formData.get('history');
  const pastedText = typeof formData.get('pastedText') === 'string' ? String(formData.get('pastedText')).trim() : '';
  const imageFiles = formData.getAll('images').filter((value): value is File => value instanceof File && value.size > 0);
  if (!(history instanceof File) && !pastedText && imageFiles.length === 0) return json({ error: 'import_source_required' }, 400);
  if (pastedText.length > telegramImportLimits.maximumPastedTextCharacters) return json({ error: 'pasted_text_too_large' }, 413);
  if (imageFiles.length > telegramImportLimits.maximumImageCount) return json({ error: 'too_many_images' }, 413);

  const combinedBytes = (history instanceof File ? history.size : 0)
    + new TextEncoder().encode(pastedText).byteLength
    + imageFiles.reduce((sum, file) => sum + file.size, 0);
  if (combinedBytes > telegramImportLimits.maximumCombinedBytes) return json({ error: 'import_too_large' }, 413);

  let candidates: TelegramImportCandidate[] = [];
  let totalMessages = 0;
  let skipped = 0;
  let truncated = 0;
  try {
    if (history instanceof File && history.size > 0) {
      if (history.size > telegramImportLimits.maximumHistoryFileBytes) return json({ error: 'history_file_too_large' }, 413);
      const raw = await history.text();
      const parsed = history.name.toLocaleLowerCase('en').endsWith('.txt')
        ? await parseSubmittedText(raw, 'text-file')
        : await parseTelegramExportJson(raw);
      candidates.push(...parsed.candidates);
      totalMessages += parsed.totalMessages;
      skipped += parsed.skipped;
      truncated += parsed.truncated;
    }
    if (pastedText) {
      const parsed = await parseSubmittedText(pastedText);
      candidates.push(...parsed.candidates);
      totalMessages += parsed.totalMessages;
      skipped += parsed.skipped;
      truncated += parsed.truncated;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid_import';
    return json({ error: ['invalid_telegram_json', 'telegram_messages_not_found'].includes(message) ? message : 'invalid_import' }, 400);
  }

  let imageAnalysis: 'not_requested' | 'completed' | 'ai_not_configured' | 'failed' = 'not_requested';
  let imageSnippets = 0;
  if (imageFiles.length) {
    const images: Array<{ bytes: Uint8Array; contentType: string }> = [];
    for (const file of imageFiles) {
      if (file.size > telegramImportLimits.maximumImageFileBytes) return json({ error: 'image_too_large' }, 413);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const contentType = detectIdentityProfilePhotoContentType(bytes);
      if (!contentType) return json({ error: 'unsupported_image_type' }, 415);
      images.push({ bytes, contentType });
    }
    const credentialRows = await getDb().select({
      apiKeyCiphertext: aiCredentials.apiKeyCiphertext,
      model: aiCredentials.model,
      enabled: aiCredentials.enabled,
    }).from(aiCredentials).where(eq(aiCredentials.userId, user.userId)).limit(1);
    const credential = credentialRows[0];
    if (!credential?.enabled) {
      imageAnalysis = 'ai_not_configured';
    } else {
      try {
        const snippets = await analyzeTelegramLearningImages(images, {
          apiKey: await decryptVaultValue(credential.apiKeyCiphertext, aiCredentialVaultContext(user.userId)),
          model: credential.model,
        });
        const imageSeed = await telegramImportMessageId(images.map((image) => `${image.contentType}:${image.bytes.byteLength}`).join('|'));
        const reviewableSnippets = snippets.filter((snippet) => snippet.role !== 'other');
        const selfSnippets = reviewableSnippets.filter((snippet) => snippet.role === 'self');
        const imageCandidates = await Promise.all(reviewableSnippets.map(async (snippet, index) => ({
          telegramMessageId: await telegramImportMessageId(`${imageSeed}:${index}:${snippet.replyContext}:${snippet.text}`),
          redactedText: snippet.role === 'unknown'
            ? `【話者不明・確認要】${snippet.text}`
            : snippet.replyContext
              ? `【相手の発言】${snippet.replyContext}\n【本人の返信】${snippet.text}`
              : `【本人の返信】${snippet.text}`,
        })));
        candidates.push(...imageCandidates);
        totalMessages += reviewableSnippets.length;
        imageSnippets = selfSnippets.length;
        imageAnalysis = 'completed';
      } catch {
        imageAnalysis = 'failed';
      }
    }
  }

  const unique = Array.from(new Map(candidates.map((candidate) => [candidate.telegramMessageId, candidate])).values());
  if (unique.length > telegramImportLimits.maximumMessages) {
    truncated += unique.length - telegramImportLimits.maximumMessages;
    candidates = unique.slice(-telegramImportLimits.maximumMessages);
  } else {
    candidates = unique;
  }

  const now = Date.now();
  let imported = 0;
  for (let offset = 0; offset < candidates.length; offset += telegramImportLimits.databaseInsertBatchSize) {
    const chunk = candidates.slice(offset, offset + telegramImportLimits.databaseInsertBatchSize);
    const inserted = await getDb().insert(telegramLearningItems).values(chunk.map((candidate, index) => {
      const createdAt = new Date(now - (candidates.length - offset - index - 1));
      return {
        id: `learning_${crypto.randomUUID()}`,
        userId: user.userId,
        telegramMessageId: candidate.telegramMessageId,
        sourceKind: 'imported' as const,
        category: 'unclassified' as const,
        status: 'pending' as const,
        redactedText: candidate.redactedText,
        approvedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
    })).onConflictDoNothing().returning({ id: telegramLearningItems.id });
    imported += inserted.length;
  }

  return json({
    imported,
    duplicates: candidates.length - imported,
    skipped,
    truncated,
    totalMessages,
    imageAnalysis,
    imageSnippets,
  }, 201);
}

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
}
