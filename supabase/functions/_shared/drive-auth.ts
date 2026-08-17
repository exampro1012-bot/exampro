// ExamPro shared helper: build an authenticated Google Drive client + folder utils.
//
// SECURITY: client_secret and refresh_token are NEVER stored in source/Git.
// They live only in Supabase Edge Function secrets (env). client_id is public.
// The OAuth refresh token is stored server-side in `google_drive_oauth_tokens`.

// client_id is public (safe to default). client_secret MUST come from env only.
const OAUTH_CLIENT_ID =
  Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ||
  "577032144870-ftlplfu0btp7btt5rbo9i6qcled5nqb0.apps.googleusercontent.com";
const OAUTH_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET"); // NO default — secret only
const OAUTH_REDIRECT_URI =
  Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI") ||
  "https://lrktftnalrtvaazaauhj.supabase.co/functions/v1/google-drive-oauth";

export const GOOGLE_OAUTH_CLIENT_ID = OAUTH_CLIENT_ID;
export const GOOGLE_OAUTH_CLIENT_SECRET = OAUTH_CLIENT_SECRET;
export const GOOGLE_OAUTH_REDIRECT_URI = OAUTH_REDIRECT_URI;
// Prefer the narrow file-scope; only broaden to `drive` if pre-existing-file
// access is deliberately required.
export const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file";

// ExamPro Drive folder structure (per spec).
export const EXAMPRO_ROOT = "ExamPro";
export const EXAMPRO_SUBFOLDERS = [
  "01_Source_Documents",
  "02_Question_Bank",
  "03_Question_Shards",
  "04_Answer_Keys",
  "05_Solutions",
  "06_Question_Assets",
  "07_Formulas",
  "08_Generated_Papers",
  "09_DPP",
  "10_OMR",
  "11_Reports",
  "12_Archives",
];

// Map a Supabase Storage bucket to its ExamPro subfolder.
export const BUCKET_TO_SUBFOLDER: Record<string, string> = {
  "question-documents": "01_Source_Documents",
  "question-images": "06_Question_Assets",
  "generated-papers": "08_Generated_Papers",
  "reports": "11_Reports",
  "user-uploads": "01_Source_Documents",
  "omr-images": "10_OMR",
  "omr-scans": "10_OMR",
  "institution-logos": "06_Question_Assets",
};

// Drive clients from googleapis are frozen objects, so the auth handle is
// tracked in a WeakMap keyed by the client instead of a property.
const driveAuthByClient = new WeakMap<object, any>();

