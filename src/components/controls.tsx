import {cloneElement, useId, type ComponentPropsWithRef, type ReactElement, type ReactNode} from "react";

export type ButtonProps = ComponentPropsWithRef<"button"> & {pending?: boolean};
/** Native button/form/ref semantics remain intact; an explicit pending operation disables activation. */
export function Button({pending, disabled, ...props}: ButtonProps) {
  return <button {...props} disabled={pending || disabled} aria-busy={pending ? true : props["aria-busy"]} />;
}

export function IconButton({label, className = "icon-button", type = "button", ...props}: Omit<ButtonProps, "aria-label"> & {label: string}) {
  if (!label.trim()) throw new Error("IconButton requires an accessible label.");
  return <Button {...props} type={type} className={className} aria-label={label} />;
}

type FieldControl = {id?: string; "aria-describedby"?: string; "aria-invalid"?: ComponentPropsWithRef<"input">["aria-invalid"]};
/** One native control per label; retain caller descriptions and add stable hint/error references. */
export function Field({label, children, hint, error, className}: {
  label: ReactNode; children: ReactElement<FieldControl>; hint?: string; error?: string; className?: string;
}) {
  const generated = useId();
  const id = children.props.id ?? generated;
  const describedBy = [children.props["aria-describedby"], hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(" ") || undefined;
  return <>
    <label className={className} htmlFor={id}>{label}{cloneElement(children, {
      id, "aria-describedby": describedBy, "aria-invalid": error ? true : children.props["aria-invalid"],
    })}</label>
    {hint && <p id={`${id}-hint`} className="small muted">{hint}</p>}
    {error && <p id={`${id}-error`} className="danger-text" role="alert">{error}</p>}
  </>;
}

type TabsProps = Omit<ComponentPropsWithRef<"div">, "onClick" | "onKeyDown"> & {
  label: string; onValueChange: (value: string) => boolean | void;
};
/** The feature owns selection and may refuse it; this owner handles roving focus and keyboard navigation. */
export function Tabs({label, onValueChange, children, ...props}: TabsProps) {
  const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
    .filter(button => !button.disabled && button.closest('[role="tablist"]') === root);
  const select = (root: HTMLElement, button: HTMLButtonElement) => {
    const value = button.dataset.tabValue;
    if (value === undefined) return;
    if (onValueChange(value) === false) buttons(root).find(tab => tab.getAttribute("aria-selected") === "true")?.focus();
    else button.focus();
  };
  return <div {...props} role="tablist" aria-label={label} onClick={event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[role="tab"]') : null;
    if (button && buttons(event.currentTarget).includes(button)) select(event.currentTarget, button);
  }} onKeyDown={event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = buttons(event.currentTarget);
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !tabs.length) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    select(event.currentTarget, tabs[next]);
  }}>{children}</div>;
}

export function Tab({value, selected, ...props}: Omit<ButtonProps, "role" | "onClick" | "tabIndex" | "aria-selected"> & {value: string; selected: boolean}) {
  return <Button {...props} type="button" role="tab" data-tab-value={value} aria-selected={selected} tabIndex={selected ? 0 : -1} />;
}
