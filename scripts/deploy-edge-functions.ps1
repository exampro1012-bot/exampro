# ExamPro — Edge Function Deployment (Google Drive integration)
# Prerequisites:
#   1. supabase login                      (Supabase access token)
#   2. Supabase dashboard -> Edge Functions -> Secrets, set:
#        GOOGLE_DRIVE_PROJECT_ID     (Google Cloud project id)
#        GOOGLE_DRIVE_CLIENT_EMAIL   (Drive service-account email, e.g. exampro1012@gmail.com service account)
#        GOOGLE_DRIVE_PRIVATE_KEY    (service-account private key, JSON-escaped with \n)
#      Secrets can also be set via: supabase secrets set --project-ref lrktftnalrtvaazaauhj
#   3. The service account must have Drive API enabled and be granted the Drive folders.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-edge-functions.ps1
param(
  [string]$ProjectRef = "lrktftnalrtvaazaauhj"
)

$ErrorActionPreference = "Stop"
$functions = @(
  "drive-health", "drive-init", "drive-upload", "drive-download",
  "drive-metadata", "drive-delete", "drive-list", "drive-audit",
  "drive-track", "drive-save-paper", "drive-save-dpp",
  "generate-paper", "generate-report", "finalize-exam",
  "send-notification", "admin-import", "admin-import-source",
  "google-drive-oauth"
)

Write-Host "==> Deploying $($functions.Count) edge functions to $ProjectRef"
foreach ($fn in $functions) {
  Write-Host "==> deploying $fn"
  supabase functions deploy $fn --project-ref $ProjectRef
  if ($LASTEXITCODE -ne 0) { Write-Error "deploy failed for $fn"; exit 1 }
}

# Flip the deployment flag so the frontend auto-probes the functions (honest
# status) instead of reporting "Not deployed". Idempotent.
Write-Host ""
Write-Host "==> Marking edge functions as deployed (system_config.edge_functions_available)"
try {
  supabase db execute --project-ref $ProjectRef --sql "insert into system_config (key, value) values ('edge_functions_available', '{\"enabled\": true}'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now();"
  if ($LASTEXITCODE -ne 0) { throw "db execute failed" }
} catch {
  Write-Host "  [!] Could not set the flag automatically — run this in the SQL editor:"
  Write-Host "  insert into system_config (key, value) values ('edge_functions_available', '{\"enabled\": true}'::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now();"
}

Write-Host ""
Write-Host "==> IMPORTANT: set Drive secrets in the dashboard (or via CLI):"
Write-Host "  supabase secrets set GOOGLE_DRIVE_PROJECT_ID=<gcp-project-id> --project-ref $ProjectRef"
Write-Host "  supabase secrets set GOOGLE_DRIVE_CLIENT_EMAIL=<sa-email> --project-ref $ProjectRef"
Write-Host "  supabase secrets set GOOGLE_DRIVE_PRIVATE_KEY='<escaped-key>' --project-ref $ProjectRef"
Write-Host "  supabase secrets set GOOGLE_OAUTH_CLIENT_ID=<oauth-client-id> --project-ref $ProjectRef"
Write-Host "  supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET='<client-secret>' --project-ref $ProjectRef"
Write-Host "  supabase secrets set GOOGLE_OAUTH_REDIRECT_URI=https://$ProjectRef.supabase.co/functions/v1/google-drive-oauth --project-ref $ProjectRef"
Write-Host "  supabase secrets set APP_URL=https://$ProjectRef.supabase.co --project-ref $ProjectRef"
Write-Host ""

Write-Host "==> Verify:"
Write-Host "  1. supabase functions list --project-ref $ProjectRef"
Write-Host "  2. Browse to https://$ProjectRef.supabase.co/functions/v1/drive-health with a logged-in JWT"
Write-Host "  3. Storage Settings page -> Test Connection / Initialize Folders"