import { acceptedExtensions, fileExtension, MAX_DOCUMENT_BYTES } from "./documents.ts";

/**
 * Import from Google Drive, in the browser (no lasting connection). Google's
 * own picker shows the person's Drive, including shared drives; they pick
 * files, and their browser fetches them with a short-lived token that only
 * covers the files they picked (the drive.file scope). Our server never sees
 * the token. Google Docs come in as Word, Sheets and Slides as PDF, so
 * Stratasphere can read them.
 *
 * Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_API_KEY and
 * NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER (a Google Cloud project with the Drive
 * and Picker APIs on); the import button is hidden without them.
 */

// Trimmed: a line break pasted into Vercel with the client ID made Google
// answer "invalid_client" (2026-10-22).
export const GOOGLE_CLIENT_ID = (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "").trim();
const GOOGLE_API_KEY = (process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "").trim();
const GOOGLE_PROJECT_NUMBER = (process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? "").trim();
const SCOPE = "https://www.googleapis.com/auth/drive.file";

export const googleDriveConfigured = Boolean(GOOGLE_CLIENT_ID && GOOGLE_API_KEY && GOOGLE_PROJECT_NUMBER);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";
/** Google's own formats, and what each comes in as. */
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: DOCX, ext: "docx" },
  "application/vnd.google-apps.spreadsheet": { mime: PDF, ext: "pdf" },
  "application/vnd.google-apps.presentation": { mime: PDF, ext: "pdf" },
};

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
}

export interface ImportPlan extends PickedFile {
  /** The file name it gets here (Google Docs gain .docx, Sheets and Slides .pdf). */
  fileName: string;
  /** Why it can't come in, if it can't. */
  problem: string | null;
}

/** What a picked file becomes, or why it can't be imported. */
export function planImport(f: PickedFile): ImportPlan {
  const exp = EXPORTS[f.mimeType];
  if (exp) {
    const base = f.name.replace(/\.(docx?|pdf)$/i, "");
    return { ...f, fileName: `${base}.${exp.ext}`, problem: null };
  }
  if (f.mimeType.startsWith("application/vnd.google-apps.")) {
    return { ...f, fileName: f.name, problem: "This kind of Google file can't be imported." };
  }
  const ext = fileExtension(f.name);
  if (!(acceptedExtensions as readonly string[]).includes(ext)) {
    return { ...f, fileName: f.name, problem: `Only ${acceptedExtensions.join(", ")} files can be imported.` };
  }
  if (f.sizeBytes != null && f.sizeBytes > MAX_DOCUMENT_BYTES) {
    return { ...f, fileName: f.name, problem: "Over the 50 MB limit." };
  }
  return { ...f, fileName: f.name, problem: null };
}

// Google's Picker script, loaded once when the Documents page opens.
type GoogleGlobal = { picker: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type GapiGlobal = { load: (name: string, cb: () => void) => void };

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Couldn't reach Google. Check your connection and try again."));
    document.head.appendChild(s);
  });
}

let loaded: Promise<GoogleGlobal> | null = null;

export function preloadGoogleDrive(): Promise<void> {
  loaded ??= loadScript("https://apis.google.com/js/api.js")
    .then(async () => {
      const w = window as unknown as { google?: GoogleGlobal; gapi?: GapiGlobal };
      await new Promise<void>((resolve) => w.gapi!.load("picker", resolve));
      return w.google!;
    })
    .catch((err) => {
      loaded = null;
      throw err;
    });
  return loaded.then(() => undefined);
}

// Google sign-in is a full-page visit to Google, not a pop-up: pop-up
// blockers, extensions and managed (Workspace) browsers can close a pop-up
// silently, and a full page shows Google's own reason when it refuses.
// Google sends the person back to /google-drive/return with a short-lived
// token in the address's #fragment (never sent to our server), which hands
// it to the page they started on through this tab's sessionStorage.
export const GOOGLE_RETURN_PATH = "/google-drive/return";
const STATE_KEY = "google-drive-state";
const RESULT_KEY = "google-drive-result";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type SignInResult = { token: string; expiresAt: number } | { error: string };

/** Only a path on this site (not "//elsewhere") can be returned to. */
export function safeReturnPath(path: string | null | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}

/** Google's address for signing in and allowing access to the files picked next. */
export function googleSignInUrl(origin: string, state: string): string {
  const q = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: origin + GOOGLE_RETURN_PATH,
    response_type: "token",
    scope: SCOPE,
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Goes to Google's sign-in; Google brings the person back to returnTo. Call it from the click. */
export function startGoogleDriveSignIn(returnTo: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  sessionStorage.setItem(STATE_KEY, nonce);
  window.location.assign(googleSignInUrl(window.location.origin, `${nonce}:${safeReturnPath(returnTo)}`));
}

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "Google sign-in was cancelled, so nothing was imported.",
  admin_policy_enforced:
    "Your organization's Google administrator doesn't allow StrataCouncil to open Google Drive. Ask them to allow it, or sign in to Google with a different account.",
};

