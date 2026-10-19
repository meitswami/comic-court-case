import { BadgeCheck, Bot, CircleHelp, Gavel, PenLine, UserCheck } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { PROVENANCE, type ProvenanceKind } from '@/lib/case-prep/provenance';
import { cn } from '@/lib/utils';

const ICONS: Record<ProvenanceKind, typeof BadgeCheck> = {
  verified: BadgeCheck,
  unverified: CircleHelp,
  confirmed: UserCheck,
  ai: Bot,
  reviewer: PenLine,
  rule: Gavel,
};

export function ProvenanceTag({ kind, suffix, className }: { kind: ProvenanceKind; suffix?: string; className?: string }) {
  const Icon = ICONS[kind];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-prov={kind}
          tabIndex={0}
          className={cn('cp-prov-text inline-flex items-center gap-1 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm', className)}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {PROVENANCE[kind].label}
          {suffix ? <span className="text-muted-foreground font-normal">{suffix}</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{PROVENANCE[kind].description}</TooltipContent>
    </Tooltip>
  );
}

/** The key to the provenance colours, shown wherever mixed content appears. */
export function ProvenanceLegend({ kinds, className }: { kinds: ProvenanceKind[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-2', className)} aria-label="What the margin colours mean">
      {kinds.map((k) => (
        <span key={k} className="cp-rail text-xs leading-tight" data-prov={k}>
          <ProvenanceTag kind={k} />
        </span>
      ))}
    </div>
  );
}
