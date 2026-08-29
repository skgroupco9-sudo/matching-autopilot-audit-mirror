import type { IdentityProfilePayload } from './identity-types';

export function toWorkerRegistrationProfile(profile: IdentityProfilePayload['profile']) {
  return {
    registrationEmail: profile.registrationEmail,
    phoneNumber: profile.phoneOwnershipConfirmed ? profile.phoneNumber : '',
    nickname: profile.nickname,
    birthDate: profile.birthDate,
    gender: profile.gender,
    residence: profile.residence,
    occupation: profile.occupation,
    bio: profile.bio,
    heightCm: profile.heightCm,
    bodyType: profile.bodyType,
    hometown: profile.hometown,
    education: profile.education,
    annualIncome: profile.annualIncome,
    maritalHistory: profile.maritalHistory,
    children: profile.children,
    smoking: profile.smoking,
    alcohol: profile.alcohol,
    workSchedule: profile.workSchedule,
    languages: profile.languages,
    interests: profile.interests,
    relationshipGoal: profile.relationshipGoal,
    personality: profile.personality,
    firstDatePreference: profile.firstDatePreference,
  };
}
