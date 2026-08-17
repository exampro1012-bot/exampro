import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";

// Scan all client-shipped source for privileged credentials.
const SRC_FILES = readdirSync("src").filter((f) => f.endsWith(".js"));
let srcText = "";
for (const f of SRC_FILES) srcText += readFileSync("src/" + f, "utf8") + "\n";

// Patterns that must NEVER appear in client-shipped code (privileged credentials).
const FORBIDDEN = [
  /sb_secret_/i,                 // Supabase service-role key
  /service_role/i,               // service-role references in client code
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./, // JWT (auth tokens / service keys)
  /postgres(ql)?:\/\//i,          // direct DB connection strings
  /aws_secret_access_key/i,      // R2 / AWS secrets
  /r2_secret/i,
  /ExamPro@123/i,                // the live DB password (server-only)
  /sk-[A-Za-z0-9]{20,}/,         // generic secret keys
  /AIza[A-Za-z0-9_-]{30,}/,      // Google / Firebase API keys
  /firebase/i,
  /code\.gs/i,
  /google\.script/i,
  /spreadsheetapp/i,
];

let failures = 0;
function check(name, cond) {
  console.log((cond ? "  PASS " : "  FAIL ") + name);
  if (!cond) failures++;
}

console.log("== Static secret scan of src/*.js ==");
for (const re of FORBIDDEN) check("no forbidden pattern: " + re, !re.test(srcText));

console.log("\n== Boot the app in a browser ==");
const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await page.goto("file://" + process.cwd() + "/index.html");
// Boot path depends on network: online -> #auth (connected), offline -> #setup.
// The deterministic guarantee is that the app boots WITHOUT uncaught errors.
await page.waitForTimeout(5000);
const which = (await page.isVisible("#auth")) ? "#auth"
  : (await page.isVisible("#setup")) ? "#setup"
  : (await page.isVisible("#app")) ? "#app" : "(none visible)";
console.log("  visible screen:", which);
check("app boots without uncaught page errors", pageErrors.length === 0);
if (pageErrors.length) console.log("  page errors:", pageErrors);

await browser.close();

console.log("\n" + (failures === 0 ? "STRUCTURAL TESTS PASSED ✓" : failures + " STRUCTURAL CHECK(S) FAILED ✗"));
process.exit(failures === 0 ? 0 : 1);
