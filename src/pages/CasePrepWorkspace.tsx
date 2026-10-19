import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Gavel, Info, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/hooks/useAuth';
import { ApiError, casePrepApi, errorMessage } from '@/lib/case-prep/api';
import { matterSentence } from '@/lib/case-prep/provenance';
import type { Alert, SourceTarget, WorkspacePayload } from '@/lib/case-prep/types';
import { cn } from '@/lib/utils';
import { CasePrepHeader } from '@/components/case-prep/CasePrepHeader';
import { CPButton } from '@/components/case-prep/CPButton';
import { DocumentsTab } from '@/components/case-prep/DocumentsTab';
import { FactsTab } from '@/components/case-prep/FactsTab';
import { ChronologyTab } from '@/components/case-prep/ChronologyTab';
import { IssuesTab } from '@/components/case-prep/IssuesTab';
import { BriefTab } from '@/components/case-prep/BriefTab';
import { SourcePanel } from '@/components/case-prep/SourcePanel';
import { ProvenanceTag } from '@/components/case-prep/Provenance';
import { ErrorState, LoadingRows } from '@/components/case-prep/StateViews';

type Tab = 'documents' | 'facts' | 'chronology' | 'issues' | 'brief';

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
const INDIA_CODE = 'https://www.indiacode.nic.in/';

