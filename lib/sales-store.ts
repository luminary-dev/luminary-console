// Where the sales board lives in the store: two state files.
//
//   state/sales/leads.json     the researched shops, replaced whole by an import
//   state/sales/progress.json  one record per shop id, shared by the team
//
// The shop list is NOT in this repository, and must not be: the repository is
// public and the list holds other people's business names and phone numbers
// with our notes on them. It is imported through the console instead
// (POST /api/sales/leads) and lives only in the bucket.
//
// Progress is one object rather than one object per shop because it is read
// whole on every page and written a few times a minute at most, by three
// people. Every write is a compare-and-swap (updateState), so two operators
// tapping at the same moment both land, and the second one is checked against
// what the first one just stored.
import { readState, updateState, writeState } from "./store";
import type { Lead, Progress, ProgressMap } from "./sales";

const LEADS_PATH = "sales/leads.json";
const PROGRESS_PATH = "sales/progress.json";

export type LeadFile = {
  /** ISO time of the last import, and who ran it. */
  importedAt: string;
  importedBy: string;
  leads: Lead[];
};

export type SalesState = { leads: Lead[]; importedAt: string | null; importedBy: string | null; progress: ProgressMap };

export async function getLeadFile(): Promise<LeadFile | null> {
  const file = await readState<LeadFile>(LEADS_PATH);
  return file && Array.isArray(file.leads) ? file : null;
}

/** Replace the shop list. Progress is keyed by shop id and is left alone, so
 *  re-importing a longer list keeps everything already recorded. */
export async function saveLeads(leads: Lead[], by: string): Promise<LeadFile> {
  const file: LeadFile = { importedAt: new Date().toISOString(), importedBy: by, leads };
  await writeState(LEADS_PATH, file);
  return file;
}

export async function getProgress(): Promise<ProgressMap> {
  const map = await readState<ProgressMap>(PROGRESS_PATH);
  return map && typeof map === "object" && !Array.isArray(map) ? map : {};
}

/** Everything a sales page needs, in two parallel reads. */
export async function getSalesState(): Promise<SalesState> {
  const [file, progress] = await Promise.all([getLeadFile(), getProgress()]);
  return {
    leads: file?.leads ?? [],
    importedAt: file?.importedAt ?? null,
    importedBy: file?.importedBy ?? null,
    progress,
  };
}

/** Change one shop's record atomically. `mutate` gets the record as it is
 *  stored right now (undefined if the shop has none yet) and returns the
 *  replacement; it can run more than once, so it must be pure, and it may
 *  throw to refuse the change. Returns the record that was written. */
export async function updateProgress(
  id: string,
  mutate: (current: Progress | undefined) => Progress,
): Promise<Progress> {
  let written: Progress | null = null;
  await updateState<ProgressMap>(PROGRESS_PATH, (current) => {
    const map = current && typeof current === "object" && !Array.isArray(current) ? current : {};
    written = mutate(map[id]);
    return { ...map, [id]: written };
  });
  // updateState either returns after a successful write, in which case mutate
  // ran and set this, or throws.
  return written as unknown as Progress;
}
