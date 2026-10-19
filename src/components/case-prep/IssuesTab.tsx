import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, ExternalLink, Pencil, RotateCcw, Scale, X } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { casePrepApi, errorMessage } from '@/lib/case-prep/api';
import { REVIEW_LABEL, factProvenance, isReviewed } from '@/lib/case-prep/provenance';
import type { Fact, Issue, SourceTarget, StatuteSummary } from '@/lib/case-prep/types';
import { cn } from '@/lib/utils';
import { CPButton } from './CPButton';
import { CitationChip } from './FactsTab';
import { ProvenanceTag } from './Provenance';
import { EmptyState } from './StateViews';

const ISSUE_TYPE_LABEL: Record<Issue['issue_type'], string> = {
  substantive: 'Substantive', procedural: 'Procedural', evidentiary: 'Evidentiary', jurisdictional: 'Jurisdiction', limitation: 'Limitation', other: 'Other',
};

function IssueCard({ issue, factById, onOpenSource, onChanged, verifyAt }: {
  issue: Issue; factById: Map<string, Fact>; onOpenSource: (t: SourceTarget) => void; onChanged: () => void; verifyAt: string;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(issue.title);
  const [analysis, setAnalysis] = useState(issue.analysis || '');
  useEffect(() => {
    if (!editing) {
      setTitle(issue.title);
      setAnalysis(issue.analysis || '');
    }
  }, [issue, editing]);

  const update = useMutation({
    mutationFn: (data: Parameters<typeof casePrepApi.updateIssue>[1]) => casePrepApi.updateIssue(issue.id, data),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const supporting = issue.fact_ids.map((id) => factById.get(id)).filter(Boolean) as Fact[];

  return (
    <li className={cn('cp-rail py-4', issue.review_status === 'rejected' && 'opacity-60')} data-prov="ai" id={`issue-${issue.id}`}>
      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Issue title" />
          <Textarea value={analysis} onChange={(e) => setAnalysis(e.target.value)} rows={6} aria-label="Analysis" className="cp-serif" />
          <div className="flex gap-2">
            <CPButton size="sm" variant="primary" onClick={() => update.mutate({ title: title.trim(), analysis: analysis.trim() })} disabled={update.isPending || title.trim().length < 3}>
              Save and accept
            </CPButton>
            <CPButton size="sm" variant="quiet" onClick={() => setEditing(false)}>Cancel</CPButton>
          </div>
        </div>
      ) : (
        <>
          <h3 className={cn('text-base', issue.review_status === 'rejected' && 'line-through')}>{issue.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <ProvenanceTag kind="ai" />
            <span>{ISSUE_TYPE_LABEL[issue.issue_type]}</span>
            <span className={cn(isReviewed(issue.review_status) && 'text-foreground')}>{REVIEW_LABEL[issue.review_status]}</span>
          </div>
          {issue.analysis ? <p className="cp-serif mt-3 max-w-prose whitespace-pre-wrap leading-relaxed">{issue.analysis}</p> : null}
        </>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <section>
          <h4 className="mb-1.5 text-sm">Relies on</h4>
          {supporting.length ? (
            <ul className="space-y-2">
              {supporting.map((f) => (
                <li key={f.id} className="cp-rail text-sm" data-prov={factProvenance(f)}>
                  <p className="cp-serif">{f.statement}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {f.citations.length ? f.citations.slice(0, 2).map((c) => <CitationChip key={c.id} citation={c} onOpen={onOpenSource} />) : <ProvenanceTag kind={factProvenance(f)} />}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[hsl(var(--cp-unverified))]">Not linked to any extracted fact. Treat with caution.</p>
          )}
        </section>

        <section>
          <h4 className="mb-1.5 text-sm">Provisions the AI suggests</h4>
          {issue.provisions.length ? (
            <ul className="space-y-1.5 text-sm">
              {issue.provisions.map((p, i) => (
                <li key={i}>
                  <span className="font-medium">{p.act}, {p.section}</span>
                  {p.relevance ? <span className="text-muted-foreground">: {p.relevance}</span> : null}
                  <span className="block text-xs text-[hsl(var(--cp-unverified))]">
                    Authority not verified{p.act_recognised ? '' : '; this act is not in the recognised list'}.{' '}
                    <a href={verifyAt} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline underline-offset-2">
                      Check on India Code <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">None suggested.</p>}
        </section>
      </div>

      {issue.evidence_gaps.length || issue.counter_arguments.length ? (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {issue.evidence_gaps.length ? (
            <section>
              <h4 className="mb-1.5 text-sm">Evidence that appears to be missing</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">{issue.evidence_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </section>
          ) : null}
          {issue.counter_arguments.length ? (
            <section>
              <h4 className="mb-1.5 text-sm">Likely counter-arguments</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">{issue.counter_arguments.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {issue.sanitation_notes.length ? (
        <ul className="mt-3 space-y-0.5 text-xs text-muted-foreground">
          {issue.sanitation_notes.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      ) : null}

      {!editing ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {issue.review_status === 'rejected' ? (
            <CPButton size="sm" variant="quiet" onClick={() => update.mutate({ review_status: 'pending' })} disabled={update.isPending}>
              <RotateCcw aria-hidden="true" /> Restore
            </CPButton>
          ) : (
            <>
              {!isReviewed(issue.review_status) ? (
                <CPButton size="sm" variant="accept" onClick={() => update.mutate({ review_status: 'accepted' })} disabled={update.isPending}>
                  <Check aria-hidden="true" /> Accept analysis
                </CPButton>
              ) : null}
              <CPButton size="sm" variant="quiet" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /> Edit</CPButton>
              <CPButton size="sm" variant="quiet" onClick={() => update.mutate({ review_status: 'rejected' })} disabled={update.isPending}>
                <X aria-hidden="true" /> Reject
              </CPButton>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function IssuesTab({ issues, facts, statutes, onOpenSource, onChanged, verifyAt }: {
  issues: Issue[]; facts: Fact[]; statutes: StatuteSummary[]; onOpenSource: (t: SourceTarget) => void; onChanged: () => void; verifyAt: string;
}) {
  const factById = new Map(facts.map((f) => [f.id, f]));
  return (
    <div className="space-y-8">
      <section aria-labelledby="statutes-heading" className="rounded-lg border border-border px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="statutes-heading" className="text-base">Provisions written in the documents</h3>
          <ProvenanceTag kind="rule" />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Found by matching section references (English and Hindi) in the source text. These show what the papers say, not whether the provision applies.</p>
        {statutes.length ? (
          <ul className="mt-3 space-y-2.5">
            {statutes.map((s) => (
              <li key={s.act_key}>
                <p className="text-sm"><span className="font-medium">{s.act_label}</span>: {s.unit} {s.sections.join(', ')}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {s.occurrences.slice(0, 6).map((o, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => o.document_id && onOpenSource({ documentId: o.document_id, passageLabel: o.passage_label, quote: o.snippet })}
                      className="rounded border border-[hsl(var(--cp-rule)/0.5)] px-1.5 py-0.5 text-xs text-[hsl(var(--cp-rule))] hover:bg-[hsl(var(--cp-rule)/0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      title={o.snippet}
                    >
                      {o.document_name}, p. {o.page_number}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-muted-foreground">No section references found in the uploaded text.</p>}
      </section>

      {!issues.length ? (
        <EmptyState icon={<Scale className="h-8 w-8" />} title="No issues yet">
          After facts are extracted, analysis lists the legal issues they raise, each tied to the facts it relies on.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {issues.map((i) => <IssueCard key={i.id} issue={i} factById={factById} onOpenSource={onOpenSource} onChanged={onChanged} verifyAt={verifyAt} />)}
        </ul>
      )}
    </div>
  );
}
