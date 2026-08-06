// Public questionnaire-attachment upload. Files go straight to Blob under
// the client's attachments folder; the returned ref is embedded in the
// answers payload and re-validated (URL must point back here) at submit
// time. Any file type is accepted — the studio opens these, clients never
// serve them to each other — but HTML-ish types are stored as octet-stream
// so the blob host never renders markup.
import { NextResponse } from "next/server";
import { getClient, putAsset } from "@/lib/store";
import { MAX_FILE_BYTES } from "@/lib/attachments";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file received." }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file looks empty — please try another." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "Files can be up to 15 MB each — please compress it, or email it to support@luminary-dev.xyz instead." },
      { status: 400 },
    );
  }

  const name = (file.name || "attachment").replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120) || "attachment";
  const type = file.type && !/html|javascript|xml/i.test(file.type) ? file.type : "application/octet-stream";
  const url = await putAsset(
    `clients/${slug}/attachments/${name}`,
    Buffer.from(await file.arrayBuffer()),
    type,
  );
  return NextResponse.json({ name, url, size: file.size });
}
