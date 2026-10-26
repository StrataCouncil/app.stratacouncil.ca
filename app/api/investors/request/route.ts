import { NextResponse, type NextRequest } from "next/server";
import { signUpInvestor } from "@/lib/investors/signup";

/**
 * The investor briefing sign-up from stratacouncil.ca's home page: the
 * marketing site's server posts the form here as JSON and shows what comes
 * back. Same rules as the sign-up page (lib/investors/signup.ts): name,
 * email, the disclaimer and the accredited confirmation, three links an
 * hour per email, the hidden bot field.
 */
export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > 4000) return NextResponse.json({ status: "error", message: "Too long." }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ status: "error", message: "Bad request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ status: "error", message: "Bad request." }, { status: 400 });
  const result = await signUpInvestor({
    name: body.name,
    email: body.email,
    disclaimer: body.disclaimer === true,
    accredited: body.accredited === true,
    website: body.website,
    ref: body.ref,
  });
  return NextResponse.json({ status: result.status, message: result.message, email: result.email });
}
