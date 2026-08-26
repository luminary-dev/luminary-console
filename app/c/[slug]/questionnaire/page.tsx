import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { buildSections } from "@/lib/questions";
import QuestionnaireSheet from "@/components/QuestionnaireSheet";

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
  // Same derivation buildSections uses for its templated labels, so the
  // Sinhala "{co}" slot reads identically to the English one.
  const co = (client.company.split("(")[0] ?? "").trim().split(" ").slice(0, 2).join(" ");

  return (
    <QuestionnaireSheet
      sections={sections}
      client={{
        slug: client.slug,
        company: client.company,
        ...(client.reg !== undefined ? { reg: client.reg } : {}),
        ...(client.address !== undefined ? { address: client.address } : {}),
        ...(client.email !== undefined ? { email: client.email } : {}),
        ...(client.phone !== undefined ? { phone: client.phone } : {}),
        docNoBase: client.docNoBase,
        projectLabel: client.projectLabel,
        co,
      }}
    />
  );
}
