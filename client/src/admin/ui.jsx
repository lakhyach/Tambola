/* eslint-disable react/prop-types */
/**
 * Shared presentation pieces for the owner control centre.
 *
 * These are intentionally generic: a panel header, a compact stat, a status
 * pill, a table wrapper, a confirm dialog. No page logic lives here, and no
 * component invents a value — callers pass real data or the "—" placeholder.
 */
import { useEffect, useRef, useState } from "react";
import Button from "../components/Button.jsx";
import { copyText } from "./clipboard.js";
import { statusLabel, statusTone } from "./format.js";

/** Small uppercase state chip. */
export function Badge({ tone = "muted", children }) {
  return (
    <span className="adm-badge" data-tone={tone}>
      {children}
    </span>
  );
}

export function StatusPill({ status, label }) {
  return <Badge tone={statusTone(status)}>{label || statusLabel(status)}</Badge>;
}

/** A single honest number with an optional hint. */
export function Stat({ label, value, hint, tone = "default" }) {
  return (
    <div className="adm-stat" data-tone={tone}>
      <p className="adm-stat__label">{label}</p>
      <p className="adm-stat__value oh-num">{value === null || value === undefined ? "—" : value}</p>
      {hint ? <p className="adm-stat__hint">{hint}</p> : null}
    </div>
  );
}

/** A titled panel section. */
export function Section({ eyebrow, title, actions, className = "", children, ...rest }) {
  return (
    <section className={`oh-panel adm-section ${className}`} aria-label={title || undefined} {...rest}>
      {eyebrow || title || actions ? (
        <header className="adm-section__head">
          <div>
            {eyebrow ? <p className="oh-eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="oh-display adm-section__title">{title}</h2> : null}
          </div>
          {actions ? <div className="adm-section__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** Quiet "nothing here" state with an explicit reason. */
export function Empty({ title = "Nothing to show", children }) {
  return (
    <div className="adm-empty">
      <p className="adm-empty__title">{title}</p>
      {children ? <p className="adm-empty__body">{children}</p> : null}
    </div>
  );
}

/** In-page failure with an optional retry. Never shows a stack trace. */
export function ErrorNote({ title = "That did not work", error, onRetry, retryLabel = "Try again" }) {
  const message =
    (error && error.message) ||
    (typeof error === "string" && error ? error : "The control centre could not complete that request.");
  return (
    <div className="adm-error" role="alert">
      <div>
        <p className="adm-error__title">{title}</p>
        <p className="adm-error__body">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function Loading({ label = "Loading…", block = false }) {
  return (
    <div className={block ? "adm-loading adm-loading--block" : "adm-loading"}>
      <span className="adm-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Full-viewport boot state while the session is resolved. */
export function Boot({ label = "Opening the control centre…" }) {
  return (
    <div className="adm-boot">
      <span className="adm-spinner" aria-hidden="true" />
      <p className="oh-eyebrow">{label}</p>
    </div>
  );
}

export function Table({ children, caption, className = "" }) {
  return (
    <div className="adm-table-wrap">
      <table className={`adm-table ${className}`}>
        {caption ? <caption className="adm-table__caption">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function Pagination({ total = 0, limit = 25, offset = 0, onChange }) {
  if (!total || total <= limit) {
    return <p className="adm-pagination adm-pagination--quiet">{total ? `${total} total` : ""}</p>;
  }
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <nav className="adm-pagination" aria-label="Pagination">
      <span className="oh-num">
        Page {page} of {pages} · {total} total
      </span>
      <div className="adm-actions">
        <Button variant="ghost" size="sm" onClick={() => onChange(Math.max(0, offset - limit))} disabled={offset <= 0}>
          Previous
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange(offset + limit)} disabled={offset + limit >= total}>
          Next
        </Button>
      </div>
    </nav>
  );
}

/** Labelled form control wrapper. */
export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="adm-field">
      <label className="adm-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="adm-field__hint">{hint}</p> : null}
    </div>
  );
}

export function Banner({ tone = "info", title, children }) {
  return (
    <div className="adm-banner" data-tone={tone} role={tone === "danger" ? "alert" : undefined}>
      {title ? <p className="adm-banner__title">{title}</p> : null}
      {children ? <div className="adm-banner__body">{children}</div> : null}
    </div>
  );
}

/** Copy-to-clipboard button that reports the outcome to the caller's toast. */
export function CopyButton({ value, label = "Copy", copiedLabel = "Copied", onResult }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function handleClick() {
    try {
      await copyText(value);
      setCopied(true);
      if (onResult) onResult(true);
    } catch (error) {
      if (onResult) onResult(false, error);
    }
  }
  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={!value}>
      {copied ? copiedLabel : label}
    </Button>
  );
}

/** Two-column definition list for summary facts. */
export function KeyValue({ items }) {
  const rows = items.filter((item) => item && item[0]);
  return (
    <dl className="adm-kv">
      {rows.map(([key, value]) => (
        <div key={key} className="adm-kv__row">
          <dt>{key}</dt>
          <dd>{value === null || value === undefined || value === "" ? "—" : value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({ value = 0, max = 100, label }) {
  const safeMax = Math.max(1, Number(max) || 1);
  const safeValue = Math.max(0, Math.min(safeMax, Number(value) || 0));
  const percent = Math.round((safeValue / safeMax) * 100);
  return (
    <div
      className="adm-progress"
      role="progressbar"
      aria-valuenow={safeValue}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Modal confirmation for destructive actions.
 * Escape and a scrim click cancel; the confirm button is focused on open.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  detail,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    if (confirmRef.current) confirmRef.current.focus();
    function onKeyDown(event) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="adm-dialog"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="adm-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="adm-dialog-title">
        <p className="oh-eyebrow">Please confirm</p>
        <h2 id="adm-dialog-title" className="oh-display adm-dialog__title">
          {title}
        </h2>
        {description ? <p className="adm-dialog__body">{description}</p> : null}
        {detail ? <div className="adm-dialog__detail">{detail}</div> : null}
        <div className="adm-dialog__actions">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <button
            ref={confirmRef}
            type="button"
            className={`oh-btn oh-btn--sm ${tone === "danger" ? "oh-btn--danger" : "oh-btn--gold"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
