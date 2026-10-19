-- MySQL Migration 012: Case Preparation Workspace
-- Adds the document-grounded case-preparation workspace:
--   documents -> page-anchored passages (verified source text)
--   facts + citations (AI-extracted, verified against passages server-side)
--   issues (AI analysis grounded in facts), versioned briefs, audit log.
-- Purely additive: no existing table is altered or dropped.
-- Tenant isolation: every row carries the owning workspace; the API scopes
-- every query by case_prep_workspaces.owner_id.

CREATE TABLE IF NOT EXISTS case_prep_workspaces (
  id CHAR(36) PRIMARY KEY,
  owner_id CHAR(36) NOT NULL,
  case_id CHAR(36) NULL,
  title VARCHAR(255) NOT NULL,
  matter_type ENUM('criminal', 'civil', 'family', 'consumer', 'corporate', 'constitutional', 'other') NOT NULL DEFAULT 'other',
  forum VARCHAR(255) NULL,
  client_side VARCHAR(120) NULL,
  description TEXT NULL,
  analysis_status ENUM('idle', 'running', 'failed') NOT NULL DEFAULT 'idle',
  analysis_error VARCHAR(500) NULL,
  analysis_started_at DATETIME NULL,
  last_analysed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL,
  INDEX idx_cpw_owner_updated (owner_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_prep_documents (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  storage_key VARCHAR(128) NOT NULL,
  encrypted BOOLEAN NOT NULL DEFAULT FALSE,
  doc_type VARCHAR(100) NULL,             -- AI-suggested label, shown as AI output
  document_language VARCHAR(60) NULL,     -- AI-suggested
  page_count INT NOT NULL DEFAULT 0,
  char_count INT NOT NULL DEFAULT 0,
  extraction_method ENUM('pdf_text', 'plain_text', 'vision_ocr') NULL,
  status ENUM('extracted', 'needs_ocr', 'analysing', 'analysed', 'failed') NOT NULL,
  error_message VARCHAR(500) NULL,
  statute_mentions JSON NULL,             -- deterministic regex scan of the source text
  analysed_at DATETIME NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (workspace_id) REFERENCES case_prep_workspaces(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cpd_workspace_hash (workspace_id, sha256),
  INDEX idx_cpd_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verified source material: text exactly as extracted from the document,
-- split into small passages that citations point at.
CREATE TABLE IF NOT EXISTS case_prep_passages (
  id CHAR(36) PRIMARY KEY,
  document_id CHAR(36) NOT NULL,
  workspace_id CHAR(36) NOT NULL,
  label VARCHAR(20) NOT NULL,             -- e.g. p3.2 = page 3, passage 2
  page_number INT NOT NULL,
  passage_index INT NOT NULL,
  content MEDIUMTEXT NOT NULL,
  char_start INT NOT NULL,                -- offset within the page text
  char_end INT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES case_prep_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES case_prep_workspaces(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cpp_doc_label (document_id, label),
  INDEX idx_cpp_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_prep_facts (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  document_id CHAR(36) NULL,
  statement TEXT NOT NULL,
  original_statement TEXT NULL,           -- AI wording before any reviewer edit
  fact_type ENUM('event', 'party', 'allegation', 'admission', 'document', 'amount', 'legal_status', 'other') NOT NULL DEFAULT 'other',
  event_date DATE NULL,
  date_text VARCHAR(120) NULL,            -- date exactly as written in the source
  date_precision ENUM('day', 'month', 'year', 'unknown') NOT NULL DEFAULT 'unknown',
  date_flag VARCHAR(255) NULL,            -- set when the parsed date needs a human check
  parties JSON NULL,
  verification ENUM('source_verified', 'unverified') NOT NULL,
  unverified_reason VARCHAR(255) NULL,
  claimed_sources JSON NULL,              -- what the AI claimed when it could not be verified
  review_status ENUM('pending', 'accepted', 'edited', 'rejected') NOT NULL DEFAULT 'pending',
  origin ENUM('ai', 'reviewer') NOT NULL DEFAULT 'ai',
  reviewer_note TEXT NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES case_prep_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES case_prep_documents(id) ON DELETE CASCADE,
  INDEX idx_cpf_workspace (workspace_id),
  INDEX idx_cpf_document (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A citation exists only if the quote was found in the stored passage text.
CREATE TABLE IF NOT EXISTS case_prep_citations (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  fact_id CHAR(36) NOT NULL,
  document_id CHAR(36) NOT NULL,
  passage_id CHAR(36) NOT NULL,
  page_number INT NOT NULL,
  quote TEXT NOT NULL,                    -- exact text from the passage
  quote_start INT NOT NULL,               -- offsets within the passage content
  quote_end INT NOT NULL,
  match_type ENUM('exact', 'normalized', 'segmented') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES case_prep_workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (fact_id) REFERENCES case_prep_facts(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES case_prep_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (passage_id) REFERENCES case_prep_passages(id) ON DELETE CASCADE,
  INDEX idx_cpc_fact (fact_id),
  INDEX idx_cpc_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_prep_issues (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  title VARCHAR(500) NOT NULL,
  analysis TEXT NULL,                     -- AI-generated analysis, never source material
  issue_type ENUM('substantive', 'procedural', 'evidentiary', 'jurisdictional', 'limitation', 'other') NOT NULL DEFAULT 'other',
  fact_ids JSON NULL,
  provisions JSON NULL,                   -- AI suggestions, authority not verified
  evidence_gaps JSON NULL,
  counter_arguments JSON NULL,
  sanitation_notes JSON NULL,             -- e.g. unverifiable case-law references removed
  review_status ENUM('pending', 'accepted', 'edited', 'rejected') NOT NULL DEFAULT 'pending',
  origin ENUM('ai', 'reviewer') NOT NULL DEFAULT 'ai',
  reviewer_note TEXT NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES case_prep_workspaces(id) ON DELETE CASCADE,
  INDEX idx_cpi_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_prep_briefs (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  content JSON NOT NULL,
  status ENUM('draft', 'approved') NOT NULL DEFAULT 'draft',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  approval_attestation VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES case_prep_workspaces(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cpb_workspace (workspace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_prep_brief_revisions (
  id CHAR(36) PRIMARY KEY,
  brief_id CHAR(36) NOT NULL,
  revision INT NOT NULL,
  content JSON NOT NULL,
  edited_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (brief_id) REFERENCES case_prep_briefs(id) ON DELETE CASCADE,
  INDEX idx_cpbr_brief (brief_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS case_prep_audit_log (
  id CHAR(36) PRIMARY KEY,
  workspace_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id CHAR(36) NULL,
  details JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (workspace_id) REFERENCES case_prep_workspaces(id) ON DELETE CASCADE,
  INDEX idx_cpal_workspace (workspace_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
