export class ControlPlaneClient {
  constructor({ baseUrl, secret, token, userId, workerId, version = '0.3.0', capabilities = [] }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.secret = secret;
    this.token = token;
    this.userId = userId;
    this.workerId = workerId;
    this.version = version;
    this.capabilities = capabilities;
  }

  async heartbeat(status = 'online') {
    return this.#json('/api/worker/heartbeat', {
      method: 'POST',
      body: {
        workerId: this.workerId,
        userId: this.userId,
        status,
        version: this.version,
        capabilities: this.capabilities,
      },
    });
  }

  async leaseJob() {
    const response = await this.#request(`/api/worker/jobs?user_id=${encodeURIComponent(this.userId)}`, { method: 'GET' });
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`job_lease_${response.status}`);
    const result = await response.json();
    return result.job ?? null;
  }

  async getRegistrationIdentity(provider) {
    return this.#json(`/api/worker/identity?user_id=${encodeURIComponent(this.userId)}&provider=${encodeURIComponent(provider)}`, { method: 'GET' });
  }

  async downloadRegistrationPhoto(photoId) {
    const response = await this.#request(`/api/worker/identity/photos/${encodeURIComponent(photoId)}?user_id=${encodeURIComponent(this.userId)}`, { method: 'GET' });
    if (!response.ok) throw new Error(`registration_photo_${response.status}`);
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async getVerificationCodes(serviceHint = '') {
    return this.#json('/api/worker/identity/codes', {
      method: 'POST',
      body: { userId: this.userId, serviceHint },
    });
  }

  async getAiSettings() {
    return this.#json(`/api/worker/ai-settings?user_id=${encodeURIComponent(this.userId)}`, { method: 'GET' });
  }

  setCapabilities(capabilities) {
    this.capabilities = capabilities;
  }

  async finishJob(jobId, status, error, retryable = false) {
    return this.#json('/api/worker/jobs', {
      method: 'POST',
      body: { jobId, status, error, retryable },
    });
  }

  async sendEvent(event) {
    return this.#json('/api/worker/events', {
      method: 'POST',
      body: {
        ...event,
        id: event.id ?? randomId(),
        userId: this.userId,
        occurredAt: event.occurredAt ?? new Date().toISOString(),
      },
    });
  }

  async sendDailySummary(date) {
    return this.#json('/api/worker/daily-summary', {
      method: 'POST',
      body: { userId: this.userId, date },
    });
  }

  async uploadScreenshot(bytes, eventId, contentType = 'image/png') {
    const response = await this.#request('/api/worker/screenshots', {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'x-user-id': this.userId,
        'x-event-id': eventId,
      },
      body: bytes,
    });
    if (!response.ok) throw new Error(`screenshot_upload_${response.status}`);
    return response.json();
  }

  async #json(path, { method, body }) {
    const response = await this.#request(path, {
      method,
      ...(typeof body === 'undefined' ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${path}_${response.status}_${detail.slice(0, 180)}`);
    }
    return response.json();
  }

  #request(path, options) {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${this.secret}`,
        'x-worker-id': this.workerId,
        'x-worker-token': this.token,
        ...(options.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
  }
}

export function randomId() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 32);
}