export async function getDriveClient(svc: any, tenantId?: string | null): Promise<any> {
  const { google } = await import("npm:googleapis@134");

  // Clear, controlled failure when NO Drive credential is configured yet
  // (no OAuth refresh token stored AND no service-account env). Callers map
  // this marker to a readable "Google Drive is not connected." response.
  const hasServiceAccount = Deno.env.get("GOOGLE_DRIVE_PROJECT_ID") && Deno.env.get("GOOGLE_DRIVE_CLIENT_EMAIL") && Deno.env.get("GOOGLE_DRIVE_PRIVATE_KEY");
  const tokenRow = svc ? await svc
    .from("google_drive_oauth_tokens")
    .select("refresh_token")
    .eq("provider", "GOOGLE_DRIVE")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle() : { data: null };
  if (!tokenRow.data?.refresh_token && !hasServiceAccount) {
    throw new Error("EXAMPRO_DRIVE_NOT_CONFIGURED");
  }
  // A stored token is useless without the client secret that minted it.
  if (tokenRow.data?.refresh_token && !(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET)) {
    throw new Error("EXAMPRO_DRIVE_OAUTH_INCOMPLETE");
  }

  // 1) Prefer a stored OAuth refresh token (per tenant, or any if none given).
  if (svc && OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET) {
    try {
      let q = svc
        .from("google_drive_oauth_tokens")
        .select("refresh_token")
        .eq("provider", "GOOGLE_DRIVE")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      let { data: tok } = await q.maybeSingle();
      // Platform admins act under the global tenant id while the stored token
      // may live under a specific tenant (or none) — fall back to the most
      // recently updated token rather than dropping to the service account.
      if (!tok?.refresh_token && tenantId) {
        ({ data: tok } = await svc
          .from("google_drive_oauth_tokens")
          .select("refresh_token")
          .eq("provider", "GOOGLE_DRIVE")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle());
      }
      if (tok?.refresh_token) {
        const oauth2 = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI);
        oauth2.setCredentials({ refresh_token: tok.refresh_token });
        const drive = google.drive({ version: "v3", auth: oauth2 });
        driveAuthByClient.set(drive, oauth2);
        return drive;
      }
    } catch (e) {
      // fall through to service-account
    }
  }

  // 2) Fallback: service-account credentials (if configured).
  const { GoogleAuth } = await import("npm:google-auth-library@8");
  const auth = new GoogleAuth({
    credentials: {
      type: "service_account",
      project_id: Deno.env.get("GOOGLE_DRIVE_PROJECT_ID"),
      client_email: Deno.env.get("GOOGLE_DRIVE_CLIENT_EMAIL"),
      private_key: Deno.env.get("GOOGLE_DRIVE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const client = await auth.getClient();
  const drive = google.drive({ version: "v3", auth: client });
  driveAuthByClient.set(drive, client);
  return drive;
}

// Resolve a fresh Google OAuth access token for direct Drive media streaming.
// The googleapis client's media responses can be unreliable in the Deno edge
// runtime, so drive-download fetches the media URL directly with this token.
export async function getDriveAccessToken(drive: any): Promise<string> {
  const auth = drive && driveAuthByClient.get(drive);
  if (!auth) throw new Error("EXAMPRO_DRIVE_NOT_CONFIGURED");
  if (typeof auth.getAccessToken === "function") {
    const res = await auth.getAccessToken();
    const token = typeof res === "string" ? res : (res && res.token) || null;
    if (token) return token;
  }
  throw new Error("EXAMPRO_DRIVE_OAUTH_INCOMPLETE");
}

// Build the Google consent URL for the authorization-code flow.
export function buildOAuthConsentUrl(tenantId: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/auth");
  url.searchParams.set("client_id", OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", tenantId);
  return url.toString();
}

// Find a folder by name under a parent, creating it if missing. Returns the id.
export async function findOrCreateFolder(drive: any, parentId: string, name: string): Promise<string> {
  const q = `'${parentId}' in parents and name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const created = await drive.files.create({
    resource: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  return created.data.id;
}

// Create/find the ExamPro root + 12 subfolders. Optionally records them in
// storage_folders (server-side, service role) for UI listing. Returns id map.
export async function ensureExamProStructure(drive: any, svc?: any): Promise<Record<string, string>> {
  const rootId = await findOrCreateFolder(drive, "root", EXAMPRO_ROOT);
  const map: Record<string, string> = { [EXAMPRO_ROOT]: rootId };
  for (const name of EXAMPRO_SUBFOLDERS) {
    const id = await findOrCreateFolder(drive, rootId, name);
    map[name] = id;
    if (svc) {
      try {
        await svc.from("storage_folders").upsert(
          {
            provider: "GOOGLE_DRIVE",
            folder_type: name,
            drive_folder_id: id,
            name,
            path: EXAMPRO_ROOT + "/" + name,
            tenant_id: null,
          },
          { onConflict: "provider,folder_type" },
        );
      } catch (_) {
        /* non-fatal: folder still usable via Drive id */
      }
    }
  }
  return map;
}

// Ensure the parent folder id for a given bucket + tenant under ExamPro.
export async function resolveBucketParent(drive: any, bucket: string, tenantId?: string | null): Promise<string> {
  const sub = BUCKET_TO_SUBFOLDER[bucket] || "01_Source_Documents";
  const rootId = await findOrCreateFolder(drive, "root", EXAMPRO_ROOT);
  const subId = await findOrCreateFolder(drive, rootId, sub);
  if (tenantId && tenantId !== "global") {
    return await findOrCreateFolder(drive, subId, "tenant-" + tenantId);
  }
  return subId;
}
