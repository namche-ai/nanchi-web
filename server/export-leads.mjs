import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const dbPath = resolve(argument('--db', process.env.LEADS_DB_PATH || '/data/leads.db'));
const outputPath = resolve(argument('--output', `leads-${new Date().toISOString().slice(0, 10)}.csv`));
const database = new DatabaseSync(dbPath, { readOnly: true });
const rows = database.prepare(`
  SELECT
    id AS '线索编号',
    created_at AS '提交时间(UTC)',
    company AS '公司',
    name AS '姓名',
    role AS '职位',
    contact AS '联系方式',
    scene AS '诊断场景',
    systems AS '当前系统',
    note AS '需求说明',
    utm_source AS 'UTM来源',
    utm_medium AS 'UTM媒介',
    utm_campaign AS 'UTM活动',
    source_url AS '来源页面',
    notification_status AS '通知状态',
    notification_attempts AS '通知次数',
    notified_at AS '通知时间(UTC)'
  FROM leads
  ORDER BY created_at DESC
`).all();
database.close();

const headers = rows.length > 0
  ? Object.keys(rows[0])
  : ['线索编号', '提交时间(UTC)', '公司', '姓名', '职位', '联系方式', '诊断场景', '当前系统', '需求说明', 'UTM来源', 'UTM媒介', 'UTM活动', '来源页面', '通知状态', '通知次数', '通知时间(UTC)'];
const csv = [
  headers.map(csvCell).join(','),
  ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
].join('\r\n');

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `\uFEFF${csv}`, 'utf8');
console.log(JSON.stringify({ ok: true, rows: rows.length, output: outputPath }));
