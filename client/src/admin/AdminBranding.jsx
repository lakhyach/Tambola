import { useEffect, useState } from "react";
import Button from "../components/Button.jsx";
import { assetUrl, getPlatformBranding, setPlatformBranding, usePlatformBranding } from "../platform-branding.js";
import { api } from "./api.js";
import { useAdmin } from "./useAdmin.js";
import { Banner, ErrorNote, Field, Loading, Section } from "./ui.jsx";

const ASSETS = (platformName) => [
  ["tambola-house-mark.svg", `${platformName} compact mark`],
  ["tambola-house-lockup.svg", `${platformName} horizontal lockup`],
  ["tambola-house-icon.svg", "Existing app icon"],
  ["tambola-house-social-card.svg", "Existing social card"],
  ["regular-mark.svg", "Regular instance mark"],
  ["bumper-mark.svg", "Bumper instance mark"],
];

const LABELS = {
  name: "Platform name", tagline: "Tagline", subtitle: "Browser and share description", mark: "Header label",
  logo: "Compact logo", horizontalLogo: "Horizontal logo", icon: "Favicon and app icon", socialCard: "Social sharing image",
  accent: "Primary accent", accentBright: "Bright accent", accentDeep: "Deep accent", coral: "Highlight accent",
  termsUrl: "Terms URL", privacyUrl: "Privacy URL", supportUrl: "Support URL", footerNotice: "Footer notice",
};

export default function AdminBranding() {
  const liveBrand = usePlatformBranding();
  const { toast } = useAdmin();
  const [draft, setDraft] = useState(null);
  const [durable, setDurable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    api.platformBranding().then((result) => {
      if (!active) return;
      const branding = result.branding || getPlatformBranding();
      setDraft(branding);
      setDurable(Boolean(result.durable));
      setPlatformBranding(branding);
      setLoading(false);
    }).catch((reason) => {
      if (active) { setError(reason); setLoading(false); }
    });
    return () => { active = false; };
  }, []);

  function update(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api.savePlatformBranding(draft);
      setDraft(result.branding);
      setDurable(Boolean(result.durable));
      setPlatformBranding(result.branding);
      toast("Platform identity saved and applied.", "success");
    } catch (reason) { setError(reason); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="adm-page"><Loading block label="Loading platform identity…" /></div>;
  if (!draft) return <div className="adm-page"><ErrorNote title="Platform identity could not load" error={error} onRetry={() => window.location.reload()} /></div>;

  const textFields = ["name", "tagline", "subtitle", "mark", "footerNotice"];
  const urls = ["termsUrl", "privacyUrl", "supportUrl"];
  const assets = ["logo", "horizontalLogo", "icon", "socialCard"];
  return (
    <div className="adm-page">
      <header className="adm-page-head">
        <div>
          <p className="oh-eyebrow">Platform controls</p>
          <h1 className="oh-display adm-page-title">Platform identity</h1>
          <p className="adm-sub">Manage the shared name, original local marks, metadata, links and design accents. Instance identity remains independently configurable.</p>
        </div>
        <span className="adm-badge" data-tone={durable ? "gold" : "warn"}>{durable ? "Saved in platform settings" : "Memory only"}</span>
      </header>

      {!durable ? <Banner tone="warn" title="This server is not using durable storage">Changes apply to this process only and will be lost when it stops.</Banner> : null}
      {error ? <ErrorNote title="Identity was not saved" error={error} /> : null}

      <Section eyebrow="Preview" title="Current public identity">
        <div className="adm-platform-brand-preview">
          <img src={assetUrl(liveBrand.horizontalLogo)} alt="" width="210" height="64" />
          <div><strong>{liveBrand.name}</strong><p>{liveBrand.tagline}</p><small>{liveBrand.subtitle}</small></div>
        </div>
      </Section>

      <Section eyebrow="Shared configuration" title="Edit platform identity">
        <form className="adm-form" onSubmit={save}>
          <div className="adm-form-row">
            {textFields.map((key) => (
              <Field key={key} label={LABELS[key]} htmlFor={`platform-brand-${key}`}>
                <input id={`platform-brand-${key}`} className="oh-field" maxLength={key === "name" ? 48 : key === "subtitle" || key === "footerNotice" ? 180 : key === "tagline" ? 100 : 32} value={draft[key] || ""} onChange={(event) => update(key, event.target.value)} required={key === "name"} />
              </Field>
            ))}
            {assets.map((key) => (
              <Field key={key} label={LABELS[key]} htmlFor={`platform-brand-${key}`}>
                <select id={`platform-brand-${key}`} className="oh-field" value={draft[key]} onChange={(event) => update(key, event.target.value)}>
                  {ASSETS(liveBrand.name).map(([filename, label]) => <option key={filename} value={filename}>{label}</option>)}
                </select>
              </Field>
            ))}
            <div className="adm-instance-colors">
              {["accent", "accentBright", "accentDeep", "coral"].map((key) => (
                <label key={key}>{LABELS[key]}<input type="color" aria-label={LABELS[key]} value={draft[key]} onChange={(event) => update(key, event.target.value)} /></label>
              ))}
            </div>
            {urls.map((key) => (
              <Field key={key} label={LABELS[key]} htmlFor={`platform-brand-${key}`} hint="Optional. Use an HTTPS URL; leave blank to hide the link.">
                <input id={`platform-brand-${key}`} className="oh-field" type="url" inputMode="url" maxLength={2048} value={draft[key] || ""} onChange={(event) => update(key, event.target.value)} />
              </Field>
            ))}
          </div>
          <p className="adm-note">Logos and icons are selected from curated local assets. Arbitrary URLs and uploaded markup are not accepted. Accent colors are checked against the platform&apos;s dark surface for readable contrast. Published themes and instance theme choices keep their own palettes; these accents provide the platform fallback.</p>
          <div className="adm-actions"><Button type="submit" variant="gold" disabled={saving}>{saving ? "Saving…" : "Save platform identity"}</Button></div>
        </form>
      </Section>
    </div>
  );
}
