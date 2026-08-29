export type ProviderId =
  | 'pairs'
  | 'with'
  | 'tinder'
  | 'omiai'
  | 'marrish'
  | 'youbride'
  | 'bridalnet'
  | 'match'
  | 'r50time'
  | 'wakuwaku'
  | 'ikukuru'
  | 'happymail'
  | 'pcmax'
  | 'jmail'
  | 'asobo'
  | 'merupara'
  | 'hanakai'
  | 'sugardaddy'
  | 'paters'
  | 'paddy'
  | 'pj'
  | 'mypappy'
  | 'mitsumitsu'
  | 'cuddle'
  | 'kikonclub'
  | 'anemone'
  | 'silk'
  | 'healmate'
  | 'marriedgo'
  | 'partners'
  | 'bachelor-date'
  | 'ciel';

export type AutomationMode = 'full_auto' | 'approval' | 'draft_only';

export type ManualCheckpoint =
  | 'initial_login'
  | 'email_or_sms_otp'
  | 'captcha'
  | 'age_verification'
  | 'identity_verification'
  | 'terms_consent'
  | 'payment_confirmation';

export type BrowserCapability =
  | 'profile'
  | 'preferences'
  | 'discovery'
  | 'like'
  | 'matches'
  | 'chat'
  | 'profile_link'
  | 'screenshot';

export type ConnectorDefinition = {
  id: ProviderId;
  label: string;
  entryUrl: string;
  signupUrl: string;
  termsUrl: string;
  capabilities: BrowserCapability[];
  manualCheckpoints: ManualCheckpoint[];
  webStatus: 'available' | 'app_only' | 'unverified';
  supportStatus: 'assisted' | 'catalog_only';
  automationTier: 'standard' | 'beta';
  automationPolicy: 'manual_handoff' | 'official_api';
  externalAutomationStatus: 'prohibited' | 'unverified' | 'official_native';
  registrationMethods: string[];
  minimumSetupFields: string[];
  limitation: string;
};

export type ServiceCatalogDefinition = {
  id: string;
  label: string;
  entryUrl: string;
  termsUrl?: string;
  category: '恋活' | '婚活' | '再婚' | '年代特化' | 'デート' | 'その他';
  webStatus: 'available' | 'app_only' | 'unverified';
  supportStatus: 'assisted' | 'catalog_only';
  automationTier: 'standard' | 'beta' | 'none';
  externalAutomationStatus: 'prohibited' | 'unverified' | 'official_native';
  availabilityStatus: 'active' | 'ended' | 'research';
  registrationMethods: string[];
  minimumSetupFields: string[];
  limitation: string;
};

export type ConversationPolicy = {
  mode: AutomationMode;
  minimumConfidence: number;
  allowedTopics: string[];
  blockedTopics: string[];
  requireApprovalForScheduling: boolean;
  requireApprovalForContactExchange: boolean;
  contactExchangeDirection?: 'receive_only' | 'send_or_receive';
};

export type ReplyAssessment = {
  action: 'send' | 'request_approval' | 'block';
  reasons: string[];
  confidence: number;
};

export type WorkerEvent = {
  id: string;
  userId: string;
  connectionId: string;
  conversationId?: string;
  type:
    | 'incoming_message'
    | 'outgoing_message'
    | 'candidate_discovered'
    | 'match_created'
    | 'session_ready'
    | 'registration_profile_prepared'
    | 'verification_code_prepared'
    | 'goal_reached'
    | 'checkpoint_required'
    | 'block_completed'
    | 'block_failed'
    | 'worker_error';
  payload: Record<string, unknown>;
  occurredAt: string;
};
