// ExamPro — reproducible production build.
// Copies the static app into dist/ and verifies the bundle is clean:
//   - no localhost references
//   - no service-role / secret patterns
//   - no mock backend
//   - the publishable key is the configured env key (baked via --key)
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dist = path.join(root, 'dist');
const keyArg = process.argv.find(a => a.startsWith('--key='));
const key = keyArg ? keyArg.slice('--key='.length) : process.env.EXAMPRO_PUBLISHABLE_KEY;

if (!key) {
  console.error('ERROR: pass --key=<publishable-key> or set EXAMPRO_PUBLISHABLE_KEY');
  process.exit(1);
}

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'src'), { recursive: true });

const indexHtml = await readFile(path.join(root, 'index.html'), 'utf8');
const html = indexHtml.replace(
  /(SUPABASE_PUBLISHABLE_KEY:\s*['"])([^'"]*)(['"])/,
  `$1${key}$3`
);
await writeFile(path.join(dist, 'index.html'), html);

for (const f of ['manifest.json', 'sw.js']) {
  await cp(path.join(root, f), path.join(dist, f));
}
for (const f of await readdir(path.join(root, 'src'))) {
  await cp(path.join(root, 'src', f), path.join(dist, 'src', f), { recursive: true });
}

const forbidden = [
  /service_role/i,
  /sb_secret_/i,
  /postgres(ql)?:\/\//i,
  /Exampro@123/i,
  /MockPassword/i,
  /mock\.supabase/i,
];
// localhost must not appear in first-party files (vendor supabase.js is a
// library bundle whose internals reference localhost for trace propagation)
const localhostRe = /localhost/i;
const jwtRe = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i;
const files = [];
async function walk(dir) {
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) await walk(p);
    else files.push(p);
  }
}
await walk(dist);

let issues = 0;
for (const f of files) {
  if (/\.(png|jpg|jpeg|webp|ico)$/i.test(f)) continue;
  if (path.basename(f) === 'supabase.js') continue; // fixed upstream SDK bundle
  const c = await readFile(f, 'utf8');
  for (const re of forbidden) {
    if (re.test(c)) {
      console.error(`FORBIDDEN PATTERN ${re} in ${path.relative(root, f)}`);
      issues++;
    }
  }
  if (path.basename(f) !== 'supabase.js' && localhostRe.test(c)) {
    console.error(`LOCALHOST REFERENCE in ${path.relative(root, f)}`);
    issues++;
  }
  // the baked publishable anon key is a JWT and is expected in the bundle
  const withoutKey = c.split(key).join('');
  if (jwtRe.test(withoutKey)) {
    console.error(`UNEXPECTED JWT in ${path.relative(root, f)}`);
    issues++;
  }
}

if (!html.includes(key)) { console.error('ERROR: publishable key not baked into dist/index.html'); issues++; }
console.log(`dist/ built: ${files.length} files, ${issues} issues`);
process.exit(issues ? 1 : 0);