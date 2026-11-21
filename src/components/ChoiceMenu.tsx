import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "./controls";
import { Icon } from "./Icon";
import "./ChoiceMenu.css";

export type ChoiceOption<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

/** A single-select action menu with native buttons and managed menu focus. */
export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  busy = false,
  showSelectedTitle = false,
  icon,
  className = "",
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  busy?: boolean;
  showSelectedTitle?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<"selected" | "first" | "last">("selected");
  const search = useRef({ text: "", at: 0 });
  const id = useId();
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  const items = () =>
    Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]',
      ) ?? [],
    );
  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const buttons = items();
    const index =
      firstFocus.current === "last"
        ? buttons.length - 1
        : firstFocus.current === "first"
          ? 0
          : Math.max(
              0,
              options.findIndex((option) => option.value === value),
            );
    buttons[index]?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, options, value]);
  const show = (focus: "selected" | "first" | "last") => {
    if (busy) return;
    firstFocus.current = focus;
    setOpen(true);
  };
  return (
    <div
      className={`choice-menu ${className}`}
      ref={root}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          close(false);
      }}
    >
      <Button
        ref={trigger}
        type="button"
        className="choice-menu-trigger"
        aria-label={`${label}: ${selectedLabel}`}
        title={showSelectedTitle ? selectedLabel : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-busy={busy || undefined}
        aria-disabled={busy || undefined}
        onClick={() => (open ? close(true) : show("selected"))}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            show(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
      >
        {icon}
        <span className="choice-menu-value">{selectedLabel}</span>
        <Icon glyph={ChevronDown} size="small" />
      </Button>
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          className="choice-menu-options"
          onKeyDown={(event) => {
            const buttons = items();
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            } else if (event.key === "Tab") close(true);
            else if (
              ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            } else if (
              event.key.length === 1 &&
              event.key !== " " &&
              !event.ctrlKey &&
              !event.altKey &&
              !event.metaKey
            ) {
              const now = Date.now();
              search.current = {
                text:
                  now - search.current.at > 700
                    ? event.key
                    : search.current.text + event.key,
                at: now,
              };
              const match = options.findIndex((option) =>
                option.label
                  .toLocaleLowerCase()
                  .startsWith(search.current.text.toLocaleLowerCase()),
              );
              if (match >= 0) {
                event.preventDefault();
                buttons[match]?.focus();
              }
            }
          }}
        >
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={-1}
              data-choice-value={option.value}
              className="choice-menu-option"
              onClick={() => {
                close(true);
                if (option.value !== value && !busy) onChange(option.value);
              }}
            >
              <span>
                <span>{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <Icon glyph={Check} size="control" />}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
