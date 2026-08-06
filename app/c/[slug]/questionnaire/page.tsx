import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { buildSections } from "@/lib/questions";
import QuestionnaireForm from "@/components/QuestionnaireForm";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  return { title: client ? `Project questionnaire · ${client.company}` : "Questionnaire" };
}

export default async function QuestionnairePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();
  const sections = buildSections(client);

  return (
    <main className="sheet">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <ThemeToggle />
      </div>
      <div className="doc-head">
        <div>
          <div className="brand" style={{ fontSize: 26 }}>
            Luminary<span>.</span>
          </div>
          <div className="k" style={{ marginTop: 8, letterSpacing: ".16em" }}>
            Full-Service Digital Studio
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="doc-title">Questionnaire</div>
          <div style={{ marginTop: 10 }}>
            <span className="pill">
              <i />
              Project discovery
            </span>
          </div>
        </div>
      </div>

      <div className="meta-grid">
        <div>
          <div className="k" style={{ marginBottom: 10 }}>Prepared for</div>
          <div className="meta-name">{client.company}</div>
          <div className="meta-detail">
            {client.reg && <>Reg. No: {client.reg}<br /></>}
            {client.address && <>{client.address}<br /></>}
            {client.email && <>{client.email}<br /></>}
            {client.phone}
          </div>
        </div>
        <div className="meta-rows">
          <div className="meta-row"><span>Document no.</span><span className="mono">LUM-QST-{client.docNoBase}</span></div>
          <div className="meta-row"><span>Project</span><span>{client.projectLabel}</span></div>
          <div className="meta-row"><span>Prepared by</span><span>Luminary Studio</span></div>
        </div>
      </div>

      <div className="howto">
        <strong>How this works:</strong>
        <p>
          answer below and press <strong>Submit</strong> — your answers come straight to our studio,
          no printing or emailing needed. Logos, photos, screenshots and documents can be attached
          right in the form where you see an <strong>Attach files</strong> button.
          This form is thorough on purpose: every answer saves a revision round later. Skip anything
          you&apos;re unsure of and we&apos;ll cover it on the kickoff call.
        </p>
        <p style={{ color: "var(--muted)" }}>Takes 25–30 minutes — worth every one of them.</p>
      </div>

      <QuestionnaireForm sections={sections} />

      <div className="foot">
        <div className="foot-links">
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>
          <i />
          <a href="tel:+94771618093">+94 77 16 18 093</a>
          <i />
          <a href="https://luminary-dev.xyz">luminary-dev.xyz</a>
        </div>
        <div className="foot-note">
          Your answers are sent privately to Luminary Studio and used only to scope and design your
          project.
        </div>
      </div>
    </main>
  );
}
