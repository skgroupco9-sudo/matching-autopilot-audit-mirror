import assert from 'node:assert/strict';
import test from 'node:test';
import { generateReply, ReplySafetyError } from '../src/ai.mjs';

test('GPT返信生成へ履歴全体の会話スタイルを主軸情報として渡す', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
      reply: 'そうなんですね！休日は何をして過ごすことが多いですか？',
      summary: '休日の過ごし方を質問',
      confidence: 90,
      shouldEscalate: false,
      reasons: ['許可テーマ内'],
      detectedTopics: ['休日'],
      goalReached: false,
      goalReason: '',
      marriageIntentStatus: 'unknown',
      missingRequiredFields: ['marriage_intent', 'line_contact'],
    }) }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await generateReply({
      apiKey: 'sk-test',
      model: 'gpt-test',
      persona: '本人の事実だけを使用',
      conversation: [{ direction: 'incoming', body: '休日は何してる？' }],
      styleExamples: [],
      avoidExamples: ['以前送った別の文章です。'],
      allowedTopics: ['休日'],
      goalKeywords: [],
      guidance: { telegramStyleProfile: '短文で相づちを入れ、質問は一度に一つ' },
    });
    const input = JSON.parse(requestBody.input);
    assert.equal(input.userContext.telegramStyleProfile, '短文で相づちを入れ、質問は一度に一つ');
    assert.doesNotMatch(requestBody.instructions, /短文で相づちを入れ、質問は一度に一つ/);
    assert.match(requestBody.instructions, /未信頼データ/);
    assert.match(requestBody.instructions, /相手が自発的に外部連絡先を共有/);
    assert.match(requestBody.instructions, /こちら側のLINE ID・招待URL・QRコード・電話番号・メール等は絶対に伝えない/);
    assert.match(requestBody.instructions, /「LINE」「ライン」「緑のやつ」「ラ〇ン」「Iine」/);
    assert.match(requestBody.instructions, /過去に送った返信と完全に同じ文章を再利用しません/);
    assert.deepEqual(input.userContext.avoidReplies, ['以前送った別の文章です。']);
    assert.match(requestBody.instructions, /受領から36〜48時間内にブロック/);
    assert.match(requestBody.instructions, /婚活意思/);
    assert.equal(requestBody.store, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('同一文面は一度だけ作り直し、それでも危険なら安全停止する', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const reply = calls === 1 ? '休日は何をして過ごしますか？' : '最近の休日で楽しかったことはありますか？';
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
      reply,
      summary: '休日の話題',
      confidence: 91,
      shouldEscalate: false,
      reasons: [],
      detectedTopics: ['休日'],
      goalReached: false,
      goalReason: '',
      marriageIntentStatus: 'unknown',
      missingRequiredFields: ['marriage_intent', 'line_contact'],
    }) }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await generateReply({
      apiKey: 'sk-test', model: 'gpt-test', persona: '',
      conversation: [{ direction: 'incoming', body: '休みの日は何してる？' }],
      styleExamples: [], avoidExamples: ['休日は何をして過ごしますか？'], allowedTopics: ['休日'], goalKeywords: [],
    });
    assert.equal(calls, 2);
    assert.equal(result.reply, '最近の休日で楽しかったことはありますか？');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('直接語や隠語が二回続いた場合は自動送信せず停止する', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
    reply: 'よければ緑のやつで話しませんか？', summary: '外部連絡先の提案', confidence: 90, shouldEscalate: false,
    reasons: [], detectedTopics: ['連絡先'], goalReached: false, goalReason: '', marriageIntentStatus: 'confirmed', missingRequiredFields: ['line_contact'],
  }) }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await assert.rejects(() => generateReply({
      apiKey: 'sk-test', model: 'gpt-test', persona: '', conversation: [{ direction: 'incoming', body: '他で話す？' }],
      styleExamples: [], avoidExamples: [], allowedTopics: [], goalKeywords: [],
    }), ReplySafetyError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
