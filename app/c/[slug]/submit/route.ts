// Public questionnaire submission. Validates against the client's schema,
// stores answers, renders the branded answers PDF, emails studio (+ optional
// client copy) — then kicks off stage-2 drafting AFTER the response, so the
// client isn't kept waiting on Claude.
import { NextResponse, after } from "next/server";
import { getClient, putAsset, saveClient } from "@/lib/store";
import { buildSections, validIds } from "@/lib/questions";
import { renderAnswers } from "@/lib/templates/answers";
import { renderPdf } from "@/lib/pdf";
import { emailStudio, emailAddresses } from "@/lib/email";
import { nowLabel, runStage2 } from "@/lib/pipeline";
import { logActivity } from "@/lib/activity";
import { esc } from "@/lib/templates/shell";
import {
  MAX_FILES_PER_FIELD,
  fmtSize,
  isOwnAttachmentUrl,
  parseAttachment,
  type AttachmentRef,
} from "@/lib/attachments";
import type { Answers, Attachment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Unknown client." }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // Honeypot → pretend success.
  if (typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const ids = validIds(client);
  const uploadIds = new Set(
    buildSections(client).flatMap((s) => s.fields.filter((f) => f.type === "upload").map((f) => f.id)),
  );
  const answers: Answers = {};
  const attachments: Attachment[] = [];
  if (body.answers && typeof body.answers === "object") {
    for (const [k, v] of Object.entries(body.answers as Record<string, unknown>)) {
      if (!ids.has(k)) continue;
      if (uploadIds.has(k)) {
        // Upload fields carry JSON-encoded refs; only refs pointing back into
        // this client's own attachments folder survive.
        if (!Array.isArray(v)) continue;
        const refs = v
          .slice(0, MAX_FILES_PER_FIELD)
          .map(parseAttachment)
          .filter((a): a is AttachmentRef => !!a && isOwnAttachmentUrl(a.u, slug));
        answers[k] = refs.map((a) => JSON.stringify(a));
        attachments.push(...refs.map((a) => ({ name: a.n, url: a.u, size: a.s })));
      } else if (typeof v === "string") answers[k] = v.slice(0, 8000);
      else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
        answers[k] = v.slice(0, 40).map((x) => x.slice(0, 300));
      }
    }
  }
  const contactName = typeof answers.contactName === "string" ? answers.contactName.trim() : "";
  if (!contactName) {
    return NextResponse.json({ error: "Please fill in your name before submitting." }, { status: 400 });
  }

  const copyTo =
    body.sendCopy === true && typeof body.copyEmails === "string"
      ? body.copyEmails.split(/[,;\s]+/).map((e: string) => e.trim()).filter((e: string) => EMAIL_RE.test(e)).slice(0, 5)
      : [];
  if (body.sendCopy === true && copyTo.length === 0) {
    return NextResponse.json({ error: "Please enter a valid email address for your copy." }, { status: 400 });
  }

  try {
    const prevAnswers =
      !client.submissions && client.answersAt && client.answersUrl && client.answersPdfUrl
        ? { at: client.answersAt, by: client.answersBy ?? "—", answersUrl: client.answersUrl, pdfUrl: client.answersPdfUrl }
        : null;
    const submittedAt = nowLabel();
    const pdf = await renderPdf(renderAnswers(client, answers, submittedAt));
    const answersUrl = await putAsset(`clients/${slug}/answers.json`, JSON.stringify(answers), "application/json");
    const answersPdfUrl = await putAsset(`clients/${slug}/answers.pdf`, pdf, "application/pdf");

    client.answersUrl = answersUrl;
    client.answersPdfUrl = answersPdfUrl;
    client.answersAt = submittedAt;
    client.answersBy = contactName;
    // Seed the history with the pre-history submission if this record predates
    // the submissions field.
    const history =
      client.submissions ??
      (prevAnswers
        ? [prevAnswers]
        : []);
    client.submissions = [
      ...history,
      {
        at: submittedAt,
        by: contactName,
        answersUrl,
        pdfUrl: answersPdfUrl,
        ...(attachments.length ? { attachments } : {}),
      },
    ];
    if (client.status === "created") client.status = "answers_in";
    await saveClient(client);
    const submissionNo = client.submissions.length;
    await logActivity(contactName, "submitted questionnaire", slug, `submission #${submissionNo}`);
    // Auto-draft only while no drafts exist — later submissions must never
    // clobber documents the studio may have revised or published.
    const willDraft = !client.docs.quotation && !client.docs.proposal && !client.docs.contract;

    const filename = `Questionnaire - ${client.company} - LUM-QST-${client.docNoBase}.pdf`;
    const contactEmail = typeof answers.contactEmail === "string" ? answers.contactEmail.trim() : "";

    const attachmentsHtml = attachments.length
      ? `<p><strong>${attachments.length} file${attachments.length > 1 ? "s" : ""} attached by the client:</strong></p>
<ul>${attachments.map((a) => `<li><a href="${esc(a.url)}">${esc(a.name)}</a> (${fmtSize(a.size)})</li>`).join("")}</ul>`
      : "";

    await emailStudio(
      `Questionnaire submitted — ${client.company}${submissionNo > 1 ? ` (submission #${submissionNo})` : ""}`,
      `<p><strong>${contactName}</strong> submitted the ${client.company} discovery questionnaire at ${submittedAt} (Colombo)${submissionNo > 1 ? ` — this is submission #${submissionNo} for this client` : ""}.</p>
${attachmentsHtml}<p>Full answers attached. ${
        willDraft
          ? "The quotation, proposal and contract are being drafted now — a second email lands when they're ready."
          : "Your existing quotation/proposal/contract were left untouched. To incorporate these new answers, use Revise on a document, or delete the drafts and press Draft now in the console."
      }</p>`,
      [{ filename, content: pdf }],
      contactEmail || undefined,
    );

    let copySent = false;
    if (copyTo.length > 0) {
      copySent = await emailAddresses(
        copyTo,
        `Your questionnaire answers — Luminary × ${client.company}`,
        `<p>Hi ${contactName},</p>
<p>Thanks for completing the project questionnaire — your answers are attached as a PDF for your records.</p>
<p>Our studio has the same document and will come back within one business day with the confirmed scope and fixed quotation. If you have logos, photos or inspiration screenshots to share, just reply to this email.</p>
<p>— Luminary Studio<br>support@luminary-dev.xyz · +94 77 16 18 093 · <a href="https://luminary-dev.xyz">luminary-dev.xyz</a></p>`,
        [{ filename, content: pdf }],
      );
    }

    // Stage 2 runs after the response is sent — the client sees the thank-you
    // immediately while Claude drafts in the background. Only for the first
    // submission; later ones must not overwrite reviewed documents.
    if (willDraft) {
      // Drafting sees file names, not raw JSON refs / blob URLs.
      const draftAnswers: Answers = { ...answers };
      for (const id of uploadIds) {
        const v = draftAnswers[id];
        if (Array.isArray(v)) {
          draftAnswers[id] = v
            .map(parseAttachment)
            .filter((a): a is AttachmentRef => !!a)
            .map((a) => `${a.n} (attached file)`);
        }
      }
      after(async () => {
        await runStage2(slug, draftAnswers, submittedAt);
      });
    }

    return NextResponse.json({ ok: true, copySent });
  } catch (e) {
    console.error("Submit failed:", e);
    return NextResponse.json(
      { error: "We couldn't process your answers just now. Please try again in a minute." },
      { status: 500 },
    );
  }
}
