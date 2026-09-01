"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ComboOption } from "../types";

export type SearchableComboboxProps = {
  /** Field label, shown above the input. Pass `""` for a bare field inside a table cell. */
  label: string;
  /** Currently selected option value, or `""` for no selection. */
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Input placeholder. Defaults to `Search {label}…`. */
  placeholder?: string;
};

/**
 * Type-ahead select with grouped options, rendered through a portal so the menu escapes
 * `overflow: hidden` ancestors such as the PRF editor's scroll container.
 *
 * Matching runs over each option's `label` plus its optional `search` terms, so a site can be found by
 * code, region or funding source as well as by name. The menu flips above the field when there is not
 * enough room below.
 *
 * ```tsx
 * <SearchableCombobox
 *   label="SITE"
 *   value={siteKey}
 *   options={siteOptions}
 *   onChange={selectSite}
 *   placeholder="Search all sites by name or code…"
 * />
 * ```
 */
export function SearchableCombobox({
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
}: SearchableComboboxProps) {
  // An empty `value` means nothing is chosen, so it must not resolve to the "-- select --" sentinel row —
  // that would render the sentinel's label as the field's text and typing would append to it.
  const selected = value ? options.find(option => option.value === value) : undefined;
  // `query` is the type-ahead term and is only ever shown while the menu is open, starting empty each time
  // it opens. Showing the selected label as the search term filtered the list down to that one row.
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const position = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 12,
      above = rect.top - 12,
      useAbove = below < 300 && above > below,
      room = useAbove ? above : below;
    const maxHeight = Math.min(300, Math.max(180, room), window.innerHeight - 24);
    setMenuStyle({
      position: "fixed",
      left: rect.left,
      top: useAbove ? undefined : rect.bottom + 5,
      bottom: useAbove ? window.innerHeight - rect.top + 5 : undefined,
      width: Math.max(rect.width, 310),
      maxHeight,
      overflowY: "auto",
    });
  };

  useEffect(() => {
    if (!open) return;
    const reposition = () => position();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const active = menuRef.current?.querySelector<HTMLElement>("button.selected");
    active?.scrollIntoView({ block: "nearest" });
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const term = query.trim().toLowerCase();
  const filtered = options.filter(
    option => !term || `${option.label} ${option.search || ""}`.toLowerCase().includes(term),
  );
  const groups = [...new Set(filtered.map(option => option.group || ""))];

  const choose = (option: ComboOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
  };
  const openMenu = () => {
    position();
    setQuery("");
    setOpen(true);
  };
  // While closed the field displays the current selection, so a keystroke arriving then would otherwise be
  // appended to that label; strip it so the first character starts a fresh search instead.
  const onType = (next: string) => {
    const shown = selected?.label || "";
    setQuery(open ? next : next.startsWith(shown) ? next.slice(shown.length) : next);
    position();
    setOpen(true);
  };
  const keys = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && !open) {
      openMenu();
      return;
    }
    if (event.key === "Enter" && open) {
      const first = filtered.find(option => option.value);
      if (first) {
        event.preventDefault();
        choose(first);
      }
    }
  };

  const menu = (
    <div className="comboMenu portalMenu" ref={menuRef} style={menuStyle} role="listbox">
      {groups.map(group => (
        <div key={group || "options"}>
          {group && <div className="comboGroup">{group}</div>}
          {filtered
            .filter(option => (option.group || "") === group)
            .map(option => (
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? "selected" : ""}
                key={`${group}-${option.value}`}
                title={option.title}
                onPointerDown={event => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                {option.label}
              </button>
            ))}
        </div>
      ))}
      {!filtered.length && <p className="comboEmpty">No matching options</p>}
    </div>
  );

  return (
    <div className="comboField">
      <small>{label}</small>
      <div className={`combo ${open ? "open" : ""}`}>
        <input
          ref={inputRef}
          aria-label={label || placeholder || "Search"}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          value={open ? query : selected?.label || ""}
          disabled={disabled}
          placeholder={open && selected ? selected.label : placeholder || `Search ${label.toLowerCase()}…`}
          onFocus={openMenu}
          onClick={openMenu}
          onKeyDown={keys}
          onChange={event => onType(event.target.value)}
          onBlur={() => window.setTimeout(() => { setOpen(false); setQuery(""); }, 180)}
        />
        <span aria-hidden="true">⌄</span>
        {open && createPortal(menu, document.body)}
      </div>
    </div>
  );
}
