// The screen inventory, as data.
//
// INVENTORY.md is generated from this file rather than maintained beside it,
// so the document and the harness cannot disagree. A route added here is
// audited everywhere automatically; a route added to the app and not here is
// itself a finding, and `enumerated-routes.spec.ts` fails when the two drift.

export type Surface = "console" | "portal";

export type Route = {
  /** The path as visited, with parameters already filled in. */
  path: string;
  /** The file-system route, for cross-referencing the code. */
  pattern: string;
  name: string;
  surface: Surface;
  auth: "operator" | "public";
  purpose: string;
  /** What has to exist in the store for this to render with content. */
  needs?: string;
  /** Skip the viewport sweep: these return a document or a file, not a UI. */
  nonHtml?: boolean;
};

/** The live client the console holds. Read-only for the audit. */
export const CLIENT = "eco-mech";

export const ROUTES: Route[] = [
  // ——— console, unauthenticated ———
  {
    path: "/login",
    pattern: "app/login/page.tsx",
    name: "Sign in",
    surface: "console",
    auth: "public",
    purpose: "Email, password and emailed OTP. The only unauthenticated console screen.",
  },

  // ——— console, operator ———
  {
    path: "/",
    pattern: "app/page.tsx",
    name: "Dashboard",
    surface: "console",
    auth: "operator",
    purpose: "Client pipeline, outstanding money, unseen activity, sessions.",
    needs: "at least one client in the index",
  },
  {
    path: "/clients/new",
    pattern: "app/clients/new/page.tsx",
    name: "New client",
    surface: "console",
    auth: "operator",
    purpose: "Creates a client, drafts the estimate, provisions the subdomain.",
  },
  {
    path: `/clients/${CLIENT}`,
    pattern: "app/clients/[slug]/page.tsx",
    name: "Client detail",
    surface: "console",
    auth: "operator",
    purpose: "Documents, billing, designs, tasks, notes, handover, assistant.",
    needs: `client "${CLIENT}"`,
  },
  {
    path: "/activity",
    pattern: "app/activity/page.tsx",
    name: "Activity",
    surface: "console",
    auth: "operator",
    purpose: "Cross-client activity feed with unread tracking.",
  },
  {
    path: "/publish",
    pattern: "app/publish/page.tsx",
    name: "Publish studio",
    surface: "console",
    auth: "operator",
    purpose: "Drafts and publishes blog articles and portfolio projects.",
  },

  // ——— console, engineering ———
  {
    path: "/github",
    pattern: "app/github/page.tsx",
    name: "Pull requests",
    surface: "console",
    auth: "operator",
    purpose: "Org-wide PR inbox with saved views and keyboard navigation.",
    needs: "a backfilled projection",
  },
  {
    path: "/github/repos",
    pattern: "app/github/repos/page.tsx",
    name: "Repositories",
    surface: "console",
    auth: "operator",
    purpose: "Repository health.",
  },
  {
    path: "/github/ci",
    pattern: "app/github/ci/page.tsx",
    name: "CI",
    surface: "console",
    auth: "operator",
    purpose: "Workflow runs, flaky checks, duration trends.",
  },
  {
    path: "/github/deployments",
    pattern: "app/github/deployments/page.tsx",
    name: "Deployments",
    surface: "console",
    auth: "operator",
    purpose: "What is deployed where, grouped by environment.",
    needs: "deployment webhooks; a backfill does not seed these",
  },
  {
    path: "/github/releases",
    pattern: "app/github/releases/page.tsx",
    name: "Releases",
    surface: "console",
    auth: "operator",
    purpose: "Published releases.",
    needs: "release webhooks; a backfill does not seed these",
  },
  {
    path: "/github/security",
    pattern: "app/github/security/page.tsx",
    name: "Security",
    surface: "console",
    auth: "operator",
    purpose: "Dependabot, code scanning and secret scanning alerts.",
    needs: "alert webhooks; a backfill does not seed these",
  },
  {
    path: "/github/insights",
    pattern: "app/github/insights/page.tsx",
    name: "Insights",
    surface: "console",
    auth: "operator",
    purpose: "Team-level throughput, cycle time, review load, flakes.",
  },
  {
    path: "/github/activity",
    pattern: "app/github/activity/page.tsx",
    name: "Engineering activity",
    surface: "console",
    auth: "operator",
    purpose: "Delivery stream, filterable by kind and repository.",
  },

  {
    path: "/github/luminary-dev/luminary-console/21",
    pattern: "app/github/[owner]/[repo]/[number]/page.tsx",
    name: "Pull request detail",
    surface: "console",
    auth: "operator",
    purpose: "One pull request: merge readiness, checks, reviews, files, actions.",
    needs: "the projection to hold that pull request; the number is resolved from a real one",
  },

  // ——— client portal ———
  {
    path: `/c/${CLIENT}`,
    pattern: "app/c/[slug]/page.tsx",
    name: "Client portal",
    surface: "portal",
    auth: "public",
    purpose: "What the client sees: documents, designs, progress, uploads.",
    needs: `client "${CLIENT}"`,
  },
  {
    path: `/c/${CLIENT}/questionnaire`,
    pattern: "app/c/[slug]/questionnaire/page.tsx",
    name: "Questionnaire",
    surface: "portal",
    auth: "public",
    purpose: "The discovery form. Long, multi-field, filled in on a phone.",
    needs: `client "${CLIENT}"`,
  },
];

/**
 * Routes that render HTML but are route handlers rather than pages.
 *
 * They are real screens a client looks at, so they belong in the viewport
 * sweep, but they are generated documents with their own stylesheet and no
 * React, so most of the interaction audit does not apply to them.
 */
export const DOCUMENT_ROUTES: Route[] = [
  {
    path: `/c/${CLIENT}/quotation`,
    pattern: "app/c/[slug]/[doc]/route.ts",
    name: "Stored document",
    surface: "portal",
    auth: "public",
    purpose: "A rendered client document: quotation, invoice, contract and the rest.",
    needs: `a published document on "${CLIENT}"`,
  },
];

export const ALL_HTML_ROUTES = [...ROUTES, ...DOCUMENT_ROUTES];
