"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

export interface ExportItem {
  title: string;
  fileName: string | null;
  folder: string;
  kind: string;
  url: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  downloadUrl: string | null;
}

const KIND: Record<string, string> = {
  upload: "Upload",
  minutes: "Minutes",
  historic_minutes: "Historic minutes",
  agenda_attachment: "Agenda attachment",
  link: "Web link",
  strata_plan: "Strata plan",
};

const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "Untitled";
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;

/**
 * Builds the "Download everything" ZIP in the browser (0062): a folder per
 * document folder, every file in it, and index.csv listing everything
 * (web links included). Starts on its own; nothing is kept on our side.
 */
export function DocumentExport({ corpId, strataName, items }: { corpId: string; strataName: string; items: ExportItem[] }) {
  const [status, setStatus] = useState("Preparing…");
  const [done, setDone] = useState<{ href: string; name: string; missing: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const { default: JSZip } = await import("jszip");
        const zip = new JSZip();
        const date = new Date().toISOString().slice(0, 10);
        const root = safe(`${corpId} ${strataName} documents ${date}`);
        const used = new Set<string>();
        const missing: string[] = [];
        const index: string[][] = [["Title", "File", "Folder", "Type", "Uploaded", "Uploaded by", "Web link"]];
        const files = items.filter((i) => i.downloadUrl);

        let n = 0;
        for (const item of items) {
          let path = "";
          if (item.downloadUrl) {
            n++;
            setStatus(`Downloading ${n} of ${files.length}: ${item.fileName || item.title}`);
            const base = safe(item.fileName || item.title);
            const dot = base.lastIndexOf(".");
            let name = base;
            for (let k = 2; used.has(`${item.folder}/${name}`.toLowerCase()); k++) {
              name = dot > 0 ? `${base.slice(0, dot)} (${k})${base.slice(dot)}` : `${base} (${k})`;
            }
            used.add(`${item.folder}/${name}`.toLowerCase());
            try {
              const res = await fetch(item.downloadUrl);
              if (!res.ok) throw new Error(String(res.status));
              zip.file(`${root}/${safe(item.folder)}/${name}`, await res.blob());
              path = `${safe(item.folder)}/${name}`;
            } catch {
              missing.push(item.fileName || item.title);
            }
          }
          index.push([
            item.title,
            path,
            item.folder,
            KIND[item.kind] ?? item.kind,
            item.uploadedAt.slice(0, 10),
            item.uploadedBy ?? "",
            item.url ?? "",
          ]);
        }
        zip.file(`${root}/index.csv`, index.map((r) => r.map(csv).join(",")).join("\r\n"));

        setStatus("Making the ZIP file…");
        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }, (m) =>
          setStatus(`Making the ZIP file… ${Math.round(m.percent)}%`)
        );
        const href = URL.createObjectURL(blob);
        const name = `${root}.zip`;
        setDone({ href, name, missing });
        const a = document.createElement("a");
        a.href = href;
        a.download = name;
        a.click();
      } catch {
        setError("The download didn't finish. Ask for a new link with Download everything on the Documents page.");
      }
    })();
  }, [corpId, strataName, items]);

  return (
    <div className="card" style={{ maxWidth: 640 }} data-testid="document-export">
      <h2>Download everything</h2>
      <p className="card__meta" style={{ margin: "0.5rem 0 1rem" }}>
        {items.length} document{items.length === 1 ? "" : "s"} from {strataName}, in one ZIP file with a folder for each
        document folder and an index of everything (index.csv). Please keep this page open until it finishes.
      </p>
      {error ? (
        <p className="form-alert" role="alert">
          {error}
        </p>
      ) : done ? (
        <div role="status" data-testid="document-export-done">
          <p>Your download has started. If it didn&rsquo;t, use the button below.</p>
          <p style={{ margin: "0.75rem 0" }}>
            <a className="button button-primary" href={done.href} download={done.name}>
              Save the ZIP file
            </a>
          </p>
          {done.missing.length > 0 && (
            <p className="form-alert">
              {done.missing.length} file{done.missing.length === 1 ? "" : "s"} couldn&rsquo;t be included: {done.missing.join(", ")}. They are listed in index.csv.
            </p>
          )}
        </div>
      ) : (
        <p className="card__meta" role="status">
          {status}
        </p>
      )}
      <p style={{ marginTop: "1rem" }}>
        <Link href={`/strata/${corpId}/documents`}>&larr; Back to Documents</Link>
      </p>
    </div>
  );
}
