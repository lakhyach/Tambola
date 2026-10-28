import { Link } from "react-router-dom";
import Header from "./Header";
import Button from "./components/Button.jsx";
import { APP_NAME, APP_TAGLINE, APP_SUBTITLE } from "./brand.js";

/* A decorative sample used purely to preview the visual language. It is not a
   live ticket and carries no game meaning — no numbers, players or scores on
   this page are presented as real gameplay. */
const PREVIEW_ROW = [
  [3, null, 20, 29, null, 51, null, 63, 74],
  [8, 15, null, null, 38, 42, 59, null, 88],
  [null, 12, 27, null, 33, null, 66, 79, 90],
];
const CALLED = new Set([3, 15, 29, 42, 66, 79]);

const Landing = () => (
  <div className="flex flex-col" style={{ minHeight: "100vh" }}>
    <Header />

    <main
      className="flex-1 flex flex-col items-center justify-center gap-10"
      style={{ padding: "clamp(20px, 6vw, 64px) clamp(16px, 5vw, 40px)", maxWidth: 1100, marginInline: "auto", width: "100%" }}
    >
      <div className="grid gap-10 items-center w-full" style={{ gridTemplateColumns: "minmax(0, 1fr)" }} data-hero="true">
        <div className="flex flex-col gap-6" data-hero-copy>
          <span className="oh-eyebrow" style={{ color: "var(--oh-gold)" }}>
            {APP_TAGLINE}
          </span>
          <h1
            className="oh-display"
            style={{ fontSize: "clamp(44px, 9vw, 88px)", lineHeight: 1.02, margin: 0, color: "var(--oh-ivory)" }}
          >
            {APP_NAME}
          </h1>
          <p style={{ color: "var(--oh-text-muted)", fontSize: "clamp(16px, 2.2vw, 19px)", maxWidth: 460, margin: 0 }}>
            {APP_SUBTITLE}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button as={Link} to="/host" variant="gold">
              Host a Game
            </Button>
            <Button as={Link} to="/player" variant="ghost">
              Join a Room
            </Button>
          </div>
          <p className="oh-eyebrow" style={{ color: "var(--oh-text-faint)" }}>
            No sign-up · No cost · Your ticket lives through a refresh
          </p>
        </div>

        <div className="flex justify-center" data-hero-preview>
          <div
            className="p-5"
            style={{
              borderRadius: "var(--oh-r-lg)",
              background: "linear-gradient(180deg, var(--oh-panel), var(--oh-graphite))",
              border: "1px solid var(--oh-line-gold)",
              boxShadow: "var(--oh-shadow-lift)",
            }}
          >
            <div className="oh-eyebrow mb-3" style={{ textAlign: "center" }}>
              Ticket Preview
            </div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(9, 34px)" }}>
              {PREVIEW_ROW.flatMap((row, r) =>
                Array.from({ length: 9 }, (_, c) => {
                  const n = row[c] ?? null;
                  return (
                    <div
                      key={`p-${r}-${c}`}
                      className="oh-ticket-cell"
                      data-empty={String(n == null)}
                      data-called={String(n != null && CALLED.has(n))}
                      style={{ width: 34, height: 34, fontSize: 13 }}
                    >
                      {n == null ? "" : n}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </main>

    <footer
      className="flex items-center justify-center"
      style={{ padding: "18px", color: "var(--oh-text-faint)", fontSize: 12 }}
    >
      A free-to-play game · server-authoritative · Obsidian Hall design direction
    </footer>

    <style>{`
      @media (min-width: 860px) {
        [data-hero="true"] { grid-template-columns: 1.1fr .9fr !important; }
        [data-hero-copy] { text-align: left; }
      }
    `}</style>
  </div>
);

export default Landing;
