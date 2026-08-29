import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
};

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name'),
    role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
    accountStatus: text('account_status', { enum: ['active', 'suspended'] }).notNull().default('active'),
    telegramChatId: text('telegram_chat_id'),
    telegramMfaEnabled: integer('telegram_mfa_enabled', { mode: 'boolean' }).notNull().default(false),
    automationState: text('automation_state', {
      enum: ['active', 'paused', 'needs_attention'],
    }).notNull().default('paused'),
    lastBackupAt: integer('last_backup_at', { mode: 'timestamp_ms' }),
    lastSelfTestAt: integer('last_self_test_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (table) => [uniqueIndex('idx_users_telegram_chat').on(table.telegramChatId)],
);

export const authRateLimits = sqliteTable('auth_rate_limits', {
  keyHash: text('key_hash').primaryKey(),
  failures: integer('failures').notNull().default(0),
  windowStartedAt: integer('window_started_at', { mode: 'timestamp_ms' }).notNull(),
  blockedUntil: integer('blocked_until', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const passwordAccounts = sqliteTable('password_accounts', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  emailNormalized: text('email_normalized').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  passwordIterations: integer('password_iterations').notNull(),
  sessionVersion: integer('session_version').notNull().default(1),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
  ...timestamps,
});

export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['login_mfa', 'password_reset'] }).notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_auth_challenges_user_kind_expires').on(table.userId, table.kind, table.expiresAt)],
);

export const identityProfiles = sqliteTable('identity_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  registrationEmailCiphertext: text('registration_email_ciphertext'),
  phoneNumberCiphertext: text('phone_number_ciphertext'),
  nicknameCiphertext: text('nickname_ciphertext'),
  birthDateCiphertext: text('birth_date_ciphertext'),
  genderCiphertext: text('gender_ciphertext'),
  residenceCiphertext: text('residence_ciphertext'),
  occupationCiphertext: text('occupation_ciphertext'),
  bioCiphertext: text('bio_ciphertext'),
  extendedProfileCiphertext: text('extended_profile_ciphertext'),
  phoneOwnershipConfirmed: integer('phone_ownership_confirmed', { mode: 'boolean' }).notNull().default(false),
  registrationAssistEnabled: integer('registration_assist_enabled', { mode: 'boolean' }).notNull().default(false),
  gmailCodeAssistEnabled: integer('gmail_code_assist_enabled', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const identityProfilePhotos = sqliteTable(
  'identity_profile_photos',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    category: text('category', {
      enum: ['face', 'full_body', 'hobby', 'travel', 'food', 'pet', 'other'],
    }).notNull().default('face'),
    position: integer('position').notNull().default(0),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    captionCiphertext: text('caption_ciphertext'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_identity_profile_photos_object_key').on(table.objectKey),
    index('idx_identity_profile_photos_user_position').on(table.userId, table.position),
  ],
);

export const identityDocuments = sqliteTable(
  'identity_documents',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: ['drivers_license', 'passport', 'my_number_card', 'residence_card', 'health_insurance', 'other'],
    }).notNull(),
    side: text('side', { enum: ['single', 'front', 'back'] }).notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    expiresOnCiphertext: text('expires_on_ciphertext'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_identity_documents_object_key').on(table.objectKey),
    index('idx_identity_documents_user_created').on(table.userId, table.createdAt),
  ],
);

export const serviceCredentials = sqliteTable(
  'service_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    serviceKey: text('service_key').notNull(),
    serviceLabelCiphertext: text('service_label_ciphertext').notNull(),
    loginIdCiphertext: text('login_id_ciphertext'),
    passwordCiphertext: text('password_ciphertext').notNull(),
    registrationFillEnabled: integer('registration_fill_enabled', { mode: 'boolean' }).notNull().default(false),
    passwordUpdatedAt: integer('password_updated_at', { mode: 'timestamp_ms' }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_service_credentials_user_service').on(table.userId, table.serviceKey),
    index('idx_service_credentials_user_updated').on(table.userId, table.updatedAt),
  ],
);

export const gmailConnections = sqliteTable('gmail_connections', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  emailCiphertext: text('email_ciphertext').notNull(),
  refreshTokenCiphertext: text('refresh_token_ciphertext').notNull(),
  scope: text('scope').notNull(),
  status: text('status', { enum: ['connected', 'error', 'revoked'] }).notNull().default('connected'),
  lastSyncedAt: integer('last_synced_at', { mode: 'timestamp_ms' }),
  lastError: text('last_error'),
  ...timestamps,
});

