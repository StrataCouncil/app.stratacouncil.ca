"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setInvestorAccess } from "@/app/admin/investors/actions";

/** End an investor's access (their links stop working), or restore it. */
export function InvestorAccessButton({ investorId, revoked }: { investorId: string; revoked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="button button-secondary button-small"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!revoked && !window.confirm("End this person's access to the investor briefing? Their links stop working at once.")) return;
            const res = await setInvestorAccess(investorId, !revoked);
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
      >
        {revoked ? "Restore access" : "End access"}
      </button>
      {error && <p className="form-alert">{error}</p>}
    </>
  );
}
