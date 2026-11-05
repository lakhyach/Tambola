/* eslint-disable react/prop-types -- poster and template payloads are validated at the API boundary. */
import { truncatePosterText } from "./poster-text.js";

const SIZE = {
  square: [1080, 1080],
  portrait: [1080, 1350],
  landscape: [1350, 1080],
  story: [1080, 1920],
};

function text(value) {
  return String(value || "").slice(0, 240);
}

function wrapTitle(value, maxCharacters = 24, maxLines = 4) {
  const lines = [];
  let line = "";
  for (const originalWord of text(value).trim().split(/\s+/).filter(Boolean)) {
    let word = originalWord;
    while (word.length > maxCharacters) {
      if (line) { lines.push(line); line = ""; }
      lines.push(word.slice(0, maxCharacters));
      word = word.slice(maxCharacters);
    }
    if (!word) continue;
    if (line && `${line} ${word}`.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, maxCharacters - 1).trimEnd()}…`;
  }
  return lines.length ? lines : ["Tambola Night"];
}

function firework(cx, cy, radius, color) {
  return <g aria-hidden="true" transform={`translate(${cx} ${cy})`} fill="none" stroke={color} strokeLinecap="round">
    {Array.from({ length: 12 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 12;
      const inner = radius * (index % 2 ? .36 : .52);
      return <line key={index} x1={Math.cos(angle) * inner} y1={Math.sin(angle) * inner} x2={Math.cos(angle) * radius} y2={Math.sin(angle) * radius} strokeWidth={index % 3 === 0 ? 6 : 3} opacity={index % 2 ? .62 : .9} />;
    })}
    <circle r={radius * .17} fill={color} stroke="none" />
  </g>;
}

export default function PosterArt({ template, poster, instance, preview = false, svgRef }) {
  if (!template || !poster) return null;
  const [width, height] = SIZE[poster.layoutSize] || SIZE.portrait;
  const palette = { ...template.palette, ...(poster.accent ? { accent: poster.accent } : {}) };
  const cx = width / 2;
  const long = height > width * 1.2;
  const titleLines = wrapTitle(poster.title);
  const longestTitleLine = Math.max(...titleLines.map((line) => line.length));
  const titleFontSize = Math.max(34, Math.min(long ? 84 : 74, Math.floor((width * 0.74) / (Math.max(1, longestTitleLine) * 0.56))));
  const titleLineHeight = titleFontSize * 1.12;
  const baseTitleY = long ? height * 0.34 : height * 0.31;
  const titleY = baseTitleY - (titleLines.length - 1) * titleFontSize * 0.58;
  const scheduleY = Math.max(baseTitleY + (long ? 130 : 110), titleY + (titleLines.length - 1) * titleLineHeight + titleFontSize * 1.7);
  const detailsY = scheduleY + 78;
  const patternsY = long ? height * .58 : height * .56;
  const isMinimal = template.layout === "minimal";
  const isFestival = template.layout === "festival";
  const isSpotlight = template.layout === "spotlight";
  const isTextile = template.category === "traditional" || template.category === "festive";
  const svgId = String(template.templateVersionId).replace(/[^a-z0-9_-]/gi, "-");
  const brand = instance?.display_name || instance?.displayName || "Tambola Night";
  const eventPatterns = poster.eventFacts?.winningPatterns || [];
  const rowHeight = Math.min(31, Math.max(18, (height * .2) / Math.max(eventPatterns.length, 1)));
  const patternBoxHeight = Math.max(156, Math.min(height * .24, eventPatterns.length * rowHeight + 76));
  const joinTop = patternsY + patternBoxHeight + 36;
  const eventMeta = [poster.organizerName && `Hosted by ${poster.organizerName}`, poster.venue && `Venue: ${poster.venue}`, poster.contactInfo && `Contact: ${poster.contactInfo}`].filter(Boolean).join(" · ");
  const bookingUrl = poster.bookingUrl || poster.eventFacts?.publicJoinUrl;
  return <svg ref={svgRef} className={`poster-art poster-art--${template.layout}${preview ? " is-preview" : ""}`} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${poster.title} poster preview`}>
    <defs>
      <linearGradient id={`poster-ground-${svgId}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={palette.background} /><stop offset="1" stopColor={palette.panel} /></linearGradient>
      <linearGradient id={`poster-accent-${svgId}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={palette.accent} /><stop offset="1" stopColor={palette.detail} /></linearGradient>
      <pattern id={`poster-dots-${svgId}`} width="42" height="42" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill={palette.accent} opacity=".24" /></pattern>
      <pattern id={`poster-weave-${svgId}`} width="42" height="42" patternUnits="userSpaceOnUse"><path d="M0 21H42M21 0V42M4 4l34 34M38 4 4 38" stroke={palette.accent} strokeWidth="2" opacity=".22" /></pattern>
      <radialGradient id={`poster-lamp-${svgId}`}><stop stopColor={palette.detail} stopOpacity=".88" /><stop offset=".32" stopColor={palette.accent} stopOpacity=".55" /><stop offset="1" stopColor={palette.accent} stopOpacity="0" /></radialGradient>
    </defs>
    <rect width={width} height={height} fill={`url(#poster-ground-${svgId})`} />
    {poster.artworkDataUrl || poster.artworkUrl ? <><image href={poster.artworkDataUrl || poster.artworkUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="xMidYMid slice" /><rect width={width} height={height} fill={palette.background} opacity=".36" /></> : null}
    {isTextile ? <rect width={width} height={height} fill={`url(#poster-weave-${svgId})`} opacity=".32" /> : null}
    {isFestival ? <><circle cx={width * 0.15} cy={height * 0.13} r={width * 0.12} fill={palette.detail} opacity=".62" /><circle cx={width * 0.85} cy={height * 0.18} r={width * 0.16} fill={palette.accent} opacity=".72" /><path d={`M0 ${height * 0.33} Q${cx} ${height * 0.23} ${width} ${height * 0.33} L${width} ${height} L0 ${height}Z`} fill={palette.panel} opacity=".75" /></> : null}
    {isSpotlight ? <><path d={`M${cx} 0 L${width * 0.72} ${height * 0.54} L${width * 0.28} ${height * 0.54}Z`} fill={palette.accent} opacity=".14" /><circle cx={cx} cy={height * 0.32} r={width * 0.27} fill="none" stroke={palette.detail} strokeWidth="4" opacity=".55" /></> : null}
    {!isMinimal ? <g aria-hidden="true" opacity={isFestival ? ".42" : ".22"}>
      <path d={`M${width * .08} ${height * .19} Q${cx} ${height * .29} ${width * .92} ${height * .19}`} fill="none" stroke={palette.accent} strokeWidth="4" />
      {Array.from({ length: 11 }, (_, index) => {
        const x = width * (.1 + index * .08);
        const y = height * (.19 + Math.sin((index / 10) * Math.PI) * .08);
        return <g key={index}><line x1={x} y1={height * .19} x2={x} y2={y + 17} stroke={palette.accent} strokeWidth="2" /><circle cx={x} cy={y + 23} r={index % 2 ? 7 : 9} fill={`url(#poster-lamp-${svgId})`} /><circle cx={x} cy={y + 23} r="3" fill={palette.detail} /></g>;
      })}
    </g> : null}
    {isFestival || isSpotlight ? <g aria-hidden="true" opacity=".58">{firework(width * .16, height * .36, width * .08, palette.detail)}{firework(width * .84, height * .39, width * .07, palette.accent)}</g> : null}
    {isMinimal ? <><rect x="54" y="54" width={width - 108} height={height - 108} rx="26" fill="none" stroke={palette.accent} strokeWidth="3" /><rect x="0" y="0" width={width} height={height} fill={`url(#poster-dots-${svgId})`} opacity=".4" /></> : <>
      <rect x="36" y="36" width={width - 72} height={height - 72} rx="42" fill="none" stroke={`url(#poster-accent-${svgId})`} strokeWidth="8" />
      <rect x="57" y="57" width={width - 114} height={height - 114} rx="32" fill="none" stroke={palette.accent} strokeWidth="2" opacity=".68" />
      <rect x="72" y="72" width={width - 144} height={height - 144} rx="26" fill="none" stroke={palette.detail} strokeWidth="1" strokeDasharray="2 13" opacity=".58" />
      {[[85, 85], [width - 85, 85], [85, height - 85], [width - 85, height - 85]].map(([x, y], index) => <g key={index} aria-hidden="true" transform={`translate(${x} ${y})`} fill="none" stroke={palette.accent} strokeWidth="4" opacity=".8"><path d="M0 -25Q7 -7 25 0Q7 7 0 25Q-7 7 -25 0Q-7 -7 0 -25Z" /><circle r="5" fill={palette.detail} /></g>)}
    </>}
    <rect x={width * .12} y={height * .1} width={width * .76} height={long ? 100 : 84} rx="42" fill={palette.panel} stroke={palette.accent} strokeOpacity=".7" strokeWidth="2" />
    <text x={cx} y={height * .1 + (long ? 66 : 57)} textAnchor="middle" fill={palette.accent} fontFamily="system-ui, sans-serif" fontWeight="700" fontSize={long ? 36 : 32} letterSpacing="5">{text(brand).toUpperCase()}</text>
    {titleLines.map((line, index) => <text key={`${index}-${line}`} data-poster-title="true" x={cx} y={titleY + index * titleLineHeight} textAnchor="middle" fill={palette.ink} fontFamily="Georgia, serif" fontWeight="700" fontSize={titleFontSize}>{line}</text>)}
    <path d={`M${width * .26} ${titleY + 42} H${width * .74}`} stroke={`url(#poster-accent-${svgId})`} strokeWidth="8" strokeLinecap="round" />
    <rect x={width * .13} y={scheduleY - 52} width={width * .74} height={108} rx="24" fill={palette.panel} stroke={palette.accent} strokeOpacity=".6" strokeWidth="2" />
    <text x={cx} y={scheduleY + 15} textAnchor="middle" fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize={long ? 44 : 40} fontWeight="700">{text(poster.schedule).slice(0, 42)}</text>
    <text x={cx} y={detailsY} textAnchor="middle" fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize={long ? 36 : 32}>{truncatePosterText(poster.details, 48)}</text>
    {poster.eventDetails ? <text x={cx} y={detailsY + 34} textAnchor="middle" fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize={long ? 25 : 22}>{text(poster.eventDetails).slice(0, 72)}</text> : null}
    <rect x={width * .11} y={patternsY - 44} width={width * .78} height={patternBoxHeight} rx="25" fill={palette.panel} opacity=".94" stroke={palette.accent} strokeOpacity=".64" strokeWidth="2" />
    <text x={cx} y={patternsY - 8} textAnchor="middle" fill={palette.accent} fontFamily="system-ui, sans-serif" fontWeight="700" fontSize={long ? 25 : 23} letterSpacing="3">WINNING PATTERNS · GAME POINTS</text>
    {eventPatterns.length ? eventPatterns.map((item, index) => <g key={item.id}><text x={width * .16} y={patternsY + 27 + index * rowHeight} fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize={Math.min(25, rowHeight * .72)}>{text(item.label).slice(0, 36)}</text><text x={width * .84} y={patternsY + 27 + index * rowHeight} textAnchor="end" fill={palette.accent} fontFamily="system-ui, sans-serif" fontSize={Math.min(25, rowHeight * .72)} fontWeight="700">{item.points} pts</text></g>) : <text x={cx} y={patternsY + 45} textAnchor="middle" fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize="24">{text(poster.patterns || "Pattern configuration unavailable").slice(0, 72)}</text>}
    <text x={cx} y={joinTop} textAnchor="middle" fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize={long ? 24 : 21}>{poster.eventFacts?.roomCode ? `Room ${poster.eventFacts.roomCode}` : "Free to play"} · {text(poster.eventFacts?.ticketAvailability || "Join the game hall")}</text>
    <rect x={width * .2} y={joinTop + 16} width={width * .6} height="62" rx="31" fill={`url(#poster-accent-${svgId})`} />
    <text x={cx} y={joinTop + 56} textAnchor="middle" fill={palette.background} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="27">{text(poster.cta || "Join the game")}</text>
    {eventMeta ? <text x={cx} y={joinTop + 100} textAnchor="middle" fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize={long ? 19 : 16}>{truncatePosterText(eventMeta, 90)}</text> : null}
    {bookingUrl ? <text x={cx} y={joinTop + 128} textAnchor="middle" fill={palette.ink} fontFamily="system-ui, sans-serif" fontSize={long ? 20 : 17}>{text(bookingUrl).slice(0, 80)}</text> : null}
    {template.layout === "classic" ? <g transform={`translate(${width * .3},${height * .75})`} fill="none" stroke={palette.accent} strokeWidth="7">{Array.from({ length: 9 }, (_, i) => <rect key={i} x={(i % 3) * 68} y={Math.floor(i / 3) * 54} width="48" height="38" rx="8" opacity={i % 2 ? ".45" : ".9"} />)}</g> : null}
    {isFestival ? <g fill={palette.detail} opacity=".85"><path d={`M${width * .2} ${height * .79} q-50 70 0 135 q50-65 0-135`} /><path d={`M${width * .8} ${height * .77} q-55 80 0 150 q55-70 0-150`} /></g> : null}
    <text x={cx} y={height * .975} textAnchor="middle" fill={palette.accent} fontFamily="system-ui, sans-serif" fontWeight="700" fontSize={long ? 26 : 21} letterSpacing="3">FREE TO PLAY · NO CASH PRIZES</text>
  </svg>;
}