export const gmailOAuthStates = sqliteTable(
  'gmail_oauth_states',
  {
    stateHash: text('state_hash').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_gmail_oauth_states_user_expires').on(table.userId, table.expiresAt)],
);

export const aiCredentials = sqliteTable('ai_credentials', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['openai'] }).notNull().default('openai'),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  keyHint: text('key_hint').notNull(),
  model: text('model').notNull().default('gpt-5.4-mini'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  ...timestamps,
});

export const accountInvites = sqliteTable(
  'account_invites',
  {
    id: text('id').primaryKey(),
    emailNormalized: text('email_normalized').notNull(),
    role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
    tokenHash: text('token_hash').notNull().unique(),
    status: text('status', { enum: ['pending', 'accepted', 'revoked'] }).notNull().default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    index('idx_account_invites_status_expires').on(table.status, table.expiresAt),
    index('idx_account_invites_email_status').on(table.emailNormalized, table.status),
  ],
);

export const billingCustomers = sqliteTable('billing_customers', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: text('stripe_customer_id').notNull().unique(),
  ...timestamps,
});

export const billingSubscriptions = sqliteTable('billing_subscriptions', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  stripePriceId: text('stripe_price_id'),
  status: text('status').notNull(),
  currentPeriodStart: integer('current_period_start', { mode: 'timestamp_ms' }),
  currentPeriodEnd: integer('current_period_end', { mode: 'timestamp_ms' }),
  trialEnd: integer('trial_end', { mode: 'timestamp_ms' }),
  cancelAtPeriodEnd: integer('cancel_at_period_end', { mode: 'boolean' }).notNull().default(false),
  canceledAt: integer('canceled_at', { mode: 'timestamp_ms' }),
  ...timestamps,
});

export const stripeWebhookEvents = sqliteTable(
  'stripe_webhook_events',
  {
    eventId: text('event_id').primaryKey(),
    type: text('type').notNull(),
    status: text('status', { enum: ['processing', 'processed', 'failed'] }).notNull().default('processing'),
    lastError: text('last_error'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
  },
  (table) => [index('idx_stripe_events_status_received').on(table.status, table.receivedAt)],
);

export const appConnections = sqliteTable(
  'app_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    label: text('label').notNull(),
    status: text('status', {
      enum: ['connected', 'paused', 'expired', 'needs_verification', 'error'],
    }).notNull().default('paused'),
    sessionReference: text('session_reference'),
    lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_connections_user_provider').on(table.userId, table.provider),
    index('idx_connections_user_status').on(table.userId, table.status),
  ],
);

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalReference: text('external_reference').notNull(),
    displayName: text('display_name').notNull(),
    age: integer('age'),
    location: text('location'),
    profileUrl: text('profile_url'),
    screenshotObjectKey: text('screenshot_object_key'),
    score: integer('score').notNull().default(0),
    status: text('status', {
      enum: ['candidate', 'liked', 'matched', 'archived', 'blocked'],
    }).notNull().default('candidate'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_contacts_provider_external').on(table.userId, table.provider, table.externalReference),
    index('idx_contacts_user_status_score').on(table.userId, table.status, table.score),
  ],
);

export const acquiredContactKeys = sqliteTable(
  'acquired_contact_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    keyKind: text('key_kind', { enum: ['line', 'name_age'] }).notNull(),
    keyHash: text('key_hash').notNull(),
    contactId: text('contact_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_acquired_contact_user_kind_hash').on(table.userId, table.keyKind, table.keyHash),
    index('idx_acquired_contact_user_created').on(table.userId, table.createdAt),
  ],
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').notNull().references(() => appConnections.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    externalReference: text('external_reference'),
    threadUrl: text('thread_url'),
    status: text('status', {
      enum: ['active', 'paused', 'escalated', 'goal_reached', 'closed'],
    }).notNull().default('active'),
    automationMode: text('automation_mode', {
      enum: ['full_auto', 'approval', 'draft_only'],
    }).notNull().default('approval'),
    stage: text('stage').notNull().default('rapport'),
    summary: text('summary').notNull().default(''),
    confidence: integer('confidence').notNull().default(0),
    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (table) => [
    index('idx_conversations_user_status_last').on(table.userId, table.status, table.lastMessageAt),
    uniqueIndex('idx_conversations_connection_contact').on(table.connectionId, table.contactId),
    uniqueIndex('idx_conversations_connection_external').on(table.connectionId, table.externalReference),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['incoming', 'outgoing'] }).notNull(),
    body: text('body').notNull(),
    sendState: text('send_state', {
      enum: ['received', 'draft', 'queued', 'sent', 'failed', 'cancelled'],
    }).notNull(),
    modelClass: text('model_class'),
    externalReference: text('external_reference'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('idx_messages_conversation_created').on(table.conversationId, table.createdAt),
    uniqueIndex('idx_messages_conversation_external').on(table.conversationId, table.externalReference),
  ],
);

