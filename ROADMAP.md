# 🗺️ eNyayaSetu — Roadmap

A phased plan for evolving https://enyayasetu.vercel.app/ from an
AI-courtroom demo into a full-featured legal-tech platform for India.

Effort tags: **S** = ≤ 1 week · **M** = 2–4 weeks · **L** = > 1 month.

---

## Phase 1 — Stabilise & Polish (next 4 weeks)

Goal: make the existing experience reliable and shareable.

| Item                                                                  | Effort |
| --------------------------------------------------------------------- | :----: |
| Fix `/api/*` 500s (TS-import / runtime mismatch)                      | S      |
| Fix SPA 404s with `vercel.json` rewrites                              | S      |
| Repair email verification + password reset flows                      | S      |
| Rotate exposed DB password + JWT secret                               | S      |
| Replace `/src/assets/logo.png` OG image with a stable static one      | S      |
| Buy and connect `enyayasetu.com` domain                               | S      |
| Generate `sitemap.xml`, fix `robots.txt`, register on Search Console  | S      |
| Mobile responsiveness pass (320–414 px)                               | M      |
| Accessibility pass to WCAG 2.1 AA                                     | M      |
| Wire Sentry for React errors and Logflare for the function            | S      |
| Add a friendly in-app 404 page                                        | S      |
| Generate per-table TypeScript types for the MySQL helpers             | S      |
| Self-host audio cues (gavel, ambient) instead of freesound CDN        | S      |

---

## Phase 2 — Citizen Tools (months 2–3)

Goal: become genuinely useful to first-time users with no legal
background.

### 2.1 Multi-language UI
- Hindi + 8 regional languages (Bengali, Marathi, Tamil, Telugu,
  Kannada, Gujarati, Malayalam, Punjabi).
- `i18next` with one namespace per page; ship language files via
  Supabase Storage so they can be updated without redeploys.
- Auto-detect from browser, allow override in profile.

### 2.2 Lawyer marketplace
- Verified human lawyers register, set rates, accept consultations.
- Reuse the existing `payments` / `invoices` / `wallets` plumbing.
- Tag lawyers by domain (criminal, civil, family, property, cyber).
- Reviews & ratings; complaint mechanism.

### 2.3 Real-court status integration
- Integrate **eCourts Services API**
  (https://services.ecourts.gov.in) so a user can paste a CNR number
  and see real hearing dates, orders and parties.
- Cache responses in `cases.public_court_data` to respect rate limits.

### 2.4 Document generators
- Templated drafts for FIR copies, RTI applications, consumer
  complaints, NCLT filings, cheque-bounce notices.
- Powered by structured prompts + the existing PDF pipeline.

### 2.5 Rights & duties knowledge base
- Searchable, plain-language summary of fundamental rights, consumer
  rights, women's rights, labour rights, tenant rights.
- Each article links to relevant act sections and example cases.

### 2.6 In-app notifications & email
- Hook up Resend to actually deliver:
  - email verification
  - password reset
  - hearing reminders
  - payment receipts
- Mirror to the in-app `notifications` table; show a bell with unread
  count.

---

## Phase 3 — Advanced AI (months 4–6)

Goal: deliver state-of-the-art legal-AI quality, grounded in real
Indian law.

### 3.1 Citation-grounded AI judge
- Build a vector index over IPC, BNS, CrPC, BNSS, the Constitution,
  and a curated set of landmark judgements.
- Modify the AI judge prompts to retrieve top-k passages and force the
  model to cite section numbers in every verdict.
- Display citations as clickable footnotes in the live transcript.

### 3.2 Judgement search
- Full-text + semantic search over Supreme Court & High Court
  judgements (sources: Indian Kanoon dataset, eCourts).
- "Cases similar to mine" recommendations from any case in the
  dashboard.

### 3.3 Case-strength simulator
- Given a filed case, run AI lawyers in self-play mode and report:
  - Estimated probability of conviction / acquittal.
  - Key weaknesses in the user's evidence.
  - Suggested additional evidence.

### 3.4 Fine-tuned Indian-law LLM
- Collect anonymised hearing transcripts (with explicit user consent).
- Fine-tune an open model (Llama-3, Mistral) on legal-Indian-English
  plus Hindi/Devanagari legal vocabulary.
- Self-host on a single A10 GPU with autoscale fallback to OpenAI.

### 3.5 Bias & safety audit
- Adversarial test suite for race, religion, caste, gender bias in AI
  verdicts.
- Independent audit before any "Phase 3.4" fine-tune goes live.

### 3.6 Real-time transcription accuracy
- Cut Word Error Rate by >30 % via:
  - Domain-adapted ElevenLabs Scribe prompts (legal jargon hints).
  - Speaker diarisation (one transcript per role per session).
  - Optional human-correction pass after the hearing.

---

## Phase 4 — Ecosystem (months 6–12)

Goal: become a platform others build on.

### 4.1 Mobile app
- React Native (Expo) sharing the React component library.
- Push notifications for hearing updates, case status, payment
  reminders.
- Native camera for evidence photos and identity verification.

### 4.2 Public API
- REST + Webhooks for:
  - Case-strength scoring.
  - Judgement search.
  - RTI drafting.
- Tiered pricing, OAuth-style API keys, usage in `ai_usage_logs`.

### 4.3 Integrations
- **DigiLocker** — pull verified ID + certificates with user consent.
- **UMANG** — surface eNyayaSetu as a service inside the central
  citizen-services app.
- **WhatsApp Business** — case updates, evidence upload by message.
- **NIC eCourts** — official filing pilot in select courts.

### 4.4 Legal-aid partnerships
- Free / subsidised tier for users referred by NALSA, state legal
  services authorities and registered NGOs.
- Bulk admin tools for partner organisations.

### 4.5 Analytics & open data
- Public, anonymised dashboard:
  - Most common case types per state.
  - Average time-to-verdict in the simulator.
  - RTI categories filed.
- Helps researchers and policymakers; doubles as marketing.

---

## Phase 5 — Long-term Vision (year 2+)

- **Voice-only kiosk mode** for tier-3 cities and rural common-service
  centres — Aadhaar-OTP login, full voice interaction in local
  language.
- **Mediation room** — AI-mediated negotiation between parties before
  any hearing, often resolving disputes outside court.
- **AR evidence reconstruction** — upload photos of an accident scene
  and let the platform generate a 3D reconstruction for the courtroom.
- **Government partnership pilot** — state-level adoption as the front
  door for civil dispute filing in one pilot district.
- **Blockchain-anchored evidence** — store SHA-256 hashes of submitted
  evidence on a public chain so chain-of-custody can be verified later.

---

## Cross-cutting workstreams (always on)

- **Security & compliance:** quarterly pen-tests, DPDP Act 2023
  alignment, data residency in `ap-south-1`, automated secret scanning
  in CI.
- **Performance:** keep Lighthouse Performance ≥ 90, p95
  hearing-start latency ≤ 3 s.
- **Cost control:** track AI / TTS / storage spend per active user;
  alert when unit-cost regresses.
- **Open source:** publish non-core components (PDF helpers, RTI
  templates, evidence OCR pipeline) under MIT to grow the contributor
  base.

---

## How to suggest changes

Open a GitHub issue tagged `roadmap` describing:

1. The user problem.
2. The proposed solution.
3. Which phase you think it fits.

Roadmap items move into actual sprints when an issue is upgraded to a
`milestone:Phase X` and assigned an owner.
