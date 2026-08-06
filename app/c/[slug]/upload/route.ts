// Questionnaire-attachment uploads go browser → Blob directly (client
// upload), because routed-through-the-function bodies hit Vercel's 4.5 MB
// limit — a phone photo wouldn't fit. This route only signs the upload
// token, pinned to THIS client's attachments folder with a 15 MB cap;
// submit re-validates every ref's URL against the same folder. HTML-ish
// content types are refused so the blob host never renders markup.
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getClient } from "@/lib/store";
import { MAX_FILE_BYTES } from "@/lib/attachments";
import { rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const limited = rateLimit(req, "upload");
  if (limited) return limited;

  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (
          !pathname.startsWith(`console/clients/${slug}/attachments/`) ||
          !/^console\/clients\/[a-z0-9-]+\/attachments\/[\w.\- ()[\]]{1,120}$/.test(pathname)
        ) {
          throw new Error("Invalid upload path.");
        }
        return {
          addRandomSuffix: true,
          maximumSizeInBytes: MAX_FILE_BYTES,
          // Everything real-world (Office, PDF, images, zips) fits these; the
          // form maps anything odd to octet-stream. text/html stays excluded.
          allowedContentTypes: [
            "image/*",
            "video/*",
            "audio/*",
            "font/*",
            "application/*",
            "text/plain",
            "text/csv",
            "text/markdown",
            "text/rtf",
          ],
        };
      },
      // Refs reach us inside the submitted answers; nothing to do per-file.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(json);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed." },
      { status: 400 },
    );
  }
}