export const automationRules = sqliteTable(
  'automation_rules',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    minAge: integer('min_age'),
    maxAge: integer('max_age'),
    radiusKm: integer('radius_km'),
    topicsJson: text('topics_json').notNull().default('[]'),
    blockedTopicsJson: text('blocked_topics_json').notNull().default('[]'),
    minimumConfidence: integer('minimum_confidence').notNull().default(85),
    automationMode: text('automation_mode', {
      enum: ['full_auto', 'approval', 'draft_only'],
    }).notNull().default('approval'),
    successConditionJson: text('success_condition_json').notNull().default('{}'),
    ...timestamps,
  },
  (table) => [index('idx_rules_user_enabled').on(table.userId, table.enabled)],
);

export const automationJobs = sqliteTable(
  'automation_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').references(() => appConnections.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    status: text('status', {
      enum: ['awaiting_approval', 'pending', 'leased', 'completed', 'failed', 'cancelled'],
    }).notNull().default('pending'),
    priority: integer('priority').notNull().default(100),
    runAfter: integer('run_after', { mode: 'timestamp_ms' }).notNull(),
    leaseUntil: integer('lease_until', { mode: 'timestamp_ms' }),
    leasedBy: text('leased_by'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    ...timestamps,
  },
  (table) => [
    index('idx_jobs_status_run_priority').on(table.status, table.runAfter, table.priority),
    index('idx_jobs_user_status').on(table.userId, table.status),
  ],
);

export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    screenshotObjectKey: text('screenshot_object_key'),
    telegramMessageId: text('telegram_message_id'),
    status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_reports_user_status_created').on(table.userId, table.status, table.createdAt)],
);

export const telegramLinkTokens = sqliteTable(
  'telegram_link_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_telegram_tokens_user_expires').on(table.userId, table.expiresAt)],
);

export const telegramLearningItems = sqliteTable(
  'telegram_learning_items',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    telegramMessageId: text('telegram_message_id').notNull(),
    sourceKind: text('source_kind', { enum: ['direct', 'forwarded', 'imported'] }).notNull().default('direct'),
    category: text('category', {
      enum: ['unclassified', 'report_example', 'conversation_example', 'ng_rule'],
    }).notNull().default('unclassified'),
    status: text('status', {
      enum: ['pending', 'ready', 'approved', 'rejected'],
    }).notNull().default('pending'),
    redactedText: text('redacted_text').notNull(),
    approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_telegram_learning_user_message').on(table.userId, table.telegramMessageId),
    index('idx_telegram_learning_user_status_created').on(table.userId, table.status, table.createdAt),
  ],
);

export const telegramLearningProfiles = sqliteTable('telegram_learning_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  conversationGuidance: text('conversation_guidance').notNull(),
  reportExample: text('report_example').notNull(),
  ngRulesJson: text('ng_rules_json').notNull().default('[]'),
  summary: text('summary').notNull(),
  analyzedCount: integer('analyzed_count').notNull().default(0),
  model: text('model').notNull(),
  ...timestamps,
});

export const workerHeartbeats = sqliteTable(
  'worker_heartbeats',
  {
    workerId: text('worker_id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['online', 'busy', 'degraded', 'offline'] }).notNull(),
    capabilitiesJson: text('capabilities_json').notNull().default('[]'),
    version: text('version').notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_heartbeats_user_seen').on(table.userId, table.lastSeenAt)],
);

export const workerBindings = sqliteTable(
  'worker_bindings',
  {
    workerId: text('worker_id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    status: text('status', { enum: ['active', 'revoked'] }).notNull().default('active'),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_worker_bindings_token_hash').on(table.tokenHash),
    index('idx_worker_bindings_user_status').on(table.userId, table.status),
  ],
);
