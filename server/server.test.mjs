import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLeadService } from './server.mjs';

const silentLogger = { info() {}, error() {} };

function waitFor(check, timeoutMs = 3000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const result = check();
        if (result) {
          resolve(result);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('等待条件超时'));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

async function startWebhook(result = { errcode: 0, errmsg: 'ok' }) {
  const messages = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    messages.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    messages,
    url: `http://127.0.0.1:${port}/cgi-bin/webhook/send?key=test`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function validLead(overrides = {}) {
  return {
    name: '张先生',
    company: '示例科技有限公司',
    contact: '13800138000',
    role: '销售运营负责人',
    scene: '报价',
    systems: 'ERP、钉钉',
    note: '希望缩短复杂报价的响应时间',
    consent: true,
    website: '',
    sourceUrl: 'https://www.namche.cn/?utm_source=wechat',
    utm: { source: 'wechat', medium: 'social', campaign: 'diagnosis' },
    ...overrides,
  };
}

test('先保存线索，再通过企业微信机器人发送通知', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'namche-leads-'));
  const webhook = await startWebhook();
  const service = createLeadService({
    host: '127.0.0.1',
    port: 0,
    dbPath: join(directory, 'leads.db'),
    webhookUrl: webhook.url,
    allowInsecureWebhook: true,
    rateLimitMax: 100,
    retryIntervalMs: 60_000,
    logger: silentLogger,
  });
  context.after(async () => {
    await service.close();
    await webhook.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const address = await service.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://www.namche.cn' },
    body: JSON.stringify(validLead()),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.match(result.leadId, /^NCH-\d{8}-[A-F0-9]{6}$/);

  await waitFor(() => webhook.messages.length === 1);
  const row = await waitFor(() => {
    const lead = service.database.prepare('SELECT * FROM leads WHERE id = ?').get(result.leadId);
    return lead?.notification_status === 'notified' ? lead : null;
  });
  assert.equal(row.company, '示例科技有限公司');
  assert.equal(row.contact, '13800138000');
  assert.equal(row.utm_source, 'wechat');
  assert.equal(webhook.messages[0].msgtype, 'text');
  assert.match(webhook.messages[0].text.content, /官网新预约/);
  assert.match(webhook.messages[0].text.content, /示例科技有限公司/);
  assert.match(webhook.messages[0].text.content, /13800138000/);

  const invalidResponse = await fetch(`http://127.0.0.1:${address.port}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validLead({ contact: '', consent: false })),
  });
  assert.equal(invalidResponse.status, 400);

  const honeypotResponse = await fetch(`http://127.0.0.1:${address.port}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validLead({ website: 'https://spam.example' })),
  });
  assert.equal(honeypotResponse.status, 201);
  const count = service.database.prepare('SELECT COUNT(*) AS total FROM leads').get().total;
  assert.equal(count, 1);
});

test('机器人失败时保留线索并标记为待重试', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'namche-leads-failure-'));
  const webhook = await startWebhook({ errcode: 93000, errmsg: 'invalid webhook' });
  const service = createLeadService({
    host: '127.0.0.1',
    port: 0,
    dbPath: join(directory, 'leads.db'),
    webhookUrl: webhook.url,
    allowInsecureWebhook: true,
    rateLimitMax: 100,
    retryIntervalMs: 60_000,
    retryBaseMs: 1000,
    logger: silentLogger,
  });
  context.after(async () => {
    await service.close();
    await webhook.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const address = await service.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validLead()),
  });
  const result = await response.json();
  assert.equal(response.status, 201);

  const row = await waitFor(() => {
    const lead = service.database.prepare('SELECT * FROM leads WHERE id = ?').get(result.leadId);
    return lead?.notification_status === 'failed' ? lead : null;
  });
  assert.equal(row.notification_attempts, 1);
  assert.match(row.last_notification_error, /93000/);
  assert.ok(row.next_notification_at);
});
