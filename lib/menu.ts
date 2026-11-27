// The console's map: every screen, what it is called, where it sits and what
// it is for, in one place.
//
// The side menu, the phone's bottom bar, Search, the trail above each page
// title, the sentence under it and the Help page are all drawn from this
// file, so they cannot disagree about what a screen is called or where it
// lives. Before this there were three menus (the top bar, a separate header on
// the GitHub screens, and a seven-tab bar in the installed app) that each
// named things their own way.
//
// The names are jobs, not tools. Someone who has never opened the console
// should be able to read the menu top to bottom and know what the studio does
// and where to click. Addresses did not change with the names: /sales is still
// /sales, so bookmarks, emails and notifications keep working.
//
// Plain data on purpose: no React and nothing server-only, so both server and
// client components can import it.

export type MenuItem = {
  href: string;
  label: string;
  /** One plain sentence saying what the screen is for. It is the line under
   *  the page title, the entry in Help and what Search matches on. */
  what: string;
  /** Other words people type when they look for this screen, including what
   *  it used to be called. */
  keywords?: string;
};

export type MenuGroup = {
  id: string;
  label: string;
  /** What this part of the console is about, for Help. */
  what: string;
  items: MenuItem[];
  /** Shown closed until opened, or until you are on one of its screens. */
  folded?: boolean;
};

export const TODAY: MenuItem = {
  href: "/",
  label: "Today",
  what: "What needs you now: money to chase, clients waiting on us, shops to message and code to check.",
  keywords: "home dashboard hub start overview",
};

export const MENU: MenuGroup[] = [
  {
    id: "clients",
    label: "Clients",
    what: "The businesses we build websites for, and everything we have sent them.",
    items: [
      {
        href: "/clients",
        label: "All clients",
        what: "Every client and where their project stands. Open one to see its documents, designs, money and messages.",
        keywords: "customers projects list documents billing invoice quotation estimate contract receipt",
      },
      {
        href: "/clients/new",
        label: "Add a client",
        what: "Start a new client. The estimate and the questions form are written for you, and the client gets their own web address.",
        keywords: "new create start lead estimate questionnaire",
      },
    ],
  },
  {
    id: "customers",
    label: "Find customers",
    what: "Reaching shops that might want a website from us.",
    items: [
      {
        href: "/sales",
        label: "Message shops",
        what: "The next shop to message, with the message already written. Mark it sent so nobody messages the same shop twice.",
        keywords: "sales send queue outreach whatsapp instagram follow up next",
      },
      {
        href: "/sales/shops",
        label: "Shop list",
        what: "Every shop we have looked into, where each one stands and who spoke to them last.",
        keywords: "sales shops leads prospects status notes import",
      },
      {
        href: "/sales/scripts",
        label: "Ready replies",
        what: "Answers to what shops usually say back, with our prices filled in. Copy one and change the words to fit.",
        keywords: "sales scripts templates answers price objections",
      },
      {
        href: "/sales/kit",
        label: "Social posts",
        what: "Every post for Instagram and Facebook in posting order, with its pictures and caption. Tick a post once it is up.",
        keywords: "sales social kit instagram facebook captions pictures content",
      },
    ],
  },
  {
    id: "website",
    label: "Our website",
    what: "What goes on the studio's own website, luminary-dev.xyz.",
    items: [
      {
        href: "/publish",
        label: "Blog posts",
        what: "Write a blog post for our website. It goes live once a teammate has approved it.",
        keywords: "publish article blog write landing page",
      },
      {
        href: "/publish/project",
        label: "Portfolio projects",
        what: "Add a finished project to the Work page of our website. It goes live once a teammate has approved it.",
        keywords: "publish portfolio work case study project landing page",
      },
    ],
  },
  {
    id: "code",
    label: "Code",
    what: "The code behind every site we build. It is kept on GitHub, and these screens show its state without opening GitHub.",
    folded: true,
    items: [
      {
        href: "/github",
        label: "Pull requests",
        what: "Changes to our code that are waiting to be checked and added. Each one says whether it is ready and what is holding it up.",
        keywords: "engineering github prs review merge code",
      },
      {
        href: "/github/ci",
        label: "Builds",
        what: "The automatic checks that run on every change, and which ones keep failing.",
        keywords: "engineering github ci checks tests failing flaky workflows actions",
      },
      {
        href: "/github/deployments",
        label: "Live versions",
        what: "Which version of each site is live right now, and where.",
        keywords: "engineering github deployments deploy vercel production environments",
      },
      {
        href: "/github/releases",
        label: "Releases",
        what: "The numbered versions we have published, newest first.",
        keywords: "engineering github versions tags notes",
      },
      {
        href: "/github/security",
        label: "Security alerts",
        what: "Warnings about unsafe code, outdated parts or leaked passwords in our code.",
        keywords: "engineering github dependabot vulnerabilities secrets scanning",
      },
      {
        href: "/github/repos",
        label: "Repositories",
        what: "Every project's code on GitHub, and how healthy each one is.",
        keywords: "engineering github repos health",
      },
      {
        href: "/github/insights",
        label: "Team stats",
        what: "How quickly changes get checked and added, so we can improve how we work.",
        keywords: "engineering github insights metrics throughput cycle time review",
      },
    ],
  },
];

