import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { CPButton } from './CPButton';
import { Skeleton } from '@/components/ui/skeleton';

export function LoadingRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-3" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="cp-rail space-y-2 py-1">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function InlineSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      {icon ? <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center text-muted-foreground">{icon}</div> : null}
      <h3 className="text-base">{title}</h3>
      {children ? <div className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = 'This could not be loaded', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/60 bg-destructive/10 px-5 py-4" role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="flex-1">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
        {onRetry ? (
          <CPButton size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            Try again
          </CPButton>
        ) : null}
      </div>
    </div>
  );
}
