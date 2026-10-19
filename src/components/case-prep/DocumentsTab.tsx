import { useRef, useState, type DragEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, FileText, Image as ImageIcon, Loader2, Lock, Trash2, Upload, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { casePrepApi, errorMessage } from '@/lib/case-prep/api';
import type { CaseDocument, SourceTarget, UploadResult } from '@/lib/case-prep/types';
import { cn } from '@/lib/utils';
import { CPButton } from './CPButton';
import { EmptyState } from './StateViews';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.txt';
const ALLOWED_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt'];

function statusText(doc: CaseDocument): { text: string; tone: 'ok' | 'warn' | 'bad' | 'busy' | 'muted' } {
  switch (doc.status) {
    case 'extracted':
      return { text: 'Text extracted, ready to analyse', tone: 'muted' };
    case 'needs_ocr':
      return doc.mime_type.startsWith('image/')
        ? { text: 'Image: text will be read during analysis', tone: 'muted' }
        : { text: 'Scanned PDF with no text layer: cannot be cited yet', tone: 'warn' };
    case 'analysing':
      return { text: 'Analysing', tone: 'busy' };
    case 'analysed':
      return { text: 'Analysed', tone: 'ok' };
    default:
      return { text: doc.error_message || 'Analysis failed', tone: 'bad' };
  }
}

const TONE: Record<string, string> = {
  ok: 'text-[hsl(var(--cp-verified))]',
  warn: 'text-[hsl(var(--cp-unverified))]',
  bad: 'text-destructive',
  busy: 'text-foreground',
  muted: 'text-muted-foreground',
};

function formatSize(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DocumentsTab({
  workspaceId, documents, maxFileMb, maxFiles, onOpenSource, onChanged,
}: {
  workspaceId: string;
  documents: CaseDocument[];
  maxFileMb: number;
  maxFiles: number;
  onOpenSource: (t: SourceTarget) => void;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);
  const [toDelete, setToDelete] = useState<CaseDocument | null>(null);

  const upload = useMutation({
    mutationFn: (files: File[]) => casePrepApi.uploadDocuments(workspaceId, files),
    onSuccess: ({ results: r }) => {
      setResults(r);
      const ok = r.filter((x) => x.ok).length;
      if (ok) toast.success(`${ok} document${ok > 1 ? 's' : ''} uploaded`);
      onChanged();
    },
    onError: (error) => {
      const details = (error as { details?: { results?: UploadResult[] } }).details;
      if (details?.results) setResults(details.results);
      toast.error(errorMessage(error));
    },
  });

  const remove = useMutation({
    mutationFn: (docId: string) => casePrepApi.deleteDocument(docId),
    onSuccess: () => {
      toast.success('Document deleted');
      onChanged();
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () => setToDelete(null),
  });

  function pick(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    const rejected: UploadResult[] = [];
    const accepted = files.filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_EXT.includes(ext)) {
        rejected.push({ name: f.name, ok: false, error: 'Unsupported type. Use PDF, PNG, JPEG, WebP or .txt.' });
        return false;
      }
      if (f.size > maxFileMb * 1024 * 1024) {
        rejected.push({ name: f.name, ok: false, error: `Larger than ${maxFileMb} MB.` });
        return false;
      }
      return true;
    });
    if (accepted.length > maxFiles) {
      toast.error(`Upload at most ${maxFiles} files at a time.`);
      return;
    }
    setResults(rejected);
    if (accepted.length) upload.mutate(accepted);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files);
  }

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn('rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors', dragging ? 'border-primary bg-primary/5' : 'border-border')}
      >
        <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">Drop FIRs, chargesheets, notices, agreements or orders here</p>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF, PNG, JPEG, WebP or .txt, up to {maxFileMb} MB each. Files are stored privately and encrypted; only you can open them.
        </p>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="sr-only" id="case-prep-upload" onChange={(e) => pick(e.target.files)} />
        <CPButton variant="primary" className="mt-4" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
          {upload.isPending ? 'Uploading and extracting text' : 'Choose files'}
        </CPButton>
      </div>

      {results.length ? (
        <ul className="space-y-1.5 text-sm" aria-label="Upload results">
          {results.map((r, i) => (
            <li key={`${r.name}-${i}`} className="flex items-start gap-2">
              {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--cp-verified))]" aria-hidden="true" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />}
              <span>
                <span className="font-medium">{r.name}</span>{' '}
                <span className="text-muted-foreground">
                  {r.ok ? `uploaded, ${r.pages} page${r.pages === 1 ? '' : 's'}${r.note ? `. ${r.note}` : ''}` : r.error}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!documents.length ? (
        <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents yet">
          Upload the case papers. Each page's text is kept exactly as extracted so every fact can point back to it.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {documents.map((doc) => {
            const s = statusText(doc);
            const isImage = doc.mime_type.startsWith('image/');
            return (
              <li key={doc.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {isImage ? <ImageIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                  <div className="min-w-0">
                    <p className="truncate font-medium" title={doc.original_name}>{doc.original_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {doc.page_count} page{doc.page_count === 1 ? '' : 's'}, {formatSize(doc.size_bytes)}
                      {doc.extraction_method === 'vision_ocr' ? ', text read from the image by OCR' : null}
                    </p>
                    {doc.doc_type ? (
                      <p className="text-xs text-muted-foreground">
                        AI reads this as <span className="text-[hsl(var(--cp-ai))]">{doc.doc_type}</span>
                      </p>
                    ) : null}
                    <p className={cn('mt-0.5 flex items-center gap-1.5 text-xs', TONE[s.tone])}>
                      {s.tone === 'busy' ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                      {s.text}
                      {doc.encrypted ? <Lock className="ml-1 h-3 w-3 text-muted-foreground" aria-label="Encrypted at rest" /> : null}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 sm:shrink-0">
                  <CPButton size="sm" onClick={() => onOpenSource({ documentId: doc.id })} disabled={doc.status === 'needs_ocr' && !isImage}>
                    View
                  </CPButton>
                  <CPButton size="sm" variant="danger" onClick={() => setToDelete(doc)} aria-label={`Delete ${doc.original_name}`} disabled={doc.status === 'analysing'}>
                    <Trash2 aria-hidden="true" />
                  </CPButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent className="case-prep">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.original_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The file, its extracted text and every fact taken from it will be permanently deleted. An approved brief will return to draft.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep document</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && remove.mutate(toDelete.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete document
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
