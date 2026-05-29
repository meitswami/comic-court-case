# ⚖️ eNyayaSetu — Digital Bridge of Justice

<div align="center">

![eNyayaSetu Logo](src/assets/logo.png)

**AI-Powered Virtual Courtroom Platform for Accessible Justice**

🌐 **Live:** [https://enyayasetu.vercel.app/](https://enyayasetu.vercel.app/)

[![Built with React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com/)
[![Tailwind](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Deployed on Vercel](https://img.shields.io/badge/Vercel-deployed-000000?logo=vercel&logoColor=white)](https://enyayasetu.vercel.app/)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Live Demo](#-live-demo)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [System Architecture](#-system-architecture)
- [Routes](#-routes)
- [Use Cases](#-use-cases)
- [Project Structure](#-project-structure)
- [API Endpoints](#-api-endpoints)
- [Database Schema](#-database-schema)
- [Getting Started](#-getting-started)
- [Configuration](#-configuration)
- [Deployment](#-deployment)
- [Roadmap](#-roadmap)
- [Known Issues](#-known-issues)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🌟 Overview

**eNyayaSetu** (literally *"Bridge of Justice"* in Hindi) is an AI-powered
virtual courtroom platform that brings accessible justice online. Real
participants interact with an AI judge and AI lawyers to process cases
based on **Indian Laws** — complete with evidence OCR, identity verification,
voice transcription, and full case lifecycle management.

The platform serves:

- 👥 **Citizens** who want to understand the strength of their case before
  approaching a real lawyer.
- 🎓 **Law students** practising courtroom procedure in a realistic
  environment.
- 🏛️ **Legal-aid organisations** that need an inexpensive triage tool.
- 📜 **RTI activists** who need a guided way to draft and file Right-to-
  Information applications.

## 🌐 Live Demo

| Environment | URL                                    |
| ----------- | -------------------------------------- |
| Production  | https://enyayasetu.vercel.app/         |

> Try the **Example Cases** button on the landing page to walk through a
> complete hearing without filing your own case.

## ✨ Key Features

### 🔍 Intelligent Document Processing
- 📎 Upload PDF/Image FIR, SIR, FR, contracts, certificates
- 🤖 AI OCR extracts case number, parties, sections, summary
- 🔄 Automatic duplicate-case detection

### 🎤 Multilingual Voice Recognition
- 🇬🇧 English, 🇮🇳 Hindi, 🇮🇳🇬🇧 Hinglish
- ElevenLabs Scribe for real-time transcription
- Web Speech API fallback when offline

### 👁️ AI Face Detection & Verification
- TensorFlow.js + face-api.js running fully in-browser
- ID document upload (Aadhaar / DL / Passport)
- Live selfie capture with confidence scoring
- Optional 3-5 second video review for backend team

### ⚖️ Virtual Courtroom
- Roles: Judge, Public Prosecutor, Defence Lawyer, Stenographer,
  Accused, Victim, Family, Police, Audience
- Role-based AI responses, real-time transcription, evidence
  presentation, adjournment requests
- Hand-raise, witness requests, hearing timer

### 💼 New Features
- **Case Strength Analysis** — instant AI-powered % strength from your
  uploaded documents (analysis is free, AI suggestions are an addon).
- **RTI Tutorial & Application** — guided tutorial on the Right to
  Information Act with one-click application drafting.

### 💰 Payments & Wallet
- INR wallet with top-ups, addon purchases, and pay-per-hearing
- Promo codes, invoices (PDF), and full transaction history
- Pluggable payment-gateway settings (Razorpay / PhonePe ready)

### 🧑‍💼 Admin Console
- User management, wallet adjustments, promo codes
- Payment-gateway configuration, usage stats, hearing logs
- Notifications, audit trail

## 🛠️ Tech Stack

| Layer        | Technology                                                  |
| ------------ | ----------------------------------------------------------- |
| Frontend     | React 18, TypeScript, Vite 5, React Router 6                |
| UI           | shadcn/ui (Radix), Tailwind CSS, lucide-react, sonner       |
| State        | TanStack Query, React Context                               |
| Auth         | Custom JWT (bcryptjs + jsonwebtoken), 2FA via `speakeasy`   |
| Backend      | Node.js + Express 4, deployed as a Vercel Serverless Function (`api/index.js`) |
| Database     | MySQL 8 (mysql2/promise), Hostinger-friendly with SSL       |
| AI / OCR     | Gemini 2.5 Flash + GPT-4 (via AI gateway)                   |
| Voice        | ElevenLabs STT + TTS (`@elevenlabs/react`)                  |
| Face Detect  | face-api.js (TensorFlow.js)                                 |
| PDF / QR     | jsPDF, qrcode                                               |
| Storage      | Supabase Storage (evidence, recordings, knowledge base)     |
| Hosting      | Vercel (frontend + API), Hostinger (MySQL)                  |

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                  Browser (React 18 SPA, Vite)                    │
│  Pages:  /  /auth  /dashboard  /court  /pricing  /rti  /admin    │
│                                                                  │
│  Components:                                                     │
│   • Hero, CaseSelection, CaseIntakeChat                          │
│   • CourtroomScene, CourtHearing, HearingTimer                   │
│   • IdentityVerification (face-api.js)                           │
│   • EvidenceUpload, KnowledgeBaseUpload                          │
│   • RTIChatAgent, RTITutorial                                    │
│   • Wallet, Checkout, AddonPurchase, Authenticator (2FA)         │
└──────────────────────────────┬───────────────────────────────────┘
                               │ fetch (same-origin via Vercel)
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│        Vercel Serverless Function — api/index.js                 │
│        (Express 4, runtime @vercel/node@3)                       │
│                                                                  │
│   /api/auth          /api/cases         /api/court               │
│   /api/payments      /api/invoices      /api/evidence            │
│   /api/addons        /api/case-strength /api/rti                 │
│   /api/ai            /api/authenticator /api/health              │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│        MySQL 8 on Hostinger (mysql2 connection pool)             │
│   users · profiles · user_roles · user_wallets                   │
│   cases · case_evidence · case_intake_messages · case_reports    │
│   hearing_sessions · hearing_logs · hearing_transcripts          │
│   court_sessions · court_participants · court_witness_requests   │
│   evidence · notifications · addons · case_addons                │
│   invoices · payments · transactions · promo_codes               │
│   payment_gateway_settings · ai_usage_logs                       │
│   identity_verifications                                         │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    External Services                             │
│   • ElevenLabs    — STT (Scribe) + TTS                           │
│   • AI Gateway    — Gemini 2.5 Flash, GPT-4                      │
│   • Supabase      — Storage buckets (evidence, recordings)       │
│   • Razorpay /    — Payment gateways                             │
│     PhonePe                                                      │
│   • Resend        — Transactional email                          │
└──────────────────────────────────────────────────────────────────┘
```

## 🛣️ Routes

| Path                     | Description                                | Auth         |
| ------------------------ | ------------------------------------------ | :----------: |
| `/`                      | Landing page                               | No           |
| `/auth`                  | Login / Register / Forgot Password         | No           |
| `/dashboard`             | User cases, wallet, invoices               | Yes          |
| `/court`                 | Pre-hearing lobby                          | Yes          |
| `/court/:sessionId`      | Live virtual courtroom session             | Yes          |
| `/rti`                   | RTI tutorial & application                 | Yes          |
| `/pricing`               | Pricing & plans                            | No           |
| `/admin`                 | Admin console                              | Yes (admin)  |
| `*`                      | NotFound page                              | No           |

> 💡 Direct hits to deep routes (e.g. `/dashboard`, `/auth?token=…`) are
> rewritten to `/index.html` by `vercel.json` so React Router can take
> over. Without that rewrite, password-reset and email-confirmation
> links land on Vercel's 404 page.

## 📌 Use Cases

### 1️⃣ Citizen filing a new case
1. Upload an FIR / SIR / FR.
2. OCR auto-fills case number, parties, sections.
3. Duplicate detection asks whether to merge or proceed.
4. Identity verification (ID + selfie + 3-second video).
5. AI Intake chat collects remaining facts.
6. Case is registered, callback scheduled.

### 2️⃣ Virtual court hearing
1. Login → select your role.
2. Pay (or use wallet) → enter the courtroom.
3. Speak in English / Hindi / Hinglish — live transcription.
4. AI judge / AI lawyers respond by role.
5. Submit evidence, request adjournment, deliver verdict.
6. Download transcript + invoice PDF.

### 3️⃣ Evidence analysis
1. Upload documents, images or PDFs to a case.
2. AI extracts dates, parties, section numbers.
3. Generates a relevance & implications report.
4. Outputs are persisted in `case_evidence` for the hearing.

## 📁 Project Structure

```
eNyayaSetu/
├── 📂 api/                       # Vercel serverless entry
│   └── index.js                  # Wraps the Express app for @vercel/node
│
├── 📂 server/                    # Express backend
│   ├── index.js                  # Long-lived server for `npm run server`
│   ├── lib/                      # Plain-JS modules used by serverless
│   │   ├── auth.js               #   custom JWT auth service
│   │   └── mysql.js              #   mysql2 connection pool + helpers
│   ├── middleware/
│   │   └── auth.js               # JWT verification + admin gate
│   └── routes/
│       ├── auth.js
│       ├── cases.js
│       ├── court.js
│       ├── evidence.js
│       ├── invoices.js
│       ├── payments.js
│       ├── addons.js
│       ├── case-strength.js
│       ├── rti.js
│       ├── authenticator.js      # TOTP-based 2FA
│       └── ai.js
│
├── 📂 src/                       # React frontend (Vite)
│   ├── pages/                    # Index, Auth, Dashboard, Court,
│   │                             # Pricing, RTI, Admin, NotFound
│   ├── components/
│   │   ├── ui/                   # 40+ shadcn/ui primitives
│   │   ├── admin/                # admin console pieces
│   │   ├── courtroom/            # live court UI
│   │   └── *.tsx                 # CaseIntakeChat, CourtHearing,
│   │                             # IdentityVerification, EvidenceUpload,
│   │                             # WalletTopUp, RTITutorial, …
│   ├── contexts/                 # LanguageContext, etc.
│   ├── hooks/                    # useAuth, useElevenLabsSTT,
│   │                             # useFaceDetection, useVoiceControls
│   ├── integrations/
│   │   ├── mysql/                # (legacy TS - kept for type hints)
│   │   └── supabase/             # Storage client + types
│   ├── services/
│   │   └── auth.ts               # legacy server-side TS (kept for
│   │                             # type hints; serverless uses
│   │                             # server/lib/auth.js)
│   ├── utils/                    # apiUrl, generateCasePDF
│   ├── App.tsx
│   └── main.tsx
│
├── 📂 mysql/                     # SQL migrations
├── 📂 supabase/                  # legacy Edge Functions (deprecated)
├── 📂 scripts/                   # one-off DB / seed scripts
├── 📂 public/                    # static assets, favicon
│
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.{,app,node}.json
├── vercel.json                   # SPA rewrites + function runtime
├── .env.example
└── .gitignore
```

## 🔌 API Endpoints

All endpoints are served from the same Vercel deployment under `/api/*`.

| Group         | Method  | Path                        | Description                       |
| ------------- | :-----: | --------------------------- | --------------------------------- |
| Auth          | `POST`  | `/api/auth/signup`          | Create account, returns session   |
| Auth          | `POST`  | `/api/auth/signin`          | Login, returns session            |
| Auth          | `GET`   | `/api/auth/is-admin`        | Returns `{ isAdmin: boolean }`    |
| Cases         | `GET`   | `/api/cases`                | List cases (admin: all)           |
| Cases         | `POST`  | `/api/cases`                | Create case                       |
| Court         | `*`     | `/api/court/*`              | Sessions, transcripts, witnesses  |
| Evidence      | `*`     | `/api/evidence/*`           | Upload / list / analyse           |
| Payments      | `*`     | `/api/payments/*`           | Create payment, list, confirm     |
| Invoices      | `*`     | `/api/invoices/*`           | Generate / fetch PDF              |
| Addons        | `*`     | `/api/addons/*`             | List / purchase addons            |
| RTI           | `*`     | `/api/rti/*`                | Tutorial, application drafting    |
| Case Strength | `*`     | `/api/case-strength/*`      | Strength % + AI suggestions       |
| AI            | `*`     | `/api/ai/*`                 | Chat / OCR / TTS / STT proxies    |
| Authenticator | `*`     | `/api/authenticator/*`      | TOTP setup + verification         |
| Health        | `GET`   | `/api/health`               | `{ status: "ok" }`                |

## 🗄️ Database Schema

Key tables (full DDL lives in `mysql/migrations/`):

```
users · profiles · user_roles · user_wallets · identity_verifications
cases · case_evidence · case_intake_messages · case_reports · case_addons
hearing_sessions · hearing_logs · hearing_transcript_logs ·
hearing_participant_logs · hearing_evidence_logs ·
hearing_interaction_logs · hearing_document_processing_logs
court_sessions · court_participants · court_transcripts ·
court_evidence_submissions · court_witness_requests ·
court_hand_raises · court_date_requests
evidence · notifications · addons
invoices · payments · transactions · promo_codes ·
payment_gateway_settings · ai_usage_logs
```

Important enums: `case_status` (pending, in_progress, adjourned,
verdict_delivered, closed) · `court_party_role` · `evidence_party` ·
`app_role` (admin, user).

## 🚀 Getting Started

### Prerequisites
- Node.js **18+** and npm
- MySQL **8+** (local Docker or Hostinger Cloud MySQL)
- (Optional) ElevenLabs, Resend, Razorpay accounts for full feature parity

### Installation

```bash
git clone https://github.com/meitswami/comic-court-case.git
cd comic-court-case

npm install

# 1. Copy and fill environment variables
cp .env.example .env
#    edit .env with your DB / JWT / API keys

# 2. Apply migrations (use phpMyAdmin or the mysql CLI)
mysql -h "$DB_HOST" -u "$DB_USER" -p "$DB_NAME" < mysql/migrations/001_initial_schema.sql
#    repeat for each numbered file in mysql/migrations/

# 3. Start dev (frontend + backend together)
npm run start:prod
#    or in two terminals:
npm run server    # http://localhost:3000  (Express via tsx)
npm run dev       # http://localhost:8080  (Vite)
```

### Production build

```bash
npm run build           # outputs static frontend to dist/
npm run preview         # smoke-test the built bundle locally
```

## ⚙️ Configuration

See [`.env.example`](./.env.example) for the full list. Required:

| Variable           | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `DB_HOST`          | MySQL host                                           |
| `DB_PORT`          | MySQL port (default `3306`)                          |
| `DB_USER`          | MySQL user                                           |
| `DB_PASSWORD`      | MySQL password                                       |
| `DB_NAME`          | MySQL database                                       |
| `JWT_SECRET`       | 32+ char random string for signing tokens            |
| `JWT_EXPIRES_IN`   | Token lifetime (default `7d`)                        |
| `API_PORT`         | Local Express port (default `3000`)                  |
| `NODE_ENV`         | `development` or `production`                        |
| `VITE_API_URL`     | Override frontend → backend URL (blank on Vercel)    |

## 🚢 Deployment

The live site is deployed on **Vercel** with the following config:

- `vercel.json` runs `api/index.js` on `@vercel/node@3` and rewrites
  every non-`/api` path to `index.html` so React Router handles deep
  links.
- Environment variables are configured in **Vercel → Settings → Environment
  Variables** (mirror everything in `.env.example`).
- The MySQL host must allow remote connections (Hostinger:
  *Databases → Remote MySQL*).

If `/api/*` returns 500 or `/auth` shows a 404, follow
[VERCEL_500_ERROR_FIX.md](./VERCEL_500_ERROR_FIX.md) and
[IMPROVEMENTS.md](./IMPROVEMENTS.md).

## 🗺️ Roadmap

The full phased plan is in [`ROADMAP.md`](./ROADMAP.md). Highlights:

- **Phase 1 — Stabilise & polish:** SPA-route fix ✅, mobile pass,
  multi-language UI (Hindi + 8 regional languages), Sentry/log telemetry.
- **Phase 2 — Citizen tools:** Lawyer marketplace, real-court status via
  eCourts API, document generators (FIR copy, RTI, consumer complaint),
  rights-and-duties knowledge base.
- **Phase 3 — Advanced AI:** Citation-grounded judgements, semantic
  judgement search, case-strength simulator, fine-tuned Indian-law LLM.
- **Phase 4 — Ecosystem:** React Native mobile app, public API, DigiLocker
  / UMANG / WhatsApp integrations, legal-aid partnerships.
- **Phase 5 — Long-term vision:** Voice-only kiosk mode, AI mediation
  rooms, AR evidence reconstruction, government partnership pilots.

## ⚠️ Known Issues

The full bug list is in [`IMPROVEMENTS.md`](./IMPROVEMENTS.md). Top
priorities:

1. **Rotate exposed credentials** — older commits and several `*.md`
   docs contained the production MySQL password and JWT secret.
   Rotate them in Hostinger immediately and generate a new JWT secret.
2. **Email verification & password reset deep-links** — depend on the
   SPA rewrite shipped in this PR.
3. **Open Graph / Twitter image** points to `/src/assets/logo.png`
   (dev-only path); replace with a static `public/og-image.png`.
4. **`og:url`** points to `https://enyayasetu.com` which is not yet a
   live domain.

## 🤝 Contributing

1. Fork the repo.
2. Create a feature branch (`git checkout -b feat/your-feature`).
3. Commit using Conventional Commits (`feat:`, `fix:`, `docs:`, …).
4. Open a PR describing **what** changed and **why**.

For larger ideas, please open an issue tagged `roadmap` first so we can
align on design.

## 📄 License

Proprietary — all rights reserved. Contact the maintainer for licensing
inquiries.

---

<div align="center">

**Made with ⚖️ for accessible justice in India.**

*eNyayaSetu — Bridging the Gap to Justice*

🌐 [enyayasetu.vercel.app](https://enyayasetu.vercel.app/)

</div>
