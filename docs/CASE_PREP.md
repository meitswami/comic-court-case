# Case preparation workspace

Route: `/workspaces` (list) and `/workspaces/:id`. API: `/api/case-prep/*`.

An advocate uploads case papers (FIR, chargesheet, legal notice, agreement,
medical report, order), and gets:

1. **Source text** — each page's text, stored exactly as extracted and split
   into labelled passages (`p3.2` = page 3, passage 2).
2. **Facts** — extracted by the AI, each with an exact quote. The server looks
   for that quote in the stored text. Found: *source-verified*, linked to the
   document, page and passage. Not found: *unverified claim*, kept out of the
   statement of facts unless a reviewer confirms it.
3. **Chronology** — dated facts, with dates re-read from the source wording
   (Indian DD/MM/YYYY convention). Disagreements with the AI's reading are flagged.
4. **Issues** — AI analysis built from the fact list, so each issue names the
   facts it relies on. Suggested provisions are always marked *authority not
   verified*; URLs and case-law citations are removed.
5. **Rule-based checks** — section references written in the documents
   (English and common Hindi forms, e.g. `u/s 379 IPC`, `धारा 323 भादवि`), and the
   1 July 2024 IPC/CrPC → BNS/BNSS transition check.
6. **Brief** — assembled from reviewed material, editable block by block,
   exportable to Markdown or a printable page (with a draft watermark until approved).

## Trust model

| Label | Meaning |
| --- | --- |
| Source-verified | Quote found in the stored document text at the cited page |
| Unverified claim | AI output whose quote was not found |
| Reviewer-confirmed | A person vouched for it without a source link |
| AI analysis | Generated reasoning; not source material, not legal advice |
| Rule-based check | Deterministic check, not an AI judgement |

- The model only proposes. Verification, date parsing, fact references and
  sanitising happen on the server (`server/lib/case-prep/`).
- Brief provenance is server-owned: clients can edit text, reorder, delete and
  add notes, but cannot change a block's kind, origin or the fact it cites.
- **Approval** requires every fact and AI analysis in the brief to be reviewed,
  plus a named reviewer attestation. Any later edit, fact/issue review change or
  document deletion returns the brief to draft.
- No statute or case-law database is connected. The product says so wherever
  provisions appear and links to India Code for verification.

## Security

- Every route requires a session and is scoped to the workspace owner; other
  users (including admins) get 404.
- Uploads are identified by file signature, not name or MIME type; size and
  count are limited; duplicates are detected by SHA-256.
- Files are stored outside `public/` under random keys, encrypted with
  AES-256-GCM (`CASE_PREP_ENCRYPTION_KEY`, mandatory in production), and served
  only through the authorised route with `nosniff`, `no-store` and a sandbox CSP.
- Document text is untrusted: it is delimited in prompts, the model is told to
  ignore instructions inside it, and it has no tools. Exports escape all text.
- AI keys stay on the server; remote AI endpoints must use HTTPS.
- Analysis and uploads are rate-limited per user; every consequential step is
  written to `case_prep_audit_log`.

## Configuration

See `.env.example` (`CASE_PREP_*`, `AI_*`) and `DEPLOYMENT.md` section 3a.

## Tests

```bash
scripts/apply-test-migrations.sh            # once, needs a local MySQL/MariaDB
npm test
```

Integration tests run the whole workflow against a real database and a local
mock AI provider that deliberately returns wrong passage labels, fabricated
quotes, misread dates, case-law citations and links. They are skipped when no
test database is reachable.

## Known limitations

- Scanned PDFs (no text layer) cannot be read yet; photographed pages (PNG/JPEG/WebP)
  are transcribed only when the configured model accepts images.
- Word files are not accepted; save as PDF.
- Hindi PDFs made with legacy (non-Unicode) fonts such as Kruti Dev extract as
  unreadable text; Unicode Hindi works.
- Statutes and precedents are not retrieved from an authoritative source.
- Workspaces belong to one user; there is no firm/team sharing yet.
- Analysis runs in the API process (one per workspace); a restart marks it failed.
