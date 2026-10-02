import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Civic address suggestions for the strata creation form. BC addresses
 * come from the Province's own BC Address Geocoder (free, no key,
 * authoritative); other provinces from Photon (OpenStreetMap), limited
 * to Canada. Proxied here so the form doesn't depend on either service's
 * browser policies, and only for signed-in users.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ suggestions: [] }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 200);
  const jurisdiction = request.nextUrl.searchParams.get("jurisdiction") ?? "BC";
  if (q.length < 4) return NextResponse.json({ suggestions: [] });

  try {
    const suggestions = jurisdiction === "BC" ? await bcGeocoder(q) : await photon(q, jurisdiction);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[address-search]", error instanceof Error ? error.message : error);
    return NextResponse.json({ suggestions: [], unavailable: true });
  }
}

async function getJson(url: string) {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function bcGeocoder(q: string): Promise<string[]> {
  const url =
    "https://geocoder.api.gov.bc.ca/addresses.json?" +
    new URLSearchParams({
      addressString: q,
      autoComplete: "true",
      maxResults: "6",
      minScore: "50",
      echo: "false",
      brief: "true",
      locationDescriptor: "any",
    });
  const data = (await getJson(url)) as { features?: { properties?: { fullAddress?: string; matchPrecision?: string } }[] };
  return unique(
    (data.features ?? [])
      // Civic addresses only: a street or locality match isn't an address.
      .filter((f) => ["CIVIC_NUMBER", "BLOCK", "SITE", "UNIT"].includes(f.properties?.matchPrecision ?? ""))
      .map((f) => f.properties?.fullAddress ?? "")
  );
}

const provinceNames: Record<string, string> = {
  AB: "Alberta", SK: "Saskatchewan", MB: "Manitoba", ON: "Ontario", QC: "Quebec", NB: "New Brunswick",
  NS: "Nova Scotia", PE: "Prince Edward Island", NL: "Newfoundland and Labrador", YT: "Yukon",
  NT: "Northwest Territories", NU: "Nunavut",
};

async function photon(q: string, jurisdiction: string): Promise<string[]> {
  const url =
    "https://photon.komoot.io/api/?" +
    new URLSearchParams({ q, limit: "8", lang: "en", bbox: "-141.0,41.7,-52.6,83.1", layer: "house" });
  const data = (await getJson(url)) as {
    features?: { properties?: Record<string, string> }[];
  };
  const province = provinceNames[jurisdiction];
  return unique(
    (data.features ?? [])
      .map((f) => f.properties ?? {})
      .filter((p) => p.countrycode === "CA" && p.housenumber && p.street && (!province || p.state === province))
      .map((p) => [`${p.housenumber} ${p.street}`, p.city ?? p.town ?? p.village, p.state, p.postcode].filter(Boolean).join(", "))
  );
}

function unique(list: string[]) {
  return [...new Set(list.filter(Boolean))].slice(0, 6);
}
