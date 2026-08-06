// Renders a submitted questionnaire as the branded answers document.
import type { Answers, ClientRecord } from "../types";
import { buildSections } from "../questions";
import { fmtSize, parseAttachment, type AttachmentRef } from "../attachments";
import { esc, clientBlock, metaRow, shell, type Mode } from "./shell";

function answerHtml(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `<div class="empty">—</div>`;
    return `<ul class="ticks">${value.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`;
  }
  const text = (value ?? "").trim();
  if (!text) return `<div class="empty">—</div>`;
  return text.split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join("");
}

export function renderAnswers(
  client: ClientRecord,
  answers: Answers,
  submittedAt: string,
  mode: Mode = "pdf",
): string {
  const sections = buildSections(client);
  const body = sections
    .map((section) => {
      const fields = section.fields
        .map((f) => {
          let value = answers[f.id];
          if (f.type === "upload") {
            const refs = (Array.isArray(value) ? value : [])
              .map(parseAttachment)
              .filter((a): a is AttachmentRef => !!a);
            const list = refs.length
              ? `<ul class="ticks">${refs
                  .map(
                    (r) =>
                      `<li><a href="${esc(r.u)}" style="color:var(--a-text);text-decoration:none;border-bottom:1px solid var(--a-border)">${esc(r.n)}</a> <span style="color:var(--muted)">(${fmtSize(r.s)})</span></li>`,
                  )
                  .join("")}</ul>`
              : `<div class="empty">—</div>`;
            return `<div class="qa"><div class="q">${esc(f.label)}</div><div class="a">${list}</div></div>`;
          }
          if (f.type === "checks" && f.other) {
            const other = (answers[`${f.id}Other`] as string | undefined)?.trim();
            const list = Array.isArray(value) ? [...value] : [];
            if (other) list.push(`Other: ${other}`);
            value = list;
          }
          return `<div class="qa"><div class="q">${esc(f.label)}</div><div class="a">${answerHtml(value)}</div></div>`;
        })
        .join("");
      return `<div class="section"><div class="sec-k">${esc(section.eyebrow)}</div><div class="sec-h">${esc(section.title)}</div>${fields}</div>`;
    })
    .join("");

  return shell({
    mode,
    title: `Questionnaire answers — ${client.company}`,
    docTitle: "Questionnaire",
    pill: "Submitted response",
    metaLeft: clientBlock(client),
    metaRightRows: [
      metaRow("Document no.", `LUM-QST-${client.docNoBase}`, true),
      metaRow("Project", client.projectLabel),
      metaRow("Submitted", submittedAt, true),
      metaRow("Prepared by", "Luminary Studio"),
    ],
    body,
  });
}
