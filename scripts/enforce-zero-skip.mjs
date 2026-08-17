// =============================================================================
// ExamPro — zero-skip enforcement gate (spec §36).
//
// Reads a Playwright JSON report and FAILS the build unless:
//   - every executed test passed (0 failed / timedOut / interrupted), and
//   - zero tests were skipped (test.skip / .fixme / serial-cascade leftovers).
//
// This makes "skip" impossible to sneak back in: a skipped test is a
// configuration defect, not an acceptable outcome.
//
// Usage:  node scripts/enforce-zero-skip.mjs <report.json>
// The report is produced by Playwright's json reporter, e.g.:
//   PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/results.json npx playwright test
// =============================================================================

import fs from 'node:fs';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node scripts/enforce-zero-skip.mjs <playwright-json-report>');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(file, 'utf8'));

const byStatus = { passed: 0, failed: 0, skipped: 0 };
const skippedTests = [];
const failedTests = [];

function walk(suites) {
  for (const suite of suites) {
    for (const spec of suite.specs || []) {
      for (const t of spec.tests || []) {
        const key = `[${t.projectName}] ${spec.title}`;
        if (t.status === 'expected' || t.status === 'passed' || t.status === 'flaky') byStatus.passed += 1;
        else if (t.status === 'skipped') { byStatus.skipped += 1; skippedTests.push({ key, file: spec.file }); }
        else { byStatus.failed += 1; failedTests.push({ key, file: spec.file, status: t.status }); }
      }
    }
    walk(suite.suites || []);
  }
}
walk(report.suites || []);

console.log('── zero-skip enforcement ──');
console.log(`passed  : ${byStatus.passed}`);
console.log(`failed  : ${byStatus.failed}`);
console.log(`skipped : ${byStatus.skipped}`);

let exitCode = 0;
if (failedTests.length) {
  console.error('\nFAILED tests (must be 0):');
  for (const t of failedTests) console.error('  ✗ ' + t.key + '  (' + t.status + ')  ' + t.file);
  exitCode = 1;
}
if (skippedTests.length) {
  console.error('\nSKIPPED tests (must be 0 — a skip is a configuration defect):');
  for (const t of skippedTests) console.error('  ✗ ' + t.key + '  ' + t.file);
  exitCode = 1;
}
if (!exitCode) {
  console.log('\nZERO-SKIP GATE PASSED — all ' + byStatus.passed + ' tests ran and passed.');
} else {
  console.error('\nZERO-SKIP GATE FAILED — fix the failures/skips, then re-run.');
}
process.exit(exitCode);