function AlertList({ alerts }: { alerts: Alert[] }) {
  if (!alerts.length) return null;
  const tone: Record<Alert['severity'], string> = {
    high: 'border-[hsl(var(--cp-unverified))]',
    medium: 'border-[hsl(var(--cp-rule))]',
    low: 'border-border',
  };
  return (
    <ul className="space-y-2" aria-label="Checks on this case file">
      {alerts.map((a) => (
        <li key={a.code} className={cn('rounded-md border-l-4 bg-card px-4 py-2.5', tone[a.severity])}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              {a.severity === 'high' ? <AlertTriangle className="h-4 w-4 text-[hsl(var(--cp-unverified))]" aria-hidden="true" /> : <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              {a.title}
            </p>
            {a.source === 'rule' ? <ProvenanceTag kind="rule" /> : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{a.message}</p>
        </li>
      ))}
    </ul>
  );
}

function Steps({ data, tab, onSelect }: { data: WorkspacePayload; tab: Tab; onSelect: (t: Tab) => void }) {
  const live = data.facts.filter((f) => f.review_status !== 'rejected');
  const reviewedFacts = data.facts.filter((f) => f.review_status !== 'pending').length;
  const liveIssues = data.issues.filter((i) => i.review_status !== 'rejected');
  const reviewedIssues = data.issues.filter((i) => i.review_status !== 'pending').length;
  const dated = live.filter((f) => f.event_date).length;
  const steps: { id: Tab; title: string; detail: string; done: boolean }[] = [
    { id: 'documents', title: 'Documents', detail: `${data.documents.length} uploaded`, done: data.documents.some((d) => d.status === 'analysed') },
    { id: 'facts', title: 'Facts', detail: data.facts.length ? `${reviewedFacts} of ${data.facts.length} reviewed` : 'Not extracted', done: data.facts.length > 0 && reviewedFacts === data.facts.length },
    { id: 'chronology', title: 'Chronology', detail: `${dated} dated event${dated === 1 ? '' : 's'}`, done: dated > 0 },
    { id: 'issues', title: 'Issues', detail: data.issues.length ? `${reviewedIssues} of ${data.issues.length} reviewed` : `${liveIssues.length} found`, done: data.issues.length > 0 && reviewedIssues === data.issues.length },
    { id: 'brief', title: 'Brief', detail: data.brief ? (data.brief.status === 'approved' ? 'Approved' : 'Draft') : 'Not drafted', done: data.brief?.status === 'approved' },
  ];
  return (
    <nav aria-label="Case preparation steps">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="tablist">
        {steps.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === s.id}
              onClick={() => onSelect(s.id)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === s.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/50'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold',
                  s.done ? 'bg-[hsl(var(--cp-verified))] text-background' : tab === s.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function CasePrepWorkspace() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isWide = useMediaQuery('(min-width: 1024px)');
  const { user, isAuthenticated, loading } = useAuth();
  const [tab, setTab] = useState<Tab>('documents');
  const [source, setSource] = useState<SourceTarget | null>(null);
  const [focusFactId, setFocusFactId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const wasRunning = useRef(false);
  const initialTabSet = useRef(false);

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate('/auth');
  }, [loading, isAuthenticated, navigate]);

  const key = ['case-prep', 'workspace', id];
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => casePrepApi.getWorkspace(id),
    enabled: isAuthenticated && !!id,
    refetchInterval: (q) => {
      const ws = q.state.data?.workspace;
      return ws && (ws.analysis_running || ws.analysis_status === 'running') ? 2000 : false;
    },
  });
  const { data: status } = useQuery({ queryKey: ['case-prep', 'status'], queryFn: casePrepApi.status, enabled: isAuthenticated, staleTime: 60000 });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['case-prep', 'brief', id] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, id]);

  // Open on the step that needs attention.
  useEffect(() => {
    if (!data || initialTabSet.current) return;
    initialTabSet.current = true;
    if (data.brief) setTab('brief');
    else if (data.facts.length) setTab('facts');
  }, [data]);

  // Tell the user when a background analysis finishes.
  const running = !!data && (data.workspace.analysis_running || data.workspace.analysis_status === 'running');
  useEffect(() => {
    if (!data) return;
    if (wasRunning.current && !running) {
      if (data.workspace.analysis_status === 'failed') {
        toast.error(data.workspace.analysis_error || 'Analysis failed.');
      } else {
        const verified = data.facts.filter((f) => f.verification === 'source_verified').length;
        toast.success(`Analysis finished: ${data.facts.length} facts, ${verified} source-verified. Review them before drafting the brief.`);
        setTab('facts');
      }
      queryClient.invalidateQueries({ queryKey: ['case-prep', 'brief', id] });
    }
    wasRunning.current = running;
  }, [running, data, queryClient, id]);

  const analyse = useMutation({
    mutationFn: (scope: 'pending' | 'all') => casePrepApi.analyse(id, scope),
    onSuccess: (r) => {
      toast.message(`Analysing ${r.documents} document${r.documents === 1 ? '' : 's'}. You can keep working; this page updates when it finishes.`);
      wasRunning.current = true;
      refetch();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: () => casePrepApi.deleteWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-prep', 'workspaces'] });
      toast.success('Case file deleted');
      navigate('/workspaces');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openSource = useCallback((t: SourceTarget) => setSource(t), []);
  const jumpToFact = useCallback((factId: string) => {
    setTab('facts');
    setFocusFactId(factId);
  }, []);
  const jumpToIssue = useCallback((issueId: string) => {
    setTab('issues');
    setTimeout(() => document.getElementById(`issue-${issueId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, []);

  if (loading || (isLoading && !data)) {
    return (
      <div className="case-prep min-h-screen bg-background">
        <CasePrepHeader email={user?.email} />
        <main className="mx-auto max-w-[90rem] px-4 py-8 sm:px-6"><LoadingRows rows={6} label="Loading case file" /></main>
      </div>
    );
  }

  if (error || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="case-prep min-h-screen bg-background">
        <CasePrepHeader email={user?.email} />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <ErrorState
            title={notFound ? 'Case file not found' : 'The case file could not be loaded'}
            message={notFound ? 'It may have been deleted, or it belongs to another account.' : errorMessage(error)}
            onRetry={notFound ? undefined : () => refetch()}
          />
          <Link to="/workspaces" className="mt-4 inline-block text-sm underline underline-offset-2">Back to case files</Link>
        </main>
      </div>
    );
  }

  const { workspace, documents, facts, issues, alerts, statutes, ai } = data;
  const pendingDocs = documents.filter((d) => d.status !== 'analysed' && !(d.status === 'needs_ocr' && !d.mime_type.startsWith('image/')));
  const canRerun = documents.some((d) => d.status === 'analysed');

  const sourcePanel = source ? <SourcePanel target={source} onClose={() => setSource(null)} /> : null;

  return (
    <div className="case-prep min-h-screen bg-background">
      <CasePrepHeader email={user?.email} />
      <main className="mx-auto max-w-[90rem] px-4 py-6 sm:px-6">
        <Link to="/workspaces" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Case files
        </Link>

        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight">{workspace.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{matterSentence(workspace)}</p>
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Gavel className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {ai.configured
                ? `Documents are sent to ${ai.host} (${ai.model}) for analysis. Statutes and case law are not checked against an authoritative source; verify on India Code.`
                : `AI analysis is unavailable: ${ai.reason}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {running ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm" role="status">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Analysing documents
              </span>
            ) : (
              <>
                {canRerun && !pendingDocs.length ? (
                  <CPButton onClick={() => analyse.mutate('all')} disabled={!ai.configured || analyse.isPending}>
                    <Sparkles aria-hidden="true" /> Re-run analysis
                  </CPButton>
                ) : null}
                <CPButton variant="primary" onClick={() => analyse.mutate('pending')} disabled={!ai.configured || !pendingDocs.length || analyse.isPending} title={!ai.configured ? ai.reason || undefined : undefined}>
                  {analyse.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
                  {pendingDocs.length ? `Analyse ${pendingDocs.length} document${pendingDocs.length === 1 ? '' : 's'}` : 'All documents analysed'}
                </CPButton>
              </>
            )}
            <CPButton variant="quiet" size="icon" onClick={() => setConfirmDelete(true)} aria-label="Delete case file" disabled={running}><Trash2 /></CPButton>
          </div>
        </div>

        {workspace.analysis_status === 'failed' && workspace.analysis_error && !running ? (
          <div className="mt-4"><ErrorState title="The last analysis did not finish" message={workspace.analysis_error} onRetry={ai.configured ? () => analyse.mutate('pending') : undefined} /></div>
        ) : null}

        <div className="mt-5"><Steps data={data} tab={tab} onSelect={setTab} /></div>
        {alerts.length ? <div className="mt-4"><AlertList alerts={alerts} /></div> : null}

        <div className={cn('mt-6 grid gap-6', source && isWide && 'grid-cols-[minmax(0,1fr)_26rem]')}>
          <section aria-label={tab} className="min-w-0">
            {tab === 'documents' ? (
              <DocumentsTab
                workspaceId={workspace.id}
                documents={documents}
                maxFileMb={status?.limits.maxFileMb ?? 15}
                maxFiles={status?.limits.maxFilesPerUpload ?? 10}
                onOpenSource={openSource}
                onChanged={refresh}
              />
            ) : null}
            {tab === 'facts' ? <FactsTab workspaceId={workspace.id} facts={facts} documents={documents} onOpenSource={openSource} onChanged={refresh} focusFactId={focusFactId} /> : null}
            {tab === 'chronology' ? <ChronologyTab facts={facts} onOpenSource={openSource} /> : null}
            {tab === 'issues' ? <IssuesTab issues={issues} facts={facts} statutes={statutes} onOpenSource={openSource} onChanged={refresh} verifyAt={status?.authority.verifyAt || INDIA_CODE} /> : null}
            {tab === 'brief' ? <BriefTab workspace={workspace} facts={facts} issues={issues} onOpenSource={openSource} onJumpToFact={jumpToFact} onJumpToIssue={jumpToIssue} /> : null}
          </section>

          {source && isWide ? (
            <div>
              <div className="sticky top-4 h-[calc(100vh-2rem)] overflow-hidden rounded-lg border border-border bg-card">{sourcePanel}</div>
            </div>
          ) : null}
        </div>
      </main>

      {/* On narrower screens the source opens as a sheet. */}
      <Sheet open={!!source && !isWide} onOpenChange={(o) => !o && setSource(null)}>
        <SheetContent side="right" className="case-prep w-full p-0 sm:max-w-lg">
          <SheetTitle className="sr-only">Source document</SheetTitle>
          {source ? <SourcePanel target={source} onClose={() => setSource(null)} showClose={false} /> : null}
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="case-prep">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this case file?</AlertDialogTitle>
            <AlertDialogDescription>
              All {documents.length} documents, their extracted text, facts, issues, the brief and its history will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep case file</AlertDialogCancel>
            <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete case file</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