export const HISTORY: MenuItem = {
  href: "/activity",
  label: "History",
  what: "Everything that has happened, newest first: what clients did, what we did, and changes to our code.",
  keywords: "activity log audit updates notifications events",
};

/** The second half of History. It has its own address but no menu entry: it is
 *  reached with the switch at the top of History. */
export const CODE_HISTORY: MenuItem = {
  href: "/github/activity",
  label: "Code history",
  what: "Changes to our code as they happened: what was opened, checked, added and published.",
  keywords: "engineering github activity events stream delivery",
};

export const HELP: MenuItem = {
  href: "/help",
  label: "Help",
  what: "What every screen is for, and what our words mean.",
  keywords: "guide glossary words how where what explain",
};

export const SETTINGS: MenuItem = {
  href: "/settings",
  label: "Devices and export",
  what: "The devices signed in to the console, and a spreadsheet of every client.",
  keywords: "settings sessions sign out export csv data account",
};

/** Every screen with an address, in menu order. Search and Help list these. */
export const ALL_SCREENS: (MenuItem & { group: string })[] = [
  { ...TODAY, group: "" },
  ...MENU.flatMap((g) => g.items.map((item) => ({ ...item, group: g.label }))),
  { ...HISTORY, group: "" },
  { ...CODE_HISTORY, group: HISTORY.label },
  { ...HELP, group: "" },
  { ...SETTINGS, group: "Account" },
];

/** The top-level folders that are console screens. Anything else under the
 *  same app (the sign-in page, a client's own pages at /c/, a document preview
 *  at /preview/) is not, and must never be drawn inside the console's frame. */
const CONSOLE_ROOTS = ["clients", "sales", "publish", "github", "activity", "help", "settings"];

/** Is this address one of the console's own screens? An allowlist, so a new
 *  kind of page stays outside the frame until someone decides it belongs. */
export function isConsolePath(pathname: string): boolean {
  if (pathname === "/") return true;
  const first = pathname.split("/")[1] ?? "";
  return CONSOLE_ROOTS.includes(first);
}

/** Which menu entry an address lights up. A page that is not itself in the
 *  menu lights the entry it sits under: one client lights All clients, one
 *  pull request lights Pull requests, code history lights History. */
export function currentFor(pathname: string): string | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (ALL_SCREENS.some((s) => s.href === path)) return path === CODE_HISTORY.href ? HISTORY.href : path;
  if (path.startsWith("/clients/")) return "/clients";
  if (path.startsWith("/github/")) return "/github";
  return undefined;
}

/** Where a screen sits: its group (if it has one) and its own entry. */
export function placeOf(href: string): { group?: MenuGroup; item?: MenuItem } {
  for (const group of MENU) {
    const item = group.items.find((i) => i.href === href);
    if (item) return { group, item };
  }
  const item = [TODAY, HISTORY, CODE_HISTORY, HELP, SETTINGS].find((i) => i.href === href);
  return item ? { item } : {};
}
