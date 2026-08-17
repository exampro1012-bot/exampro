// ExamPro — cross-project storage-policy lock.
//
// The storage policy (app_set_storage_policy) is a GLOBAL runtime setting.
// Both Playwright projects (chromium-desktop, chromium-mobile) run in parallel
// and several specs toggle it around real ingestion flows. A toggle in one
// worker must never race a flow in another worker, so every policy-toggling
// test executes inside an atomic filesystem lock shared by ALL workers.
//
// The lock is a directory whose creation is atomic (fs.mkdir) and exclusive
// per machine — all workers run on the same host (webServer + browsers on
// localhost), so this serializes policy toggles across projects and workers.
// Held workers wait up to 4 minutes; a crashed worker's stale lock is broken
// after a grace period so the suite can never deadlock permanently.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LOCK_DIR = path.join(os.tmpdir(), 'exampro-e2e-policy.lock');
const ACQUIRE_TIMEOUT_MS = 4 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;

function lockAgeMs(): number {
  try {
    return Date.now() - fs.statSync(LOCK_DIR).mtimeMs;
  } catch {
    return 0;
  }
}

export async function withPolicyLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      break;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;
      if (lockAgeMs() > STALE_AFTER_MS) {
        try {
          fs.rmdirSync(LOCK_DIR);
        } catch {
          /* another worker cleared it — retry acquire */
        }
      }
      if (Date.now() > deadline) {
        throw new Error('timed out waiting for the storage-policy lock (another worker crashed mid-toggle?)');
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      fs.rmdirSync(LOCK_DIR);
    } catch {
      /* release must never mask a test failure */
    }
  }
}