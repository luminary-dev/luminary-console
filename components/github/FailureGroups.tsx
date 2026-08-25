// Identical CI failures, grouped across pull requests.
//
// A check failing on four pull requests at once is almost never four bugs; it
// is one broken thing. Grouping is the difference between four investigations
// and one, which is why this panel sits beside the inbox rather than inside
// each row.
import Link from "next/link";
import { StatusIcon } from "./MergeVerdict";

/** Shaped by groupFailures() in lib/github/views, kept structural so the
 *  server can hand it straight over. */
export type FailureGroup = {
  name: string;
  count: number;
  prs: { repo: string; number: number; title: string }[];
};

export default function FailureGroups({ groups }: { groups: FailureGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="gh-note">
        No failing checks on any open pull request right now. Anything that breaks across several
        branches at once will be grouped here, so one shared cause reads as one entry.
      </p>
    );
  }

  return (
    <div>
      <p className="gh-note">
        Grouped by check name, most widespread first. A name appearing on several pull requests is
        usually one broken thing, not several.
      </p>
      {groups.map((group) => (
        <div className="gh-group" key={group.name}>
          <p className="gh-group-head">
            <span className="gh-status is-bad">
              <StatusIcon tone="bad" />
              <span className="gh-group-name">{group.name}</span>
            </span>
            <span className="gh-group-count">
              failing on {group.count} pull {group.count === 1 ? "request" : "requests"}
            </span>
          </p>
          <ul className="gh-group-prs">
            {group.prs.map((pr) => (
              <li key={`${pr.repo}#${pr.number}`}>
                <Link href={`/github/${pr.repo}/${pr.number}`}>
                  <span className="gh-row-no">
                    {pr.repo} #{pr.number}
                  </span>
                  {pr.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
