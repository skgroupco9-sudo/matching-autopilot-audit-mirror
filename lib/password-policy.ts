// The production Web Crypto runtime supports PBKDF2 iteration counts up to
// 100,000. Centralize the value so every password flow remains compatible.
export const PASSWORD_ITERATIONS = 100_000;

