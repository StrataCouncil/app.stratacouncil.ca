"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteInvestor } from "@/app/admin/investors/actions";

/** Delete an investor and their record (test or junk sign-ups). */
export function InvestorDeleteButton({ investorId, name, small = false }: { investorId: string; name: string; small?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={small ? "text-action" : "button button-secondary button-small"}
        disabled={pending}
        data-testid={`delete-investor-${investorId}`}
        onClick={() =>
          start(async () => {
            if (!window.confirm(`Delete ${name}? Their sign-up, viewing record and notes are deleted for good.`)) return;
            const res = await deleteInvestor(investorId);
            if (!res.ok) return setError(res.error);
            router.push("/admin/investors");
            router.refresh();
          })
        }
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && <p className="form-alert">{error}</p>}
    </>
  );
}
