// Client-site landing: a small branded hub linking whatever is published.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { DOC_LABELS, type DocType } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  return { title: client ? `Client portal · ${client.company}` : "Client portal" };
}

export default async function ClientHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();

  const published = (Object.keys(client.docs) as DocType[]).filter(
    (t) => client.docs[t]?.status === "published",
  );

  return (
    <main className="sheet sheet--narrow">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <ThemeToggle />
      </div>
      <div className="brand" style={{ fontSize: 26 }}>
        Luminary<span>.</span>
      </div>
      <div className="k" style={{ marginTop: 8, letterSpacing: ".16em" }}>
        Client portal — {client.company}
      </div>
      <div className="card" style={{ marginTop: 24 }}>
        <h3>Your documents</h3>
        <div className="portal-links">
          <Link className="portal-link" href="/questionnaire">
            <span>Project questionnaire</span>
            <span className="no">→</span>
          </Link>
          {published.map((t) => (
            <Link className="portal-link" key={t} href={`/${t}`}>
              <span>{DOC_LABELS[t]}</span>
              <span className="no">{client.docs[t]!.no} →</span>
            </Link>
          ))}
          {(client.billing ?? [])
            .filter((b) => b.status === "published")
            .map((b) => (
              <Link className="portal-link" key={b.slug} href={`/${b.slug}`}>
                <span>{b.stage === "advance" ? "Advance " : b.stage === "final" ? "Final " : ""}{DOC_LABELS[b.kind]}</span>
                <span className="no">{b.no} →</span>
              </Link>
            ))}
        </div>
      </div>
      <div className="foot">
        <div className="foot-links">
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>
          <i />
          <a href="https://luminary-dev.xyz">luminary-dev.xyz</a>
        </div>
      </div>
    </main>
  );
}
