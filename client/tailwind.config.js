/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Colours are the CSS custom properties from index.css, so a Tailwind
      // utility and a hand-authored component can never drift apart.
      colors: {
        void: "var(--oh-void)",
        obsidian: "var(--oh-obsidian)",
        graphite: "var(--oh-graphite)",
        panel: "var(--oh-panel)",
        raised: "var(--oh-panel-raised)",
        inset: "var(--oh-inset)",
        line: "var(--oh-line)",
        gold: "var(--oh-gold)",
        goldbright: "var(--oh-gold-bright)",
        golddeep: "var(--oh-gold-deep)",
        silver: "var(--oh-silver)",
        ivory: "var(--oh-ivory)",
        mute: "var(--oh-text-muted)",
        faint: "var(--oh-text-faint)",
        ok: "var(--oh-ok)",
        warn: "var(--oh-warn)",
        danger: "var(--oh-danger)",
      },
      fontFamily: {
        display: "var(--oh-font-display)",
        ui: "var(--oh-font-ui)",
        num: "var(--oh-font-num)",
      },
      borderRadius: {
        tile: "var(--oh-r-tile)",
      },
      boxShadow: {
        panel: "var(--oh-shadow)",
        lift: "var(--oh-shadow-lift)",
      },
    },
  },
  plugins: [],
};
