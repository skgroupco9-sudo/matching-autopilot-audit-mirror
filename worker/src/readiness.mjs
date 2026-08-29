const baseCapabilities = [
  'persistent_chrome',
  'session',
  'like',
  'chat',
  'screenshot',
  'candidate_scan',
  'registration_profile_prefill',
  'registration_credential_prefill',
  'gmail_code_prefill',
  'line_contact_detection',
  'delayed_line_block',
  'account_freeze_guard',
  'unique_reply_generation',
];

export function buildWorkerReadiness(config) {
  const missing = [];
  const capabilities = [...baseCapabilities];
  if (config.openaiApiKey?.trim()) {
    capabilities.push('reply_generation');
  } else {
    missing.push('OPENAI_API_KEY');
  }
  return {
    capabilities,
    missing,
    degraded: missing.length > 0,
  };
}

export function effectiveHeartbeatStatus(requestedStatus, readiness) {
  if (requestedStatus === 'offline') return 'offline';
  return readiness.degraded ? 'degraded' : requestedStatus;
}
