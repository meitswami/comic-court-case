// Types for the case-preparation workspace API (/api/case-prep).

export type MatterType = 'criminal' | 'civil' | 'family' | 'consumer' | 'corporate' | 'constitutional' | 'other';
export type ReviewStatus = 'pending' | 'accepted' | 'edited' | 'rejected';
export type Verification = 'source_verified' | 'unverified';
export type DocumentStatus = 'extracted' | 'needs_ocr' | 'analysing' | 'analysed' | 'failed';
export type FactType = 'event' | 'party' | 'allegation' | 'admission' | 'document' | 'amount' | 'legal_status' | 'other';

export interface Workspace {
  id: string;
  title: string;
  matter_type: MatterType;
  forum: string | null;
  client_side: string | null;
  description: string | null;
  case_id: string | null;
  analysis_status: 'idle' | 'running' | 'failed';
  analysis_error: string | null;
  analysis_running?: boolean;
  last_analysed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceSummary extends Workspace {
  document_count: number;
  fact_count: number;
  pending_review_count: number;
  brief_status: 'draft' | 'approved' | null;
}

export interface StatuteMention {
  act_key: string;
  act_label: string;
  unit: 'Section' | 'Article';
  sections: string[];
  passage_label: string;
  page_number: number;
  snippet: string;
  document_id?: string;
  document_name?: string;
}

export interface CaseDocument {
  id: string;
  workspace_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  encrypted: boolean;
  doc_type: string | null;
  document_language: string | null;
  page_count: number;
  char_count: number;
  extraction_method: 'pdf_text' | 'plain_text' | 'vision_ocr' | null;
  status: DocumentStatus;
  error_message: string | null;
  statute_mentions: StatuteMention[];
  analysed_at: string | null;
  created_at: string;
}

export interface Citation {
  id: string;
  fact_id: string;
  document_id: string;
  document_name: string;
  passage_id: string;
  passage_label: string;
  page_number: number;
  quote: string;
  quote_start: number;
  quote_end: number;
  match_type: 'exact' | 'normalized' | 'segmented';
}

export interface ClaimedSource {
  passage: string;
  quote: string;
  reason: string;
}

export interface Fact {
  id: string;
  workspace_id: string;
  document_id: string | null;
  statement: string;
  original_statement: string | null;
  fact_type: FactType;
  event_date: string | null;
  date_text: string | null;
  date_precision: 'day' | 'month' | 'year' | 'unknown';
  date_flag: string | null;
  parties: { name: string; role: string }[];
  verification: Verification;
  unverified_reason: string | null;
  claimed_sources: ClaimedSource[] | null;
  review_status: ReviewStatus;
  origin: 'ai' | 'reviewer';
  reviewer_note: string | null;
  citations: Citation[];
}

export interface Provision {
  act: string;
  act_key: string | null;
  section: string;
  relevance: string;
  act_recognised: boolean;
  authority_status: 'unverified';
  verify_at: string;
  issue_title?: string;
}

export interface Issue {
  id: string;
  title: string;
  analysis: string | null;
  issue_type: 'substantive' | 'procedural' | 'evidentiary' | 'jurisdictional' | 'limitation' | 'other';
  fact_ids: string[];
  provisions: Provision[];
  evidence_gaps: string[];
  counter_arguments: string[];
  sanitation_notes: string[];
  review_status: ReviewStatus;
  origin: 'ai' | 'reviewer';
  reviewer_note: string | null;
}

export interface Alert {
  code: string;
  severity: 'high' | 'medium' | 'low';
  source: 'rule' | 'system';
  title: string;
  message: string;
}

export interface StatuteSummary {
  act_key: string;
  act_label: string;
  unit: 'Section' | 'Article';
  sections: string[];
  occurrences: StatuteMention[];
}

export interface AIStatus {
  configured: boolean;
  reason: string | null;
  host: string | null;
  model: string | null;
  vision: boolean;
}

export interface WorkspacePayload {
  workspace: Workspace;
  documents: CaseDocument[];
  facts: Fact[];
  issues: Issue[];
  statutes: StatuteSummary[];
  alerts: Alert[];
  brief: { id: string; revision: number; status: 'draft' | 'approved'; approved_at: string | null; updated_at: string } | null;
  ai: AIStatus;
}

export type BlockKind = 'context' | 'fact' | 'analysis' | 'note' | 'chronology' | 'statutes' | 'suggested_provisions' | 'gaps' | 'unverified';
export type BlockOrigin = 'workspace' | 'source' | 'reviewer_confirmed' | 'ai' | 'reviewer' | 'derived';

export interface BriefBlock {
  id: string;
  kind: BlockKind;
  origin: BlockOrigin;
  edited: boolean;
  text?: string;
  source_text?: string;
  title?: string;
  fact_id?: string;
  issue_id?: string;
  fact_ids?: string[];
  items?: unknown[];
}

export interface BriefSection {
  id: string;
  title: string;
  blocks: BriefBlock[];
}

export interface Brief {
  id: string;
  workspace_id: string;
  revision: number;
  status: 'draft' | 'approved';
  approved_by: string | null;
  approved_at: string | null;
  approval_attestation: string | null;
  content: { generated_at: string; last_edited_at?: string; sections: BriefSection[] };
  updated_at: string;
}

export interface ReviewCheck {
  blockers: { code: string; message: string; fact_id?: string; issue_id?: string; block_id?: string }[];
  warnings: { code: string; message: string; fact_id?: string }[];
}

export interface BriefResponse {
  brief: Brief | null;
  check: ReviewCheck | null;
}

export interface UploadResult {
  name: string;
  ok: boolean;
  id?: string;
  status?: DocumentStatus;
  pages?: number;
  passages?: number;
  note?: string | null;
  code?: string;
  error?: string;
}

export interface Passage {
  id: string;
  document_id: string;
  label: string;
  page_number: number;
  passage_index: number;
  content: string;
}

export interface CasePrepStatus {
  ai: AIStatus;
  storage: { ready: boolean; encrypted: boolean; error: string | null };
  limits: { maxFileMb: number; maxFilesPerUpload: number; acceptedTypes: string[] };
  authority: { statuteRetrieval: boolean; caseLawRetrieval: boolean; verifyAt: string };
}

/** What the source panel should show. */
export interface SourceTarget {
  documentId: string;
  passageId?: string;
  passageLabel?: string;
  quote?: string;
  quoteStart?: number;
  quoteEnd?: number;
}
