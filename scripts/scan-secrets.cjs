// Final secret-material scan across shipped + source surfaces.
const fs = require('fs');
const path = require('path');
const pats = [
  { re: /sbp_[A-Za-z0-9]+/g, n: 'personal-token' },
  { re: /service_role/g, n: 'service_role' },
  { re: /BEGIN (RSA )?PRIVATE/g, n: 'private-key' },
  { re: /client_secret\s*[:=]\s*["'][^"']+/g, n: 'client-secret-value' },
  { re: /GOOGLE_DRIVE_PRIVATE_KEY\s*[:=]/g, n: 'sa-key-ref' },
];
const dirs = ['src', 'dist/src', 'dist', 'public', 'supabase/functions'];
const seen = new Set();
let any = false;
for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  const walk = (p) => {
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      if (e.isDirectory()) walk(fp);
      else if (/\.(js|ts|html)$/.test(e.name)) {
        const t = fs.readFileSync(fp, 'utf8');
        for (const { re, n } of pats) {
          const m = t.match(re);
          if (m) {
            any = true;
            for (const x of m) {
              const k = n + ':' + fp;
              if (!seen.has(k)) { seen.add(k); console.log(n + '  ' + fp); }
            }
          }
        }
      }
    }
  };
  walk(d);
}
console.log(any ? 'SCAN: HITS ABOVE' : 'SCAN CLEAN');
