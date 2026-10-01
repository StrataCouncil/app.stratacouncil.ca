"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Civic address field backed by an address lookup (/api/address-search).
 * Picking a suggestion marks the address verified; typing one by hand is
 * still possible (a brand-new building may not be listed yet), and the
 * reviewer sees that it wasn't picked.
 */
export function AddressAutocomplete({
  id,
  value,
  jurisdiction,
  onChange,
}: {
  id: string;
  value: string;
  jurisdiction: string;
  onChange: (address: string, verified: boolean) => void;
}) {
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
    const q = value.trim();
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
  }, [value, jurisdiction]);

  function pick(address: string) {
    skipNext.current = true;
    setVerified(true);
    setOpen(false);
    setSuggestions([]);
    onChange(address, true);
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
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => {
          setVerified(false);
          onChange(e.target.value, false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder="Start typing the building's street address"
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
        required
        data-testid="address-input"
      />
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
      <span className="field__hint">
        {verified
          ? "Address confirmed."
          : unavailable
            ? "Address lookup isn't responding right now. Type the full address; our team will check it."
            : "Pick the address from the list. If your building isn't listed, type the full address and our team will check it."}
      </span>
    </div>
  );
}
