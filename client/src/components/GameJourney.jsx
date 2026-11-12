/* eslint-disable react/prop-types */
const COPY = {
  en: [
    ["Setup", "Start a room or choose a published game."],
    ["Tickets", "Book a seat or enter your room code."],
    ["Play", "Follow the calls and claim a win."],
  ],
  hi: [
    ["तैयारी", "रूम शुरू करें या प्रकाशित गेम चुनें।"],
    ["टिकट", "सीट बुक करें या रूम कोड डालें।"],
    ["खेलें", "नंबर देखें और जीत का दावा करें।"],
  ],
};
const STEPS = ["setup", "tickets", "play"];

export default function GameJourney({ current = "setup", language = "en", compact = false }) {
  const active = Math.max(0, STEPS.indexOf(current));
  const copy = COPY[language === "hi" ? "hi" : "en"];
  return (
    <nav className={`game-journey${compact ? " game-journey--compact" : ""}`} aria-label={language === "hi" ? "खेल के तीन चरण" : "Three game steps"}>
      <ol>
        {STEPS.map((step, index) => (
          <li key={step} aria-current={index === active ? "step" : undefined} data-complete={index < active ? "true" : "false"}>
            <span className="game-journey__number">{index + 1}</span>
            <span className="game-journey__copy"><strong>{copy[index][0]}</strong><small>{copy[index][1]}</small></span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
