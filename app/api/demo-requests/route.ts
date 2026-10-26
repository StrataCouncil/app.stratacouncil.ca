import { NextResponse, type NextRequest } from "next/server";
import { submitDemoRequest } from "@/lib/demo-requests-server";

/**
 * "Request a demo" from stratacouncil.ca (0067): the marketing site's
 * server posts the form here as JSON and shows what comes back. The request
 * is saved for the console's Demo tab and staff get a notice
 * (lib/demo-requests-server.ts).
 */
export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > 4000) return NextResponse.json({ status: "error", message: "Too long." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ status: "error", message: "Bad request." }, { status: 400 });
  }
  const result = await submitDemoRequest(body);
  return NextResponse.json(result);
}
