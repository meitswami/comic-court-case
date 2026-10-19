import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { casePrepApi, errorMessage } from '@/lib/case-prep/api';
import type { MatterType } from '@/lib/case-prep/types';
import { MATTER_LABEL, matterSentence } from '@/lib/case-prep/provenance';
import { CasePrepHeader } from '@/components/case-prep/CasePrepHeader';
import { CPButton } from '@/components/case-prep/CPButton';
import { EmptyState, ErrorState, LoadingRows } from '@/components/case-prep/StateViews';

function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [matterType, setMatterType] = useState<MatterType>('criminal');
  const [forum, setForum] = useState('');
  const [clientSide, setClientSide] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () => casePrepApi.createWorkspace({ title: title.trim(), matter_type: matterType, forum: forum.trim(), client_side: clientSide.trim(), description: description.trim() }),
    onSuccess: (ws) => {
      queryClient.invalidateQueries({ queryKey: ['case-prep', 'workspaces'] });
      onOpenChange(false);
      navigate(`/workspaces/${ws.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const valid = title.trim().length >= 3;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="case-prep max-w-lg">
        <DialogHeader>
          <DialogTitle>New case file</DialogTitle>
          <DialogDescription>Name the matter. You can upload documents on the next screen.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ws-title">Matter name</Label>
            <Input id="ws-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="State v. Suresh Sharma (FIR 245/2024)" autoFocus />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type of matter</Label>
              <Select value={matterType} onValueChange={(v) => setMatterType(v as MatterType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(MATTER_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-side">Acting for (optional)</Label>
              <Input id="ws-side" value={clientSide} onChange={(e) => setClientSide(e.target.value)} placeholder="Complainant" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-forum">Court or forum (optional)</Label>
            <Input id="ws-forum" value={forum} onChange={(e) => setForum(e.target.value)} placeholder="Chief Judicial Magistrate, Jaipur" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-desc">Notes (optional)</Label>
            <Textarea id="ws-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <CPButton variant="quiet" onClick={() => onOpenChange(false)}>Cancel</CPButton>
            <CPButton type="submit" variant="primary" disabled={!valid || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Create case file
            </CPButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CasePrepList() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading } = useAuth();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate('/auth');
  }, [loading, isAuthenticated, navigate]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['case-prep', 'workspaces'],
    queryFn: casePrepApi.listWorkspaces,
    enabled: isAuthenticated,
  });

  return (
    <div className="case-prep min-h-screen bg-background">
      <CasePrepHeader email={user?.email} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl">Case files</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Upload case papers, get facts that each point to the page they came from, and build a brief you review and approve.
            </p>
          </div>
          <CPButton variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> New case file</CPButton>
        </div>

        <div className="mt-8">
          {isLoading || loading ? <LoadingRows label="Loading case files" /> : null}
          {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : null}
          {data && !data.length ? (
            <EmptyState
              icon={<FolderOpen className="h-8 w-8" />}
              title="Start your first case file"
              action={<CPButton variant="primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> New case file</CPButton>}
            >
              Works with FIRs, chargesheets, legal notices, agreements, medical reports and orders, in English or Hindi.
            </EmptyState>
          ) : null}
          {data?.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {data.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/workspaces/${w.id}`)}
                    className="flex w-full flex-col gap-1 px-4 py-4 text-left hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{w.title}</span>
                      <span className="block text-sm text-muted-foreground">{matterSentence(w)}</span>
                    </span>
                    <span className="flex shrink-0 flex-wrap gap-x-4 text-sm text-muted-foreground">
                      <span>{w.document_count} document{w.document_count === 1 ? '' : 's'}</span>
                      <span>{w.pending_review_count ? `${w.pending_review_count} to review` : `${w.fact_count} facts`}</span>
                      <span className={w.brief_status === 'approved' ? 'text-[hsl(var(--cp-verified))]' : ''}>
                        {w.brief_status === 'approved' ? 'Brief approved' : w.brief_status === 'draft' ? 'Brief in draft' : 'No brief'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </main>
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
