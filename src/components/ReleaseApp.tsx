"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReleaseResult } from "@/lib/release/types";
import { parseReleaseInput } from "@/lib/release/validation";
import { ModuleNav } from "./ModuleNav";
import { ThemeToggle } from "./ThemeToggle";
import { applyReleaseEdits, type ChangeEdit } from "@/lib/release/review";
import { renderNotes } from "@/lib/release/analysis";

export function ReleaseApp() {
  const [repository, setRepository] = useState("");
  const [base, setBase] = useState("");
  const [head, setHead] = useState("main");
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [originalResult, setResult] = useState<ReleaseResult | null>(null);
  const [edits, setEdits] = useState<Record<string, ChangeEdit>>({});
  const result = useMemo(() => {
    if (!originalResult) return null;
    const analysis = applyReleaseEdits(originalResult.analysis, edits);
    return { analysis, notes: renderNotes(analysis) };
  }, [originalResult, edits]);
  const [audience, setAudience] = useState<"technical" | "customer">("technical");
  const [copyStatus, setCopyStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (controller.current) return;
    setError(""); setResult(null); setCopyStatus(""); setEdits({});
    try {
      const input = parseReleaseInput({ repository, base, head, useAi });
      controller.current = new AbortController();
      setBusy(true);
      const response = await fetch("/api/releases/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: controller.current.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Release analysis failed. Please try again.");
      if (!data) throw new Error("Release analysis returned an unreadable response.");
      setResult(data as ReleaseResult);
    } catch (err) {
      if (!(err instanceof Error && err.name === "AbortError")) setError(err instanceof Error ? err.message : "Release analysis failed.");
    } finally { controller.current = null; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(result!.notes[audience]); setCopyStatus("Copied Markdown."); }
    catch { setCopyStatus("Clipboard unavailable. Select and copy the notes below."); }
  }
  function editChange(id: string, patch: ChangeEdit) {
    setEdits(current => ({ ...current, [id]: { ...current[id], ...patch } }));
    setCopyStatus("");
  }
  const inputClass = "mt-2 w-full rounded-md border border-bg-border bg-bg-panel p-3 text-ink focus:border-status-running focus:outline-none";

  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
    <header className="flex items-center justify-between gap-4"><ModuleNav active="release" /><ThemeToggle /></header>
    <div><p className="text-sm text-ink-400">Vizu / Release</p><h1 className="mt-2 text-3xl font-semibold text-ink">Understand what shipped.</h1>
      <p className="mt-3 max-w-2xl text-ink-300">Turn a public GitHub comparison into technical and customer release notes, with sources behind every change.</p></div>
    <form onSubmit={submit} className="rounded-xl border border-bg-border bg-bg-raised p-5">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm text-ink">Public GitHub repository<input required maxLength={250} value={repository} onChange={e => setRepository(e.target.value)} placeholder="owner/repository or https://github.com/owner/repository" className={inputClass} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-ink">Base ref or tag<input required maxLength={200} value={base} onChange={e => setBase(e.target.value)} placeholder="v1.0.0" className={inputClass} /></label>
          <label className="block text-sm text-ink">Head ref<input required maxLength={200} value={head} onChange={e => setHead(e.target.value)} placeholder="main" className={inputClass} /></label>
        </div>
        <p className="text-xs text-ink-400">Up to 40 commits. Head must descend from base. Public metadata only; never enter credentials. Nothing is published or saved to a database.</p>
        <label className="flex items-start gap-2 text-sm text-ink-200"><input type="checkbox" checked={useAi} onChange={e => setUseAi(e.target.checked)} className="mt-1" /><span>Improve wording with AI when available. This sends eligible public change titles to Anthropic. Without AI, deterministic notes still work.</span></label>
        <button type="submit" className="rounded-md bg-status-running px-5 py-2.5 font-medium text-white disabled:opacity-50">{busy ? "Analyzing changes…" : "Analyze release"}</button>
      </fieldset>
      {busy && <p role="status" className="mt-3 text-sm text-ink-300">Collecting commits and pull requests, then preparing your draft…</p>}
    </form>
    {error && <p role="alert" className="rounded-md border border-status-failure p-4 text-ink">{error}</p>}
    {result && <>
      <section aria-label="Release summary" className="space-y-3">
        <h2 className="text-xl font-semibold text-ink">{result.analysis.changes.filter(c => c.releaseWorthy).length} release-worthy / {result.analysis.changes.length} changes</h2>
        <p className="text-sm text-ink-300">{result.analysis.repository} · {result.analysis.baseSha.slice(0, 7)} → {result.analysis.headSha.slice(0, 7)} · {result.analysis.source === "claude" ? "AI-assisted draft" : "Deterministic draft"}</p>
        <a className="text-sm text-status-running underline" href={result.analysis.compareUrl} target="_blank" rel="noreferrer">View comparison on GitHub</a>
        <p className="text-sm text-ink-300">Impact and confidence are inferred from metadata, not verified product behavior. Review wording and breaking changes before sharing. Security-sensitive details are withheld from exported notes.</p>
        <p className="text-sm text-ink-300">Open each change below to adjust inclusion and wording. Edits stay in this page and are lost when you leave or analyze another range.</p>
        <button disabled={!Object.keys(edits).length} onClick={() => { setEdits({}); setCopyStatus(""); }} className="rounded border border-bg-border px-3 py-2 text-sm text-ink disabled:opacity-50">Reset draft edits</button>
        {result.analysis.warnings.map(w => <p key={w} role="note" className="text-sm text-ink-300">{w}</p>)}
      </section>
      <section className="rounded-xl border border-bg-border bg-bg-panel p-5" aria-label="Release notes">
        <div className="flex flex-wrap gap-3">
          <button aria-pressed={audience === "technical"} onClick={() => { setAudience("technical"); setCopyStatus(""); }} className="rounded border border-bg-border px-3 py-2 text-ink">Technical</button>
          <button aria-pressed={audience === "customer"} onClick={() => { setAudience("customer"); setCopyStatus(""); }} className="rounded border border-bg-border px-3 py-2 text-ink">Customer</button>
          <button onClick={copy} className="rounded border border-bg-border px-3 py-2 text-ink sm:ml-auto">Copy Markdown</button>
        </div>
        <p role="status" className="mt-2 text-sm text-ink-300">{copyStatus}</p>
        <textarea aria-label={`${audience === "technical" ? "Technical" : "Customer"} release notes`} readOnly value={result.notes[audience]} className="mt-3 min-h-80 w-full resize-y rounded border border-bg-border bg-bg p-4 font-mono text-sm text-ink" />
      </section>
      <section aria-label="Change evidence" className="space-y-3">
        <h2 className="text-xl font-semibold text-ink">Changes and evidence</h2>
        {!result.analysis.changes.length && <p className="text-ink-300">These refs contain no new commits.</p>}
        {result.analysis.changes.map((change, index) => <details key={change.id} className="rounded-lg border border-bg-border bg-bg-panel p-4">
          <summary className="cursor-pointer text-sm font-medium text-ink">{change.securitySensitive ? "Security-related change — review required" : change.title} · {change.releaseWorthy ? "Included" : "Excluded"}</summary>
          <p className="mt-3 text-sm text-ink-300">{change.reason}</p>
          <p className="mt-2 text-xs text-ink-400">Category: {change.category} · Impact: {change.impact} · Importance: {change.importance} · Confidence: {change.confidence} · Breaking: {change.breakingChange ? "yes" : "no"} · Security-sensitive: {change.securitySensitive ? "yes" : "no"}</p>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink"><input type="checkbox" aria-label={`Include change ${index + 1}`} checked={change.releaseWorthy} onChange={e => editChange(change.id, { included: e.target.checked })} />Include in notes</label>
          {change.securitySensitive ? <p className="mt-3 text-sm text-ink-300">Sensitive wording is protected. Review the linked source separately; including this change keeps its details withheld.</p> : <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-ink">Technical wording<textarea aria-label={`Technical wording ${index + 1}`} maxLength={600} value={edits[change.id]?.technical ?? change.technical} onChange={e => editChange(change.id, { technical: e.target.value })} className={inputClass} /></label>
            <label className="text-sm text-ink">Customer wording<textarea aria-label={`Customer wording ${index + 1}`} maxLength={600} value={edits[change.id]?.customer ?? change.customer} onChange={e => editChange(change.id, { customer: e.target.value })} className={inputClass} /></label>
          </div>}
          <ul className="mt-3 flex flex-wrap gap-4">{change.evidence.map(e => <li key={e.id}><a href={e.url} target="_blank" rel="noreferrer" className="text-sm text-status-running underline">{e.label}</a></li>)}</ul>
        </details>)}
      </section>
      <details className="rounded-lg border border-bg-border p-4"><summary className="cursor-pointer text-ink">Changed files ({result.analysis.files.length})</summary><p className="my-3 text-xs text-ink-400">Evidence for the whole comparison; files are not attributed to individual changes.</p><ul className="space-y-2">{result.analysis.files.map(e => <li key={e.id}><a href={e.url} target="_blank" rel="noreferrer" className="break-all text-sm text-status-running underline">{e.label}</a></li>)}</ul></details>
    </>}
  </main>;
}
