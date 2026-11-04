import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Button from "../components/Button.jsx";
import { api } from "./api.js";
import { formatNumber } from "./format.js";
import { Badge, Empty, ErrorNote, Field, Loading, Section, Table } from "./ui.jsx";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const METRICS = [
  ["rooms", "Rooms created"], ["open_rooms", "Open rooms"], ["rounds", "Rounds started"],
  ["completed_rounds", "Rounds completed"], ["players", "Participants"], ["tickets", "Tickets issued"],
  ["valid_claims", "Accepted claims"], ["rejected_claims", "Rejected claims"], ["awards", "Awards"],
  ["reservations", "Reservations"], ["held_reservations", "Holds"], ["confirmed_reservations", "Confirmed"],
  ["cancelled_reservations", "Cancelled"], ["expired_reservations", "Expired"], ["reserved_tickets", "Held/confirmed tickets"],
];

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export default function AdminReports() {
  const [search, setSearch] = useSearchParams();
  const [instances, setInstances] = useState([]);
  const [filters, setFilters] = useState({ instanceId: search.get("instanceId") || "", from: daysAgo(29), to: today() });
  const initialFilters = useRef(filters);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (next) => {
    setLoading(true); setError(null);
    try {
      const [instancesData, reportData] = await Promise.all([
        api.instances(), api.instanceReports({ instanceId: next.instanceId, from: next.from, to: next.to }),
      ]);
      setInstances(instancesData.instances || []);
      setReport(reportData);
      const params = new URLSearchParams();
      if (next.instanceId) params.set("instanceId", next.instanceId);
      setSearch(params, { replace: true });
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  }, [setSearch]);

  useEffect(() => { load(initialFilters.current); }, [load]); // initial page load only; filters apply explicitly

  const dailyRows = useMemo(() => (report?.daily || []).map((row) => ({ ...row, metricLabel: METRICS.find(([key]) => key === row.metric)?.[1] || row.metric })), [report]);

  function downloadCsv() {
    if (!report) return;
    const header = ["instance_id", "instance_name", "from_utc", "to_utc", ...METRICS.map(([, label]) => label)];
    const rows = report.instances.map((instance) => [instance.instance_id, instance.display_name, report.from, report.to, ...METRICS.map(([key]) => instance[key] ?? 0)]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `instance-report-${report.from}-to-${report.to}.csv`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <div className="adm-page">
    <header className="adm-page-head"><div><p className="oh-eyebrow">Platform reporting</p><h1 className="oh-display adm-page-title">Instance activity</h1><p className="adm-sub">Aggregate operational activity from persisted records. Player names and booking credentials are never included.</p></div><div className="adm-actions"><Badge tone="gold">UTC dates</Badge><Button variant="ghost" size="sm" onClick={() => load(filters)} disabled={loading}>Refresh</Button><Button variant="gold" size="sm" onClick={downloadCsv} disabled={!report || loading}>Download CSV</Button></div></header>
    <Section title="Report filters" description="Choose an instance and an inclusive UTC date range (up to 366 days).">
      <form className="adm-form" onSubmit={(event) => { event.preventDefault(); load(filters); }}>
        <div className="adm-form-row">
          <Field label="Instance" htmlFor="report-instance"><select id="report-instance" className="oh-field" value={filters.instanceId} onChange={(event) => setFilters((old) => ({ ...old, instanceId: event.target.value }))}><option value="">All instances</option>{instances.map((instance) => <option key={instance.instance_id} value={instance.instance_id}>{instance.display_name}</option>)}</select></Field>
          <Field label="From (UTC)" htmlFor="report-from"><input id="report-from" className="oh-field" type="date" required value={filters.from} onChange={(event) => setFilters((old) => ({ ...old, from: event.target.value }))} /></Field>
          <Field label="To (UTC)" htmlFor="report-to"><input id="report-to" className="oh-field" type="date" required value={filters.to} onChange={(event) => setFilters((old) => ({ ...old, to: event.target.value }))} /></Field>
        </div>
        <Button type="submit" variant="gold" disabled={loading}>{loading ? "Loading report…" : "Apply filters"}</Button>
      </form>
    </Section>
    {error ? <ErrorNote title="Report could not be loaded" error={error} onRetry={() => load(filters)} /> : null}
    {loading && !report ? <Loading block label="Reading instance activity…" /> : null}
    {report ? <>
      <Section title="Instance summary" description={`${report.from} through ${report.to}, inclusive (UTC).`}>
        {report.instances.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Instance</th>{METRICS.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{report.instances.map((instance) => <tr key={instance.instance_id}><th scope="row" data-label="Instance"><span className="adm-mobile-label" aria-hidden="true">Instance</span>{instance.display_name}</th>{METRICS.map(([key, label]) => <td className="oh-num" data-label={label} key={key}><span className="adm-mobile-label" aria-hidden="true">{label}</span>{formatNumber(instance[key] ?? 0)}</td>)}</tr>)}</tbody></Table> : <Empty title="No instance records">There are no instances in this report.</Empty>}
      </Section>
      <Section title="Daily activity" description="Counts are grouped by event date and instance; participants are distinct per day.">
        {dailyRows.length ? <Table className="adm-table--mobile-cards"><thead><tr><th>Date (UTC)</th><th>Instance</th><th>Activity</th><th>Count</th></tr></thead><tbody>{dailyRows.map((row, index) => <tr key={`${row.day}-${row.instance_id}-${row.metric}-${index}`}><td data-label="Date (UTC)"><span className="adm-mobile-label" aria-hidden="true">Date (UTC)</span>{String(row.day).slice(0, 10)}</td><td data-label="Instance"><span className="adm-mobile-label" aria-hidden="true">Instance</span>{instances.find((item) => item.instance_id === row.instance_id)?.display_name || row.instance_id}</td><td data-label="Activity"><span className="adm-mobile-label" aria-hidden="true">Activity</span>{row.metricLabel}</td><td className="oh-num" data-label="Count"><span className="adm-mobile-label" aria-hidden="true">Count</span>{formatNumber(row.value)}</td></tr>)}</tbody></Table> : <Empty title="No activity in this range">Daily rows appear when matching persisted activity exists.</Empty>}
      </Section>
    </> : null}
  </div>;
}
