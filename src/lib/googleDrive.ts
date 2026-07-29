/**
 * Google Drive picker plumbing — Google Identity Services (OAuth token) plus
 * the Picker API, kept in one place so no component touches the Google globals.
 *
 * Auth model: the browser holds a short-lived access token for the session and
 * downloads the bytes itself. Nothing Google-related reaches an Edge Function,
 * so there is no refresh token to store and no file-size ceiling. (While the
 * OAuth app is in Testing mode a stored refresh token would expire every 7 days
 * anyway — see README/.env.example.)
 *
 * All three values below are browser-side by design. The Picker's developer key
 * is as public as the client ID; it is protected with an HTTP-referrer
 * restriction in Google Cloud Console, not by being secret. The app ID is just
 * the Cloud project number.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
/** Cloud project number. Required by the Picker under the drive.file scope. */
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID as string | undefined;

/**
 * Per-file access, granted only for what the user actually picks — rather than
 * drive.readonly, which reads their entire Drive.
 *
 * This scope only works in combination with PickerBuilder.setAppId(): the grant
 * is attached to the app identified there when the user selects a file. Without
 * a matching app ID the picker still returns file metadata, but the subsequent
 * alt=media download 404s because the app was never granted the file.
 */
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const GIS_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SRC = "https://apis.google.com/js/api.js";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

/** Thrown when the browser-side Google config is missing, with a fix in the text. */
export class DriveConfigError extends Error {}

export function driveConfigError(): string | null {
  if (!CLIENT_ID) {
    return "VITE_GOOGLE_CLIENT_ID is not set. Add it to your Vercel environment (and .env.local for local dev).";
  }
  if (!API_KEY) {
    return "VITE_GOOGLE_API_KEY is not set. The Google Picker needs its developer key in the browser — a key in Supabase secrets is server-side only and can't be read here.";
  }
  if (!APP_ID) {
    // Checked up front because the failure is otherwise silent and confusing:
    // picking succeeds and only the download fails, with a bare 404.
    return "VITE_GOOGLE_APP_ID is not set. The drive.file scope needs your Cloud project number here, or Google never grants access to the files a user picks.";
  }
  return null;
}

/** Google's globals are injected by the two scripts; typed just enough to use. */
interface GoogleGlobals {
  accounts?: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: { access_token?: string; error?: string }) => void;
        error_callback?: (error: { type?: string }) => void;
      }): { requestAccessToken(overrides?: { prompt?: string }): void };
    };
  };
  /** The Picker namespace is large and loosely typed; used through helpers below. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  picker?: any;
}

interface GapiGlobal {
  load(name: string, callback: () => void): void;
}

function googleGlobal(): GoogleGlobals | undefined {
  return (window as unknown as { google?: GoogleGlobals }).google;
}

function gapiGlobal(): GapiGlobal | undefined {
  return (window as unknown as { gapi?: GapiGlobal }).gapi;
}

/** Script tags are shared across mounts — load each at most once. */
const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  const existing = scriptPromises.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      scriptPromises.delete(src);
      reject(new Error(`Could not load ${src}. Check your network or any content blockers.`));
    };
    document.head.appendChild(el);
  });

  scriptPromises.set(src, promise);
  return promise;
}

let pickerLoaded: Promise<void> | null = null;

/** Loads GIS and the Picker module. Safe to call repeatedly. */
async function loadGoogleApis(): Promise<void> {
  const configError = driveConfigError();
  if (configError) throw new DriveConfigError(configError);

  await Promise.all([loadScript(GIS_SRC), loadScript(GAPI_SRC)]);

  pickerLoaded ??= new Promise<void>((resolve, reject) => {
    const gapi = gapiGlobal();
    if (!gapi) {
      pickerLoaded = null;
      reject(new Error("Google API script loaded but gapi is unavailable."));
      return;
    }
    gapi.load("picker", () => resolve());
  });
  await pickerLoaded;
}

