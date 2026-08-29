export type DashboardConnection = {
  id: string;
  provider: string;
  label: string;
  status: 'connected' | 'paused' | 'expired' | 'needs_verification' | 'error';
  lastHeartbeatAt: string | null;
};

export type DashboardMessage = {
  id: string;
  direction: 'incoming' | 'outgoing';
  body: string;
  sendState: 'received' | 'draft' | 'queued' | 'sent' | 'failed' | 'cancelled';
  createdAt: string;
};

export type DashboardConversation = {
  id: string;
  contactId: string;
  initials: string;
  name: string;
  age: number | null;
  provider: string;
  providerLabel: string;
  location: string | null;
  profileUrl: string | null;
  status: 'active' | 'paused' | 'escalated' | 'goal_reached' | 'closed';
  automationMode: 'full_auto' | 'approval' | 'draft_only';
  stage: string;
  summary: string;
  confidence: number;
  lastMessageAt: string | null;
  messages: DashboardMessage[];
};

export type DashboardCandidate = {
  id: string;
  initials: string;
  name: string;
  age: number | null;
  provider: string;
  location: string | null;
  profileUrl: string | null;
  score: number;
  status: 'candidate' | 'liked' | 'matched' | 'archived' | 'blocked';
};

export type DashboardRule = {
  minAge: number | null;
  maxAge: number | null;
  radiusKm: number | null;
  topics: string[];
  blockedTopics: string[];
  minimumConfidence: number;
  automationMode: 'full_auto' | 'approval' | 'draft_only';
  requireApprovalForScheduling: boolean;
  requireApprovalForContactExchange: boolean;
  contactExchangeDirection: 'receive_only';
  requiredConversationFields: Array<'marriage_intent' | 'line_contact'>;
  goalKeywords: string[];
  goalTarget: number;
  preferredLocations: string[];
  requiredProfileKeywords: string[];
  excludedProfileKeywords: string[];
  desiredRelationship: string;
  conversationTone: 'natural' | 'friendly' | 'calm' | 'polite';
  replyLength: 'short' | 'balanced' | 'detailed';
  questionFrequency: 'low' | 'balanced' | 'high';
  persona: string;
  forbiddenPhrases: string[];
  escalationTriggers: string[];
};

export type DashboardReport = {
  id: string;
  kind: string;
  text: string;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
};

export type DashboardPayload = {
  user: {
    id: string;
    displayName: string;
    email: string;
    role: 'admin' | 'user';
    automationState: 'active' | 'paused' | 'needs_attention';
    telegramLinked: boolean;
    telegramMfaEnabled: boolean;
    lastBackupAt: string | null;
    lastSelfTestAt: string | null;
  };
  metrics: {
    liked: number;
    matched: number;
    activeConversations: number;
    goalReached: number;
    needsReview: number;
  };
  connections: DashboardConnection[];
  conversations: DashboardConversation[];
  candidates: DashboardCandidate[];
  rule: DashboardRule;
  worker: {
    status: 'online' | 'busy' | 'degraded' | 'offline';
    version: string | null;
    lastSeenAt: string | null;
    capabilities: string[];
  };
  readiness: {
    level: 'ready' | 'needs_setup' | 'blocked';
    readyCount: number;
    totalCount: number;
    checks: Array<{
      id: 'worker' | 'ai' | 'service' | 'identity' | 'gmail' | 'telegram' | 'line_report' | 'rules' | 'operation' | 'security' | 'backup' | 'self_test';
      label: string;
      status: 'ready' | 'action' | 'blocked';
      detail: string;
      href: string;
    }>;
  };
  verification: {
    completedCount: number;
    totalCount: number;
    stages: Array<{
      id: 'connected' | 'candidate' | 'liked' | 'matched' | 'reply_sent' | 'line_reported';
      label: string;
      verified: boolean;
    }>;
  };
  reports: DashboardReport[];
  auditEvents: Array<{
    id: string;
    type: string;
    status: 'awaiting_approval' | 'pending' | 'leased' | 'completed' | 'failed' | 'cancelled';
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>;
};
