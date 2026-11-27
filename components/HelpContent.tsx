// The Help page's content: every screen in one sentence, a client's tabs, how
// to get around, and what the studio's words mean.
//
// The first two parts are not written here. They are read from the menu
// (lib/menu.ts) and the client tabs (components/ClientTabs.tsx), so Help
// cannot describe a screen that has been renamed or forget one that was added.
// Only the word list is its own text.
import Link from "next/link";
import { CLIENT_TABS } from "@/components/ClientTabs";
import { CODE_HISTORY, HISTORY, MENU, SETTINGS, TODAY, type MenuItem } from "@/lib/menu";

/** The studio's words, in the order a project meets them. Plain meanings, not
 *  definitions: what someone needs to know to use the screen the word is on. */
export const WORDS: { word: string; means: string }[] = [
  { word: "Estimate", means: "A rough price range, sent first, before we know the details of the job." },
  { word: "Questions form", means: "The form a new client fills in about their business and what they want. Also called the questionnaire. The quotation is written from their answers." },
  { word: "Quotation", means: "The exact price and what it covers. The client accepts it on their own page." },
  { word: "Proposal", means: "How we will do the work, and when." },
  { word: "Contract and SOW", means: "The agreement the client signs. SOW is short for statement of work: the list of exactly what will be delivered." },
  { word: "Draft and published", means: "A draft is seen only by us. Publishing a document puts it on the client's page. Unpublishing takes it off again." },
  { word: "Client's page", means: "Each client gets their own web address. There they read their documents, pick a design, ask questions and send us files." },
  { word: "Stage", means: "Where a project is: lead, quoted, accepted, development, delivered, warranty, closed." },
  { word: "Invoice and receipt", means: "An invoice asks for a payment and a receipt confirms one arrived. A project has two invoices: 30% when the design is approved, and 70% on delivery." },
  { word: "Change order", means: "A change the client asks for after agreeing the price. It is written down and added to the final invoice." },
  { word: "Handover pack", means: "The document that closes a project: what was built, every document we issued, the logins, the 30-day warranty and a summary of payments." },
  { word: "Warranty", means: "The 30 days after delivery in which we fix faults at no charge." },
  { word: "Follow-up", means: "A second or third message to a shop that has not answered, sent 2 days and 5 days after the first." },
  { word: "Repository", means: "One project's code and its whole history, kept on GitHub." },
  { word: "Pull request", means: "A proposed change to code. A teammate checks it before it is added." },
  { word: "Build", means: "The automatic checks that run on every change: does it still work, do the tests pass. Engineers call this CI." },
  { word: "Live version", means: "A copy of a site running on the internet. Production is the one the public sees. A preview is a private copy for checking. Engineers call these deployments." },
  { word: "Release", means: "A numbered version of a project, such as v2.0.0." },
];

function Screen({ item }: { item: MenuItem }) {
  return (
    <div>
      <dt>
        <Link href={item.href}>{item.label}</Link>
      </dt>
      <dd>{item.what}</dd>
    </div>
  );
}

export default function HelpContent() {
  return (
    <>
      <section className="card" aria-labelledby="help-around">
        <h3 id="help-around">Getting around</h3>
        <dl className="help-list">
          <div>
            <dt>The menu</dt>
            <dd>
              Every screen is in the menu, grouped by what you are trying to do. On a computer it
              is down the left side. On a phone, press Menu at the bottom right.
            </dd>
          </div>
          <div>
            <dt>Search</dt>
            <dd>
              Finds any screen, client or document. It is the box at the top of the menu, or press
              the / key. Type what you are after, like &quot;invoice&quot;, and it offers each
              client&apos;s Money tab. Type a client&apos;s name as well as the word to go straight
              to that client&apos;s tab. A document number opens the tab it is on.
            </dd>
          </div>
          <div>
            <dt>The trail</dt>
            <dd>
              The small line above each page title says where you are, such as Clients, then the
              client&apos;s name, then Money. Press any part of it to go back up.
            </dd>
          </div>
          <div>
            <dt>How this works</dt>
            <dd>
              Under some titles is a small &quot;How this works&quot; link. It opens the longer
              explanation of that screen, for when you want it.
            </dd>
          </div>
        </dl>
      </section>

      <section className="card" aria-labelledby="help-screens">
        <h3 id="help-screens">What every screen is for</h3>
        <dl className="help-list">
          <Screen item={TODAY} />
        </dl>
        {MENU.map((group) => (
          <div className="help-group" key={group.id}>
            <h4>{group.label}</h4>
            <p>{group.what}</p>
            <dl className="help-list">
              {group.items.map((item) => (
                <Screen key={item.href} item={item} />
              ))}
            </dl>
          </div>
        ))}
        <div className="help-group">
          <h4>{HISTORY.label}</h4>
          <dl className="help-list">
            <Screen item={HISTORY} />
            <Screen item={CODE_HISTORY} />
          </dl>
        </div>
        <div className="help-group">
          <h4>Account</h4>
          <p>At the bottom of the menu: light or dark, alerts on this device, and signing out.</p>
          <dl className="help-list">
            <Screen item={SETTINGS} />
          </dl>
        </div>
      </section>

      <section className="card" aria-labelledby="help-client">
        <h3 id="help-client">On a client&apos;s page</h3>
        <p className="empty-note">
          Open a client from All clients. Their page has six tabs, and the top of it always says
          where the project stands.
        </p>
        <dl className="help-list">
          {CLIENT_TABS.map((tab) => (
            <div key={tab.id}>
              <dt>{tab.label}</dt>
              <dd>{tab.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card" aria-labelledby="help-words">
        <h3 id="help-words">What our words mean</h3>
        <dl className="help-list">
          {WORDS.map((w) => (
            <div key={w.word}>
              <dt>{w.word}</dt>
              <dd>{w.means}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
