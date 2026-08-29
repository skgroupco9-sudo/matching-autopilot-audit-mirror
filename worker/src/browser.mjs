import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class ChromeBrowser {
  constructor({ executablePath, dataDir, headless = false }) {
    this.executablePath = executablePath;
    this.dataDir = resolve(dataDir);
    this.headless = headless;
    this.process = null;
    this.cdp = null;
    this.sessionId = null;
    this.sessions = new Map();
  }

  async start() {
    if (!existsSync(this.executablePath)) throw new Error(`chrome_not_found:${this.executablePath}`);
    await mkdir(this.dataDir, { recursive: true });
    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${this.dataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--start-maximized',
      'about:blank',
    ];
    if (this.headless) args.unshift('--headless=new');
    this.process = spawn(this.executablePath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false });
    const websocketUrl = await waitForDevTools(this.process);
    this.cdp = new CdpConnection(websocketUrl);
    await this.cdp.open();
    const targetList = await this.cdp.send('Target.getTargets');
    let target = targetList.targetInfos.find((item) => item.type === 'page');
    if (!target) {
      const created = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
      target = { targetId: created.targetId };
    }
    const attached = await this.cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    this.sessionId = attached.sessionId;
    this.sessions.set('default', this.sessionId);
    await this.#enableSession(this.sessionId);
  }

  async page(key) {
    const normalizedKey = String(key || 'default');
    let sessionId = this.sessions.get(normalizedKey);
    if (!sessionId) {
      const created = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
      const attached = await this.cdp.send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
      sessionId = attached.sessionId;
      this.sessions.set(normalizedKey, sessionId);
      await this.#enableSession(sessionId);
    }
    return new BrowserPage(this, sessionId);
  }

  async navigate(url) {
    return this.navigateIn(this.sessionId, url);
  }

  async navigateIn(sessionId, url) {
    const loaded = this.cdp.waitFor('Page.loadEventFired', sessionId, 20_000).catch(() => null);
    const result = await this.cdp.send('Page.navigate', { url }, sessionId);
    if (result.errorText) throw new Error(`navigation_failed:${result.errorText}`);
    await loaded;
    await wait(800);
  }

  async evaluate(fn, ...args) {
    return this.evaluateIn(this.sessionId, fn, ...args);
  }

  async evaluateIn(sessionId, fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const result = await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(`browser_evaluate_failed:${result.exceptionDetails.text ?? 'unknown'}`);
    return result.result?.value;
  }

  async screenshot() {
    return this.screenshotIn(this.sessionId);
  }

  async screenshotIn(sessionId) {
    const result = await this.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    return Uint8Array.from(Buffer.from(result.data, 'base64'));
  }

  async currentUrl() {
    return this.evaluate(() => location.href);
  }

  async withTemporaryUpload(bytes, contentType, callback) {
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
    if (!extension) throw new Error(`unsupported_upload_content_type:${contentType}`);
    const temporaryDirectory = join(this.dataDir, 'matchpilot-upload-buffer');
    await mkdir(temporaryDirectory, { recursive: true });
    const filePath = join(temporaryDirectory, `profile-${crypto.randomUUID()}.${extension}`);
    await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      return await callback(filePath);
    } finally {
      await unlink(filePath).catch(() => undefined);
    }
  }

  async setFileInputFileIn(sessionId, selector, filePath) {
    const document = await this.cdp.send('DOM.getDocument', { depth: 1 }, sessionId);
    const result = await this.cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector }, sessionId);
    if (!result.nodeId) throw new Error('file_input_not_found');
    await this.cdp.send('DOM.setFileInputFiles', { nodeId: result.nodeId, files: [resolve(filePath)] }, sessionId);
  }

  async stop() {
    await this.cdp?.close().catch(() => undefined);
    this.process?.kill();
  }

  async #enableSession(sessionId) {
    await Promise.all([
      this.cdp.send('Page.enable', {}, sessionId),
      this.cdp.send('Runtime.enable', {}, sessionId),
      this.cdp.send('Network.enable', {}, sessionId),
      this.cdp.send('DOM.enable', {}, sessionId),
    ]);
  }
}

class BrowserPage {
  constructor(browser, sessionId) {
    this.browser = browser;
    this.sessionId = sessionId;
  }

  navigate(url) {
    return this.browser.navigateIn(this.sessionId, url);
  }

  evaluate(fn, ...args) {
    return this.browser.evaluateIn(this.sessionId, fn, ...args);
  }

  screenshot() {
    return this.browser.screenshotIn(this.sessionId);
  }

  currentUrl() {
    return this.evaluate(() => location.href);
  }

  setFileInputFile(selector, filePath) {
    return this.browser.setFileInputFileIn(this.sessionId, selector, filePath);
  }
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('cdp_connection_failed')), { once: true });
      this.socket.addEventListener('message', (event) => this.#onMessage(event.data));
      this.socket.addEventListener('close', () => {
        for (const pending of this.pending.values()) pending.reject(new Error('cdp_connection_closed'));
        this.pending.clear();
      });
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.sequence;
    const message = { id, method, params, ...(sessionId ? { sessionId } : {}) };
    return new Promise((resolveCommand, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cdp_timeout:${method}`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolveCommand(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket.send(JSON.stringify(message));
    });
  }

  waitFor(method, sessionId, timeoutMs) {
    const key = `${sessionId ?? ''}:${method}`;
    return new Promise((resolveEvent, reject) => {
      const timeout = setTimeout(() => {
        this.listeners.delete(key);
        reject(new Error(`cdp_event_timeout:${method}`));
      }, timeoutMs);
      this.listeners.set(key, (params) => { clearTimeout(timeout); resolveEvent(params); });
    });
  }

  async close() {
    this.socket?.close();
  }

  #onMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`cdp_${message.error.code}:${message.error.message}`));
      else pending.resolve(message.result ?? {});
      return;
    }
    const key = `${message.sessionId ?? ''}:${message.method}`;
    const listener = this.listeners.get(key);
    if (listener) {
      this.listeners.delete(key);
      listener(message.params ?? {});
    }
  }
}

function waitForDevTools(chromeProcess) {
  return new Promise((resolveUrl, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error('chrome_start_timeout')), 25_000);
    chromeProcess.once('error', (error) => { clearTimeout(timeout); reject(error); });
    chromeProcess.stderr.on('data', (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolveUrl(match[1]);
      }
      if (buffer.length > 20_000) buffer = buffer.slice(-10_000);
    });
  });
}

export function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}
