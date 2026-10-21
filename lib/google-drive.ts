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

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
const GOOGLE_PROJECT_NUMBER = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER ?? "";
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

// Google's scripts, loaded once on first use.
type GoogleGlobal = {
  accounts: { oauth2: { initTokenClient: (cfg: Record<string, unknown>) => { requestAccessToken: (o?: Record<string, unknown>) => void } } };
  picker: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
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

async function loadGoogle(): Promise<{ google: GoogleGlobal }> {
  await Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]);
  const w = window as unknown as { google?: GoogleGlobal; gapi?: GapiGlobal };
  await new Promise<void>((resolve) => w.gapi!.load("picker", resolve));
  return { google: w.google! };
}

/** Sign in to Google (a popup) for a token that covers only the files picked next. */
function requestToken(google: GoogleGlobal): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      callback: (res: { access_token?: string; error?: string }) =>
        res.access_token ? resolve(res.access_token) : reject(new Error(res.error === "access_denied" ? "Google sign-in was cancelled." : "Google sign-in didn't work.")),
      error_callback: () => reject(new Error("Google sign-in was closed before it finished.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

/** Opens Google's picker; resolves with the files picked (empty if cancelled) and the token to fetch them. */
export async function pickFromGoogleDrive(maxItems: number): Promise<{ token: string; files: PickedFile[] }> {
  const { google } = await loadGoogle();
  const token = await requestToken(google);
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
