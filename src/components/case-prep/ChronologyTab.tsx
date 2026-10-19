import { AlertTriangle, CalendarDays } from 'lucide-react';
import { factProvenance, formatFactDate, REVIEW_LABEL } from '@/lib/case-prep/provenance';
import type { Fact, SourceTarget } from '@/lib/case-prep/types';
import { CitationChip } from './FactsTab';
import { ProvenanceTag } from './Provenance';
import { EmptyState } from './StateViews';

export function ChronologyTab({ facts, onOpenSource }: { facts: Fact[]; onOpenSource: (t: SourceTarget) => void }) {
  const live = facts.filter((f) => f.review_status !== 'rejected');
  const dated = live.filter((f) => f.event_date).sort((a, b) => (a.event_date as string).localeCompare(b.event_date as string));
  const undated = live.filter((f) => !f.event_date && ['event', 'allegation', 'admission'].includes(f.fact_type));

  if (!dated.length && !undated.length) {
    return (
      <EmptyState icon={<CalendarDays className="h-8 w-8" />} title="No dated events yet">
        The chronology is built from extracted facts that carry a date. Run analysis, or add facts with dates.
      </EmptyState>
    );
  }

  let lastYear: string | null = null;
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Dates are read from the source wording using the Indian day-month-year convention. Rejected facts are left out.
      </p>
      <ol className="relative space-y-0">
        {dated.map((f) => {
          const year = (f.event_date as string).slice(0, 4);
          const showYear = year !== lastYear;
          lastYear = year;
          return (
            <li key={f.id}>
              {showYear ? <p className="mb-2 mt-6 text-lg font-semibold first:mt-0">{year}</p> : null}
              <div className="grid grid-cols-[6.5rem_1fr] gap-4 py-2 sm:grid-cols-[8rem_1fr]">
                <div className="pt-0.5 text-sm tabular-nums">
                  {formatFactDate(f.event_date, f.date_precision)}
                  {f.date_flag ? (
                    <span className="mt-1 flex items-center gap-1 text-xs text-[hsl(var(--cp-unverified))]" title={f.date_flag}>
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Check date
                    </span>
                  ) : null}
                </div>
                <div className="cp-rail" data-prov={factProvenance(f)}>
                  <p className="cp-serif leading-relaxed">{f.statement}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <ProvenanceTag kind={factProvenance(f)} />
                    <span>{REVIEW_LABEL[f.review_status]}</span>
                    {f.citations.slice(0, 2).map((c) => <CitationChip key={c.id} citation={c} onOpen={onOpenSource} />)}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {undated.length ? (
        <section>
          <h3 className="mb-2 text-base">Events without a date</h3>
          <ul className="space-y-2">
            {undated.map((f) => (
              <li key={f.id} className="cp-rail" data-prov={factProvenance(f)}>
                <p className="cp-serif">{f.statement}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {f.citations.slice(0, 2).map((c) => <CitationChip key={c.id} citation={c} onOpen={onOpenSource} />)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
