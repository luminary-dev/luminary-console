// Language switching for the questionnaire. The English strings stay where
// they always were (lib/questions.ts builds the schema, the form owns its
// chrome); this module is the thin layer that swaps them for the Sinhala in
// lib/questions.si.ts. Everything here is pure, so the toggle is instant and
// answers — which are stored under field IDs, never labels — are untouched.
import type { Field, Section } from "./questions";
import { SI_FIELDS, SI_OPTIONS, SI_SECTIONS, SI_UI, si, type UIStrings } from "./questions.si";

export type Lang = "en" | "si";

export const LANG_KEY = "luminary-questionnaire-lang";

export type { UIStrings };

export const EN_UI: UIStrings = {
  langLabel: "Language",
  langNote:
    "A few questions written specially for your project appear in English only — answer them in whichever language you prefer.",

  tagline: "Full-Service Digital Studio",
  docTitle: "Questionnaire",
  pill: "Project discovery",
  preparedFor: "Prepared for",
  regNo: "Reg. No",
  docNo: "Document no.",
  project: "Project",
  preparedBy: "Prepared by",
  studio: "Luminary Studio",

  howToTitle: "How this works:",
  howTo1:
    "answer below and press Submit — your answers come straight to our studio, no printing or emailing needed. Logos, photos, screenshots and documents can be attached right in the form where you see an Attach files button. This form is thorough on purpose: every answer saves a revision round later. Skip anything you're unsure of and we'll cover it on the kickoff call.",
  howTo2: "Takes 25–30 minutes — worth every one of them.",

  other: "Other:",
  attach: "+ Attach files",
  attachMore: "+ Attach more files",
  uploading: (n: number) => `Uploading ${n} file${n > 1 ? "s" : ""}…`,
  fileNote: "Any file type · up to 15 MB each",
  removeFile: (name: string) => `Remove ${name}`,

  copyLabel: "Email a copy of my answers (PDF) to me / my team",
  copyTo: "Send the copy to",
  copyHint: "One or more email addresses, separated by commas.",

  submitNote:
    "Pressing submit sends your answers directly to Luminary Studio as a PDF. Nothing is published anywhere.",
  submit: "Submit questionnaire",
  sending: "Sending…",

  doneTitle: "Thank you — we've got it.",
  doneBody:
    "Your answers — and every file you attached — are with the studio as a PDF. We'll review them and come back within one business day with the confirmed scope and fixed quotation. Anything you forgot to attach can be emailed to ",
  doneBodyEnd: " any time.",
  doneCopy1: "A copy of your answers is on its way to ",
  doneCopy2: " — check the inbox (and spam, the first time).",

  draftRestored:
    "Your earlier answers were brought back from this device. Nothing has been sent yet.",
  draftKeep: "Keep them",
  draftDiscard: "Start fresh",

  errName: "Please tell us your name (first question) so we know who to reply to.",
  errRequired: "These starred questions still need an answer: ",
  errCopy: "You asked for a copy — please enter at least one valid email address for it.",
  errGeneric: "Something went wrong.",
  errSuffix:
    " Your answers are still here — please try again, or email us at support@luminary-dev.xyz.",

  footNote:
    "Your answers are sent privately to Luminary Studio and used only to scope and design your project.",
};

export const strings = (lang: Lang): UIStrings => (lang === "si" ? SI_UI : EN_UI);

export type SectionText = { eyebrow: string; title: string; sub?: string };

export function sectionText(section: Section, lang: Lang, co: string): SectionText {
  const en: SectionText = {
    eyebrow: section.eyebrow,
    title: section.title,
    ...(section.sub !== undefined ? { sub: section.sub } : {}),
  };
  if (lang !== "si") return en;
  const t = SI_SECTIONS[section.id];
  if (!t) return en;
  const sub = t.sub ? si(t.sub, co) : section.sub;
  return {
    eyebrow: si(t.eyebrow, co),
    title: si(t.title, co),
    ...(sub !== undefined ? { sub } : {}),
  };
}

export type FieldText = { label: string; hint?: string; placeholder?: string };

/** Sinhala for a base-schema field; Claude's "extra_N" questions have no
 *  entry and fall through to their generated English. */
export function fieldText(field: Field, lang: Lang, co: string): FieldText {
  const enPlaceholder = "placeholder" in field ? field.placeholder : undefined;
  const en: FieldText = {
    label: field.label,
    ...(field.hint !== undefined ? { hint: field.hint } : {}),
    ...(enPlaceholder !== undefined ? { placeholder: enPlaceholder } : {}),
  };
  if (lang !== "si") return en;
  const t = SI_FIELDS[field.id];
  if (!t) return en;
  const hint = t.hint ? si(t.hint, co) : en.hint;
  const placeholder = t.placeholder ? si(t.placeholder, co) : en.placeholder;
  return {
    label: t.label ? si(t.label, co) : en.label,
    ...(hint !== undefined ? { hint } : {}),
    ...(placeholder !== undefined ? { placeholder } : {}),
  };
}

/** Checkbox option text. The VALUE stored in the answers is always the
 *  English option — only the visible label changes, so a Sinhala submission
 *  and an English one produce identical data for the document pipeline. */
export const optionText = (option: string, lang: Lang): string =>
  lang === "si" ? (SI_OPTIONS[option] ?? option) : option;

/** True when this section carries at least one generated (English-only)
 *  question, so the form can note that once, where it applies. */
export const hasExtras = (section: Section): boolean =>
  section.fields.some((f) => f.id.startsWith("extra_"));
