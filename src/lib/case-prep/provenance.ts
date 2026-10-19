// How every piece of content in the workspace is labelled. One vocabulary is
// used everywhere (facts list, brief editor, exports) so users learn it once.
import type { BlockOrigin, Fact, MatterType, ReviewStatus, Workspace } from './types';

export type ProvenanceKind = 'verified' | 'unverified' | 'confirmed' | 'ai' | 'reviewer' | 'rule';

export const PROVENANCE: Record<ProvenanceKind, { label: string; description: string }> = {
  verified: {
    label: 'Source-verified',
    description: 'The quoted words were found in the uploaded document at the cited page.',
  },
  unverified: {
    label: 'Unverified claim',
    description: 'The AI produced this, but its quote could not be found in any document. Do not rely on it unless you confirm it.',
  },
  confirmed: {
    label: 'Reviewer-confirmed',
    description: 'No source link. A reviewer confirmed this statement on their own authority.',
  },
  ai: {
    label: 'AI analysis',
    description: 'Generated reasoning. It is not source material and is not legal advice until reviewed.',
  },
  reviewer: {
    label: 'Reviewer note',
    description: 'Written by a person in this workspace.',
  },
  rule: {
    label: 'Rule-based check',
    description: 'A fixed check run on the documents, not an AI judgement.',
  },
};

export function factProvenance(fact: Pick<Fact, 'verification' | 'review_status'>): ProvenanceKind {
  if (fact.verification === 'source_verified') return 'verified';
  if (fact.review_status === 'accepted' || fact.review_status === 'edited') return 'confirmed';
  return 'unverified';
}

export function originProvenance(origin: BlockOrigin): ProvenanceKind {
  switch (origin) {
    case 'source':
      return 'verified';
    case 'reviewer_confirmed':
      return 'confirmed';
    case 'ai':
      return 'ai';
    case 'derived':
      return 'rule';
    default:
      return 'reviewer';
  }
}

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: 'Needs review',
  accepted: 'Accepted',
  edited: 'Edited and accepted',
  rejected: 'Rejected',
};

export function isReviewed(status: ReviewStatus): boolean {
  return status === 'accepted' || status === 'edited';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format a fact date at the precision the source supports (Indian day-month-year order). */
export function formatFactDate(iso: string | null, precision: Fact['date_precision']): string {
  if (!iso) return 'Undated';
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  if (precision === 'year') return String(y);
  if (precision === 'month') return `${MONTHS[m - 1]} ${y}`;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export const MATTER_LABEL: Record<MatterType, string> = {
  criminal: 'Criminal', civil: 'Civil', family: 'Family', consumer: 'Consumer', corporate: 'Corporate', constitutional: 'Constitutional / writ', other: 'Other',
};

export function matterSentence(w: Pick<Workspace, 'matter_type' | 'forum' | 'client_side'>): string {
  const parts = [`${MATTER_LABEL[w.matter_type]} matter`];
  if (w.forum) parts[0] += ` before ${w.forum}`;
  if (w.client_side) parts.push(`acting for the ${w.client_side.toLowerCase()}`);
  return `${parts.join(', ')}.`;
}
