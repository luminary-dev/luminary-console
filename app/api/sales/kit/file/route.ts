// One picture from the social kit, handed through the console's own origin.
//
// Two reasons it is not simply an <img> pointing at the kit site: the
// console's CSP allows images from 'self' only, and a download link is honoured
// only same-origin. This is not an open proxy: the host is fixed by
// configuration and the path must look like a picture inside the kit's out/
// folder (lib/kit.isKitFile), so nothing else can be fetched through it.
import { NextResponse } from "next/server";
import { fetchKitFile, isKitFile } from "@/lib/kit";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path") ?? "";
  if (!isKitFile(path)) return NextResponse.json({ error: "Not a kit picture." }, { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetchKitFile(path);
  } catch {
    return NextResponse.json({ error: "The kit site could not be reached." }, { status: 502 });
  }
  if (upstream.status === 404) return NextResponse.json({ error: "No such picture in the kit." }, { status: 404 });
  const type = upstream.headers.get("content-type") ?? "";
  // A redirect is the kit site asking for a login; anything that is not an
  // image is not something to pass on under the console's name.
  if (!upstream.ok || !type.startsWith("image/") || !upstream.body) {
    return NextResponse.json({ error: "The kit site did not return a picture." }, { status: 502 });
  }

  const name = path.split("/").pop() ?? "picture";
  const headers = new Headers({
    "Content-Type": type,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  const length = upstream.headers.get("content-length");
  if (length) headers.set("Content-Length", length);
  if (url.searchParams.get("dl") === "1") headers.set("Content-Disposition", `attachment; filename="${name}"`);
  return new NextResponse(upstream.body, { status: 200, headers });
}
