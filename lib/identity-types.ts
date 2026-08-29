export type IdentityDocumentKind = 'drivers_license' | 'passport' | 'my_number_card' | 'residence_card' | 'health_insurance' | 'other';
export type IdentityDocumentSide = 'single' | 'front' | 'back';

export type IdentityProfilePhotoCategory = 'face' | 'full_body' | 'hobby' | 'travel' | 'food' | 'pet' | 'other';

export type IdentityProfilePhotoRecord = {
  id: string;
  contentType: string;
  sizeBytes: number;
  category: IdentityProfilePhotoCategory;
  position: number;
  isPrimary: boolean;
  caption: string;
  createdAt: string;
  updatedAt: string;
  previewUrl: string;
};

export type IdentityExtendedProfile = {
  legalName: string;
  nameKana: string;
  heightCm: string;
  bodyType: string;
  hometown: string;
  education: string;
  annualIncome: string;
  maritalHistory: string;
  children: string;
  smoking: string;
  alcohol: string;
  workSchedule: string;
  languages: string;
  interests: string;
  relationshipGoal: string;
  personality: string;
  firstDatePreference: string;
  singleStatusConfirmed: boolean;
  tokyoEligibility: string;
  singleCertificateStatus: string;
  incomeProofStatus: string;
  preferredLoginMethod: string;
  passwordStrategy: string;
  previouslyRegisteredServices: string;
  accountRecoveryNotes: string;
  singleAccountPolicyConfirmed: boolean;
};

export type IdentityDocumentRecord = {
  id: string;
  kind: IdentityDocumentKind;
  side: IdentityDocumentSide;
  contentType: string;
  sizeBytes: number;
  expiresOn: string;
  expired: boolean;
  createdAt: string;
  downloadUrl: string;
};

export type ServiceCredentialRecord = {
  id: string;
  serviceKey: string;
  serviceLabel: string;
  loginHint: string;
  registrationFillEnabled: boolean;
  passwordUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type PasswordServiceOption = {
  id: string;
  label: string;
  registrationFillAvailable: boolean;
};

export type IdentityProfilePayload = {
  vaultConfigured: boolean;
  profile: IdentityExtendedProfile & {
    registrationEmail: string;
    phoneNumber: string;
    nickname: string;
    birthDate: string;
    gender: string;
    residence: string;
    occupation: string;
    bio: string;
    phoneOwnershipConfirmed: boolean;
    registrationAssistEnabled: boolean;
    gmailCodeAssistEnabled: boolean;
    updatedAt: string | null;
  };
  gmail: {
    oauthConfigured: boolean;
    connected: boolean;
    email: string;
    status: 'connected' | 'error' | 'revoked' | 'not_connected';
    lastSyncedAt: string | null;
  };
  documents: IdentityDocumentRecord[];
  photos: IdentityProfilePhotoRecord[];
  credentials: ServiceCredentialRecord[];
  credentialLimits: {
    maximumCount: number;
    minimumPasswordLength: number;
    maximumPasswordLength: number;
  };
  documentLimits: {
    maximumCount: number;
    maximumFileBytes: number;
    maximumTotalBytes: number;
  };
  photoLimits: {
    maximumCount: number;
    maximumFileBytes: number;
    maximumTotalBytes: number;
  };
};

export type VerificationCodeCandidate = {
  code: string;
  subject: string;
  sender: string;
  receivedAt: string;
};
