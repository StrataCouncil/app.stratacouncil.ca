/**
 * Strata management details (0024): the company that manages the strata,
 * printed as a letterhead on agendas and minutes. Shared by the
 * Management tab, its actions and the exports.
 */
export interface ManagerContact {
  name: string;
  title: string;
  phone: string;
  email: string;
}

export interface ManagementDetails {
  companyName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  managers: ManagerContact[];
  logoPath: string | null;
}

export const MAX_MANAGERS = 6;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg"] as const;

export function emptyManagement(): ManagementDetails {
  return { companyName: "", address: "", phone: "", email: "", website: "", managers: [], logoPath: null };
}

export function hasManagement(m: ManagementDetails | null): m is ManagementDetails {
  return Boolean(m && (m.companyName.trim() || m.logoPath || m.managers.some((x) => x.name.trim())));
}

/**
 * The letterhead as lines of text, under the logo:
 *   Company name
 *   Address
 *   phone · email · website
 *   Manager name, Title · phone · email   (one per manager)
 */
export function letterheadLines(m: ManagementDetails): { text: string; bold?: boolean }[] {
  const lines: { text: string; bold?: boolean }[] = [];
  if (m.companyName.trim()) lines.push({ text: m.companyName.trim(), bold: true });
  if (m.address.trim()) lines.push({ text: m.address.trim() });
  const contact = [m.phone, m.email, m.website].map((s) => s.trim()).filter(Boolean).join(" · ");
  if (contact) lines.push({ text: contact });
  for (const x of m.managers) {
    if (!x.name.trim()) continue;
    const who = x.title.trim() ? `${x.name.trim()}, ${x.title.trim()}` : x.name.trim();
    lines.push({ text: [who, x.phone.trim(), x.email.trim()].filter(Boolean).join(" · ") });
  }
  return lines;
}

/** Width and height of a PNG or JPEG, read from its header; null if it's neither. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; type: "png" | "jpg" } | null {
  // PNG: signature, then IHDR width and height (big-endian) at bytes 16-23.
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), type: "png" };
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], type: "jpg" };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Scale (width, height) to fit inside a box, keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / width, maxH / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