/**
 * Reads Google's answer (the #fragment on the return page), checks it
 * belongs to a sign-in this tab started, and keeps the result for the page
 * the person came from. Returns that page's path.
 */
export function finishGoogleDriveSignIn(hash: string, storage: Storage, now = Date.now()): string {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const [nonce, ...rest] = (params.get("state") ?? "").split(":");
  const returnTo = safeReturnPath(rest.join(":"));
  const expected = storage.getItem(STATE_KEY);
  storage.removeItem(STATE_KEY);

  let result: SignInResult;
  if (!expected || nonce !== expected) {
    result = { error: "Google sign-in didn't finish. Please try again." };
  } else if (params.get("error")) {
    result = { error: GOOGLE_ERRORS[params.get("error")!] ?? "Google sign-in didn't work. Please try again." };
  } else if (params.get("access_token")) {
    const seconds = Number(params.get("expires_in")) || 3600;
    result = { token: params.get("access_token")!, expiresAt: now + seconds * 1000 };
  } else {
    result = { error: "Google sign-in didn't work. Please try again." };
  }
  storage.setItem(RESULT_KEY, JSON.stringify(result));
  return returnTo;
}

/** The sign-in result waiting for this page, if any (read once). */
export function takeGoogleDriveSignIn(storage: Storage, now = Date.now()): SignInResult | null {
  const raw = storage.getItem(RESULT_KEY);
  storage.removeItem(RESULT_KEY);
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as SignInResult;
    if ("token" in r && r.expiresAt <= now) return { error: "Google sign-in expired. Please try again." };
    return r;
  } catch {
    return null;
  }
}

/** Opens Google's picker; resolves with the files picked (empty if cancelled). */
export async function pickFromGoogleDrive(token: string, maxItems: number): Promise<{ token: string; files: PickedFile[] }> {
  await preloadGoogleDrive();
  return openPicker((await loaded)!, token, maxItems);
}

function openPicker(google: GoogleGlobal, token: string, maxItems: number): Promise<{ token: string; files: PickedFile[] }> {
  const p = google.picker;
  return new Promise((resolve) => {
    // Their Drive (folders to browse into), and shared drives (a Workspace's team folders).
    const drive = new p.DocsView(p.ViewId.DOCS).setIncludeFolders(true);
    const shared = new p.DocsView(p.ViewId.DOCS).setIncludeFolders(true).setEnableDrives(true);
    const picker = new p.PickerBuilder()
      .addView(drive)
      .addView(shared)
      .enableFeature(p.Feature.MULTISELECT_ENABLED)
      .enableFeature(p.Feature.SUPPORT_DRIVES)
      .setMaxItems(maxItems)
      .setOAuthToken(token)
      .setDeveloperKey(GOOGLE_API_KEY)
      .setAppId(GOOGLE_PROJECT_NUMBER)
      .setTitle("Choose files to import")
      .setCallback((data: { action: string; docs?: Array<Record<string, unknown>> }) => {
        if (data.action === p.Action.PICKED) {
          resolve({
            token,
            files: (data.docs ?? [])
              .filter((d) => d.type !== "folder" && d.mimeType !== "application/vnd.google-apps.folder")
              .map((d) => ({
                id: String(d.id),
                name: String(d.name ?? "Untitled"),
                mimeType: String(d.mimeType ?? ""),
                sizeBytes: d.sizeBytes != null ? Number(d.sizeBytes) : null,
              })),
          });
        } else if (data.action === p.Action.CANCEL) {
          resolve({ token, files: [] });
        }
      })
      .build();
    picker.setVisible(true);
  });
}

/** Fetches one picked file (exporting Google Docs, Sheets and Slides) as a File ready to upload. */
export async function fetchFromGoogleDrive(token: string, f: ImportPlan): Promise<File> {
  const exp = EXPORTS[f.mimeType];
  const base = "https://www.googleapis.com/drive/v3/files";
  const url = exp
    ? `${base}/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(exp.mime)}`
    : `${base}/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const tooBig = exp && res.status === 403;
    throw new Error(tooBig ? `${f.name} is too large for Google to convert. Download it from Drive and upload it instead.` : `${f.name} couldn't be fetched from Google Drive.`);
  }
  const blob = await res.blob();
  if (blob.size > MAX_DOCUMENT_BYTES) throw new Error(`${f.name} is over the 50 MB limit.`);
  return new File([blob], f.fileName, { type: exp?.mime ?? (f.mimeType || blob.type) });
}
