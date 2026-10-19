import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Check, ListChecks, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { casePrepApi, errorMessage } from '@/lib/case-prep/api';
import { REVIEW_LABEL, factProvenance, formatFactDate, isReviewed } from '@/lib/case-prep/provenance';
import type { CaseDocument, Citation, Fact, FactType, SourceTarget } from '@/lib/case-prep/types';
import { cn } from '@/lib/utils';
import { CPButton } from './CPButton';
import { ProvenanceLegend, ProvenanceTag } from './Provenance';
import { EmptyState } from './StateViews';

const FACT_TYPE_LABEL: Record<FactType, string> = {
  event: 'Event', party: 'Party', allegation: 'Allegation', admission: 'Admission', document: 'Document',
  amount: 'Amount', legal_status: 'Legal status', other: 'Other',
};

type Filter = 'all' | 'review' | 'verified' | 'unverified' | 'rejected';

export function CitationChip({ citation, onOpen }: { citation: Citation; onOpen: (t: SourceTarget) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onOpen({ documentId: citation.document_id, passageId: citation.passage_id, quote: citation.quote, quoteStart: citation.quote_start, quoteEnd: citation.quote_end })}
          className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-[hsl(var(--cp-verified)/0.5)] px-1.5 py-0.5 text-xs text-[hsl(var(--cp-verified))] hover:bg-[hsl(var(--cp-verified)/0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="truncate">{citation.document_name}</span>
          <span className="shrink-0">p. {citation.page_number}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm text-xs">
        <span className="cp-serif">&ldquo;{citation.quote}&rdquo;</span>
      </TooltipContent>
    </Tooltip>
  );
}

function FactRow({ fact, onOpenSource, onChanged, focused }: { fact: Fact; onOpenSource: (t: SourceTarget) => void; onChanged: () => void; focused: boolean }) {
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(fact.statement);
  const [date, setDate] = useState(fact.event_date || '');

  useEffect(() => {
    if (!editing) {
      setStatement(fact.statement);
      setDate(fact.event_date || '');
    }
  }, [fact, editing]);

  const update = useMutation({
    mutationFn: (data: Parameters<typeof casePrepApi.updateFact>[1]) => casePrepApi.updateFact(fact.id, data),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const prov = factProvenance(fact);
  const busy = update.isPending;

  function saveEdit() {
    const data: Parameters<typeof casePrepApi.updateFact>[1] = {};
    if (statement.trim() !== fact.statement) data.statement = statement.trim();
    if ((date || null) !== (fact.event_date || null)) data.event_date = date || null;
    if (!Object.keys(data).length) {
      setEditing(false);
      return;
    }
    if (data.statement !== undefined && data.statement.length < 5) {
      toast.error('A fact needs at least 5 characters.');
      return;
    }
    update.mutate(data);
  }

  return (
    <li
      id={`fact-${fact.id}`}
      className={cn('cp-rail py-3 pr-2', fact.review_status === 'rejected' && 'opacity-60', focused && 'rounded-r bg-primary/10')}
      data-prov={prov}
    >
      {editing ? (
        <div className="space-y-2">
          <Label htmlFor={`stmt-${fact.id}`} className="sr-only">Fact wording</Label>
          <Textarea id={`stmt-${fact.id}`} value={statement} onChange={(e) => setStatement(e.target.value)} rows={3} className="cp-serif" />
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor={`date-${fact.id}`} className="text-xs text-muted-foreground">Date</Label>
            <Input id={`date-${fact.id}`} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-auto" />
            <CPButton size="sm" variant="primary" onClick={saveEdit} disabled={busy}>Save and accept</CPButton>
            <CPButton size="sm" variant="quiet" onClick={() => setEditing(false)} disabled={busy}>Cancel</CPButton>
          </div>
          {fact.citations.length ? (
            <p className="text-xs text-muted-foreground">Your wording is saved alongside the original source quote, which stays linked.</p>
          ) : null}
        </div>
      ) : (
        <p className={cn('cp-serif text-[0.975rem] leading-relaxed', fact.review_status === 'rejected' && 'line-through')}>{fact.statement}</p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <ProvenanceTag kind={prov} />
        <span>
          {formatFactDate(fact.event_date, fact.date_precision)}
          {fact.date_text && fact.date_text !== fact.event_date ? <span className="ml-1">(&ldquo;{fact.date_text}&rdquo;)</span> : null}
        </span>
        {fact.date_flag ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex items-center gap-1 text-[hsl(var(--cp-unverified))]">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Check date
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">{fact.date_flag}</TooltipContent>
          </Tooltip>
        ) : null}
        <span>{FACT_TYPE_LABEL[fact.fact_type]}</span>
        {fact.origin === 'reviewer' ? <span>Added by reviewer</span> : null}
        <span className={cn(isReviewed(fact.review_status) && 'text-foreground')}>{REVIEW_LABEL[fact.review_status]}</span>
      </div>

      {fact.citations.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {fact.citations.map((c) => <CitationChip key={c.id} citation={c} onOpen={onOpenSource} />)}
        </div>
      ) : null}

      {fact.verification === 'unverified' && fact.claimed_sources?.length ? (
        <div className="mt-2 space-y-1 text-xs text-[hsl(var(--cp-unverified))]">
          {fact.claimed_sources.slice(0, 2).map((c, i) => (
            <p key={i}>
              The AI cited {c.passage || 'no passage'}{c.quote ? <>: <span className="cp-serif">&ldquo;{c.quote}&rdquo;</span></> : null}. {c.reason}.
            </p>
          ))}
        </div>
      ) : null}
      {fact.verification === 'unverified' && !fact.claimed_sources?.length && fact.unverified_reason ? (
        <p className="mt-2 text-xs text-[hsl(var(--cp-unverified))]">{fact.unverified_reason}.</p>
      ) : null}
      {fact.original_statement && fact.original_statement !== fact.statement ? (
        <p className="mt-1.5 text-xs text-muted-foreground">Originally extracted as: <span className="cp-serif">{fact.original_statement}</span></p>
      ) : null}

      {!editing ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {fact.review_status === 'rejected' ? (
            <CPButton size="sm" variant="quiet" onClick={() => update.mutate({ review_status: 'pending' })} disabled={busy}>
              <RotateCcw aria-hidden="true" /> Restore
            </CPButton>
          ) : (
            <>
              {!isReviewed(fact.review_status) ? (
                <CPButton size="sm" variant={fact.verification === 'source_verified' ? 'accept' : 'outline'} onClick={() => update.mutate({ review_status: 'accepted' })} disabled={busy}>
                  <Check aria-hidden="true" /> {fact.verification === 'source_verified' ? 'Accept' : 'Confirm without source'}
                </CPButton>
              ) : null}
              <CPButton size="sm" variant="quiet" onClick={() => setEditing(true)} disabled={busy}>
                <Pencil aria-hidden="true" /> Edit
              </CPButton>
              <CPButton size="sm" variant="quiet" onClick={() => update.mutate({ review_status: 'rejected' })} disabled={busy}>
                <X aria-hidden="true" /> Reject
              </CPButton>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function AddFactDialog({ open, onOpenChange, workspaceId, documents, onAdded }: {
  open: boolean; onOpenChange: (o: boolean) => void; workspaceId: string; documents: CaseDocument[]; onAdded: () => void;
}) {
  const [statement, setStatement] = useState('');
  const [factType, setFactType] = useState<FactType>('event');
  const [date, setDate] = useState('');
  const [documentId, setDocumentId] = useState<string>('none');
  const [quote, setQuote] = useState('');
  const citable = documents.filter((d) => d.status !== 'needs_ocr' || d.extraction_method);

  const add = useMutation({
    mutationFn: () => casePrepApi.addFact(workspaceId, {
      statement: statement.trim(),
      fact_type: factType,
      event_date: date || null,
      document_id: documentId === 'none' ? null : documentId,
      quote: documentId === 'none' ? null : quote.trim() || null,
    }),
    onSuccess: (fact) => {
      toast.success(fact.verification === 'source_verified' ? 'Fact added with a verified source' : 'Fact added without a source link');
      setStatement('');
      setQuote('');
      setDate('');
      setDocumentId('none');
      onOpenChange(false);
      onAdded();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const valid = statement.trim().length >= 5;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="case-prep max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a fact</DialogTitle>
          <DialogDescription>Paste the exact words from a document to link it as a source-verified fact. Without a quote it is saved as reviewer-confirmed.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-fact">Fact</Label>
            <Textarea id="new-fact" value={statement} onChange={(e) => setStatement(e.target.value)} rows={3} placeholder="The complainant sent a legal notice on 5 September 2024." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={factType} onValueChange={(v) => setFactType(v as FactType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FACT_TYPE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-fact-date">Date (optional)</Label>
              <Input id="new-fact-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Source document (optional)</Label>
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No source</SelectItem>
                {citable.map((d) => <SelectItem key={d.id} value={d.id}>{d.original_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {documentId !== 'none' ? (
            <div className="space-y-1.5">
              <Label htmlFor="new-fact-quote">Exact quote from that document</Label>
              <Textarea id="new-fact-quote" value={quote} onChange={(e) => setQuote(e.target.value)} rows={2} className="cp-serif" />
              <p className="text-xs text-muted-foreground">The server checks that these words appear in the document before saving.</p>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <CPButton variant="quiet" onClick={() => onOpenChange(false)}>Cancel</CPButton>
          <CPButton variant="primary" onClick={() => add.mutate()} disabled={!valid || add.isPending || (documentId !== 'none' && quote.trim().length < 8)}>
            {add.isPending ? 'Checking' : 'Add fact'}
          </CPButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FactsTab({ workspaceId, facts, documents, onOpenSource, onChanged, focusFactId }: {
  workspaceId: string; facts: Fact[]; documents: CaseDocument[]; onOpenSource: (t: SourceTarget) => void; onChanged: () => void; focusFactId?: string | null;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => ({
    all: facts.filter((f) => f.review_status !== 'rejected').length,
    review: facts.filter((f) => f.review_status === 'pending').length,
    verified: facts.filter((f) => f.verification === 'source_verified' && f.review_status !== 'rejected').length,
    unverified: facts.filter((f) => f.verification === 'unverified' && f.review_status !== 'rejected').length,
    rejected: facts.filter((f) => f.review_status === 'rejected').length,
  }), [facts]);

  const visible = facts.filter((f) => {
    switch (filter) {
      case 'review': return f.review_status === 'pending';
      case 'verified': return f.verification === 'source_verified' && f.review_status !== 'rejected';
      case 'unverified': return f.verification === 'unverified' && f.review_status !== 'rejected';
      case 'rejected': return f.review_status === 'rejected';
      default: return f.review_status !== 'rejected';
    }
  });

  useEffect(() => {
    if (focusFactId) {
      setFilter('all');
      requestAnimationFrame(() => document.getElementById(`fact-${focusFactId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
  }, [focusFactId]);

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'review', label: 'Needs review' },
    { id: 'verified', label: 'Source-verified' },
    { id: 'unverified', label: 'Unverified' },
    { id: 'rejected', label: 'Rejected' },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter facts">
          {filters.map((f) => (
            <CPButton key={f.id} size="sm" variant={filter === f.id ? 'selected' : 'quiet'} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} <span className="text-muted-foreground">{counts[f.id]}</span>
            </CPButton>
          ))}
        </div>
        <CPButton size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" /> Add fact
        </CPButton>
      </div>

      <ProvenanceLegend kinds={['verified', 'unverified', 'confirmed']} />

      {!facts.length ? (
        <EmptyState icon={<ListChecks className="h-8 w-8" />} title="No facts yet">
          Run analysis to extract facts from the documents. Each one will cite the page it came from, or be marked unverified.
        </EmptyState>
      ) : !visible.length ? (
        <p className="text-sm text-muted-foreground">Nothing in this view.</p>
      ) : (
        <ul className="space-y-1">
          {visible.map((f) => <FactRow key={f.id} fact={f} onOpenSource={onOpenSource} onChanged={onChanged} focused={focusFactId === f.id} />)}
        </ul>
      )}

      <AddFactDialog open={adding} onOpenChange={setAdding} workspaceId={workspaceId} documents={documents} onAdded={onChanged} />
    </div>
  );
}
