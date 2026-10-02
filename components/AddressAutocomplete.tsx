"use client";

import { useEffect, useId, useRef, useState } from "react";
import { joinPostal, normalizePostalCode, splitPostal } from "@/lib/postal";

/**
 * Address field backed by an address lookup (/api/address-search), with
 * its own postal code box: BC's address geocoder doesn't return postal
 * codes, so they're entered (or filled in when a suggestion has one).
 * Picking a suggestion marks the address verified; typing one by hand is
 * still possible (a brand-new building may not be listed yet), and the
 * reviewer sees that it wasn't picked. `onChange` gets the one-line
 * address ending in the postal code (lib/postal.ts).
 */
export function AddressAutocomplete({
  id,
  value,
  jurisdiction,
  onChange,
  placeholder = "Start typing the building's street address",
}: {
  id: string;
  value: string;
  jurisdiction: string;
  onChange: (address: string, verified: boolean) => void;
  placeholder?: string;
}) {
  const [street, setStreet] = useState(() => splitPostal(value).street);
  const [postal, setPostal] = useState(() => splitPostal(value).postal);
  const postalOk = Boolean(normalizePostalCode(postal));
  const listId = useId();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [unavailable, setUnavailable] = useState(false);
  const [verified, setVerified] = useState(false);
  const skipNext = useRef(false);

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const q = street.trim();
    if (q.length < 4) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address-search?${new URLSearchParams({ q, jurisdiction })}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { suggestions: string[]; unavailable?: boolean };
        setSuggestions(data.suggestions ?? []);
        setUnavailable(Boolean(data.unavailable));
        setHighlight(-1);
        setOpen(true);
      } catch {
        // Aborted by the next keystroke, or offline: typing still works.
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [street, jurisdiction]);

  function pick(address: string) {
    skipNext.current = true;
    const picked = splitPostal(address);
    const nextPostal = picked.postal || postal;
    setStreet(picked.street);
    setPostal(nextPostal);
    setVerified(true);
    setOpen(false);
    setSuggestions([]);
    onChange(joinPostal(picked.street, nextPostal), true);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div className="address-lookup">
      <div className="address-lookup__row">
      <input
        id={id}
        type="text"
        value={street}
        onChange={(e) => {
          setVerified(false);
          setStreet(e.target.value);
          onChange(joinPostal(e.target.value, postal), false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
        required
        data-testid="address-input"
      />
      <input
        type="text"
        className="address-lookup__postal"
        value={postal}
        onChange={(e) => {
          setPostal(e.target.value.toUpperCase());
          onChange(joinPostal(street, e.target.value), verified);
        }}
        onBlur={() => {
          const tidy = normalizePostalCode(postal);
          if (tidy) setPostal(tidy);
        }}
        placeholder="Postal code"
        aria-label="Postal code"
        maxLength={7}
        autoComplete="postal-code"
        required
        data-testid="postal-code-input"
      />
      </div>
      {showList && (
        <ul className="address-lookup__list" id={listId} role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              data-highlight={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
      <span className={postal && !postalOk ? "field__hint form-error" : "field__hint"}>
        {postal && !postalOk
          ? "That postal code doesn't look right. It should look like V0E 2S3."
          : verified
          ? "Address confirmed."
          : unavailable
            ? "Address lookup isn't responding right now. Type the full address; our team will check it."
            : "Pick the address from the list. If it isn't listed, type the full address and our team will check it."}
      </span>
    </div>
  );
}
