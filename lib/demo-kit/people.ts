/**
 * The demo strata's people (all fictional): the 24 owners on the lot
 * roster, the five on council, the strata manager, and the new owner
 * asking to join. Pure.
 *
 * Lots go floor by floor: SL001-SL006 are units 101-106, SL007-SL012 are
 * 201-206, and so on. On each floor the corner homes (1 and 6) are two
 * bedrooms and den, 2 and 5 two bedrooms, 3 and 4 one bedroom.
 */

export const BUILDING = {
  name: "Larchwood Commons",
  address: "2150 Larchwood Crescent, Port Moody, BC V3H 0Z9",
  units: 24,
  built: 2009,
  description: "a four-storey wood-frame building over a concrete parkade, with one elevator, 24 homes, an amenity room, a small gym and a bike room",
};

export const MANAGEMENT = {
  companyName: "Harbourline Strata Management Ltd.",
  address: "Suite 210 - 3880 Harbourline Way, Burnaby, BC V5C 0A1",
  phone: "604-555-0142",
  email: "info@harbourline.example",
  website: "https://harbourline.example",
  manager: { name: "Dev Malhotra", title: "Strata Manager", phone: "604-555-0147", email: "dev.malhotra@harbourline.example" },
  assistant: { name: "Corinne Abbott", title: "Accounting Coordinator", phone: "604-555-0149", email: "accounts@harbourline.example" },
};

export type CouncilRole = "president" | "vice_president" | "treasurer" | "secretary" | "member_at_large";

/** People with accounts: shared by every visitor's strata (demo_cast). */
export interface CastMember {
  key: string;
  fullName: string;
  /** Fictional (example.com, harbourline.example) and never emailed: no one signs in to these accounts. */
  email: string;
  part: "council" | "manager" | "joiner";
  lot?: string;
  role?: CouncilRole;
}

export const CAST: CastMember[] = [
  { key: "margaret", fullName: "Margaret Chen-Whitford", email: "margaret.chen.whitford@example.com", part: "council", lot: "SL012", role: "president" },
  { key: "tomasz", fullName: "Tomasz Kowalczyk", email: "tomasz.kowalczyk@example.com", part: "council", lot: "SL005", role: "vice_president" },
  { key: "adaeze", fullName: "Adaeze Okafor", email: "adaeze.okafor@example.com", part: "council", lot: "SL019", role: "treasurer" },
  { key: "liam", fullName: "Liam Fraser", email: "liam.fraser@example.com", part: "council", lot: "SL008", role: "secretary" },
  { key: "ruth", fullName: "Ruth Gallagher", email: "ruth.gallagher@example.com", part: "council", lot: "SL022", role: "member_at_large" },
  { key: "dev", fullName: MANAGEMENT.manager.name, email: MANAGEMENT.manager.email, part: "manager" },
  { key: "marisol", fullName: "Marisol Ortega", email: "marisol.ortega@example.com", part: "joiner", lot: "SL017" },
];

export const council = () => CAST.filter((c) => c.part === "council");
export const castByKey = (key: string) => CAST.find((c) => c.key === key)!;

export type OwnerType = "owner_occupant" | "owner_absentee";

export interface Owner {
  lot: string;
  unit: string;
  name: string;
  type: OwnerType;
  bedrooms: "1 bedroom" | "2 bedrooms" | "2 bedrooms and den";
  entitlement: number;
  /** Monthly strata fee. */
  fee: number;
  parking: string;
  storage: string;
  bike: string | null;
}

/** Annual contributions to the operating fund and the contingency reserve fund (see the budget). */
export const ANNUAL_CONTRIBUTIONS = 142_848;
export const TOTAL_ENTITLEMENT = 1960;

const NAMES: Array<[string, OwnerType]> = [
  ["Harold and June Peterson", "owner_occupant"],
  ["Sung-min Park", "owner_absentee"],
  ["Fatima Haddad", "owner_occupant"],
  ["Bryce Whitaker", "owner_occupant"],
  ["Tomasz Kowalczyk", "owner_occupant"],
  ["Eleanor Vance", "owner_occupant"],
  ["Rajinder Sandhu", "owner_occupant"],
  ["Liam Fraser", "owner_occupant"],
  ["Chloé Tremblay", "owner_absentee"],
  ["Kwame Mensah", "owner_occupant"],
  ["Isabel Moreau", "owner_occupant"],
  ["Margaret Chen-Whitford", "owner_occupant"],
  ["Daniel Reyes", "owner_occupant"],
  ["Gregory Lindqvist", "owner_absentee"],
  ["Wen Li and Jun Li", "owner_occupant"],
  ["Nadia Petrova", "owner_occupant"],
  ["Marisol Ortega", "owner_occupant"],
  ["Aaron Goldberg", "owner_absentee"],
  ["Adaeze Okafor", "owner_occupant"],
  ["Mateo Silva", "owner_occupant"],
  ["Hiroshi Tanaka", "owner_occupant"],
  ["Ruth Gallagher", "owner_occupant"],
  ["Siobhan O'Neill", "owner_occupant"],
  ["Arjun Mehta", "owner_absentee"],
];

const BIKE_LOTS = new Set([3, 5, 8, 10, 13, 15, 17, 20, 21, 23]);

export const OWNERS: Owner[] = NAMES.map(([name, type], i) => {
  const lotNo = i + 1;
  const floor = Math.floor(i / 6) + 1;
  const position = (i % 6) + 1;
  const bedrooms = position === 1 || position === 6 ? "2 bedrooms and den" : position === 2 || position === 5 ? "2 bedrooms" : "1 bedroom";
  const entitlement = bedrooms === "2 bedrooms and den" ? 95 : bedrooms === "2 bedrooms" ? 85 : 65;
  const pad = String(lotNo).padStart(2, "0");
  return {
    lot: `SL${String(lotNo).padStart(3, "0")}`,
    unit: String(floor * 100 + position),
    name,
    type,
    bedrooms,
    entitlement,
    fee: Math.round((ANNUAL_CONTRIBUTIONS * entitlement * 100) / TOTAL_ENTITLEMENT / 12) / 100,
    parking: `P1-${pad}`,
    storage: `S-${pad}`,
    bike: BIKE_LOTS.has(lotNo) ? `B-${pad}` : null,
  };
});

export const ownerOf = (lot: string) => OWNERS.find((o) => o.lot === lot)!;

/** "first.last@example.com", for the roster's owner contact column. */
export function ownerEmail(name: string): string {
  // "Harold and June Peterson" -> harold.peterson; "Wen Li and Jun Li" -> wen.li
  const [first, ...others] = name.split(/ and /);
  const words = first.split(" ");
  const surname = words.length > 1 ? words.slice(1).join(" ") : (others.at(-1)?.split(" ").slice(1).join(" ") ?? "");
  const plain = `${words[0]} ${surname}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return `${plain.replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "")}@example.com`;
}

export const money = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$142,848" */
export const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
