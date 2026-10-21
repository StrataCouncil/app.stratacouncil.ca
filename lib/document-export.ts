import { createHash } from "node:crypto";

/** "Download everything" (0062): only a hash of each emailed link's token is kept. */
export const hashExportToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Link lifetime: once, within 24 hours. */
export const EXPORT_LINK_HOURS = 24;
