const lower = 'abcdefghijkmnopqrstuvwxyz';
const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const digits = '23456789';
const symbols = '!@#$%&*+-_';
const allDigits = '0123456789';
const allLower = 'abcdefghijklmnopqrstuvwxyz';
const allUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export type ServicePasswordPolicy = {
  minimumLength: number;
  maximumLength: number;
  description: string;
  kind: 'strong' | 'alphanumeric' | 'numeric_pin';
};

const servicePasswordPolicies: Record<string, ServicePasswordPolicy> = {
  hanamel: { minimumLength: 4, maximumLength: 4, description: '数字4桁', kind: 'numeric_pin' },
  partners: { minimumLength: 6, maximumLength: 20, description: '半角英数字6〜20文字', kind: 'alphanumeric' },
};

const defaultServicePasswordPolicy: ServicePasswordPolicy = {
  minimumLength: 8,
  maximumLength: 128,
  description: '半角英数・記号8文字以上',
  kind: 'strong',
};

export function getServicePasswordPolicy(serviceKey: string) {
  return servicePasswordPolicies[serviceKey] ?? defaultServicePasswordPolicy;
}

export function generateServicePassword(serviceKey: string) {
  const policy = getServicePasswordPolicy(serviceKey);
  if (policy.kind === 'numeric_pin') return Array.from({ length: 4 }, () => randomCharacter(allDigits)).join('');
  if (policy.kind === 'alphanumeric') {
    const required = [randomCharacter(allLower), randomCharacter(allUpper), randomCharacter(allDigits)];
    const alphabet = `${allLower}${allUpper}${allDigits}`;
    while (required.length < 16) required.push(randomCharacter(alphabet));
    return shuffle(required).join('');
  }
  return generateCompatiblePassword(20);
}

export function isServicePasswordCompatible(serviceKey: string, value: string) {
  const policy = getServicePasswordPolicy(serviceKey);
  if (policy.kind === 'numeric_pin') return /^\d{4}$/.test(value);
  if (policy.kind === 'alphanumeric') {
    return value.length >= policy.minimumLength
      && value.length <= policy.maximumLength
      && /^[A-Za-z0-9]+$/.test(value);
  }
  return value.length >= policy.minimumLength
    && value.length <= policy.maximumLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function generateCompatiblePassword(length = 20) {
  if (!Number.isInteger(length) || length < 8 || length > 128) {
    throw new RangeError('invalid_password_length');
  }

  const required = [
    randomCharacter(lower),
    randomCharacter(upper),
    randomCharacter(digits),
    randomCharacter(symbols),
  ];
  const alphabet = `${lower}${upper}${digits}${symbols}`;
  while (required.length < length) required.push(randomCharacter(alphabet));
  return shuffle(required).join('');
}

export function isCompatibleGeneratedPassword(value: string) {
  return value.length >= 8
    && value.length <= 128
    && [...value].every((character) => `${lower}${upper}${digits}${symbols}`.includes(character))
    && [...lower].some((character) => value.includes(character))
    && [...upper].some((character) => value.includes(character))
    && [...digits].some((character) => value.includes(character))
    && [...symbols].some((character) => value.includes(character));
}

function randomCharacter(alphabet: string) {
  return alphabet[randomIndex(alphabet.length)];
}

function shuffle(characters: string[]) {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters;
}

function randomIndex(maximum: number) {
  const limit = Math.floor(256 / maximum) * maximum;
  const bytes = new Uint8Array(1);
  do crypto.getRandomValues(bytes); while (bytes[0] >= limit);
  return bytes[0] % maximum;
}
