import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createLeadService } from './server.mjs';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

test('可以把线索底账导出为 Excel 可打开的 CSV', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'namche-leads-export-'));
  const dbPath = join(directory, 'leads.db');
  const outputPath = join(directory, 'leads.csv');
  const service = createLeadService({
    host: '127.0.0.1',
    port: 0,
    dbPath,
    webhookUrl: '',
    rateLimitMax: 100,
    retryIntervalMs: 60_000,
    logger: { info() {}, error() {} },
  });
  context.after(() => rmSync(directory, { recursive: true, force: true }));

  const address = await service.listen();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: '李女士',
      company: '南驰测试客户',
      contact: 'wecom-test',
      scene: '履约',
      consent: true,
    }),
  });
  assert.equal(response.status, 201);
  await service.close();

  const exported = spawnSync(process.execPath, [
    join(currentDirectory, 'export-leads.mjs'),
    '--db', dbPath,
    '--output', outputPath,
  ], { encoding: 'utf8' });
  assert.equal(exported.status, 0, exported.stderr);

  const csv = readFileSync(outputPath, 'utf8');
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /南驰测试客户/);
  assert.match(csv, /wecom-test/);
  assert.match(csv, /pending/);
});
