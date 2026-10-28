/**
 * A slim progress read-out built only from real called numbers. The bar is the
 * fraction of the ninety that have gone; nothing is invented.
 */
// eslint-disable-next-line react/prop-types
const GameProgress = ({ state = "WAITING", calledCount = 0, total = 90, remaining }) => {
  const pct = Math.min(100, Math.round((calledCount / total) * 100));
  const left = remaining == null ? total - calledCount : remaining;
  const tone =
    state === "RUNNING"
      ? "var(--oh-ok)"
      : state === "PAUSED"
        ? "var(--oh-warn)"
        : state === "COMPLETED"
          ? "var(--oh-gold)"
          : "var(--oh-text-faint)";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span
          className="uppercase tracking-wider"
          style={{ color: tone, fontSize: 12, fontWeight: 700 }}
        >
          {state}
        </span>
        <span className="oh-num" style={{ color: "var(--oh-text-muted)", fontSize: 12 }}>
          {calledCount}/{total} · {left} left
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={calledCount}
        style={{
          height: 8,
          borderRadius: 999,
          background: "var(--oh-inset)",
          border: "1px solid var(--oh-line)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: "linear-gradient(90deg, var(--oh-gold-deep), var(--oh-gold-bright))",
            transition: "width var(--oh-slow) var(--oh-ease-out)",
          }}
        />
      </div>
    </div>
  );
};

export default GameProgress;
