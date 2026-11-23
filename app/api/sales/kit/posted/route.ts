// Tick or untick "this post is up" for one platform. Shared by the team, so
// two people do not post the same picture, and attributed, so it is clear who
// did. The post must exist in the kit as it is now: a tick for a post nobody
// can see would just be a stray key in the store.
import { NextResponse } from "next/server";
import { CHANNELS, fetchKit, setPosted, type KitChannel } from "@/lib/kit";
import { currentOperator } from "@/lib/operator";
import { StoreConflictError } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { id?: unknown; channel?: unknown; posted?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  const channel = CHANNELS.find((c) => c === body?.channel) as KitChannel | undefined;
  if (!id || !channel || typeof body?.posted !== "boolean") {
    return NextResponse.json({ error: "Unknown request." }, { status: 400 });
  }

  const kit = await fetchKit();
  if (!kit.ok) return NextResponse.json({ error: kit.reason }, { status: 502 });
  if (!kit.kit.posts.some((p) => p.id === id)) {
    return NextResponse.json({ error: "That post is not in the kit." }, { status: 404 });
  }

  try {
    const marks = await setPosted(id, channel, body.posted, await currentOperator());
    return NextResponse.json({ ok: true, id, marks });
  } catch (e) {
    if (e instanceof StoreConflictError) {
      return NextResponse.json(
        { error: "Someone else was ticking posts at the same moment. Please try again." },
        { status: 409 },
      );
    }
    throw e;
  }
}
