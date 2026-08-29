import { normalizeVisionSnippets } from './telegram-import';

type ImageInput = { bytes: Uint8Array; contentType: string };

const visionSchema = {
  type: 'object',
  properties: {
    snippets: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['self', 'other', 'unknown'] },
          text: { type: 'string', minLength: 1, maxLength: 1600 },
          replyContext: { type: 'string', maxLength: 800 },
        },
        required: ['role', 'text', 'replyContext'],
        additionalProperties: false,
      },
    },
  },
  required: ['snippets'],
  additionalProperties: false,
} as const;

export async function analyzeTelegramLearningImages(images: ImageInput[], credential: { apiKey: string; model: string }) {
  const content = [
    {
      type: 'input_text',
      text: [
        '同意を得て提出されたTelegram会話・報告の画像です。',
        '画像内で読める、人が作成した会話文または報告文だけを正確に抽出してください。推測・補完・要約はしないでください。',
        'マッチングアプリの会話画面では、吹き出しの左右、色、並びから本人側をself、相手側をotherと判定してください。確信がなければunknownにしてください。',
        'selfの発言では、直前の相手発言が読める場合だけreplyContextへ入れてください。otherとunknownのreplyContextは空文字にしてください。',
        '送信者名、アイコン、グループ名、日時、既読表示、電話番号、メール、URL、ユーザー名、認証番号は出力しないでください。',
        '文章の口調、相手への返し方、質問の運び方を学ぶために意味のある発言単位でsnippetsへ分けてください。読める対象がなければ空配列にしてください。',
      ].join('\n'),
    },
    ...images.map((image) => ({
      type: 'input_image',
      image_url: `data:${image.contentType};base64,${bytesToBase64(image.bytes)}`,
      detail: 'high',
    })),
  ];
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${credential.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: credential.model,
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 2500,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'telegram_image_learning', strict: true, schema: visionSchema } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`image_analysis_${response.status}`);
  const result = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  const outputText = result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text;
  if (!outputText) throw new Error('image_analysis_output_missing');
  return normalizeVisionSnippets(JSON.parse(outputText));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
