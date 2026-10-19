import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ScanText, X } from 'lucide-react';
import { CPButton } from './CPButton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { casePrepApi, errorMessage } from '@/lib/case-prep/api';
import type { Passage, SourceTarget } from '@/lib/case-prep/types';
import { ErrorState, InlineSpinner, LoadingRows } from './StateViews';
import { ProvenanceTag } from './Provenance';

function Highlighted({ passage, target }: { passage: Passage; target: SourceTarget }) {
  const { content } = passage;
  let start = -1;
  let end = -1;
  if (target.passageId === passage.id && typeof target.quoteStart === 'number' && typeof target.quoteEnd === 'number') {
    start = target.quoteStart;
    end = target.quoteEnd;
  } else if (target.quote) {
    start = content.indexOf(target.quote);
    end = start === -1 ? -1 : start + target.quote.length;
  }
  if (start < 0 || end <= start || end > content.length) return <>{content}</>;
  return (
    <>
      {content.slice(0, start)}
      <mark className="cp-highlight" data-testid="source-highlight">{content.slice(start, end)}</mark>
      {content.slice(end)}
    </>
  );
}

function OriginalView({ documentId, mime, page }: { documentId: string; mime: string; page: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    casePrepApi.documentFile(documentId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

  if (error) return <ErrorState title="The original could not be opened" message={error} />;
  if (!url) return <InlineSpinner label="Opening the original" />;
  if (mime === 'application/pdf') {
    return <iframe title="Original document" src={`${url}#page=${page}`} className="h-[70vh] w-full rounded border border-border bg-white" />;
  }
  if (mime.startsWith('image/')) return <img src={url} alt="Original document" className="w-full rounded border border-border" />;
  return <p className="text-sm text-muted-foreground">Plain-text documents are shown in full in the extracted text view.</p>;
}

export function SourcePanel({ target, onClose, showClose = true }: { target: SourceTarget; onClose: () => void; showClose?: boolean }) {
  const [view, setView] = useState<'text' | 'original'>('text');
  const focusRef = useRef<HTMLDivElement>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['case-prep', 'doc-text', target.documentId],
    queryFn: () => casePrepApi.documentText(target.documentId),
    staleTime: 5 * 60 * 1000,
  });

  const passage = useMemo(() => {
    if (!data) return null;
    return data.passages.find((p) => p.id === target.passageId)
      || data.passages.find((p) => p.label === target.passageLabel)
      || (target.quote ? data.passages.find((p) => p.content.includes(target.quote as string)) : undefined)
      || data.passages[0]
      || null;
  }, [data, target]);

  const pagePassages = useMemo(() => (data && passage ? data.passages.filter((p) => p.page_number === passage.page_number) : []), [data, passage]);

  useEffect(() => {
    setView('text');
  }, [target.documentId, target.passageId, target.passageLabel]);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: 'center' });
  }, [passage, view]);

  return (
    <aside className="flex h-full flex-col" aria-label="Source document">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-medium" title={data?.document.original_name}>{data?.document.original_name || 'Source'}</p>
          {passage ? (
            <p className="text-xs text-muted-foreground">Page {passage.page_number}, passage {passage.label}</p>
          ) : null}
        </div>
        {showClose ? (
          <CPButton variant="quiet" size="icon" onClick={onClose} aria-label="Close source">
            <X />
          </CPButton>
        ) : null}
      </div>

      <div className="flex gap-1 border-b border-border px-4 py-2" role="tablist" aria-label="Source view">
        <CPButton size="sm" variant={view === 'text' ? 'selected' : 'quiet'} role="tab" aria-selected={view === 'text'} onClick={() => setView('text')}>
          <ScanText aria-hidden="true" />
          Extracted text
        </CPButton>
        <CPButton size="sm" variant={view === 'original' ? 'selected' : 'quiet'} role="tab" aria-selected={view === 'original'} onClick={() => setView('original')} disabled={!data}>
          <FileText aria-hidden="true" />
          Original
        </CPButton>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 px-4 py-4">
          {isLoading ? <LoadingRows rows={3} label="Loading source text" /> : null}
          {error ? <ErrorState message={errorMessage(error)} onRetry={() => refetch()} /> : null}
          {data && view === 'original' ? (
            <OriginalView documentId={data.document.id} mime={data.document.mime_type} page={passage?.page_number || 1} />
          ) : null}
          {data && view === 'text' ? (
            <>
              <ProvenanceTag kind="verified" suffix="text as stored from the upload" />
              {data.document.extraction_method === 'vision_ocr' ? (
                <p className="rounded border border-border px-3 py-2 text-xs text-muted-foreground">
                  This text is a machine transcription of an image. Check quotes against the original before relying on them.
                </p>
              ) : null}
              {!passage ? <p className="text-sm text-muted-foreground">No extracted text for this document.</p> : null}
              {pagePassages.map((p) => (
                <div
                  key={p.id}
                  ref={p.id === passage?.id ? focusRef : undefined}
                  className={p.id === passage?.id ? 'cp-serif whitespace-pre-wrap text-[0.95rem] leading-7' : 'cp-serif whitespace-pre-wrap text-sm leading-6 text-muted-foreground'}
                >
                  <span className="mr-2 align-top font-sans text-[0.7rem] text-muted-foreground">{p.label}</span>
                  {p.id === passage?.id ? <Highlighted passage={p} target={target} /> : p.content}
                </div>
              ))}
            </>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}
