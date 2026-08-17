import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const ext = join(dir, 'trace-ext');
const file = readdirSync(ext).find(f => f.endsWith('.trace'));
const lines = readFileSync(join(ext, file), 'utf8').split('\n').filter(Boolean).map(JSON.parse);
for (const e of lines) {
  const t = (e.startTime != null ? e.startTime.toFixed(0) : '').padStart(8);
  if (e.type === 'before' && e.class && e.method) {
    const p = e.params ? JSON.stringify(e.params).slice(0, 140) : '';
    console.log(t, 'BEFORE', e.class + '.' + e.method, p);
  } else if (e.type === 'after' && e.class && e.method) {
    const p = e.result ? JSON.stringify(e.result).slice(0, 140) : '';
    const err = e.error ? ' ERROR:' + (e.error.error?.message || JSON.stringify(e.error)).slice(0, 200) : '';
    console.log(t, 'AFTER ', e.class + '.' + e.method, p, err);
  } else if (e.type === 'log') {
    console.log(t, 'LOG   ', e.message.slice(0, 200));
  }
}