/**
 * Requests a Drive access token, showing Google's consent popup.
 *
 * The OAuth app is External + Testing, so this fails for any Google account
 * that isn't on the test-user list — that case is surfaced with a message
 * naming the cause rather than a bare "access_denied".
 */
export async function requestDriveAccessToken(): Promise<string> {
  await loadGoogleApis();

  const oauth2 = googleGlobal()?.accounts?.oauth2;
  if (!oauth2) throw new Error("Google Identity Services did not initialise.");

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: CLIENT_ID!,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.access_token) {
          resolve(response.access_token);
          return;
        }
        reject(
          new Error(
            response.error === "access_denied"
              ? "Google denied access. This app is in Testing mode, so only Google accounts added as test users can connect."
              : `Google sign-in failed${response.error ? `: ${response.error}` : "."}`
          )
        );
      },
      error_callback: (error) => {
        reject(
          new Error(
            error.type === "popup_closed"
              ? "Google sign-in was closed before finishing."
              : "Google sign-in could not be opened. Check that popups are allowed for this site."
          )
        );
      },
    });
    client.requestAccessToken();
  });
}

/**
 * Opens the Picker filtered to photos and videos. Resolves with the chosen
 * files, or an empty array if the user cancels.
 */
export async function openDrivePicker(accessToken: string): Promise<DriveFile[]> {
  await loadGoogleApis();

  const picker = googleGlobal()?.picker;
  if (!picker) throw new Error("Google Picker did not initialise.");

  return new Promise<DriveFile[]>((resolve, reject) => {
    try {
      const view = new picker.DocsView(picker.ViewId.DOCS_IMAGES_AND_VIDEOS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false)
        .setMode(picker.DocsViewMode.GRID);

      const built = new picker.PickerBuilder()
        .setOAuthToken(accessToken)
        .setDeveloperKey(API_KEY!)
        // Attaches the drive.file grant to this app when the user picks.
        .setAppId(APP_ID!)
        .setTitle("Select photos and videos")
        .enableFeature(picker.Feature.MULTISELECT_ENABLED)
        .addView(view)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .setCallback((data: any) => {
          const action = data[picker.Response.ACTION];
          if (action === picker.Action.PICKED) {
            const docs = (data[picker.Response.DOCUMENTS] ?? []) as Record<string, unknown>[];
            resolve(
              docs.map((d) => ({
                id: String(d.id ?? ""),
                name: String(d.name ?? "untitled"),
                mimeType: String(d.mimeType ?? "application/octet-stream"),
                // sizeBytes arrives as a string on some payloads.
                sizeBytes: Number(d.sizeBytes ?? 0) || 0,
              }))
            );
          } else if (action === picker.Action.CANCEL) {
            resolve([]);
          }
        })
        .build();

      built.setVisible(true);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Could not open the Google Picker."));
    }
  });
}

/** Google-native docs (Sheets, Slides…) have no bytes to download. */
export function isGoogleNativeFile(mimeType: string): boolean {
  return mimeType.startsWith("application/vnd.google-apps");
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/**
 * Downloads a Drive file's bytes in the browser. Drive supports CORS for
 * alt=media with a bearer token, so this needs no server hop — which is what
 * keeps large videos off the Edge Function's 150s wall clock.
 */
export async function downloadDriveFile(
  accessToken: string,
  file: DriveFile
): Promise<Blob> {
  if (isGoogleNativeFile(file.mimeType)) {
    throw new Error(`"${file.name}" is a Google document, not a photo or video.`);
  }

  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}` +
    `?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Google refused the download of "${file.name}" (${res.status}). The session may have expired — try connecting again.`
      );
    }
    if (res.status === 404) {
      // Under drive.file the file is invisible to us unless the pick granted
      // it, so a 404 here means "not granted" far more often than "missing".
      throw new Error(
        `Google did not grant access to "${file.name}". Try picking it again — if it keeps failing, VITE_GOOGLE_APP_ID may not match the Cloud project behind VITE_GOOGLE_CLIENT_ID.`
      );
    }
    throw new Error(`Could not download "${file.name}" from Drive (${res.status}).`);
  }
  return await res.blob();
}
