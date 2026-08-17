// Document read-receipts: when a CLIENT opens a published document on their
// portal, we stamp the time. Kept in a single state map ({slug: {docKey: ISO}})
// separate from the client record so a public GET never races operator edits
// of the record. Best-effort; a failed stamp just means no receipt this time.
import { readState, writeState } from "./store";

const PATH = "doc_views.json";
const THROTTLE_MS = 15 * 60 * 1000; // don't rewrite more than once per 15 min

type ViewMap = Record<string, Record<string, string>>;

/** { docKey: lastOpenedISO } for one client. */
export async function getDocViews(slug: string): Promise<Record<string, string>> {
  try {
    const map = (await readState<ViewMap>(PATH)) ?? {};
    return map[slug] ?? {};
  } catch {
    return {};
  }
}

/** Stamp a client view of one document (throttled, best-effort). */
export async function markDocView(slug: string, docKey: string): Promise<void> {
  try {
    const map = (await readState<ViewMap>(PATH)) ?? {};
    const prev = map[slug]?.[docKey];
    if (prev && Date.now() - Date.parse(prev) < THROTTLE_MS) return; // seen very recently
    map[slug] = { ...(map[slug] ?? {}), [docKey]: new Date().toISOString() };
    await writeState(PATH, map);
  } catch (e) {
    console.error("Doc view stamp failed:", e);
  }
}
