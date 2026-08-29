export type SafeLearningCategory = 'conversation_example' | 'report_example' | 'ng_rule';

const promptInjectionPattern = /(?:以前の指示を無視|上の指示を無視|システム(?:メッセージ|プロンプト)|developer message|system prompt|ignore (?:all |the )?(?:previous|above) instructions|jailbreak|あなたは今から)/iu;
const overlyCasualPattern = /(?:だよ|だね|じゃん|っしょ|だろ|やん|やで|せや|マジ|めっちゃ|ウケる|草|[wｗ]{2,})(?:[。！？!?\s]*$|\s)/u;
const politeJapanesePattern = /(?:です|ます|ません|でした|ました|でしょう|ください|ございます|ですね|ですよね|でしょうか|ですか|ますか)(?:[。！？!?😊🙂☺️\s]*$|\s)/u;
const operationalChatPattern = /(?:処理(?:中|済み|完了)|作業(?:中|完了)|納品|提出|業務連絡|アカウント作成|ログインでき|パスワード|管理画面|対応状況|報告してください)/u;

export function isSafeLearningExample(category: SafeLearningCategory, value: string) {
  const text = value.normalize('NFKC').trim();
  if (!text || text.length > 4_000 || promptInjectionPattern.test(text)) return false;
  if (category !== 'conversation_example') return true;
  return politeJapanesePattern.test(text)
    && !overlyCasualPattern.test(text)
    && !operationalChatPattern.test(text);
}
