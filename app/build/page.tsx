import Link from "next/link";
import { getMyAuthoredModules } from "@/lib/data/training";

/** The author's list of assigned modules. */
export default async function BuildHomePage() {
  const modules = await getMyAuthoredModules();
  return (
    <div className="wrap page">
      <div className="page-header">
        <h1>Your modules</h1>
        <p>Build and preview the Council Training modules you&rsquo;re assigned. When one is ready, mark it ready for review.</p>
      </div>
      {modules.length === 0 ? (
        <p className="roster-notice">No modules are assigned to you yet.</p>
      ) : (
        <div className="module-list">
          {modules.map((m) => (
            <div className="module-row" key={m.id}>
              <div>
                <div className="module-row__title">{m.title}</div>
                <div className="module-row__meta">
                  {m.trackTitle} &middot; {m.screenCount} {m.screenCount === 1 ? "screen" : "screens"} &middot;{" "}
                  {m.publishedVersion ? `published v${m.publishedVersion}` : "not published"}
                  {m.readyForReview ? " · ready for review" : ""}
                </div>
              </div>
              <Link href={`/build/${m.id}`} className="button button-primary button-small">
                Open builder
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
