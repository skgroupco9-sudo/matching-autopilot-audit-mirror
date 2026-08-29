import type { IdentityExtendedProfile } from './identity-types';
import { normalizeUnicodeText } from './unicode-text.ts';

export const emptyExtendedIdentityProfile: IdentityExtendedProfile = {
  legalName: '',
  nameKana: '',
  heightCm: '',
  bodyType: '',
  hometown: '',
  education: '',
  annualIncome: '',
  maritalHistory: '',
  children: '',
  smoking: '',
  alcohol: '',
  workSchedule: '',
  languages: '',
  interests: '',
  relationshipGoal: '',
  personality: '',
  firstDatePreference: '',
  singleStatusConfirmed: false,
  tokyoEligibility: '',
  singleCertificateStatus: '',
  incomeProofStatus: '',
  preferredLoginMethod: '',
  passwordStrategy: '',
  previouslyRegisteredServices: '',
  accountRecoveryNotes: '',
  singleAccountPolicyConfirmed: false,
};

const enumFields = {
  bodyType: new Set(['', 'slim', 'average', 'athletic', 'curvy', 'large', 'prefer_not_to_say']),
  education: new Set(['', 'high_school', 'vocational', 'junior_college', 'university', 'graduate_school', 'other', 'prefer_not_to_say']),
  annualIncome: new Set(['', 'under_2m', '2m_4m', '4m_6m', '6m_8m', '8m_10m', '10m_15m', 'over_15m', 'prefer_not_to_say']),
  maritalHistory: new Set(['', 'never_married', 'divorced', 'widowed', 'prefer_not_to_say']),
  children: new Set(['', 'none', 'has_children_living_together', 'has_children_living_apart', 'prefer_not_to_say']),
  smoking: new Set(['', 'never', 'occasionally', 'regularly', 'trying_to_quit', 'prefer_not_to_say']),
  alcohol: new Set(['', 'never', 'occasionally', 'socially', 'regularly', 'prefer_not_to_say']),
  relationshipGoal: new Set(['', 'serious_relationship', 'marriage', 'friendship_first', 'casual_dating', 'activity_partner', 'prefer_not_to_say']),
  tokyoEligibility: new Set(['', 'resident', 'worker', 'student', 'not_eligible']),
  singleCertificateStatus: new Set(['', 'ready', 'requesting', 'not_ready']),
  incomeProofStatus: new Set(['', 'ready', 'requesting', 'not_ready']),
  preferredLoginMethod: new Set(['', 'email', 'phone', 'google', 'line', 'apple']),
  passwordStrategy: new Set(['', 'service_specific', 'common_when_compatible', 'manual']),
} as const;

const textLimits = {
  legalName: 80,
  nameKana: 80,
  hometown: 60,
  workSchedule: 80,
  languages: 120,
  interests: 300,
  personality: 300,
  firstDatePreference: 300,
  previouslyRegisteredServices: 1000,
  accountRecoveryNotes: 500,
} as const;

export type ExtendedIdentityProfileResult =
  | { ok: true; value: IdentityExtendedProfile }
  | { ok: false; error: string };

export function normalizeExtendedIdentityProfile(input: Record<string, unknown>): ExtendedIdentityProfileResult {
  const heightCm = normalizeText(input.heightCm, 3);
  if (heightCm && (!/^\d{3}$/.test(heightCm) || Number(heightCm) < 120 || Number(heightCm) > 230)) {
    return { ok: false, error: 'invalid_height' };
  }

  const value: IdentityExtendedProfile = { ...emptyExtendedIdentityProfile, heightCm };
  for (const [field, allowed] of Object.entries(enumFields)) {
    const normalized = normalizeText(input[field], 40);
    if (!allowed.has(normalized)) return { ok: false, error: `invalid_${camelToSnake(field)}` };
    value[field as keyof typeof enumFields] = normalized;
  }
  for (const [field, maximumLength] of Object.entries(textLimits)) {
    value[field as keyof typeof textLimits] = normalizeText(input[field], maximumLength);
  }
  value.singleStatusConfirmed = input.singleStatusConfirmed === true;
  value.singleAccountPolicyConfirmed = input.singleAccountPolicyConfirmed === true;
  return { ok: true, value };
}

export function parseExtendedIdentityProfile(value: string): IdentityExtendedProfile {
  if (!value) return { ...emptyExtendedIdentityProfile };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const normalized = normalizeExtendedIdentityProfile(parsed);
    return normalized.ok ? normalized.value : { ...emptyExtendedIdentityProfile };
  } catch {
    return { ...emptyExtendedIdentityProfile };
  }
}

function normalizeText(value: unknown, maximumLength: number) {
  return normalizeUnicodeText(value, maximumLength);
}

function camelToSnake(value: string) {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}
