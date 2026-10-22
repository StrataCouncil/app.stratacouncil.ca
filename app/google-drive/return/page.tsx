"use client";

import { useEffect } from "react";
import { finishGoogleDriveSignIn } from "@/lib/google-drive";

/**
 * Where Google sends people back after signing in for "Import from Google
 * Drive" (lib/google-drive.ts). The token is in the address's #fragment,
 * which never reaches our server; this page hands it to the Documents page
 * they started on and takes them straight back there.
 */
export default function GoogleDriveReturnPage() {
  useEffect(() => {
    const hash = window.location.hash;
    // Take the token out of the address bar and history first.
    window.history.replaceState(null, "", window.location.pathname);
    window.location.replace(finishGoogleDriveSignIn(hash, sessionStorage));
  }, []);

  return (
    <main className="auth-shell">
      <p className="card__meta" role="status">
        Returning to StrataCouncil…
      </p>
    </main>
  );
}
