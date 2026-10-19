import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CheckCircle2, Download, ExternalLink, FileSignature, Loader2, Plus, Printer, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, casePrepApi, errorMessage } from '@/lib/case-prep/api';
import { briefToHtml, briefToMarkdown, downloadText, safeFilename } from '@/lib/case-prep/export';
import { factProvenance, formatFactDate, originProvenance } from '@/lib/case-prep/provenance';
import type { Brief, BriefBlock, BriefSection, Fact, Issue, Provision, ReviewCheck, SourceTarget, StatuteSummary, Workspace } from '@/lib/case-prep/types';
import { cn } from '@/lib/utils';
import { CPButton } from './CPButton';
import { CitationChip } from './FactsTab';
import { ProvenanceLegend, ProvenanceTag } from './Provenance';
import { EmptyState, ErrorState, LoadingRows } from './StateViews';

const EDITABLE = new Set(['context', 'fact', 'analysis', 'note']);

function newNoteId() {
  return `note-${crypto.randomUUID()}`;
}

function BlockText({ value, onChange, label, serif = true }: { value: string; onChange: (v: string) => void; label: string; serif?: boolean }) {
  const rows = Math.min(14, Math.max(1, Math.ceil(value.length / 90) + (value.match(/\n/g)?.length || 0)));
  return (
    <Textarea
      aria-label={label}
      value={value}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      className={cn('min-h-0 resize-y border-transparent bg-transparent px-1 py-1 text-[0.98rem] leading-7 shadow-none hover:border-border focus-visible:border-border focus-visible:ring-1 focus-visible:ring-offset-0', serif && 'cp-serif')}
    />
  );
}

