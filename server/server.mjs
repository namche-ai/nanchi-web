import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_MAX_BODY_BYTES = 20 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 5;
const DEFAULT_RETRY_INTERVAL_MS = 60 * 1000;
const DEFAULT_RETRY_BASE_MS = 60 * 1000;
const DEFAULT_MAX_NOTIFICATION_ATTEMPTS = 12;

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

function validateWebhookUrl(value, allowInsecureWebhook) {
  if (!value) return '';
  const url = new URL(value);
  if (allowInsecureWebhook) return url.toString();
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'qyapi.weixin.qq.com'
    || url.pathname !== '/cgi-bin/webhook/send'
    || !url.searchParams.get('key')
  ) {
    throw new Error('WECHAT_WORK_WEBHOOK_URL 必须是企业微信官方 HTTPS 群机器人地址');
  }
  return url.toString();
}

export function loadConfig(env = process.env) {
  const allowInsecureWebhook = env.ALLOW_INSECURE_WEBHOOK === 'true';
  return {
    host: env.HOST || '0.0.0.0',
    port: integer(env.PORT, 8787, 0, 65535),
    dbPath: resolve(env.LEADS_DB_PATH || '/data/leads.db'),
    webhookUrl: validateWebhookUrl(env.WECHAT_WORK_WEBHOOK_URL, allowInsecureWebhook),
    allowInsecureWebhook,
    allowedOrigins: (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    maxBodyBytes: integer(env.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES, 1024, 128 * 1024),
    rateLimitWindowMs: integer(
      env.RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      1000,
      24 * 60 * 60 * 1000,
    ),
    rateLimitMax: integer(env.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX, 1, 1000),
    retryIntervalMs: integer(
      env.RETRY_INTERVAL_MS,
      DEFAULT_RETRY_INTERVAL_MS,
      1000,
      60 * 60 * 1000,
    ),
    retryBaseMs: integer(env.RETRY_BASE_MS, DEFAULT_RETRY_BASE_MS, 1000, 60 * 60 * 1000),
    maxNotificationAttempts: integer(
      env.MAX_NOTIFICATION_ATTEMPTS,
      DEFAULT_MAX_NOTIFICATION_ATTEMPTS,
      1,
      100,
    ),
    webhookTimeoutMs: integer(env.WEBHOOK_TIMEOUT_MS, 8000, 1000, 30 * 1000),
  };
}

function createDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec('PRAGMA busy_timeout = 5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      contact TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      scene TEXT NOT NULL,
      systems TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      consent INTEGER NOT NULL CHECK (consent = 1),
      source_url TEXT NOT NULL DEFAULT '',
      utm_source TEXT NOT NULL DEFAULT '',
      utm_medium TEXT NOT NULL DEFAULT '',
      utm_campaign TEXT NOT NULL DEFAULT '',
      utm_content TEXT NOT NULL DEFAULT '',
      utm_term TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      notification_status TEXT NOT NULL DEFAULT 'pending',
      notification_attempts INTEGER NOT NULL DEFAULT 0,
      next_notification_at TEXT,
      notified_at TEXT,
      last_notification_error TEXT
    );
    CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
    CREATE INDEX IF NOT EXISTS leads_notification_retry_idx
      ON leads (notification_status, next_notification_at);
  `);
  database.prepare(`
    UPDATE leads
    SET notification_status = 'failed', next_notification_at = ?
    WHERE notification_status = 'sending'
  `).run(new Date().toISOString());
  return database;
}

function createStatements(database) {
  return {
    insert: database.prepare(`
      INSERT INTO leads (
        id, created_at, name, company, contact, role, scene, systems, note, consent,
        source_url, utm_source, utm_medium, utm_campaign, utm_content, utm_term, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getById: database.prepare('SELECT * FROM leads WHERE id = ?'),
    claim: database.prepare(`
      UPDATE leads
      SET notification_status = 'sending',
          notification_attempts = notification_attempts + 1,
          last_notification_error = NULL
      WHERE id = ?
        AND notification_status IN ('pending', 'failed')
        AND notification_attempts < ?
    `),
    markNotified: database.prepare(`
      UPDATE leads
      SET notification_status = 'notified',
          notified_at = ?,
          next_notification_at = NULL,
          last_notification_error = NULL
      WHERE id = ?
    `),
    markFailed: database.prepare(`
      UPDATE leads
      SET notification_status = 'failed',
          next_notification_at = ?,
          last_notification_error = ?
      WHERE id = ?
    `),
    dueForRetry: database.prepare(`
      SELECT id
      FROM leads
      WHERE notification_status IN ('pending', 'failed')
        AND notification_attempts < ?
        AND (next_notification_at IS NULL OR next_notification_at <= ?)
      ORDER BY created_at ASC
      LIMIT 20
    `),
  };
}

