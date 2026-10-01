import { SubscribeCta } from "@/components/SubscribeCta";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { StratasphereChat } from "@/components/StratasphereChat";
import { getStrataAccess } from "@/lib/data/strata";
import { conversations, projects } from "@/lib/placeholder-data";

/**
 * Standalone Stratasphere™ assistant — never free, not even during the
 * trial window (doc01 §4b). Only the embedded Meeting Mode assistant is
 * ever free. Subscribed renders the real chat UI (`StratasphereChat`);
 * everything else stays the existing lock-panel pattern.
 */
export default async function AssistantPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const subscribed = (await getStrataAccess(corpId))?.subscribed ?? false;

  return (
    <>
      <StrataSphereNav active="assistant" />

      {subscribed ? (
        <StratasphereChat conversations={conversations} projects={projects} />
      ) : (
        <>
          <h2 style={{ marginBottom: "1rem" }}>Stratasphere&trade;</h2>
          <div className="lock-panel">
            <h2>Ask questions about your strata&rsquo;s documents</h2>
            <p>
              The standalone Stratasphere&trade; assistant requires an active
              subscription &mdash; it&rsquo;s never part of the free tier, even
              during your one free meeting.
            </p>
            <SubscribeCta testId="assistant-subscribe-cta" />
          </div>
        </>
      )}
    </>
  );
}