function BlockView({
  block, factById, issueById, onOpenSource, onText, onMove, onDelete, isFirst, isLast,
}: {
  block: BriefBlock; factById: Map<string, Fact>; issueById: Map<string, Issue>;
  onOpenSource: (t: SourceTarget) => void; onText: (text: string) => void; onMove: (dir: -1 | 1) => void; onDelete: () => void; isFirst: boolean; isLast: boolean;
}) {
  const fact = block.fact_id ? factById.get(block.fact_id) : undefined;
  const issue = block.issue_id ? issueById.get(block.issue_id) : undefined;
  const prov = block.kind === 'fact' && fact ? factProvenance(fact)
    : block.kind === 'unverified' ? 'unverified'
      : block.kind === 'statutes' ? 'rule'
        : originProvenance(block.origin);

  const controls = (
    <div className="flex shrink-0 gap-0.5 opacity-70 focus-within:opacity-100 group-hover:opacity-100">
      <CPButton size="icon" variant="quiet" onClick={() => onMove(-1)} disabled={isFirst} aria-label="Move up"><ArrowUp /></CPButton>
      <CPButton size="icon" variant="quiet" onClick={() => onMove(1)} disabled={isLast} aria-label="Move down"><ArrowDown /></CPButton>
      <CPButton size="icon" variant="quiet" onClick={onDelete} aria-label="Remove from brief"><Trash2 /></CPButton>
    </div>
  );

  let body: JSX.Element;
  switch (block.kind) {
    case 'context':
    case 'note':
    case 'fact':
    case 'analysis':
      body = (
        <>
          {block.kind === 'analysis' ? <h4 className="mb-1 text-[0.95rem]">{block.title || issue?.title}</h4> : null}
          <BlockText value={block.text || ''} onChange={onText} label={block.kind === 'fact' ? 'Fact wording' : block.kind === 'analysis' ? 'Analysis' : 'Text'} />
          {block.kind === 'fact' && fact ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {fact.citations.map((c) => <CitationChip key={c.id} citation={c} onOpen={onOpenSource} />)}
              {block.edited ? <span className="text-xs text-muted-foreground">Reworded; the source quote is unchanged.</span> : null}
            </div>
          ) : null}
          {block.kind === 'fact' && !fact ? <p className="text-xs text-destructive">The fact behind this block no longer exists.</p> : null}
        </>
      );
      break;
    case 'chronology': {
      const rows = (block.fact_ids || []).map((id) => factById.get(id)).filter(Boolean) as Fact[];
      body = rows.length ? (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} className="align-top">
                <th scope="row" className="w-32 whitespace-nowrap py-1 pr-4 text-left font-semibold tabular-nums">{formatFactDate(f.event_date, f.date_precision)}</th>
                <td className="cp-serif py-1">
                  {f.statement}{' '}
                  {f.citations.slice(0, 1).map((c) => <CitationChip key={c.id} citation={c} onOpen={onOpenSource} />)}
                  {f.review_status === 'rejected' ? <span className="ml-1 text-xs text-destructive">rejected</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-sm text-muted-foreground">No dated facts.</p>;
      break;
    }
    case 'statutes': {
      const items = (block.items || []) as StatuteSummary[];
      body = items.length ? (
        <ul className="space-y-1 text-sm">{items.map((s) => <li key={s.act_key}><span className="font-medium">{s.act_label}</span>: {s.unit} {s.sections.join(', ')}</li>)}</ul>
      ) : <p className="text-sm text-muted-foreground">No section references found in the documents.</p>;
      break;
    }
    case 'suggested_provisions': {
      const items = (block.items || []) as Provision[];
      body = items.length ? (
        <ul className="space-y-1 text-sm">
          {items.map((p, i) => (
            <li key={i}>
              {p.act}, {p.section}{p.relevance ? <span className="text-muted-foreground">: {p.relevance}</span> : null}
              <span className="ml-1 text-xs text-[hsl(var(--cp-unverified))]">authority not verified</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted-foreground">None.</p>;
      break;
    }
    case 'gaps': {
      const items = (block.items || []) as string[];
      body = items.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((g, i) => <li key={i}>{g}</li>)}</ul> : <p className="text-sm text-muted-foreground">None identified.</p>;
      break;
    }
    case 'unverified': {
      const rows = (block.fact_ids || []).map((id) => factById.get(id)).filter(Boolean) as Fact[];
      body = rows.length ? (
        <ul className="space-y-1 text-sm">{rows.map((f) => <li key={f.id} className="cp-serif">{f.statement} <span className="font-sans text-xs text-[hsl(var(--cp-unverified))]">{f.unverified_reason}</span></li>)}</ul>
      ) : <p className="text-sm text-muted-foreground">None.</p>;
      break;
    }
    default:
      body = <></>;
  }

  return (
    <div className="cp-rail group py-2" data-prov={prov}>
      <div className="mb-1 flex items-center justify-between gap-2">
        {block.kind === 'chronology' ? (
          <span className="text-xs text-muted-foreground">Built from the facts above; each entry keeps its source.</span>
        ) : block.kind === 'context' ? (
          <span className="text-xs text-muted-foreground">Matter details entered for this case file</span>
        ) : (
          <ProvenanceTag kind={prov} suffix={block.edited ? ' reworded' : issue && issue.review_status !== 'pending' ? ` ${issue.review_status}` : undefined} />
        )}
        {controls}
      </div>
      {body}
    </div>
  );
}

function ApproveDialog({ open, onOpenChange, check, onApprove, pending, onJumpToFact, onJumpToIssue }: {
  open: boolean; onOpenChange: (o: boolean) => void; check: ReviewCheck | null; onApprove: (name: string) => void; pending: boolean;
  onJumpToFact: (id: string) => void; onJumpToIssue: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const blockers = check?.blockers || [];
  const warnings = check?.warnings || [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="case-prep max-w-lg">
        <DialogHeader>
          <DialogTitle>Approve this brief</DialogTitle>
          <DialogDescription>Approval records that a responsible person checked the brief. Any later change returns it to draft.</DialogDescription>
        </DialogHeader>
        {blockers.length ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Finish these first</p>
            <ul className="max-h-56 space-y-1.5 overflow-auto text-sm">
              {blockers.map((b, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span>{b.message}</span>
                  {b.fact_id ? <CPButton size="sm" variant="quiet" onClick={() => { onOpenChange(false); onJumpToFact(b.fact_id as string); }}>Review</CPButton> : null}
                  {b.issue_id ? <CPButton size="sm" variant="quiet" onClick={() => { onOpenChange(false); onJumpToIssue(b.issue_id as string); }}>Review</CPButton> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            {warnings.length ? (
              <ul className="space-y-1 text-sm text-[hsl(var(--cp-unverified))]">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="reviewer-name">Reviewer name</Label>
              <Input id="reviewer-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Adv. full name" autoComplete="name" />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} className="mt-0.5" />
              <span>I checked every fact against its source, reviewed every AI analysis, and will verify the statutory provisions before relying on this brief.</span>
            </label>
          </div>
        )}
        <DialogFooter>
          <CPButton variant="quiet" onClick={() => onOpenChange(false)}>Cancel</CPButton>
          <CPButton variant="primary" disabled={!!blockers.length || !confirmed || name.trim().length < 2 || pending} onClick={() => onApprove(name.trim())}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSignature aria-hidden="true" />}
            Approve brief
          </CPButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BriefTab({ workspace, facts, issues, onOpenSource, onJumpToFact, onJumpToIssue }: {
  workspace: Workspace; facts: Fact[]; issues: Issue[]; onOpenSource: (t: SourceTarget) => void; onJumpToFact: (id: string) => void; onJumpToIssue: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const key = ['case-prep', 'brief', workspace.id];
  const { data, isLoading, error, refetch } = useQuery({ queryKey: key, queryFn: () => casePrepApi.getBrief(workspace.id) });
  const brief = data?.brief || null;

  const [sections, setSections] = useState<BriefSection[]>([]);
  const [dirty, setDirty] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  useEffect(() => {
    if (brief && !dirty) setSections(structuredClone(brief.content.sections));
    // Re-sync only when the server revision changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief?.revision, brief?.status]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const factById = useMemo(() => new Map(facts.map((f) => [f.id, f])), [facts]);
  const issueById = useMemo(() => new Map(issues.map((i) => [i.id, i])), [issues]);

  const onServer = (res: { brief: Brief | null }) => {
    queryClient.setQueryData(key, res);
    queryClient.invalidateQueries({ queryKey: ['case-prep', 'workspace', workspace.id] });
    if (res.brief) setSections(structuredClone(res.brief.content.sections));
    setDirty(false);
  };

  const generate = useMutation({
    mutationFn: (overwrite: boolean) => casePrepApi.generateBrief(workspace.id, overwrite),
    onSuccess: (res) => { onServer(res); toast.success('Brief drafted from the current facts and issues'); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'BRIEF_HAS_EDITS') setConfirmRegenerate(true);
      else toast.error(errorMessage(e));
    },
  });
  const save = useMutation({
    mutationFn: () => casePrepApi.saveBrief(workspace.id, brief!.revision, sections),
    onSuccess: (res) => { onServer(res); toast.success('Brief saved'); },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') {
        toast.error('Someone else changed this brief. Reload to see the latest version; your unsaved edits will be lost.', {
          action: { label: 'Reload', onClick: () => { setDirty(false); refetch(); } },
          duration: 10000,
        });
      } else toast.error(errorMessage(e));
    },
  });
  const approve = useMutation({
    mutationFn: (name: string) => casePrepApi.approveBrief(workspace.id, brief!.revision, name),
    onSuccess: (res) => { onServer(res); setApproving(false); toast.success('Brief approved'); },
    onError: (e) => {
      toast.error(errorMessage(e));
      refetch();
    },
  });

  function updateBlock(sectionId: string, blockId: string, fn: (b: BriefBlock) => BriefBlock | null) {
    setSections((prev) => prev.map((s) => (s.id !== sectionId ? s : {
      ...s,
      blocks: s.blocks.map((b) => (b.id === blockId ? fn(b) : b)).filter(Boolean) as BriefBlock[],
    })));
    setDirty(true);
  }
  function moveBlock(sectionId: string, index: number, dir: -1 | 1) {
    setSections((prev) => prev.map((s) => {
      if (s.id !== sectionId) return s;
      const blocks = [...s.blocks];
      const j = index + dir;
      if (j < 0 || j >= blocks.length) return s;
      [blocks[index], blocks[j]] = [blocks[j], blocks[index]];
      return { ...s, blocks };
    }));
    setDirty(true);
  }
  function addNote(sectionId: string) {
    setSections((prev) => prev.map((s) => (s.id !== sectionId ? s : {
      ...s, blocks: [...s.blocks, { id: newNoteId(), kind: 'note', origin: 'reviewer', edited: false, text: '' }],
    })));
    setDirty(true);
  }

  async function exportBrief(format: 'markdown' | 'pdf') {
    if (!brief) return;
    const current = { ...brief, content: { ...brief.content, sections } };
    const input = { workspace, brief: current, facts, issues };
    if (format === 'markdown') {
      downloadText(`${safeFilename(workspace.title)}${brief.status === 'approved' ? '' : '-DRAFT'}.md`, briefToMarkdown(input));
    } else {
      const win = window.open('', '_blank');
      if (!win) {
        toast.error('Allow pop-ups for this site to print the brief.');
        return;
      }
      win.document.open();
      win.document.write(briefToHtml(input));
      win.document.close();
      win.focus();
      setTimeout(() => win.print(), 300);
    }
    casePrepApi.logExport(workspace.id, format).catch(() => undefined);
  }

  if (isLoading) return <LoadingRows rows={5} label="Loading brief" />;
  if (error) return <ErrorState message={errorMessage(error)} onRetry={() => refetch()} />;

  const liveFacts = facts.filter((f) => f.review_status !== 'rejected').length;
  if (!brief) {
    return (
      <EmptyState
        icon={<FileSignature className="h-8 w-8" />}
        title="No brief yet"
        action={(
          <CPButton variant="primary" onClick={() => generate.mutate(false)} disabled={!liveFacts || generate.isPending}>
            {generate.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <FileSignature aria-hidden="true" />}
            Draft the brief
          </CPButton>
        )}
      >
        {liveFacts
          ? 'The draft is assembled from your facts and issues: source-verified facts go into the statement of facts, unverified claims are listed separately, and AI analysis is labelled.'
          : 'Extract facts from your documents first; the brief is built only from them.'}
      </EmptyState>
    );
  }

  const check = data?.check || null;
  const approved = brief.status === 'approved' && !dirty;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          {approved ? (
            <span className="inline-flex items-center gap-1.5 text-[hsl(var(--cp-verified))]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Approved, revision {brief.revision}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Draft, revision {brief.revision}{dirty ? ', unsaved changes' : ''}.{' '}
              {check && !dirty ? (check.blockers.length ? `${check.blockers.length} item${check.blockers.length > 1 ? 's' : ''} to review before approval.` : 'Ready for approval.') : null}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <CPButton size="sm" variant="quiet" onClick={() => (dirty ? setConfirmRegenerate(true) : generate.mutate(false))} disabled={generate.isPending}>
            <RefreshCw aria-hidden="true" /> Redraft
          </CPButton>
          <CPButton size="sm" onClick={() => exportBrief('markdown')}><Download aria-hidden="true" /> Markdown</CPButton>
          <CPButton size="sm" onClick={() => exportBrief('pdf')}><Printer aria-hidden="true" /> Print or PDF</CPButton>
          <CPButton size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />} Save
          </CPButton>
          <CPButton size="sm" variant="primary" onClick={() => setApproving(true)} disabled={dirty || approved}>
            <CheckCircle2 aria-hidden="true" /> {approved ? 'Approved' : 'Approve'}
          </CPButton>
        </div>
      </div>

      {approved && brief.approval_attestation ? <p className="text-xs text-muted-foreground">{brief.approval_attestation}</p> : null}

      <article className="cp-paper rounded-md px-5 py-6 shadow-sm sm:px-10 sm:py-10" aria-label="Case brief">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs text-muted-foreground">{approved ? 'Approved case brief' : 'Draft case brief, not approved'}</p>
          <h2 className="cp-serif mt-1 text-2xl font-semibold">{workspace.title}</h2>
          <ProvenanceLegend kinds={['verified', 'confirmed', 'ai', 'reviewer', 'rule']} className="mt-3" />
        </header>

        <div className="space-y-8">
          {sections.map((section) => {
            const hide = !section.blocks.length && section.id !== 'notes';
            if (hide) return null;
            return (
              <section key={section.id} aria-labelledby={`sec-${section.id}`}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 id={`sec-${section.id}`} className="cp-serif text-lg font-semibold">{section.title}</h3>
                  {['overview', 'facts', 'issues', 'gaps', 'notes'].includes(section.id) ? (
                    <CPButton size="sm" variant="quiet" onClick={() => addNote(section.id)}><Plus aria-hidden="true" /> Note</CPButton>
                  ) : null}
                </div>
                {section.id === 'suggested' ? (
                  <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                    Not checked against an authoritative source.
                    <a className="inline-flex items-center gap-0.5 underline underline-offset-2" href="https://www.indiacode.nic.in/" target="_blank" rel="noopener noreferrer">
                      Verify on India Code <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  </p>
                ) : null}
                <div className="space-y-2">
                  {section.blocks.map((block, i) => (
                    <BlockView
                      key={block.id}
                      block={block}
                      factById={factById}
                      issueById={issueById}
                      onOpenSource={onOpenSource}
                      onText={(text) => updateBlock(section.id, block.id, (b) => (EDITABLE.has(b.kind) ? { ...b, text } : b))}
                      onMove={(dir) => moveBlock(section.id, i, dir)}
                      onDelete={() => updateBlock(section.id, block.id, () => null)}
                      isFirst={i === 0}
                      isLast={i === section.blocks.length - 1}
                    />
                  ))}
                  {!section.blocks.length ? <p className="text-sm text-muted-foreground">Nothing here yet.</p> : null}
                </div>
              </section>
            );
          })}
        </div>
        <footer className="mt-10 border-t border-border pt-3 text-xs text-muted-foreground">
          Prepared with AI assistance. AI analysis is not legal advice and must be reviewed by the responsible advocate.
        </footer>
      </article>

      <ApproveDialog open={approving} onOpenChange={setApproving} check={check} onApprove={(n) => approve.mutate(n)} pending={approve.isPending} onJumpToFact={onJumpToFact} onJumpToIssue={onJumpToIssue} />

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent className="case-prep">
          <AlertDialogHeader>
            <AlertDialogTitle>Redraft and replace your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              The brief will be rebuilt from the current facts and issues. Reworded blocks, notes and ordering changes will be replaced. Earlier revisions stay in the history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep my edits</AlertDialogCancel>
            <AlertDialogAction onClick={() => generate.mutate(true)}>Redraft</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