function makeLeadId(now = new Date()) {
  const date = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `NCH-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function cleanText(value, maximum, { required = false, multiline = false } = {}) {
  const source = typeof value === 'string' ? value : '';
  const controlCharacters = multiline
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
    : /[\u0000-\u001F\u007F]/g;
  const cleaned = source.replace(controlCharacters, ' ').replace(/[ \t]+/g, ' ').trim();
  if (required && !cleaned) throw new Error('required');
  if (cleaned.length > maximum) throw new Error('too_long');
  return cleaned;
}

function validateLead(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: '请求内容格式不正确' };
  }

  try {
    if (cleanText(body.website, 200)) return { honeypot: true };
    const utm = body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm) ? body.utm : {};
    const lead = {
      name: cleanText(body.name, 50, { required: true }),
      company: cleanText(body.company, 120, { required: true }),
      contact: cleanText(body.contact, 100, { required: true }),
      role: cleanText(body.role, 100),
      scene: cleanText(body.scene, 50, { required: true }),
      systems: cleanText(body.systems, 200),
      note: cleanText(body.note, 2000, { multiline: true }),
      sourceUrl: cleanText(body.sourceUrl, 500),
      utmSource: cleanText(utm.source, 120),
      utmMedium: cleanText(utm.medium, 120),
      utmCampaign: cleanText(utm.campaign, 160),
      utmContent: cleanText(utm.content, 160),
      utmTerm: cleanText(utm.term, 160),
    };
    if (body.consent !== true) return { error: '请先同意信息使用说明' };
    return { lead };
  } catch (error) {
    return { error: error.message === 'too_long' ? '部分填写内容过长' : '请完整填写必填信息' };
  }
}

function chinaTime(isoTimestamp) {
  const shifted = new Date(new Date(isoTimestamp).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 19).replace('T', ' ');
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncateUtf8(value, maximumBytes) {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) return value;
  let output = '';
  for (const character of value) {
    if (Buffer.byteLength(`${output}${character}…`, 'utf8') > maximumBytes) break;
    output += character;
  }
  return `${output}…`;
}

function buildWechatMessage(lead) {
  const campaign = [lead.utm_source, lead.utm_medium, lead.utm_campaign]
    .map(oneLine)
    .filter(Boolean)
    .join(' / ');
  const lines = [
    `【官网新预约】${lead.id}`,
    '',
    `公司：${oneLine(lead.company)}`,
    `联系人：${oneLine(lead.name)}${lead.role ? `｜${oneLine(lead.role)}` : ''}`,
    `联系方式：${oneLine(lead.contact)}`,
    `诊断场景：${oneLine(lead.scene)}`,
    `当前系统：${oneLine(lead.systems) || '未填写'}`,
    `需求说明：${oneLine(lead.note) || '未填写'}`,
    `提交时间：${chinaTime(lead.created_at)}`,
  ];
  if (campaign) lines.push(`渠道来源：${campaign}`);
  return truncateUtf8(lines.join('\n'), 2000);
}

function redactSecret(value) {
  return String(value || '通知失败')
    .replace(/([?&]key=)[^&\s]+/gi, '$1***')
    .slice(0, 500);
}

async function sendWechatNotification(webhookUrl, lead, timeoutMs) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype: 'text',
      text: { content: buildWechatMessage(lead) },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`企业微信返回了无法识别的响应（HTTP ${response.status}）`);
  }
  if (!response.ok || Number(result.errcode) !== 0) {
    throw new Error(`企业微信通知失败（${result.errcode ?? response.status}: ${result.errmsg || 'unknown'}）`);
  }
}

async function readJson(request, maximumBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error('payload_too_large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('invalid_json');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function requestIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress || 'unknown';
}

function createRateLimiter(windowMs, maximum) {
  const clients = new Map();
  return (key) => {
    const now = Date.now();
    const current = clients.get(key);
    if (!current || current.expiresAt <= now) {
      clients.set(key, { count: 1, expiresAt: now + windowMs });
      return false;
    }
    current.count += 1;
    if (clients.size > 10_000) {
      for (const [client, entry] of clients) {
        if (entry.expiresAt <= now) clients.delete(client);
      }
    }
    return current.count > maximum;
  };
}

export function createLeadService(overrides = {}) {
  const config = { ...loadConfig(process.env), ...overrides };
  config.webhookUrl = validateWebhookUrl(config.webhookUrl, config.allowInsecureWebhook);
  const logger = overrides.logger || console;
  const database = createDatabase(config.dbPath);
  const statements = createStatements(database);
  const isRateLimited = createRateLimiter(config.rateLimitWindowMs, config.rateLimitMax);
  const inFlight = new Map();
  let retryTimer;
  let closed = false;

  function attemptNotification(id) {
    if (!config.webhookUrl || closed) return Promise.resolve(false);
    if (inFlight.has(id)) return inFlight.get(id);

    const task = (async () => {
      const claim = statements.claim.run(id, config.maxNotificationAttempts);
      if (Number(claim.changes) === 0) return false;
      const lead = statements.getById.get(id);
      try {
        await sendWechatNotification(config.webhookUrl, lead, config.webhookTimeoutMs);
        statements.markNotified.run(new Date().toISOString(), id);
        logger.info?.(JSON.stringify({ event: 'wechat_notification_sent', leadId: id }));
        return true;
      } catch (error) {
        const delay = Math.min(
          config.retryBaseMs * (2 ** Math.max(0, lead.notification_attempts - 1)),
          6 * 60 * 60 * 1000,
        );
        const nextAttempt = new Date(Date.now() + delay).toISOString();
        const message = redactSecret(error.message);
        statements.markFailed.run(nextAttempt, message, id);
        logger.error?.(JSON.stringify({ event: 'wechat_notification_failed', leadId: id, error: message }));
        return false;
      }
    })();

    inFlight.set(id, task);
    task.finally(() => inFlight.delete(id));
    return task;
  }

  async function processRetries() {
    if (!config.webhookUrl || closed) return;
    const due = statements.dueForRetry.all(
      config.maxNotificationAttempts,
      new Date().toISOString(),
    );
    await Promise.allSettled(due.map(({ id }) => attemptNotification(id)));
  }

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;

    if (request.method === 'GET' && pathname === '/healthz') {
      sendJson(response, 200, { ok: true, webhookConfigured: Boolean(config.webhookUrl) });
      return;
    }
    if (request.method !== 'POST' || pathname !== '/api/leads') {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.length > 0 && !config.allowedOrigins.includes(origin)) {
      sendJson(response, 403, { ok: false, error: 'origin_not_allowed' });
      return;
    }
    if (isRateLimited(requestIp(request))) {
      sendJson(response, 429, { ok: false, error: '请求过于频繁，请稍后再试' }, { 'Retry-After': '600' });
      return;
    }
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { ok: false, error: '仅支持 JSON 请求' });
      return;
    }

    try {
      const body = await readJson(request, config.maxBodyBytes);
      const validation = validateLead(body);
      if (validation.honeypot) {
        sendJson(response, 201, { ok: true });
        return;
      }
      if (validation.error) {
        sendJson(response, 400, { ok: false, error: validation.error });
        return;
      }

      const id = makeLeadId();
      const createdAt = new Date().toISOString();
      const lead = validation.lead;
      statements.insert.run(
        id,
        createdAt,
        lead.name,
        lead.company,
        lead.contact,
        lead.role,
        lead.scene,
        lead.systems,
        lead.note,
        1,
        lead.sourceUrl,
        lead.utmSource,
        lead.utmMedium,
        lead.utmCampaign,
        lead.utmContent,
        lead.utmTerm,
        cleanText(String(request.headers['user-agent'] || '').slice(0, 300), 300),
      );

      sendJson(response, 201, { ok: true, leadId: id });
      void attemptNotification(id);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode === 500) {
        logger.error?.(JSON.stringify({ event: 'lead_submission_failed', error: redactSecret(error.message) }));
      }
      sendJson(response, statusCode, {
        ok: false,
        error: statusCode === 413 ? '提交内容过长' : statusCode === 400 ? '请求内容格式不正确' : '服务暂时不可用',
      });
    }
  });

  return {
    database,
    server,
    processRetries,
    attemptNotification,
    async listen() {
      await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(config.port, config.host, () => {
          server.off('error', reject);
          resolveListen();
        });
      });
      retryTimer = setInterval(() => void processRetries(), config.retryIntervalMs);
      retryTimer.unref();
      void processRetries();
      return server.address();
    },
    async close() {
      closed = true;
      clearInterval(retryTimer);
      await new Promise((resolveClose) => server.close(resolveClose));
      await Promise.allSettled([...inFlight.values()]);
      database.close();
    },
  };
}

const isMain = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const service = createLeadService();
  const address = await service.listen();
  console.log(JSON.stringify({ event: 'lead_api_started', address }));

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await service.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
