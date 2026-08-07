"use client";

// Owns the questionnaire's language. Everything a Sinhala reader sees —
// document head, "how this works", the form itself, the footer note — lives
// under this one component so a single toggle switches the whole page
// instantly with no reload and no round trip.
//
// The choice is remembered in localStorage. It is read in an effect rather
// than during render because the server has no access to it: rendering
// Sinhala straight away would be a hydration mismatch. The result is a
// single frame of English for returning Sinhala readers, which is the
// cheapest correct trade-off available here.
import { useEffect, useState } from "react";
import QuestionnaireForm from "./QuestionnaireForm";
import ThemeToggle from "./ThemeToggle";
import type { Section } from "@/lib/questions";
import { LANG_KEY, strings, type Lang } from "@/lib/questions.i18n";

export type SheetClient = {
  slug: string;
  company: string;
  reg?: string;
  address?: string;
  email?: string;
  phone?: string;
  docNoBase: string;
  projectLabel: string;
  /** Short company name for the {co} slot in translated labels. */
  co: string;
};

export default function QuestionnaireSheet({
  client,
  sections,
}: {
  client: SheetClient;
  sections: Section[];
}) {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    try {
      if (localStorage.getItem(LANG_KEY) === "si") setLang("si");
    } catch {
      /* private mode / blocked storage — English is a fine default */
    }
  }, []);

  const pick = (next: Lang) => {
    setLang(next);
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* the choice just won't survive the visit */
    }
  };

  const t = strings(lang);

  return (
    <main className="sheet" lang={lang === "si" ? "si" : "en"}>
      <div className="sheet-top">
        <div className="lang-switch" role="group" aria-label={t.langLabel}>
          <button
            type="button"
            className={`lang-btn${lang === "en" ? " on" : ""}`}
            aria-pressed={lang === "en"}
            onClick={() => pick("en")}
          >
            English
          </button>
          <button
            type="button"
            className={`lang-btn${lang === "si" ? " on" : ""}`}
            aria-pressed={lang === "si"}
            onClick={() => pick("si")}
            lang="si"
          >
            සිංහල
          </button>
        </div>
        <ThemeToggle />
      </div>

      <div className="doc-head">
        <div>
          <div className="brand" style={{ fontSize: 26 }}>
            Luminary<span>.</span>
          </div>
          <div className="k" style={{ marginTop: 8, letterSpacing: ".16em" }}>
            {t.tagline}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="doc-title">{t.docTitle}</div>
          <div style={{ marginTop: 10 }}>
            <span className="pill">
              <i />
              {t.pill}
            </span>
          </div>
        </div>
      </div>

      <div className="meta-grid">
        <div>
          <div className="k" style={{ marginBottom: 10 }}>{t.preparedFor}</div>
          <div className="meta-name">{client.company}</div>
          <div className="meta-detail">
            {client.reg && <>{t.regNo}: {client.reg}<br /></>}
            {client.address && <>{client.address}<br /></>}
            {client.email && <>{client.email}<br /></>}
            {client.phone}
          </div>
        </div>
        <div className="meta-rows">
          <div className="meta-row"><span>{t.docNo}</span><span className="mono">LUM-QST-{client.docNoBase}</span></div>
          <div className="meta-row"><span>{t.project}</span><span>{client.projectLabel}</span></div>
          <div className="meta-row"><span>{t.preparedBy}</span><span>{t.studio}</span></div>
        </div>
      </div>

      <div className="howto">
        <strong>{t.howToTitle}</strong>
        <p>{t.howTo1}</p>
        <p style={{ color: "var(--muted)" }}>{t.howTo2}</p>
      </div>

      <QuestionnaireForm slug={client.slug} sections={sections} lang={lang} co={client.co} />

      <div className="foot">
        <div className="foot-links">
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>
          <i />
          <a href="tel:+94771618093">+94 77 16 18 093</a>
          <i />
          <a href="https://luminary-dev.xyz">luminary-dev.xyz</a>
        </div>
        <div className="foot-note">{t.footNote}</div>
      </div>
    </main>
  );
}
