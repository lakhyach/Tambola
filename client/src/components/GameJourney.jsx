/* eslint-disable react/prop-types */
const COPY = {
  en: [
    ["Setup", "Create or choose your game"],
    ["Tickets", "Book a seat or join your room"],
    ["Play", "Follow calls and claim a win"],
  ],
  hi: [
    ["तैयारी", "गेम शुरू करें या चुनें"],
    ["टिकट", "सीट बुक करें या रूम से जुड़ें"],
    ["खेलें", "नंबर देखें और जीत का दावा करें"],
  ],
};
const STEPS = ["setup", "tickets", "play"];

export default function GameJourney({ current = "setup", language = "en", compact = false }) {
  const active = Math.max(0, STEPS.indexOf(current));
  const copy = COPY[language === "hi" ? "hi" : "en"];
  return (
    <nav
      className={`game-journey${compact ? " game-journey--compact" : ""}`}
      aria-label={language === "hi" ? "खेल के तीन चरण" : "Three game steps"}
      data-active-step={STEPS[active]}
    >
      <ol style={{ "--journey-progress": `${(active / (STEPS.length - 1)) * 100}%` }}>
        {STEPS.map((step, index) => (
          <li key={step} aria-current={index === active ? "step" : undefined} data-complete={index < active ? "true" : "false"}>
            <span className="game-journey__number" aria-hidden="true">{index < active ? "✓" : String(index + 1).padStart(2, "0")}</span>
            <span className="game-journey__copy">
              <strong>{copy[index][0]}</strong>
              <small>{copy[index][1]}</small>
            </span>
            {index === active ? <span className="game-journey__state">{language === "hi" ? "अभी यहाँ" : "You are here"}</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
