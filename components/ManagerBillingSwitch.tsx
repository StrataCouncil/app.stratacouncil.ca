"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setManagersCanBill } from "@/app/strata/[corpId]/roster-actions";

/**
 * The admin's switch for whether the strata's Manager can use Billing
 * (the subscription, payment method, invoices and billing contacts).
 * Off unless the admin turns it on.
 */
export function ManagerBillingSwitch({ corporationId, on }: { corporationId: string; on: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !value;
    setValue(next);
    setError(null);
    start(async () => {
      const r = await setManagersCanBill(corporationId, next);
      if (!r.ok) {
        setValue(!next);
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="manager-billing" data-testid="manager-billing">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby="manager-billing-label"
        className="permission-switch"
        disabled={pending}
        onClick={toggle}
        data-testid="manager-billing-switch"
      >
        <span className="permission-switch__thumb" aria-hidden="true" />
      </button>
      <div>
        <div id="manager-billing-label" className="manager-billing__label">
          Manager can access billing
        </div>
        <div className="roster-table__meta">
          The strata&rsquo;s Manager can open Billing: the subscription, payment method, invoices and billing contacts.
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
