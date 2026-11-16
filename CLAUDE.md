# CLAUDE.md — Project Guide

**Project:** AI-Powered Road Infrastructure Damage Detection, Severity Assessment and Maintenance Management System
**Type:** Final Year Project (FYP)
**Status:** Phase 5 (admin–engineer chat and admin analytics) implemented and committed separately from Stage 4 (`003b4b9`).
- **Phase 1 — backend foundation:** Express + TypeScript + Prisma, health endpoints, CORS, error handling, tests.
- **Phase 2 — authentication and user management:** citizen registration with SMS OTP verification (mock SMS in development only), login/logout, cookie-based JWT sessions with refresh-token rotation, CSRF protection, role-based authorization, admin bootstrap CLI, admin engineer management, and the React frontend for all of these.
- **Phase 3 — citizen reporting and AI integration:** report submission (live camera + browser GPS, or gallery upload + map pick), secure image storage (private original + metadata-free display copy), EXIF location verification, the Python + FastAPI AI service running the trained `best.pt`, Node-side estimated severity, the citizen dashboard (list, summary, detail with detection boxes and map), and tests (2026-11-14).
- **Stage 4 — admin and engineer workflows (2026-11-14):** admin dashboard, report list (search/filter/paginate) and detail; Review / Accept / Reject / Delay / Keep delayed with reasons and status history; severity correction; engineer suggestions and (re)assignment; engineer dashboard, job detail, repair status per **repair attempt**, notes, repair photos (1–5 per attempt), work history; admin "needs more work" feedback and completion confirmation; citizen decision reason and repair progress; citizen SMS on Accepted/Rejected/Delayed/Completed (mock in development).
- **Phase 5 — maps, communication and analytics (2026-11-15):** one-to-one admin–engineer chat (WebSocket `ws` + REST history, PostgreSQL persistence, idempotent sends by `clientId`, reconnect with catch-up), admin analytics page with Recharts (real report data, one shared date range). Maps/EXIF/GPS and citizen SMS were verified, not rebuilt.
- **Phase 6 — Civic Ink redesign, in-app notifications and web improvements (2026-11-16, NOT committed yet):** see §15 (incl. structured logging, admin sorting, possible-duplicate hints, turnaround metrics, AI retry and the engineer map).
- **Not implemented yet:** priority, a real SMS provider, chat attachments/read receipts/typing/unread counts, model evaluation/retraining.
- **Model validation status:** only the `pothole` class has been exercised with a real photo (one Wikimedia Commons image, detected at confidence ≈ 0.69). `longitudinal_crack`, `transverse_crack` and `alligator_crack` have **not** been tested yet; they will be tested later with the owner's RDD2022 data. Never claim the model is validated for all four classes.

This file is the main reference for anyone (human or AI) working in this repository. If anything here conflicts with an explicit instruction from the project owner, the owner's instruction wins. Update this file when decisions are made.

---

## 0. Rules for Claude (always follow)

1. **Always inspect existing code before modifying it.** Read the relevant files and check `git status` first.
2. **Never overwrite or delete existing work without permission.**
3. **Explain important architectural decisions:** what was chosen, why, and what the alternatives were.
4. **Keep frontend and backend responsibilities separate** (see §5).
5. **Write modular, maintainable code:** small focused modules, clear names, no copy-paste duplication.
6. **Do not invent requirements, model results, metrics, dataset details, or completed features.** If something is unknown, say so.
7. **Ask before making major architectural changes or introducing additional technologies** (new libraries, services, databases, frameworks, cloud providers).
8. **Explain unfamiliar technical concepts in beginner-friendly language** when asked.
9. **Do not implement features that have not been approved.** Stick to the agreed scope of each task.
10. **Do not start model training or retraining** unless explicitly requested.
11. **Do not commit or push** unless asked.
12. **Never put passwords, API keys, JWT secrets, or other credentials in Git.** Use environment variables and a committed `.env.example` that contains placeholder values only.
13. **Treat uploaded images and location metadata as potentially sensitive information** (see §8).

Also:
- Do not add large datasets or model weights to Git without first agreeing a storage approach with the owner.
- When a task is finished, report exactly what changed, what was not done, and any open decisions.

---

## 1. Project overview and objectives

A web application that connects:
- **Citizens**, who report road damage,
- **Administrators**, who check reports and manage repairs,
- **Maintenance engineers**, who repair roads and report progress.

### Objectives
1. Make road damage reporting simple, using photos and location.
2. Use an existing trained YOLOv8 model to detect the **damage class** and **confidence**, and from these produce an **initial severity estimate**.
3. Check location reliability by comparing EXIF GPS metadata with the location the user provides.
4. Give admins tools to check, filter, prioritise and assign reports.
5. Assign work to engineers based on calculated workload and availability.
6. Support real-time admin–engineer communication.
7. Keep citizens informed through SMS notifications.

### Out of scope for now
- Model training, retraining, evaluation, or performance tuning (planned for later).
- Selecting the SMS provider (not yet decided).

---

## 2. User roles and permissions

There are exactly three roles: `citizen`, `admin`, `engineer`. Every protected backend endpoint must check the role.

| Capability | Citizen | Admin | Engineer |
|---|:-:|:-:|:-:|
| Self-register | ✅ | ❌ | ❌ (created by admin) |
| Verify mobile number | ✅ | — | — |
| Submit damage report | ✅ | ❌ | ❌ |
| View own reports and progress | ✅ | — | — |
| View all reports | ❌ | ✅ | ❌ |
| Accept / reject / delay report | ❌ | ✅ | ❌ |
| Correct severity | ❌ | ✅ | ❌ |
| Create engineer accounts | ❌ | ✅ | ❌ |
| Assign reports to engineers | ❌ | ✅ | ❌ |
| View engineer profiles and workload | ❌ | ✅ | Own profile only |
| View assigned jobs | ❌ | All | Own only |
| Update repair status, notes, repair photos | ❌ | ❌ (monitors only) | ✅ (own jobs) |
| Admin ↔ engineer chat | ❌ | ✅ | ✅ |
| Dashboard statistics | ❌ | ✅ | ❌ |
| Receive notifications | SMS | ✅ (channel to be decided) | ✅ (channel to be decided) |

Rules:
- A citizen can only see **their own** reports.
- An engineer can only see and update jobs **assigned to them**, and can access only **their own** profile.
- Admins **monitor** repair status; only the assigned engineer updates it.
- **Multiple admin accounts** must be supported. Do not assume there is only one admin.
- Admin accounts are **not** created through public registration. Admins are created only with the CLI script `npm run admin:create` (implemented; see §7.2). It refuses to create another admin unless `--additional` is passed.
- **Implemented (Phase 2):** roles are the PostgreSQL enum `UserRole` = `CITIZEN | ADMIN | ENGINEER`. Account status is `AccountStatus` = `PENDING_VERIFICATION | ACTIVE | DEACTIVATED`. Authorization is enforced in the backend (`requireRole`); the frontend only hides what a role cannot use.
- **Implemented admin user management:** engineer accounts only (create, list, view, update, activate/deactivate). Managing citizen or other admin accounts through the API is **not** implemented yet.

---

## 3. Application workflows

### 3.1 Citizen registration
1. The citizen enters their name, mobile number and password.
2. The system sends a one-time verification code by SMS.
3. The citizen enters the code. The account becomes active only after the number is verified.
4. The citizen logs in with **mobile number + password** and receives a cookie-based JWT session (implemented; see §7.2).

Implementation details (Phase 2):
- Mobile numbers are validated as **mobile** numbers and stored in **E.164** (e.g. `+12025550143`). Without `PHONE_DEFAULT_COUNTRY`, users must type the `+country code`.
- A number that belongs to a verified (or non-citizen) account cannot be registered again (409). An **unverified** registration does not lock the number: registering again (after the resend cooldown) replaces the unproven details, and whoever proves ownership with the OTP wins.
- OTP: 6 digits from `crypto.randomInt`, stored only as an HMAC-SHA256 hash, valid **10 minutes**, max **5 wrong attempts** per code (then it is burned), **60 s** resend cooldown, max **5 codes per hour** per account. A new code invalidates older ones; a used code can never be reused.
- The account becomes `ACTIVE` only when the OTP is verified. Unverified citizens cannot log in (403 `ACCOUNT_NOT_VERIFIED`, revealed only after a correct password).

### 3.2 Report submission
1. The citizen chooses **Live camera** or **Gallery upload**.
   - **Live camera:** a photo is taken in the browser and the device's GPS location is captured at the same time (with the user's permission).
   - **Gallery upload:** the citizen chooses an image and picks the location manually on a Leaflet/OSM map.
2. **Location verification** (see §8):
   - **Gallery upload:** the main backend reads EXIF GPS metadata, if present, and compares its distance to the manually selected location with a configurable tolerance. Result: `verified`, `mismatch` or `no_metadata`.
   - **Live camera:** no EXIF comparison is run. The browser GPS location is used and the status is `browser_gps`. Live-camera reports are **not** marked `no_metadata` just because browser camera images lack EXIF GPS. If the browser reports poor GPS accuracy, the report is flagged for an admin to check; the captured coordinates and accuracy are kept.
   - **Reports are never automatically rejected** for location reasons. `mismatch` and `no_metadata` reports, and live-camera reports with poor GPS accuracy, are flagged for an admin to check.
3. The main backend sends the image to the AI service, which runs the YOLOv8 model and returns detections (class, confidence, bounding box).
4. Severity is estimated from the detections (see §6).
5. The citizen sees the damage class, confidence and estimated severity.
6. The report is saved with status `submitted`.

Implementation details (Phase 3):
- **One photo per report**, JPEG or PNG only (detected from the file content, not the name/MIME type), max **10 MB**, longest side max **8000 px**. HEIC is not supported. Optional description, max 1000 characters.
- The backend keeps the **original upload** (with EXIF) privately and creates a **display copy**: EXIF orientation applied, re-encoded as JPEG, all metadata (including GPS) removed. Only the display copy is served and sent to the AI service, so AI boxes are in display-image pixels.
- EXIF GPS is read from the original (gallery uploads only). Thresholds: `EXIF_LOCATION_TOLERANCE_KM` (default **2 km**), `GPS_ACCURACY_THRESHOLD_METERS` (default **100 m**). A 0,0 EXIF position is treated as "no metadata".
- **If the AI service fails** (unavailable, timeout, rejected, invalid response) the report is **still saved** with `aiStatus = FAILED`, no detections and no severity. Nothing is ever faked.
- Submission is limited to **10 reports per hour per citizen** (keyed by user id, in memory).
- Every new report gets a `report_status_history` row (`null → SUBMITTED`, changed by the citizen).

### 3.3 Admin review
1. An admin views a list of reports and can search, filter and sort it (see §7.3).
2. An admin opens a report and sees the photo(s), AI detections, location verification result and a map location. Opening a report to look at it does **not** change its status.
3. The admin clicks the **Review** button. Only this action changes the status from `submitted` to `under_review`.
4. The admin may correct severity. Both the AI value and the admin value are kept.
5. The admin chooses **Accept**, **Reject** or **Delay**. *Proposed, pending confirmation:* Reject and Delay require a reason.
6. A `delayed` report stays `delayed` until an admin reviews it again and decides to accept it, reject it or keep it delayed.
7. The citizen is notified by SMS.

### 3.4 Assignment
1. For an accepted report, the system suggests engineers ranked by **calculated workload** (for example the number of active jobs) and **availability**.
2. The admin confirms or changes the assignment.
3. The engineer is notified. The report's assignment status is updated.
4. The exact workload/availability formula must be agreed with the owner before it is implemented.

Implementation (Stage 4, agreed 2026-11-14):
- **Suggestion formula:** only ACTIVE engineers, sorted by open jobs (report ACCEPTED, repair PENDING or WORKING), fewest first, ties by name. There is no availability field. The admin makes the final choice. Engineers who still have a temporary password can be assigned (the UI warns); deactivated engineers cannot.
- Assignment and reassignment are only possible while the report is `ACCEPTED`. Every (re)assignment starts a **new repair attempt** in its initial state `PENDING` and is recorded in `report_assignments` (engineer, previous engineer, admin, reason, attempt).
- "Engineer is notified": no channel is decided (§14); the job appears on the engineer's dashboard. Assignment status (`ASSIGNED`/`UNASSIGNED`) is derived from `reports.assigned_engineer_id`.

### 3.5 Maintenance
1. The engineer sees the assigned job: photos, map location, severity and details.
2. The engineer updates the status: **Pending → Working → Completed**.
3. The engineer adds notes and progress updates.
4. When the job is completed, the engineer uploads photo(s) of the repair.
5. Admins monitor progress. The citizen receives SMS updates when key milestones are reached.
6. When the engineer sets the repair status to **Completed**, the report status does **not** change automatically. An admin checks the repair and confirms it is complete; only then does the report status become `completed`, the final report status.
7. Completed jobs appear in the engineer's history.

Implementation (Stage 4, agreed 2026-11-14) — **repair attempts:**
- Work on a job is organised in numbered attempts. `reports.repair_attempt` is the current attempt; every repair photo, repair update and assignment row stores the attempt it belongs to. Nothing is ever deleted or re-tagged.
- A new attempt starts on first assignment (1), on reassignment (+1, PENDING, new engineer) and when the engineer **reopens** a Completed repair (COMPLETED → WORKING, +1). Nothing else changes it.
- Repair status is changed **only by the assigned engineer**: PENDING → WORKING; WORKING → COMPLETED (needs ≥ 1 photo **of the current attempt**); COMPLETED → WORKING (reopen, while the report is still ACCEPTED). PENDING is never requested through the API.
- Repair photos: 1–5 **per attempt**, only while the attempt is PENDING or WORKING (a Completed attempt is frozen evidence), same secure pipeline as citizen photos, no AI analysis. A reopened attempt or a new engineer can never rely on earlier photos.
- Admin "**Needs more work**" feedback is allowed **only** when the report is ACCEPTED **and** the repair is COMPLETED (awaiting confirmation); it is a note on the current attempt and never changes repair status — the engineer reopens.
- Admin **confirmation** (ACCEPTED + repair COMPLETED → report COMPLETED) names the attempt it confirms; a status-history note records it.
- Engineer and admin actions send the attempt number shown on screen (`expectedAttempt`); a stale action is refused with 409.

### 3.6 Chat
- One-to-one, WhatsApp-style chat between an admin and an engineer over WebSockets.
- Each admin–engineer pair has its own separate conversation. There is **no** shared inbox where several admins share one conversation with an engineer.
- Messages are stored in PostgreSQL so the history is kept.
- Read/delivered status and attachments are optional and must be agreed first.

Implementation (Phase 5, agreed 2026-11-15):
- **Who:** admins chat with ACTIVE engineers, engineers with ACTIVE admins (both must have changed their temporary password). Citizens have no chat (router, gateway and service all refuse them). A conversation is opened with `POST /chat/conversations { userId }` (idempotent; the unique `(admin_id, engineer_id)` pair keeps one row even when both sides open it at once). History with a later-deactivated user stays readable; new messages to an inactive account are refused (409 `CHAT_RECIPIENT_INACTIVE`).
- **Sending** happens over the WebSocket (`{type:"send", clientId, conversationId, body}`); REST serves history. The message is stored (transaction: insert + `last_message_at`) **before** the sender gets `ack`; then the recipient's sockets and the sender's other tabs get `message`.
- **Idempotency:** `clientId` is a client-generated UUID, unique per sender in the database. A resend with the same `clientId`, conversation and (trimmed) body returns the stored message (`ack`, no second push); a different conversation or body is refused (409 `CHAT_CLIENT_ID_CONFLICT`). Concurrent duplicates hit the unique index (P2002) and return the stored row.
- **Limits:** body 1–2000 characters after trimming (`CHAT_MESSAGE_MAX_LENGTH`), 30 messages per minute per user (in memory, all of the user's sockets), WebSocket frames over 16 KB are closed (1009). Constants in `src/config/chat.ts`.
- **Reconnect:** the client (`frontend/src/lib/chatSocket.ts`) reconnects with backoff (0.5 s … 30 s), keeps unacknowledged messages and resends them with the same `clientId`, and after every (re)connect fetches missed messages with `GET …/messages?after=<last id>`. On close code 4001 or a failed handshake it checks the session with `GET /auth/me` (which refreshes an expired session); only a 401/403 stops it, a network error or 5xx just retries. Close code 4003 (account may no longer chat) stops it.
- No unread counts, read receipts, typing indicators or attachments (not in scope).

### Status model
Report status and engineer repair status are **separate fields**. Never merge them.

- **Report status:**
  - `submitted` → `under_review` → `accepted` | `rejected` | `delayed`
  - `submitted` → `under_review` happens only when an admin clicks **Review**. Opening a report does not change its status.
  - `delayed` → `accepted` | `rejected` | `delayed` (when an admin reviews it again)
  - `accepted` → `completed` only after the assigned engineer has set the repair status to Completed **and** an admin confirms the repair. The engineer's Completed status never changes the report status by itself. `completed` is the final report status.
- **Repair status** (engineer task, set only by the assigned engineer): exactly **Pending**, **Working**, **Completed**. No other values.
- **Assignment status** (names proposed): `unassigned` | `assigned`
- **Location verification status:**
  - Gallery uploads: `verified` | `mismatch` | `no_metadata` | `not_checked`
  - Live camera: `browser_gps` (flagged for admin review when GPS accuracy is poor; see §8)

---

## 4. Technology stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Styling | Tailwind CSS |
| Main backend | Node.js 24 LTS + Express.js 5 (TypeScript, native ES modules) |
| ORM | Prisma 7 (connects through the `@prisma/adapter-pg` driver adapter) |
| Database | PostgreSQL 18 |
| AI service | Python + FastAPI, YOLOv8 (Ultralytics) + PyTorch |
| Authentication | JWT |
| Charts | Recharts |
| Maps | OpenStreetMap tiles + Leaflet |
| Real-time chat | WebSockets (admin–engineer chat) |
| Notifications | SMS for citizens — **provider not selected yet** |

MongoDB is **not** part of this project. Do not add MongoDB or any MongoDB-related dependencies.

Other libraries in use in the main backend (approved): `helmet` (security headers), `cors` (CORS), `tsx` (development runner), `typescript`, `prisma` / `@prisma/client` / `@prisma/adapter-pg`.

Added in Phase 2 (authentication):
- **Main backend:** `zod` (request validation), `@node-rs/argon2` (Argon2id password hashing), `jose` (JWT), `cookie-parser`, `express-rate-limit`, `libphonenumber-js` (mobile number validation/E.164).
- **Frontend (TypeScript):** `react` 19, `react-dom`, `react-router` 8 (declarative routing), `vite` 8, `@vitejs/plugin-react`, `tailwindcss` 4 with `@tailwindcss/vite`, `typescript`.

Added in Phase 3 (approved 2026-11-14):
- **Main backend:** `multer` (multipart uploads, memory storage with limits), `exifr` (EXIF GPS), `sharp` (metadata-free JPEG display copy). File type is checked with our own magic-byte check.
- **Frontend:** `leaflet` + `react-leaflet` (OpenStreetMap maps), `@types/leaflet`.
- **AI service (Python 3.12.16, managed with `uv`, venv `backend/ai/.venv`):** `torch 2.15.0+cpu`, `torchvision 0.29.2+cpu` (CPU-only wheels), `ultralytics 8.4.212`, `fastapi 0.162.7`, `starlette 1.10.0`, `uvicorn 0.54.0`, `python-multipart`, `pydantic`, `pydantic-settings`, `pillow`, `numpy`; tests: `pytest`, `httpx`. Exact pins are in `backend/ai/requirements.txt` / `requirements-dev.txt`. (Starlette warns that its test client prefers `httpx2`; `httpx` still works.)

Added in Phase 5 (approved 2026-11-15):
- **Main backend:** `ws` 8.23 (+ `@types/ws`) — WebSocket server attached to the existing `http.Server` (`noServer` + manual `handleUpgrade`). Node 24 has a WebSocket client but no server; `ws` is dependency-free. Socket.IO was rejected (own protocol, client library, fallbacks not needed).
- **Frontend:** `recharts` 3.10 — admin analytics charts (already in the stack table, first installed in Phase 5).

Library choices not listed here (for example the request validation library, the WebSocket library, the EXIF library, password hashing, or frontend state management) must be **proposed to the owner and approved** before use.

---

## 5. Architecture

```text
road-damage-fyp/
├── frontend/            React + Vite + Tailwind (TypeScript); see "Frontend layout" below
│   ├── index.html  vite.config.ts  tsconfig.json  package.json  .env.example
│   └── src/
│       ├── assets/          static images and icons
│       ├── components/      shared, reusable UI components
│       ├── features/        feature modules (UI + feature-specific hooks/api calls)
│       │   ├── auth/  citizen/  admin/  engineer/  chat/  notifications/
│       ├── hooks/           shared React hooks
│       ├── layouts/         page layouts (auth pages, logged-in app)
│       ├── lib/             configured clients (API/HTTP client, later WebSocket client, map setup)
│       ├── pages/           route-level pages shared by several roles
│       ├── routes/          routing and role-based route guards
│       ├── styles/          Tailwind entry and global styles
│       └── utils/           pure helper functions
│
├── backend/
│   ├── api/                 Node.js + Express main backend (see "Main backend layout" below)
│   │   ├── src/             main backend source code
│   │   ├── prisma/          Prisma schema (schema.prisma)
│   │   ├── storage/uploads/ runtime uploaded images (NOT in Git)
│   │   ├── tests/           backend tests
│   │   ├── prisma.config.ts Prisma CLI configuration
│   │   ├── .env.example     environment template (real .env is NOT in Git)
│   │   └── package.json
│   └── ai/                  Python + FastAPI AI inference service (see "AI service layout" below)
│       ├── app/             FastAPI application source code
│       ├── weights/         best.pt (NOT in Git)
│       ├── tests/           pytest (fake detector + one real-model test skipped without best.pt)
│       ├── requirements.txt / requirements-dev.txt   pinned dependencies
│       ├── .env.example     environment template (real .env is NOT in Git)
│       └── .venv/           Python 3.12.16 virtual environment (NOT in Git)
│
├── datasets/            dataset_notes.md only (data NOT in Git)
└── docs/                project documentation
```

> **Backend layout (approved):** `backend/api/` is the Node.js + Express main backend (Prisma, PostgreSQL access, uploads and business logic). `backend/ai/` is the Python + FastAPI AI inference service. Do not restructure these folders without the owner's approval.

### AI service layout (`backend/ai/`, Phase 3)
```text
app/
├── main.py       create_app(settings, detector): lifespan loads the model ONCE; GET /health, POST /v1/detect
├── config.py     Settings (pydantic-settings, prefix AI_, reads backend/ai/.env); invalid config stops startup
├── detector.py   Detector protocol + YoloDetector (Ultralytics; class names read from the model; missing weights → ModelLoadError)
├── images.py     decode JPEG/PNG with Pillow (pixel limit, EXIF orientation, RGB)
├── security.py   X-AI-Service-Key check (hmac.compare_digest)
├── schemas.py    Pydantic response models
└── errors.py     {"error": {"code", "message"}} responses, no internal details
```
- Run (from `backend/ai/`): `.venv/bin/uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000`. Bound to localhost by default.
- Tests: `.venv/bin/python -m pytest` (from `backend/ai/`).
- Install: `uv pip install --python .venv/bin/python -r requirements-dev.txt`. uv is installed in `~/.local/bin`.
- Inference runs in a worker thread behind a lock (one inference at a time); the model is warmed up at startup. `YOLO_OFFLINE=1` is set so Ultralytics makes no network calls.
- The service key is checked **before** the multipart body is read, so unauthenticated uploads are never parsed.

### Main backend layout (`backend/api/`, current)
```text
src/
├── index.ts               entry point: load + validate env, create SMS sender, Prisma client and services, start server, graceful shutdown
├── app.ts                 createApp(): builds the Express app (no server), so tests can use fake dependencies
├── config/
│   ├── env.ts             .env loading and environment validation
│   └── auth.ts            auth constants (token lifetimes, OTP limits, cookie names)
├── db/prisma.ts           Prisma client factory (PrismaPg adapter); one client is created in index.ts and injected
├── config/reports.ts      upload limits, report rate limit, SEVERITY_CONFIG (the single severity formula config)
├── routes/
│   ├── index.ts           everything under /api (health + /v1)
│   ├── health.routes.ts   /api/health, /api/health/db
│   └── v1/index.ts        /api/v1 router: auth, profile and admin routes (all application routes go here)
├── controllers/           request/response handling (thin): auth, profile, engineers, reports, adminReports, engineerJobs, chat, analytics, health
├── services/              business logic and database access
│   ├── index.ts           createServices(): wires all services (used by index.ts and tests)
│   ├── auth.service.ts    register, verify mobile, login, refresh, logout, change password
│   ├── otp.service.ts     OTP generation, hashing, limits, verification
│   ├── token.service.ts   access JWTs, refresh-token rotation/revocation
│   ├── user.service.ts    publicUserSelect (the only user fields sent to clients), profile
│   ├── engineer.service.ts  admin engineer management
│   ├── adminBootstrap.service.ts  admin creation for the CLI script
│   ├── password.service.ts  Argon2id hashing/verification
│   ├── report.service.ts  report submission flow, citizen list/summary/detail, authorised image access
│   ├── reportViews.ts     shared report selects/mappers (citizen view incl. decisionReason, repairProgress)
│   ├── reportWorkflow.ts  pure Stage 4 rules: report transitions, repair transitions, attempts, SMS rule
│   ├── adminReport.service.ts  admin list/detail/dashboard, review, decide (incl. keep delayed), severity, feedback, confirm
│   ├── assignment.service.ts   engineer suggestions (agreed formula), assign/reassign (new attempt)
│   ├── engineerJob.service.ts  engineer jobs: list/detail, repair status per attempt, notes, repair photos, photo access
│   ├── repairViews.ts     repair attempts grouping (shared by admin and engineer views)
│   ├── chat.service.ts    chat: contacts, conversations (open = idempotent), history paging, send (membership, active recipient, clientId idempotency)
│   ├── analytics.service.ts  admin analytics (Prisma groupBy/findMany only; one count per report; UTC day/week/month buckets)
│   ├── notification.service.ts citizen status SMS (after commit, never throws, masked logging)
│   ├── severity.ts        estimateSeverity() (heuristic estimate)
│   ├── ai/aiClient.ts     AiClient interface + HTTP client for the AI service (timeout, secret header, zod-validated response)
│   ├── images/            detectImageType (magic bytes), processImage (sharp display copy)
│   ├── location/          haversine, exifGps (exifr), verifyLocation
│   ├── storage/fileStorage.ts  FileStorage (random UUID keys under originals/ and display/)
│   ├── sms/               SmsSender interface + MockSmsSender (development only)
│   └── clock.ts           injectable clock (tests simulate expiry)
├── realtime/chatGateway.ts  chat WebSocket (/api/v1/chat/ws): handshake auth (Origin, JWT via TokenService, active account, role,
│                          password changed), per-message re-check + zod + rate limit, ack after persistence, push, expiry (4001), heartbeat
├── config/chat.ts         chat limits, WS path, close codes
├── middleware/            cors, csrf, auth (authenticate / requireRole / requirePasswordChanged), rateLimit, upload (multer), errorHandler, notFound, requestLogger
├── validation/schemas.ts  zod schemas for every request body, params and query
├── scripts/               createAdmin.ts (`npm run admin:create`), resetPassword.ts + accountPasswordReset.ts
│                          (`npm run account:reset-password`), prompt.ts (shared hidden-input prompter)
├── types/                 api.ts (response types), express.d.ts (req.auth)
├── utils/                 apiResponse, httpError, validation (parseInput), authCookies, crypto, phone
└── generated/prisma/      generated Prisma client (NOT in Git; recreated by `prisma generate`)
prisma/
├── schema.prisma          User, OtpCode, RefreshToken, Report, ReportImage, AiDetection, ReportStatusHistory
└── migrations/            committed SQL migrations
tests/
├── *.test.ts              node:test test files (auth, admin, reports, reportUnits, aiClient, cors, env, errorHandling, health,
│                          reportWorkflow, adminReports, assignments, engineerJobs, passwordReset, chat, analytics)
├── helpers/               chatSocket (ws test client), workflowFixtures, startTestServer (optional onServer hook), testDb (isolated test schema), authTestApp (fake SMS, fake AI, temp upload dir, test clock, chat gateway,
│                          cookie/CSRF/multipart client), fakeAi, testImages (JPEG/PNG, hand-built EXIF GPS)
└── tsconfig.json          type-checks tests together with src/
```
- Request flow: **route → controller → service → Prisma**. Routes and controllers contain no business logic.
- Dependencies (such as the database check or, later, services) are passed into `createApp()` rather than imported as globals, so tests never need a real database.
- New application features add a router under `src/routes/v1/` (plus controller and service), mounted in `src/routes/v1/index.ts`.
- Every request body, params object and query string is validated with a zod schema (`parseInput`); unknown fields are rejected. Responses that contain users must use `publicUserSelect`.

### Frontend layout (`frontend/`, current)
```text
src/
├── main.tsx                     BrowserRouter + AuthProvider + routes
├── lib/api.ts                   the ONLY HTTP client: cookies (credentials: include), CSRF header, one silent refresh + retry on 401,
│                                multipart uploads (postForm) and protected image downloads (apiBlob)
├── lib/types.ts                 User / role / status types (mirror the backend's public user)
├── features/auth/               AuthContext (who is logged in), authApi/profileApi, Login, Register, VerifyOtp,
│                                ChangePasswordPage (forced for temporary passwords), ChangePasswordForm
├── features/admin/              engineersApi, EngineersPage (+ open jobs), EngineerDetailPage (+ workload, jobs), CreateEngineerForm,
│                                adminReportsApi, AdminDashboardPage, AdminReportsPage (filters in the URL), AdminReportTable,
│                                AdminReportDetailPage (action panel from server-side allowedActions), AssignEngineerDialog,
│                                analyticsApi, AdminAnalyticsPage (Recharts; period/granularity in the URL)
├── features/engineer/           engineerJobsApi, EngineerDashboardPage, EngineerJobList, EngineerJobDetailPage (attempt N,
│                                photos per attempt, notes, reopen), EngineerHistoryPage
├── features/chat/               chatApi (contacts, conversations, history), ChatPage (contact list + thread, pending/failed/retry, plain-text bubbles)
├── lib/chatSocket.ts            the ONLY WebSocket client (reconnect/backoff, idempotent resend, session check); lib/chatTypes.ts
├── features/citizen/            reportsApi, CitizenDashboardPage (summary + list), NewReportPage, LiveCameraCapture
│                                (getUserMedia + geolocation), GalleryPicker, ReportDetailPage (decision reason, repair progress)
├── components/reports/          shared: ReportPhoto, LocationMap (+ EXIF comparison point), SeverityNote, labels,
│                                StatusTimeline, RepairAttempts, PhotoUploader
├── components/                  ui.tsx, Pagination, Dialog (+ ReasonDialog)
├── lib/reportTypes.ts           report/admin/engineer view types (mirror the backend)
├── lib/map.ts                   Leaflet CSS, marker icons, OSM tile URL/attribution
├── pages/                       ProfilePage (citizen/engineer/admin own profile), NotFoundPage
├── layouts/                     AuthLayout (login/register cards), AppLayout (role-aware navigation, logout)
├── routes/                      AppRoutes, guards (RequireAuth, RequireRole, PublicOnly, HomeRedirect)
├── components/ui.tsx            Button, TextField, Alert, Card, Badge, Spinner
├── utils/format.ts              labels and date formatting
└── styles/index.css             Tailwind entry
```
- Routes: `/login`, `/register`, `/verify` (logged-out only); `/profile` (all roles); `/reports`, `/reports/new`, `/reports/:id` (CITIZEN only); `/admin`, `/admin/analytics`, `/admin/reports`, `/admin/reports/:id`, `/admin/engineers`, `/admin/engineers/:id` (ADMIN only); `/engineer`, `/engineer/jobs/:id`, `/engineer/history` (ENGINEER only); `/chat?with=<userId>` (ADMIN and ENGINEER); `/change-password` (forced while `mustChangePassword`); `/` redirects by role (admin → `/admin`, citizen → `/reports`, engineer → `/engineer`).
- Report photos are fetched through `apiBlob` (session cookie) and shown from object URLs; there are no public image URLs.
- Maps (`lib/map.ts`): tiles from `https://tile.openstreetmap.org/{z}/{x}/{y}.png` with `referrerPolicy: strict-origin-when-cross-origin` (OSM requires a Referer; Helmet's default `no-referrer` page policy would otherwise block tiles if the frontend is ever served with it). `L.Icon.Default.imagePath = ""` is required: Leaflet otherwise prepends a folder detected from leaflet.css to the bundler's marker URLs and the marker 404s. `LocationMap` re-measures itself when its container resizes and shows a message if no tile can be loaded.
- Live camera location (`LiveCameraCapture`): a fresh `watchPosition` (`enableHighAccuracy: true`, `maximumAge: 0`) starts when the step opens; the citizen sees the live coordinates and reported accuracy; the photo uses the most precise reading the device reported in the last 30 s (an unmodified real reading). Accuracy worse than 100 m shows a warning (UI hint only; the backend's `GPS_ACCURACY_THRESHOLD_METERS` decides and flags the report). Permission denied / unavailable / timeout show explanations and a "Try location again" button. `enableHighAccuracy` does not guarantee GPS: laptops/desktops often only have Wi-Fi/IP positioning (hundreds of metres or more).
- `public/favicon.svg` is the site icon.
- Tokens are **never** stored in `localStorage`/`sessionStorage`; the CSRF token is kept in memory only.
- In development the Vite dev server proxies `/api` to the backend (`API_PROXY_TARGET`, default `http://localhost:3000`), including the chat WebSocket (`ws: true`), so the browser sees one origin and the session cookie reaches the WebSocket handshake.

### Separation of responsibilities
- **Frontend:** presentation, user input, client-side validation for user experience, camera/GPS capture, map display. It **never** makes security decisions; the UI hiding something is not access control.
- **Frontend communication (confirmed rule):** the React frontend communicates **only** with the Node.js + Express main backend. It does **not** communicate directly with the Python + FastAPI AI service or with PostgreSQL. The main backend is responsible for communicating with the AI service and for accessing PostgreSQL through Prisma.
- **Main backend (Node.js + Express + Prisma):** the main application backend. Authentication, authorisation, all business rules, report workflow and statuses, EXIF parsing and location verification, assignment calculation, admin–engineer chat (WebSockets), SMS sending, file uploads, and all database access through Prisma. It calls the AI service to analyse images.
- **AI service (Python + FastAPI):** AI inference only. It loads the existing YOLOv8 `best.pt` **once** at startup, accepts an image, and returns detections (class, confidence, bounding box). It does not handle users, authentication, report workflow or the database.
- **Database (PostgreSQL):** accessed only by the main backend, through Prisma.
- **Severity is computed by the main backend** (decided 2026-11-14). The AI service only returns detections.
- **Main backend → AI service (decided 2026-11-14):** HTTP to the internal `AI_SERVICE_URL`, multipart field `image`, shared secret in the `X-AI-Service-Key` header (`AI_SERVICE_SECRET` in `backend/api/.env` = `AI_SHARED_SECRET` in `backend/ai/.env`). The URL and the secret are never sent to the frontend. Every AI response is validated with zod (shape, class names match the model's class list, boxes inside the image, image size matches the copy that was sent); timeouts, connection errors, 4xx/5xx and malformed responses become `aiStatus = FAILED`.
- In the main backend, **routes** call **services**; services call the database (through Prisma) and the AI service. Routes contain no business logic.

---

## 6. AI model integration

- AI inference runs in the separate **Python + FastAPI AI service**.
- Use the **existing trained `best.pt`** (YOLOv8, trained on RDD2022). **Do not train or retrain.**
- Location: `backend/ai/weights/best.pt` (present locally, **never** in Git; SHA-256 `676c82da…4b084162f`). Configurable with `AI_MODEL_PATH`.
- **Model facts (read from the file with Ultralytics, 2026-11-14):** task `detect`, YOLOv8s (fine-tuned from `yolov8s.pt`), 11,137,148 parameters, strides 8/16/32, 4 classes `{0: longitudinal_crack, 1: transverse_crack, 2: alligator_crack, 3: pothole}`, trained at `imgsz=640` for 50 epochs (saved by Ultralytics 8.4.207). Training metrics stored in the checkpoint have not been reviewed and must not be quoted as an evaluation.
- **Thresholds:** confidence **0.25** and IoU **0.7** (Ultralytics defaults), configurable with `AI_CONFIDENCE_THRESHOLD` / `AI_IOU_THRESHOLD`. Do not change the default based on single images. Inference runs on **CPU** (`AI_DEVICE=cpu`).
- If the weights file is missing, the AI service must fail with a clear error message rather than produce fake predictions.
- Load the model once (at AI service startup), not once per request.
- Inference output for each detection: class name, confidence, bounding box. The main backend stores the raw detections with the report.
- Read class names **from the model file itself**. Do not hard-code assumed class lists.
- Run inference so that it does not block the async event loop (for example in a thread pool).

### Severity estimation (initial, heuristic) — implemented in the main backend
- Formula (agreed 2026-11-14), in `backend/api/src/services/severity.ts` with all constants in `SEVERITY_CONFIG` (`src/config/reports.ts`):
  `score = Σ over detections of areaFraction × confidence × classWeight`
  - class weights: `pothole 1.0`, `alligator_crack 0.8`, `longitudinal_crack 0.5`, `transverse_crack 0.5`; a class not in the table gets `1.0` (unknown damage is never down-weighted)
  - `score ≥ 0.15 → HIGH`, `score ≥ 0.05 → MEDIUM`, `score > 0 → LOW`; **no detections → no severity** (null, shown as "no damage detected automatically")
  - `areaFraction` = box area / display-image area. Example: the real pothole test (4.4 % of the image, confidence 0.69) scores ≈ 0.03 → LOW.
- Stored as `reports.ai_severity` + `ai_severity_score`. `admin_severity`, `admin_severity_by_id`, `admin_severity_at` exist for the admin phase and are never overwritten by the AI value.
- **This is a heuristic estimate, not a validated engineering measurement.** UI text and documentation must say "estimated severity" and must not claim engineering accuracy.
- Admins can override severity. Store `ai_severity`, `admin_severity` and who changed it and when.
- The exact formula and thresholds must be agreed with the owner.

### Honesty
- **Never invent** accuracy, mAP, precision/recall, dataset split sizes, or other evaluation numbers. Evaluation is planned for a later stage.

---

## 7. Database, authentication and API

### 7.1 Database (PostgreSQL + Prisma)
- **PostgreSQL** is the database. The main backend accesses it **only through Prisma**. The AI service does not access the database.
- The database structure is defined in the Prisma schema, and schema changes go through Prisma. The migration workflow is to be agreed (§14).
- Likely tables (to be confirmed): `users`, `reports`, `assignments`, `messages`, `notifications`, `otp_codes`.
- **Current state (Phase 2):** three tables, created by migration `20261113000000_auth_users_otp_refresh_tokens` (applied to `public` with `prisma migrate deploy`):
  - `users`: `id` (uuid), `full_name`, `mobile_number` (**unique**, E.164), `password_hash` (Argon2id), `role` (`UserRole`), `status` (`AccountStatus`), `mobile_verified_at`, `must_change_password`, `created_by_id` (→ users, SET NULL), `created_at`, `updated_at`. Indexes on (`role`, `status`) and `created_at`.
  - `otp_codes`: `user_id` (→ users, CASCADE), `purpose`, `code_hash` (HMAC, never the code), `expires_at`, `attempts`, `consumed_at`, `created_at`. Index on (`user_id`, `purpose`, `created_at`).
  - `refresh_tokens`: `user_id` (→ users, CASCADE), `token_hash` (**unique**, SHA-256), `family_id`, `expires_at`, `revoked_at`, `replaced_by_id` (→ refresh_tokens, unique), `created_at`. Indexes on `user_id`, `family_id`, `expires_at`.
  - Timestamps are `timestamptz(3)`; table/column names are snake_case (`@@map`/`@map`).
- **Phase 5** migration `20261115120000_phase5_chat` (owner reviewed the final SQL; additive only — 2 new tables, 4 indexes, 4 foreign keys, no change to existing tables; applied to `public` and `app_test` with `migrate deploy` on 2026-11-15, no drift afterwards):
  - `conversations`: `id`, `admin_id`, `engineer_id` (→ users, RESTRICT), `last_message_at`, `created_at`; **unique (`admin_id`, `engineer_id`)** = one conversation per pair; index on `engineer_id`. Roles are enforced in the service (the database cannot express them).
  - `chat_messages`: `id`, `conversation_id` (→ conversations, CASCADE), `sender_id` (→ users, RESTRICT), `client_id` (uuid), `body` VARCHAR(2000), `created_at`; **unique (`sender_id`, `client_id`)** for idempotent sends; index (`conversation_id`, `created_at`, `id`) for history paging. Messages are never edited or deleted.
- Analytics needed **no** schema change.
- **Stage 4** migration `20261114180000_stage4_assignments_repairs` (owner reviewed the full SQL; additive only: enums `RepairStatus` (PENDING, WORKING, COMPLETED) and `RepairUpdateKind` (STATUS_CHANGE, NOTE, ADMIN_FEEDBACK); nullable `reports.assigned_engineer_id` (→ users, SET NULL), `assigned_at`, `repair_status`, `repair_status_updated_at`, `repair_attempt`; tables `report_assignments`, `repair_updates`, `repair_photos` (each with an `attempt` column; users RESTRICT so history cannot be lost; reports CASCADE); indexes; applied to `public` and `app_test` with `migrate deploy`).
- **Phase 3** migration `20261114120000_citizen_reports` (additive only: 5 enum types, 4 tables, indexes, foreign keys; applied to `public` with `migrate deploy`):
  - Enums: `ReportStatus` (SUBMITTED, UNDER_REVIEW, ACCEPTED, REJECTED, DELAYED, COMPLETED), `CaptureMethod` (LIVE_CAMERA, GALLERY_UPLOAD), `LocationVerificationStatus` (VERIFIED, MISMATCH, NO_METADATA, NOT_CHECKED, BROWSER_GPS), `AiAnalysisStatus` (COMPLETED, FAILED), `SeverityLevel` (LOW, MEDIUM, HIGH).
  - `reports`: citizen (→ users, RESTRICT), status, capture method, description, `latitude`/`longitude` (DOUBLE PRECISION), `gps_accuracy_m`, `location_status`, `location_needs_review`, `exif_latitude`/`exif_longitude`/`exif_distance_m`, `ai_status`, `ai_error_code`, `ai_model`, `ai_analyzed_at`, `ai_severity`, `ai_severity_score`, `admin_severity`, `admin_severity_by_id` (→ users, SET NULL), `admin_severity_at`, timestamps. Indexes: (citizen_id, created_at), (status, created_at), ai_severity, created_at, (latitude, longitude).
  - `report_images`: report (CASCADE), `original_key` / `display_key` (unique, random storage keys — never file contents), `mime_type`, `size_bytes`, `width`/`height` (display copy), `sha256` (original).
  - `ai_detections`: report + image (CASCADE), `class_id`, `class_name`, `confidence`, `x1,y1,x2,y2` (display-image pixels), `area_fraction`. Indexes on report, image, class name.
  - `report_status_history`: report (CASCADE), `from_status`, `to_status`, `changed_by_id` (→ users, SET NULL), `note`, `created_at` (audit trail).
- **Location storage (decided 2026-11-14):** plain latitude/longitude columns, no PostGIS; distances use haversine in code.
- **Test schemas:** automated tests use a separate schema `app_test` (override with `TEST_DATABASE_SCHEMA`, must end with `_test`) in the same database; migrations are deployed there and its tables are truncated between tests. Tests never touch `public`.
- Local database: PostgreSQL 18 on `localhost:5432`, database `road_damage_db`, dedicated user `road_damage_user` (already created; credentials only in the local `.env`).

#### Prisma 7 setup (current)
- The database URL is **not** in `schema.prisma`. The Prisma CLI reads it from `backend/api/prisma.config.ts`, which loads `backend/api/.env` (Prisma 7 does not load `.env` automatically).
- The client is generated by the `prisma-client` generator (ES modules) into `src/generated/prisma/` and imported from `src/generated/prisma/client.js`.
- The app connects through the `PrismaPg` driver adapter, which owns the connection pool (5 s connection timeout). The `?schema=` URL parameter is read in `src/db/prisma.ts` and passed to the adapter, because the adapter does not read it from the URL.
- Create **one** `PrismaClient` per process (in `src/index.ts`) and inject it; it is disconnected on shutdown.
- **Raw SQL does not follow the configured schema.** The `PrismaPg` `schema` option only qualifies the queries Prisma generates; `$queryRaw`/`$executeRaw` use PostgreSQL's default `search_path` (so in tests they would hit `public`, not `app_test`). Prefer the query API (analytics uses `groupBy`/`findMany` only); any raw SQL must schema-qualify table names.
- **A `create`/`update` whose `select` loads relations** runs in an implicit transaction and triggers the same pg deprecation as below. Create with a plain select, then read the view separately (done in `chat.service.ts` `openConversation`, found 2026-11-15).
- **Do not use the array form `prisma.$transaction([...])` for read queries that load relations** (e.g. a page + count). Inside such a batch, Prisma 7's query engine loads relations in parallel on the transaction's single pg connection, which pg 8.23 reports as a deprecation ("Calling client.query() when the client is already executing a query") and pg 9 will reject. Use `Promise.all([...])` instead (READ COMMITTED gives no snapshot across statements anyway). Interactive transactions for writes are unaffected. Check with `NODE_OPTIONS=--throw-deprecation npm test` (found and fixed 2026-11-15 in the admin list, engineer job list/summary and citizen list).

#### Database migration policy
- **No schema change or migration without the owner's explicit approval.** Propose the model changes first.
- Schema changes are made only in `schema.prisma` and applied only through Prisma migrations (exact workflow, e.g. `migrate dev` locally vs `migrate deploy` elsewhere, is still to be agreed — §14). Never change tables by hand.
- **Never** run destructive commands against the project database without explicit approval: `prisma migrate reset`, `prisma db push --force-reset`, dropping/recreating the database, or changing the database user or password.
- After any schema change, run `npm run prisma:generate` so the generated client matches.
- Migrations that are approved and created must be committed to Git (`prisma/migrations/`).
- **How migrations are created (current workflow):** `road_damage_user` can create schemas but **cannot create databases**, so `prisma migrate dev` (which needs a shadow database) does not work. Instead:
  1. Change `schema.prisma`.
  2. Generate SQL against the live schema: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql` (for the very first migration `--from-empty` was used).
  3. **Review the SQL** for anything destructive (`DROP`, `ALTER … TYPE`, data loss) and get approval.
  4. Apply with `npm run prisma:migrate:deploy` (non-destructive, no shadow database); check with `npm run prisma:migrate:status`.

Expectations:
- Store image **file paths/keys** in the database, not image binaries.
- How locations are stored (for example plain latitude/longitude columns or the PostGIS extension) is an **open decision** (§14). The choice should support nearby and duplicate-report queries.
- Add indexes for common filters (status, severity, created date, assigned engineer).
- Use timezone-aware UTC timestamps (`created_at`, `updated_at`).
- Keep an audit trail of status changes (who, what, when).
- The database connection string comes from environment variables, never from code.

### 7.2 Authentication (JWT) — implemented in Phase 2
- **Passwords:** Argon2id (`@node-rs/argon2` defaults: m=19456 KiB, t=2, p=1), 8–128 characters. Never stored, logged or returned in plain text. Login runs a dummy hash for unknown accounts so timing does not reveal which numbers exist; wrong number and wrong password give the same 401 `INVALID_CREDENTIALS`.
- **Login identifier:** mobile number + password (confirmed and implemented). Email login is **not** implemented (undecided).
- **Secrets:** one `AUTH_SECRET` (≥ 32 chars); separate keys for JWT signing, OTP hashing and CSRF tokens are derived from it with HKDF-SHA256.
- **Sessions use httpOnly cookies only** (never `localStorage`):

  | Cookie | Content | Lifetime | Path |
  |---|---|---|---|
  | `access_token` | JWT (HS256, `sub` = user id, `role`, issuer `road-damage-api`, audience `road-damage-web`) | **15 min** | `/api` |
  | `refresh_token` | random 256-bit token; only its SHA-256 is stored in `refresh_tokens` | **7 days** | `/api/v1/auth` |
  | `csrf_token` | signed CSRF token (see below) | session | `/` |

  All are `HttpOnly`, `SameSite=Lax` by default (`COOKIE_SAMESITE`), and `Secure` when `NODE_ENV=production`.
- **Every authenticated request re-checks the account** in the database (`authenticate` middleware): a deactivated or deleted account is rejected immediately, even with an unexpired access token.
- **Refresh-token rotation:** `POST /auth/refresh` consumes the refresh token (single use, atomic) and issues a new pair in the same *family*. Presenting an already-used or revoked token is treated as theft: the **whole family is revoked** (that login session ends on every device that shares it). The frontend serialises refresh calls within a tab **and across tabs** (Web Locks API, lock `road-damage-session-refresh`): all tabs share the cookies, so two tabs refreshing at once would otherwise send the same token and log the user out everywhere. A tab that had to wait for the lock first checks `GET /auth/me` and skips its own refresh if another tab already renewed the session.
- **Expected 401s:** a logged-out visitor's page load makes one `GET /auth/me` (401) and one `POST /auth/refresh` (401) before the redirect to `/login`; an expired access token gives one 401 followed by a successful refresh and retry. Browsers log these 401s in the console; they are not errors in the app.
- **Logout** revokes the refresh-token family and clears the cookies. An access token copied before logout stays valid until it expires (≤ 15 min) — standard JWT trade-off.
- **Password change** requires the current password, revokes **all** the user's sessions and issues a fresh session to the current device.
- **Temporary passwords:** engineers (created by an admin) have `must_change_password = true`. Until they change it they can only view their profile, change the password, refresh and log out; other routes return 403 `PASSWORD_CHANGE_REQUIRED` and the frontend forces `/change-password`.
- **CSRF protection** (signed double-submit token): the frontend calls `GET /api/v1/auth/csrf`, which sets the `csrf_token` cookie and returns the same token in the body (kept in memory). Every `POST/PUT/PATCH/DELETE` under `/api/v1` — including login and registration — must send it in `X-CSRF-Token`; the header must equal the cookie and carry a valid HMAC signature, otherwise 403 `CSRF_TOKEN_INVALID`. The CORS allow-list (403 for foreign origins) and SameSite cookies are additional layers.
- **Role checks:** `requireRole(...)` middleware; admin routes use `authenticate → requireRole("ADMIN") → requirePasswordChanged`.
- **Admin bootstrap:** `npm run admin:create` (first admin) / `npm run admin:create -- --additional` (more admins). It prompts for name, mobile number and password (hidden on a terminal; piped input also works), never prints the password, and uses a PostgreSQL advisory lock so concurrent runs cannot create two "first" admins. There is no HTTP endpoint for creating admins.
- **CLI password reset** (`npm run account:reset-password`, `src/scripts/resetPassword.ts` → `accountPasswordReset.ts` → `services/passwordReset.service.ts`): for operators with database access, not an app feature. Uses the normal password rule (`newPasswordSchema`) and `hashPassword()`; in one transaction it updates only `users.password_hash` and revokes all of that account's refresh tokens (access tokens already issued remain valid ≤ 15 min, as with logout). Role, status, verification, `must_change_password` and all data are unchanged; a PENDING_VERIFICATION citizen still has to verify the mobile number, and a DEACTIVATED account stays deactivated. Never prints passwords or hashes. Tested in `tests/passwordReset.test.ts`.
- **Rate limits** (per IP, in memory, disabled in tests): login 10 / 15 min, registration 10 / hour, OTP verify+resend 20 / 15 min → 429 `TOO_MANY_REQUESTS`. OTP also has per-account limits (§3.1).

### 7.3 REST API expectations
- **Route convention (confirmed):**
  - **All application routes** — authentication, users, reports, assignments, chat history, notifications and other business functionality — are under **`/api/v1`** (for example `/api/v1/reports`). They are added in `src/routes/v1/`.
  - **Operational endpoints** stay unversioned under `/api`: currently only the health endpoints (§7.5).
  - A future breaking change gets a new version prefix (`/api/v2`) instead of changing `/api/v1` behaviour.
- **Response format (implemented):** every JSON response uses one of two shapes (types in `src/types/api.ts`, helpers in `src/utils/apiResponse.ts`):
  - Success: `{ "success": true, "data": ... }`
  - Error: `{ "success": false, "error": { "code": "SOME_CODE", "message": "Safe, human-readable message" } }`
- **Errors (implemented):** throw `HttpError(status, code, message, { cause })` from handlers; the central error handler formats it. Unknown routes return 404 `NOT_FOUND`; invalid JSON 400 `INVALID_JSON`; JSON bodies over 100 KB 413 `PAYLOAD_TOO_LARGE`; anything unexpected 500 `INTERNAL_ERROR` with a generic message. Internal details and causes are logged on the server only. A `stack` field is included **only** for unexpected 5xx errors and **only** when `NODE_ENV=development`.
- **Implemented endpoints (Phase 2)** — all under `/api/v1`, all state-changing ones need `X-CSRF-Token`:

  | Method & path | Access | Purpose |
  |---|---|---|
  | `GET /auth/csrf` | public | issue CSRF token (cookie + body) |
  | `POST /auth/register` | public | citizen registration (`fullName`, `mobileNumber`, `password`, `confirmPassword`) → 201, OTP sent |
  | `POST /auth/otp/verify` | public | verify mobile (`mobileNumber`, `code`) |
  | `POST /auth/otp/resend` | public | new OTP (generic response if no pending account) |
  | `POST /auth/login` | public | sets session cookies, returns `{ user }` |
  | `POST /auth/refresh` | refresh cookie | rotates tokens, returns `{ user }` |
  | `POST /auth/logout` | any | revokes the session, clears cookies |
  | `GET /auth/me` | logged in | current user |
  | `GET /profile` / `PATCH /profile` | logged in (PATCH needs changed password) | own profile / update `fullName` |
  | `POST /profile/password` | logged in | change password (`currentPassword`, `newPassword`, `confirmNewPassword`) |
  | `GET /admin/engineers?page&pageSize&search&status` | ADMIN | list engineers (paginated) |
  | `POST /admin/engineers` | ADMIN | create engineer (`fullName`, `mobileNumber`, `temporaryPassword`) |
  | `GET /admin/engineers/:id` / `PATCH /admin/engineers/:id` | ADMIN | view / update (`fullName`, `mobileNumber`) |
  | `PATCH /admin/engineers/:id/status` | ADMIN | `{ status: "ACTIVE" \| "DEACTIVATED" }`; deactivation revokes sessions |
  | `POST /reports` | CITIZEN | multipart: `image` (one file), `captureMethod`, `latitude`, `longitude`, `gpsAccuracyMeters` (required for LIVE_CAMERA, not allowed for GALLERY_UPLOAD), `description?` → 201 `{ report }` |
  | `GET /reports?page&pageSize&status&sort` | CITIZEN | own reports only (pageSize ≤ 50, sort `newest`/`oldest`) |
  | `GET /reports/summary` | CITIZEN | `{ summary: { total, byStatus } }` |
  | `GET /reports/:id` | CITIZEN | own report (another citizen's report → 404) |
  | `GET /reports/:id/images/:imageId` | CITIZEN (own), ADMIN (any), ENGINEER (assigned jobs) | metadata-free display JPEG, `Cache-Control: private, no-store` |
  | `GET /reports/:id/repair-photos/:photoId` | ADMIN (any), ENGINEER (current job) | repair evidence photo |
  | `GET /admin/dashboard` | ADMIN | counts by status / effective severity, work queues, recent reports |
  | `GET /admin/reports?page&pageSize&sort&search&status&severity&from&to&captureMethod&locationStatus&needsLocationReview&aiStatus&damageClass&assignment&engineerId&repairStatus` | ADMIN | all reports (pageSize ≤ 50); `engineerId` lists an engineer's jobs |
  | `GET /admin/reports/:id` | ADMIN | full detail incl. citizen, EXIF point, status/assignment history, repair attempts, `allowedActions`; read-only |
  | `POST /admin/reports/:id/review` | ADMIN | SUBMITTED → UNDER_REVIEW |
  | `POST /admin/reports/:id/decision` | ADMIN | `{ decision: ACCEPT\|REJECT\|DELAY, reason? }` from UNDER_REVIEW or DELAYED; reason required for REJECT/DELAY (also keep delayed) |
  | `PATCH /admin/reports/:id/severity` | ADMIN | `{ severity }` (AI value kept) |
  | `GET /admin/reports/:id/engineer-suggestions` | ADMIN | ranked engineers with open-job counts |
  | `POST /admin/reports/:id/assignment` | ADMIN | `{ engineerId, reason? }` assign / reassign (new attempt) |
  | `POST /admin/reports/:id/feedback` | ADMIN | `{ note, expectedAttempt }` only when ACCEPTED + repair COMPLETED |
  | `POST /admin/reports/:id/confirm-completion` | ADMIN | `{ expectedAttempt, note? }` → COMPLETED |
  | `GET /engineer/summary`, `GET /engineer/jobs?scope=active\|history` | ENGINEER | own jobs only |
  | `GET /engineer/jobs/:reportId` | ENGINEER | own job (no citizen identity, no EXIF) |
  | `PATCH /engineer/jobs/:reportId/repair-status` | ENGINEER | `{ status: WORKING\|COMPLETED, expectedAttempt, note? }` |
  | `POST /engineer/jobs/:reportId/notes` | ENGINEER | `{ note, expectedAttempt }` |
  | `POST /engineer/jobs/:reportId/photos` | ENGINEER | multipart `image` + `expectedAttempt`; 30/hour per engineer |
  | `GET /admin/analytics?from&to&granularity` | ADMIN | analytics (see §7.3 Analytics); `from`/`to` = YYYY-MM-DD UTC, inclusive; `granularity` day\|week\|month (default by span); ≤ 1000 periods |
  | `GET /chat/contacts` | ADMIN, ENGINEER | active counterparts only: `{ id, fullName, role, status }` |
  | `GET /chat/conversations` | ADMIN, ENGINEER | own conversations, newest activity first, with contact and last message |
  | `POST /chat/conversations` | ADMIN, ENGINEER | `{ userId }` → get or create the pair's conversation (active counterpart only, else 404 `CHAT_CONTACT_NOT_FOUND`) |
  | `GET /chat/conversations/:id/messages?after\|before&limit` | ADMIN, ENGINEER (members only) | history oldest first, `{ messages, hasMore }`; `after` = catch-up after reconnect, `before` = older page; limit ≤ 100 (default 50); non-member → 404 |
  | `GET /chat/ws` (WebSocket upgrade) | ADMIN, ENGINEER | see §7.4 |

  Citizen report responses never contain storage keys, EXIF coordinates, SHA-256 hashes or admin fields.

  Main error codes: `VALIDATION_ERROR` (400, `details.fields` per field), `INVALID_CREDENTIALS`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `SESSION_INVALID` (401), `FORBIDDEN`, `ACCOUNT_NOT_VERIFIED`, `ACCOUNT_DEACTIVATED`, `PASSWORD_CHANGE_REQUIRED`, `CSRF_TOKEN_INVALID`, `CORS_ORIGIN_NOT_ALLOWED` (403), `ENGINEER_NOT_FOUND` (404), `MOBILE_ALREADY_REGISTERED` (409), `OTP_INVALID`, `OTP_EXPIRED`, `OTP_ATTEMPTS_EXCEEDED` (400), `OTP_RESEND_TOO_SOON`, `OTP_RESEND_LIMIT`, `TOO_MANY_REQUESTS` (429, with `details.retryAfterSeconds` for OTP), `SMS_UNAVAILABLE` (503).
  Stage 4 adds: `REPORT_STATE_CONFLICT`, `INVALID_TRANSITION`, `REPAIR_PHOTO_REQUIRED`, `REPAIR_PHOTO_LIMIT` (409), `ENGINEER_NOT_ASSIGNABLE` (400), `JOB_NOT_FOUND`, `REPAIR_PHOTO_NOT_FOUND` (404). Admin action responses include `notification: "sent" | "failed"` when a citizen SMS was due.
  **SMS rules (Stage 4):** sent only after the transaction commits, only by the request whose state-checked update matched (no duplicates from concurrent or retried decisions), only when the status actually changes to ACCEPTED/REJECTED/DELAYED/COMPLETED (no SMS for Review, keep-delayed, severity, assignment, feedback); failures are logged with a masked number and never undo the decision. Known limitation: a crash between commit and send loses that SMS (no outbox).
  Phase 5 adds: `CONVERSATION_NOT_FOUND`, `CHAT_CONTACT_NOT_FOUND` (404), `CHAT_RECIPIENT_INACTIVE`, `CHAT_CLIENT_ID_CONFLICT` (409); WebSocket `error` frames reuse the codes (`VALIDATION_ERROR`, `TOO_MANY_REQUESTS`, `TOKEN_EXPIRED`, `UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `INTERNAL_ERROR`).
  **Analytics (Phase 5):** one response with `range`, `total`, `overTime` (zero-filled periods), `byStatus`, `bySeverity` (effective `admin ?? ai`, plus `NONE`), `damageClasses` (`byClass` = distinct reports per class, `noDetections`, `aiFailed`), `repairProgress` (unassigned/pending/working/awaitingConfirmation/completed from the report's **current** state), `engineerWorkload` (open/awaitingConfirmation/completed per current engineer; every active engineer listed), `location` (per verification status with `needsReview`). Every chart uses the same report-submission date range. Counts are per report, so attempts, reassignments and multiple detections never inflate them.
  Phase 3 adds: `REPORT_NOT_FOUND`, `IMAGE_NOT_FOUND` (404), `IMAGE_REQUIRED`, `IMAGE_INVALID`, `UNEXPECTED_FIELD`, `INVALID_MULTIPART`, `MULTIPART_REQUIRED` (400), `FILE_TOO_LARGE`, `IMAGE_DIMENSIONS_TOO_LARGE` (413), `UNSUPPORTED_IMAGE_TYPE` (415).
- Use JSON. Validate every request in the main backend with **zod** (`src/validation/schemas.ts`, adopted in Phase 2). Never return internal fields such as password hashes, OTP hashes or refresh-token hashes.
- Use correct HTTP status codes and a consistent error format.
- List endpoints support **pagination**, **sorting** and **filters**, including: location/area, severity, damage class, submission date range, report status, AI confidence range, assigned engineer, assignment status, location verification status, repair status, priority, possible duplicates, and unassigned only.
- Uploads use `multipart/form-data`.
- How the main backend's API is documented is to be agreed. The AI service's FastAPI docs cover only its inference endpoint(s).

### 7.4 WebSocket expectations (implemented in Phase 5: `src/realtime/chatGateway.ts`)
- **Endpoint** `ws(s)://<api origin>/api/v1/chat/ws` (under `/api` because the `access_token` cookie is scoped to `/api`).
- **Handshake** (before the upgrade; failures get a JSON HTTP error, no socket): Origin must be in the CORS allow-list (missing Origin is refused too — protects against cross-site WebSocket hijacking); `access_token` cookie verified by `TokenService.verifyAccessToken` (jose `jwtVerify`: signature, issuer, audience, HS256, expiry; it also returns the verified `expiresAt`); account ACTIVE (`findActiveById`), role ADMIN/ENGINEER, temporary password changed.
- **Every message:** session expiry checked (4001), account re-checked in the database (deactivation stops it at once: error + all of the user's sockets closed with 4003), zod-validated frame (strict), rate limit, conversation membership in the service.
- The socket is closed with 4001 when the access token expires (timer); a heartbeat ping (30 s) terminates dead connections. Connections are tracked in memory (single process).
- Known limitation: like the REST API, a socket opened before logout or a password change stays usable until its access token expires (≤ 15 min).
- The WebSocket server runs in the **main backend** (Node.js + Express).
- Used for admin–engineer chat. In-app notifications for admins and engineers are **not** a confirmed requirement.
- Authenticate the WebSocket connection with a JWT. Reject unauthenticated connections.
- On the server, check that the sender is allowed to message the recipient.
- Persist messages in PostgreSQL before acknowledging them.
- Handle reconnects. The client re-fetches missed messages over REST.
- Note: a single-process, in-memory connection manager is fine for the FYP. Scaling to several workers would need something like Redis pub/sub, which must be discussed first.

### 7.5 Health endpoints (implemented)
| Endpoint | Purpose | Responses |
|---|---|---|
| `GET /api/health` | The API process is running. Does **not** touch the database. | 200 `{ success: true, data: { status: "ok", timestamp } }` |
| `GET /api/health/db` | PostgreSQL is reachable (runs `SELECT 1` through Prisma). | 200 `{ ..., data: { status: "ok", database: "up", timestamp } }`; 503 `DATABASE_UNAVAILABLE` with no internal details |

These stay unversioned and must keep working without authentication.

### 7.6 CORS (implemented)
- Only origins listed in `CORS_ORIGIN` (comma-separated, exact `scheme://host[:port]`, no paths) may call the API from a browser. The allowed origin is echoed back; `*` is never used or accepted.
- Outside production, if `CORS_ORIGIN` is not set, the default is the Vite dev server `http://localhost:5173`. **In production `CORS_ORIGIN` is required**; the server refuses to start without it.
- A request from a disallowed origin (including a preflight) is rejected with **403 `CORS_ORIGIN_NOT_ALLOWED`** before reaching any route.
- Requests without an `Origin` header (curl, server-to-server) are served without CORS headers. CORS is a browser protection only; authentication will protect the API itself.
- Preflight `OPTIONS` requests are answered with 204; allowed methods `GET, HEAD, POST, PUT, PATCH, DELETE`; allowed request headers `Content-Type, Authorization, X-CSRF-Token`; preflight cache 600 s; `Access-Control-Allow-Credentials: true` (**required**: authentication uses httpOnly cookies, §7.2).
- Implemented in `src/middleware/cors.ts`, registered before the body parser and routes.

### 7.7 Environment variables (main backend)
Configured in `backend/api/.env` (never committed; template in `backend/api/.env.example`). Loaded by `src/config/env.ts` with Node's built-in `process.loadEnvFile()`; variables already set in the environment take precedence. Validated at startup: on any problem the server prints the list of problems (never the values) and exits with code 1.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `production` or `test`. Stack traces in error responses only in `development`. |
| `PORT` | no | `3000` | 1–65535 |
| `DATABASE_URL` | **yes** | — | `postgresql://road_damage_user:PASSWORD@localhost:5432/road_damage_db?schema=public`. Special characters in the password must be URL-encoded. The placeholder `YOUR_PASSWORD` is rejected. |
| `CORS_ORIGIN` | in production | `http://localhost:5173` (non-production only) | Comma-separated allowed origins (§7.6). |
| `AUTH_SECRET` | **yes** | — | ≥ 32 characters, random (`openssl rand -base64 48`). Keys for JWT, OTP hashing and CSRF are derived from it. Changing it logs everyone out and invalidates pending OTPs. Placeholder `CHANGE_ME` is rejected. |
| `SMS_PROVIDER` | yes (except `test`) | — | `mock` = development only (prints codes to the server console, sends nothing). No real provider exists yet, so **production refuses to start** (§9). |
| `PHONE_DEFAULT_COUNTRY` | no | none | ISO code (e.g. `GB`) used when a number is typed without `+country code`. |
| `COOKIE_SAMESITE` | no | `lax` | `lax`, `strict` or `none` (`none` only with `NODE_ENV=production`). |
| `TEST_DATABASE_SCHEMA` | no (tests only) | `app_test` | Schema used by database tests; must end with `_test`. |
| `AI_SERVICE_URL` | yes (except `test`) | — | Internal URL of the AI service, e.g. `http://127.0.0.1:8000`. Never sent to the frontend; only its origin is logged. |
| `AI_SERVICE_SECRET` | yes (except `test`) | — | ≥ 32 chars, must equal `AI_SHARED_SECRET` in `backend/ai/.env`. Placeholder `CHANGE_ME` rejected. Never logged. |
| `AI_REQUEST_TIMEOUT_MS` | no | `30000` | Whole milliseconds. |
| `UPLOAD_DIR` | no | `storage/uploads` | Relative to `backend/api/`. Holds `originals/` and `display/`; never served statically. |
| `EXIF_LOCATION_TOLERANCE_KM` | no | `2` | Gallery uploads: EXIF within this distance → `VERIFIED`. |
| `GPS_ACCURACY_THRESHOLD_METERS` | no | `100` | Live camera: accuracy worse than this → flagged for admin review. |

AI service (`backend/ai/.env`, template `backend/ai/.env.example`, prefix `AI_`): `AI_SHARED_SECRET` (required, ≥ 32 chars), `AI_MODEL_PATH` (`weights/best.pt`), `AI_CONFIDENCE_THRESHOLD` (`0.25`), `AI_IOU_THRESHOLD` (`0.7`), `AI_IMAGE_SIZE` (`640`), `AI_DEVICE` (`cpu`), `AI_MAX_IMAGE_BYTES` (10 MB), `AI_MAX_IMAGE_PIXELS` (8000×8000). Invalid configuration stops the service with field names only (never values).

Frontend (`frontend/.env`, optional): `VITE_API_BASE_URL` (empty in development; set only if the API is on a different origin in production) and `API_PROXY_TARGET` (dev proxy target, default `http://localhost:3000`).

- Never print, log or paste `.env` values (including in chat). Never ask the owner to paste a password.
- Add every new variable to `src/config/env.ts` validation **and** to `.env.example` (with a placeholder).

---

## 8. Photo upload, GPS, EXIF verification and location privacy

### Uploads
- Accept only allowed image types (for example JPEG/PNG; HEIC support to be decided). Check the **actual file content**, not only the extension.
- Enforce a maximum file size.
- Save files with **server-generated random filenames**. Never use the user's filename in the path.
- Uploads are stored in `backend/api/storage/uploads/`, which belongs to the main backend. Uploaded files must never be committed to Git.
- Serve images only through authorised endpoints (citizen: own; admin: all; engineer: assigned jobs). Do not expose the uploads folder publicly.

### GPS (live camera)
- Use the browser Geolocation API with user permission. Record the coordinates and the reported accuracy.
- If the reported accuracy is poor, flag the report for admin review. The status stays `browser_gps`, and the captured coordinates and accuracy are kept. **Never automatically reject** such reports.
- The accuracy threshold for "poor" is configurable: `GPS_ACCURACY_THRESHOLD_METERS`, default **100 m** (agreed 2026-11-14).
- Note: browsers allow camera and geolocation only on **HTTPS or localhost**.

### EXIF verification (gallery uploads only)
- The EXIF comparison runs **only for gallery uploads**.
- Read EXIF GPS on the main backend from the **original** upload, before any image processing removes it.
- Compare EXIF coordinates with the manually selected location using the haversine (great-circle) distance.
- The tolerance is configurable: `EXIF_LOCATION_TOLERANCE_KM`, default **2 km** (agreed 2026-11-14).
- Gallery outcomes: `verified` (distance ≤ tolerance), `mismatch` (distance > tolerance), `no_metadata` (no EXIF GPS in the image), `not_checked` (the location check has not been run yet).
- **Live-camera reports** get no EXIF comparison. Their status is `browser_gps` (location taken from browser GPS). They are never marked `no_metadata` just because browser camera images lack EXIF GPS.
- **Never automatically reject.** `mismatch` and `no_metadata` reports, and live-camera reports with poor GPS accuracy, are flagged for admin review.
- Remember that many apps and browsers strip EXIF data, so missing metadata is common and is not proof of fraud.

### Location privacy
- Photos and coordinates are personal data. Show only what each role needs.
- **Implemented:** the copy shown to users and sent to the AI service has all metadata removed (sharp re-encode); the original with EXIF is stored privately and never served; the extracted EXIF coordinates are stored in the database but never returned to citizens.
- Never log exact coordinates or image contents unnecessarily.
- Never commit real user uploads or location data to Git.

---

## 9. SMS notifications

- **The provider is not selected yet.** Do not pick one without the owner's approval.
- Put SMS behind a **provider-agnostic interface** in the main backend's services layer (for example `send_sms(to, message)`). During development use a console/log implementation that does not send real SMS messages.
- **Implemented (Phase 2):** `SmsSender` interface in `backend/api/src/services/sms/smsSender.ts`; `createSmsSender()` selects the implementation from `SMS_PROVIDER`. The only implementation is `MockSmsSender` (`SMS_PROVIDER=mock`), which **throws if created outside `NODE_ENV=development`**, prints `[MOCK SMS - NOT DELIVERED]` messages (including OTP codes) to the server console, and is announced with a warning at startup. There is **no silent fallback** to the mock. A real provider must implement `SmsSender` and be added to `createSmsSender()` and the `SMS_PROVIDER` validation; until then production cannot start. Tests inject their own fake sender.
- Currently used only for the registration OTP.
- Uses: registration OTP, report status changes (accepted/rejected/delayed), assignment, repair progress and completion.
- Store mobile numbers in a single format (E.164 is suggested).
- Rate-limit OTP and SMS sending to prevent abuse and cost overruns.
- Keep messages short and free of sensitive data (no exact coordinates).
- Provider credentials come only from environment variables.

---

## 10. Coding conventions

### General
- Small, single-purpose modules and functions. Clear, descriptive names.
- No hard-coded configuration or secrets. Use environment variables with a committed `.env.example`.
- Comment *why*, not *what*.

### Main backend (Node.js + Express, TypeScript)
- **Language: TypeScript** (confirmed). Do not write main backend code in plain JavaScript.
- Give explicit types to function parameters and return values, request and response shapes, and service interfaces. Define shared types in one place instead of repeating them.
- Avoid unnecessary `any`. When a value's type is genuinely unknown, use `unknown` and narrow it before use.
- Use Prisma's generated types for database models instead of redefining them by hand.
- **Runtime: Node.js 24 LTS** (confirmed). `package.json` declares `"engines": { "node": ">=24 <25" }`.
- **Compiler settings** (confirmed, in `backend/api/tsconfig.json`): `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noFallthroughCasesInSwitch` are enabled. Do not weaken them.
- **Module system:** native ES modules (`"type": "module"` with `"module": "nodenext"`). Relative imports must use the `.js` extension, for example `import { x } from "./util.js"`.
- **Entry point:** `src/index.ts`, compiled to `dist/index.js`. TypeScript source lives in `src/`; compiled output goes to `dist/` (not in Git).
- **Scripts** (run inside `backend/api/`):

  | Command | What it does |
  |---|---|
  | `npm run dev` | `tsx watch src/index.ts` — runs the API with auto-restart on changes (**no type checking**) |
  | `npm run typecheck` | `tsc --noEmit && tsc -p tests/tsconfig.json` — type-checks `src/` and `tests/` |
  | `npm test` | `node --import tsx --test --test-concurrency=1 "tests/**/*.test.ts"` — runs all tests; database tests use the `app_test` schema and are skipped (clearly reported) if `DATABASE_URL` is not configured |
  | `npm run build` | `prisma generate && tsc` — generates the Prisma client and compiles to `dist/` |
  | `npm start` | `node dist/index.js` — runs the compiled build (production) |
  | `npm run prisma:generate` | regenerates the Prisma client (`src/generated/prisma/`) |
  | `npm run prisma:validate` / `npm run prisma:format` | validates / formats `prisma/schema.prisma` |
  | `npm run prisma:migrate:deploy` / `npm run prisma:migrate:status` | applies committed migrations (non-destructive) / shows migration status |
  | `npm run admin:create` | creates the first admin (add `-- --additional` for more admins); production build: `node dist/scripts/createAdmin.js` |
  | `npm run account:reset-password` | operator tool: resets the password of one existing account of any role (asks for the mobile number, shows name/role/status, asks "yes", then the new password twice, hidden); production build: `node dist/scripts/resetPassword.js` |
  | `postinstall` (automatic) | runs `prisma generate` after `npm install` |

  Before considering work finished, run **`npm run typecheck`, `npm test` and `npm run build`**; `tsx` alone does not check types.
- `camelCase` for functions and variables, `PascalCase` for classes, interfaces and types.
- Keep routes thin; business logic lives in services. All database access goes through Prisma.
- The ESLint/Prettier setup is to be agreed.

### AI service (Python + FastAPI)
- Follow PEP 8. Use type hints. Use Pydantic models for input/output.
- `snake_case` for functions and variables, `PascalCase` for classes.
- Blocking work (inference) runs off the async event loop.
- Formatter/linter choice (for example Black/Ruff) to be agreed.

### Frontend (React)
- **Language: TypeScript** (adopted in Phase 2) with the same strict flags as the backend (`frontend/tsconfig.json`). Node.js 24.
- **Scripts** (inside `frontend/`): `npm run dev` (Vite on http://localhost:5173, proxies `/api`), `npm run typecheck` (`tsc --noEmit`), `npm run build` (typecheck + `vite build` → `frontend/dist/`, not in Git), `npm run preview`.
- Function components and hooks. `PascalCase` component files, `camelCase` hooks starting with `use`.
- Code for a feature lives in `features/<feature>/`. Only code that is truly shared goes in `components/`, `hooks/` and `utils/`.
- Make all API calls through a single configured client in `lib/`.
- Use Tailwind utility classes. Avoid inline styles.
- The ESLint/Prettier setup is to be agreed.

---

## 11. Security requirements

- No secrets in Git. `.env` files are ignored.
- Hash passwords. Use short-lived JWTs. Enforce roles on **every** protected endpoint and WebSocket.
- Validate all input on the server side (main backend and AI service). Never trust frontend checks.
- Use a restrictive CORS policy: list allowed frontend origins explicitly (implemented; see §7.6).
- Security headers are set with Helmet; `X-Powered-By` is disabled. JSON request bodies are limited to 100 KB.
- Validate uploads: type, size, random filename, no path traversal.
- Rate-limit login, OTP and report submission. (Login, registration and OTP limits are implemented, §7.2; report submission is limited to 10/hour per citizen, Phase 3. The limiter is in-memory and per IP: it resets on restart, and behind a reverse proxy Express `trust proxy` must be configured first or all clients share one IP.)
- Authentication cookies are httpOnly, SameSite and Secure in production; state-changing requests need a CSRF token (§7.2).
- Escape user-generated content (chat, notes). Never insert raw HTML.
- Do not include stack traces or internal details in API error responses.
- Use HTTPS in deployment.
- Apply the principle of least privilege to the PostgreSQL database user.
- The AI service is protected by a shared secret header (`X-AI-Service-Key`, constant-time comparison) and binds to `127.0.0.1` by default; only the main backend calls it. In deployment it must not be exposed publicly.
- Uploads: multer runs only after authentication, role check, CSRF and rate limiting; the file type is detected from content; files get random server-generated names under `UPLOAD_DIR` with mode 0600; stored files are deleted if the database write fails.

---

## 12. Testing expectations

- **Main backend:** tests currently use Node's built-in test runner (`node:test` + `node:assert`, run through `tsx`; no extra dependency) and `fetch` against the app started on a random port (`tests/helpers/testServer.ts`). Formal confirmation of the tool is still listed in §14. Unit tests for services (haversine/EXIF verification, assignment workload calculation, auth/role checks, and severity calculation if it lives here) and API tests. Use a separate PostgreSQL test database. Mock the AI service in main backend tests.
- **Current main backend tests** (`backend/api/tests/`):
  - Without a database: health endpoints (200, 503 without leaking details, no database use for `/api/health`), Helmet headers, CORS (allowed/disallowed origins, preflights, exact matching), error handling (404, invalid JSON, payload too large, hidden/visible stack, `HttpError`), environment validation and SMS sender selection.
  - With the `app_test` schema (Phase 2): registration (normalization, hashing, duplicates, validation), OTP (success, reuse, wrong code, attempt limit, expiry, resend cooldown and hourly limit), login (unverified, wrong/unknown credentials, cookie flags, no secrets in responses), sessions (expiry, refresh rotation, reuse detection, logout), CSRF and origin rejection, profile and password change, rate limiting, admin authorization (citizen/engineer forbidden), engineer management (create, temporary password, list/search/filter, detail, update, deactivate/reactivate) and the admin bootstrap (duplicate prevention, concurrency).
  - Phase 3: severity formula, haversine, location verification, magic-byte detection, EXIF GPS reading (hand-built EXIF), metadata stripping, storage key validation; the HTTP AI client against a local fake server (success, secret header, unreachable, timeout, 4xx/5xx, malformed JSON, wrong shapes, oversized); report API tests (roles, CSRF, validation, disguised/corrupt/oversized files, VERIFIED/MISMATCH/NO_METADATA/BROWSER_GPS, detections + severity stored, AI failure → FAILED, size mismatch, private originals, metadata-free display copy, image access per role, no leaked fields, file cleanup, list/summary/pagination/filters, 10/hour rate limit).
  - Fakes: `FakeSms` captures OTP messages; `TestClock` simulates expiry; `FakeAiClient` replaces the AI service; uploads go to a temporary folder.
- **AI service tests** (`backend/ai/tests/`, pytest): service key, response shape, configured thresholds, JPEG/PNG accepted, non-images/other formats/too large/too many pixels rejected, secret validation, clear error for missing weights; `test_real_model.py` loads the real `best.pt` and runs inference on a blank image (skipped when the weights are absent; it checks output format only, **not** accuracy).
- **Stage 4 tests:** `reportWorkflow.test.ts` (all transitions, attempts, SMS rule), `adminReports.test.ts` (authorization matrix, review/decisions, reasons, keep delayed, concurrent/retried decisions with one SMS, SMS failure, severity, filters, dashboard), `assignments.test.ts` (assign/reassign attempts, not assignable, concurrency, suggestions, workload), `engineerJobs.test.ts` (full rework loop with attempt 2, per-attempt photo cap with parallel uploads, feedback rule, reassignment evidence and access, isolation, stale attempts, temporary passwords, no citizen identity/EXIF for engineers, history photo access, simultaneous confirm vs reopen, deactivated engineer + reassignment, repair-photo upload rate limit 30/hour). Backend total: 173 tests.
- **Phase 5 tests:** `chat.test.ts` (handshake: no session, forged token, foreign/missing Origin, citizen, temporary password, expired token, wrong path; REST access by role; contacts; one conversation per pair from either side and concurrently, separate conversations for two admins; wrong-role/inactive/unknown contacts; CSRF; persist-before-ack and push; sender's other tabs; plain-text bodies; clientId idempotency incl. simultaneous duplicates, different body and different conversation; pair isolation for other admins/engineers; invalid and oversized messages, 16 KB frame limit; 30/min rate limit; reconnect catch-up with `after`, `before` paging and query validation; deactivation mid-session; 4001 on expiry), `analytics.test.ts` (UTC buckets, empty database, aggregation with effective severity, distinct damage classes, reassignment/attempt inflation, date filters incl. inclusive end day and weeks, confirmed repair after rework, invalid queries), one added assertion in `adminReports.test.ts` (no SMS for a severity correction). **Backend total: 204 tests, all passing** (2026-11-15, with `NODE_OPTIONS=--throw-deprecation`). AI service: 15 pytest tests passing.
- **Phase 5 scripted browser verification (2026-11-15, headless Windows Chrome over CDP driven by Windows Node from scratch scripts — not committed; real AI service; API on port 3100 against `app_test`; one isolated browser context per user):** 25/25 checks — CLI-created admins, engineers replacing temporary passwords, citizen registration with mock-SMS OTP; gallery report (file + map click) analysed by the real model; Start review → Accept (1 SMS) → assign → engineer start/photo/complete → admin confirm (2nd SMS, per-report) → citizen sees Completed → engineer history; chat between two logged-in browsers (live delivery both ways, Enter and Send, HTML shown as text and not executed, history after refresh, messages missed while away, **API restarted mid-session: both pages reconnected and a message typed during the outage was delivered and stored once**), second admin and second engineer cannot see the conversation (UI empty, API 404), citizens redirected/403; analytics charts render, totals equal the API and an independent database count, each period choice sends the right date range, empty range shows empty states, non-admins redirected; no horizontal scroll at 390 px on chat/analytics/dashboard; no JavaScript errors. The browser run found and fixed two frontend bugs: the chat client stopped for good during a server outage (it treated a network error as "session ended"), and the "All time" analytics period requested only the last 30 days. Limitation of this run: every test photo was a plain image with no detections, so damage-type/severity charts were exercised with real zero data in the browser (their counting is covered by the backend tests).
- **Not verified in a browser yet:** chat on real phones, chat with a deactivated account mid-session (covered by backend tests), analytics with real detections, Phase 5 manual owner testing.
- **Stage 4 browser verification (T12, 2026-11-14, scripted headless Chrome, each role in its own browser context, real AI service, `app_test`):** role home pages; empty and error states; review → accept (SMS) → assign → engineer attempt 1 with photo and note → feedback → reopen as attempt 2 (photo required again) → confirm (SMS) → citizen sees "repaired" and engineer history; severity override + filter; reject with required reason; delay → keep delayed (no SMS, citizen sees the new reason) → accept; reassignment (new attempt, old engineer locked out); no horizontal overflow at 390 px on six key pages. Stage 3 browser regression (sessions, two-tab refresh, maps, GPS cases, logout) also passed.
- **Owner's manual browser test (reported 2026-11-15):** the full workflow passed — citizen report submission; admin review, acceptance and severity override; engineer assignment; engineer start, photos, notes and completion; admin "Needs more work"; engineer reopen and completion of repair attempt 2; admin final confirmation; status history Accepted → Completed with attempt 2 confirmed. Not reported as manually tested: reject, delay/keep delayed, reassignment, phone-width layout, real phone camera/GPS.
- **Manual end-to-end verification (2026-11-14):** real AI service + API (against `app_test`) + the Wikimedia Commons photo `Potholes.jpg`: 1 `pothole` detection at confidence ≈ 0.689, estimated severity LOW; location MISMATCH vs a far location, VERIFIED (≈ 334 m) near the photo's own EXIF position; with the AI service stopped the report was saved as FAILED. Only the pothole class has been exercised.
- **Frontend:** no automated tests yet (tool still undecided). Phase 2 was verified end to end through the Vite dev proxy with HTTP requests (pages served, all auth flows, cookies, roles). Phase 3 citizen pages were checked on 2026-11-14 in headless Chrome (Windows) driven over the DevTools protocol from scratch scripts (not committed): login/redirects, expired-token refresh, simultaneous refresh in two tabs, gallery and detail maps (tiles + markers), live camera with Chrome's fake camera and emulated geolocation (coarse → precise, poor accuracy flagged, unavailable, denied + retry), favicon. Real device GPS accuracy and a real camera still need a manual test on a phone.
- **AI service:** pytest (in use since Phase 3). Mock the model in unit tests so they don't need `best.pt`. If inference integration tests exist, skip them clearly when the weights are missing.
- **Frontend testing tool:** still to be agreed (for example Vitest + React Testing Library).
- Tests must never send real SMS messages or use production data.
- Do not claim tests pass unless they were actually run.

---

## 13. Git and version control

- Commit or push **only when the owner asks**.
- *Proposed convention:* branch from `main` for features (for example `feature/citizen-report-upload`).
- Write clear commit messages, for example `feat:`, `fix:`, `docs:`, `chore:`, `test:`.
- Use `git mv` for moves so history is kept.
- **Never commit:** `.env`, credentials, `node_modules`, virtual environments, build output, uploads, local DB files, logs, model weights (`*.pt`), or datasets.
- Agree how large files (weights, datasets) will be stored before adding them (options: Git LFS, cloud storage, a manual download step).
- Empty folders are kept with `.gitkeep` files.

---

## 14. Open decisions (need owner approval)

- [ ] SMS provider
- [x] EXIF parsing library — `exifr` (2026-11-14)
- [ ] Storage approach for `best.pt` and datasets (Git LFS / cloud / manual) — currently: copied manually into `backend/ai/weights/`, git-ignored
- [x] Default EXIF location tolerance — 2 km, `EXIF_LOCATION_TOLERANCE_KM` (2026-11-14)
- [x] Browser GPS accuracy threshold — 100 m, `GPS_ACCURACY_THRESHOLD_METERS` (2026-11-14)
- [x] Severity heuristic formula and thresholds — weighted score, §6 (2026-11-14)
- [x] Engineer workload/availability formula — active engineers by open-job count, no availability field (2026-11-14)
- [ ] Priority definition (derived from severity? set manually by the admin?)
- [ ] Duplicate-report detection rule (distance + time window?)
- [ ] Notification channel for admins and engineers (no in-app channel is confirmed)
- [ ] Email login / email field for accounts (mobile number + password is implemented)
- [ ] Forgot-password / password-reset flow for users in the app (not implemented; needs the SMS provider). An operator CLI reset exists: `npm run account:reset-password`.
- [ ] How engineers receive their temporary password (currently: admin sets it and shares it privately) — or an SMS/link-based account setup once SMS works
- [ ] Admin management of citizen and admin accounts through the API (only engineer management is implemented)
- [ ] Rate-limit storage and `trust proxy` setting for deployment (current limiter is in-memory, per IP)
- [x] Reject and Delay require a reason; Accept takes an optional note (2026-11-14)
- [ ] Proposed convention to confirm: feature branches
- [ ] Frontend state management and testing tools; main backend testing tool (`node:test` currently in use — confirm); AI service testing tool (pytest in use — confirm)
- [x] WebSocket library — `ws` (2026-11-15)
- [ ] API documentation approach for the main backend (request validation: zod, adopted in Phase 2)
- [ ] Chat extras (unread counts, read receipts, attachments, typing) — not in scope; would need approval
- [ ] Chat across several server processes (would need shared pub/sub such as Redis — out of scope for the FYP)
- [x] How the main backend calls the AI service, and how it is protected — internal URL + shared secret header, §5 (2026-11-14)
- [x] Which service computes severity — main backend (2026-11-14)
- [x] Location storage — plain latitude/longitude columns (2026-11-14)
- [ ] Confirm the Prisma migration workflow (`migrate diff` + review + `migrate deploy` is in use because the DB user cannot create a shadow database, §7.1)
- [ ] PostgreSQL hosting/deployment (for example local install, Docker or a managed service)
- [x] Python version — 3.12.16 via uv (2026-11-14)
- [ ] Python lint/format tooling
- [ ] Deployment target
- [ ] Validation of the three crack classes (and wider pothole testing) with the owner's RDD2022 data
- [ ] HEIC support for uploads (not supported now)

---

## 15. Phase 6 — Civic Ink redesign, in-app notifications and web improvements (2026-11-16)

Owner-approved. Working tree only: **not committed**.

### Design system ("Civic Ink")
- Tokens in `frontend/src/styles/index.css` (`@theme`): ink (`ink-*`), canvas, cobalt (actions/focus), road yellow (small accent), severity and state colours. Pages use token classes only, never raw Tailwind palette colours (`slate-*`, `blue-*`, ...).
- Fonts are self-hosted: `@fontsource-variable/public-sans` (UI) and `@fontsource/ibm-plex-mono` (references, coordinates, scores). Icons: `lucide-react`. No UI component library.
- "RoadWatch" is a **temporary** product name, defined only in `components/Brand.tsx`. The official project title is unchanged.
- Three deliberately different indicators (`components/reports/indicators.tsx`): `StatusPill` (neutral pill + dot), `SeverityIndicator` (1–3 bars + label, never colour alone), `RepairPill`. `reportRef(id)` gives a display reference `RD-XXXXXX` from the UUID; it is **not** an identifier (links, API calls and authorization always use the UUID).
- Shell (`layouts/AppLayout.tsx`): ink sidebar on desktop, ink top bar + bottom tab bar on phones, one component for all roles. Desktop top bar holds the AI status pill (admins) and the notification bell.
- Shared: `Toast` (confirmations), `ErrorBoundary`, `Skeleton`/`SkeletonList`, `EmptyState`, `PageHeader`, `ProgressStepper`/`ProgressBar`, `ReportPhoto` (per-class box colours, show/hide, enlarge), `ReportThumb` (lazy), `SeverityExplanation`, `ReportsOverviewMap`, `lib/protectedImage.ts` (cached authorised image loading).
- `SeverityExplanation` only explains the **stored** score. `lib/severityConfig.ts` mirrors the backend's `SEVERITY_CONFIG`; if the re-added parts do not match the stored score the breakdown is hidden. Keep the two in step when the formula changes.
- New routes: `/` (public landing page for visitors; logged-in users are redirected by role), `/notifications` (all roles), `/admin/map`. Citizens have a List/Map switch on `/reports` (own reports only).
- Unchanged on purpose: `lib/api.ts`, `lib/chatSocket.ts`, the feature API modules' existing calls, and the camera/GPS logic in `LiveCameraCapture`.

### In-app notifications (all three roles)
- Migration `20261116200000_phase6_notifications` (owner approved; additive only: enum `NotificationType`, table `notifications`, 3 indexes, 3 foreign keys with CASCADE; applied to `public` and `app_test` with `migrate deploy`).
- `notifications`: `user_id` (recipient), `type`, `title`, `body`, `report_id?`, `conversation_id?`, `dedupe_key`, `read_at?`, `created_at`; **unique (`user_id`, `dedupe_key`)**.
- Rows are written by `services/notificationEvents.ts` **inside the transaction of the business operation** (same `tx`), with `createMany({ skipDuplicates })`. The dedupe key comes from the record that caused the event (status-history, assignment or repair-update id), so retries and concurrent requests cannot duplicate, and refused or rolled-back actions leave nothing.
- Event mapping: report created → citizen `REPORT_SUBMITTED`, all active admins `NEW_REPORT` (+ `AI_ANALYSIS_FAILED` when the analysis failed); decision that changes the status → citizen `REPORT_ACCEPTED`/`REPORT_REJECTED`/`REPORT_DELAYED` (with the reason); engineer PENDING→WORKING → citizen `REPAIR_STARTED`; →COMPLETED → citizen `REPAIR_UPDATED`, all active admins `REPAIR_AWAITING_CONFIRMATION`; reopen → citizen `REPAIR_UPDATED`; admin confirmation → citizen and engineer `REPAIR_CONFIRMED`; (re)assignment → new engineer `JOB_ASSIGNED`, previous engineer `JOB_REASSIGNED` (no report link: access is gone); admin feedback → engineer `REWORK_REQUESTED`; chat message → the other member `CHAT_MESSAGE`.
- Not notified: Start review, keep-delayed, severity correction, engineer notes. Texts never contain citizen identity, the engineer's name (for citizens), phone numbers or coordinates.
- Chat: **one row per recipient per conversation** (`chat:<conversationId>`, upsert): a new message refreshes it and makes it unread; opening the conversation marks it read. This is not a per-message unread counter.
- API (any logged-in role, own rows only; another user's id → 404 `NOTIFICATION_NOT_FOUND`): `GET /notifications?page&pageSize` (≤ 50; returns `unread`), `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `POST /notifications/conversations/:id/read`.
- Frontend: `features/notifications/` — context polls the unread count every 30 s while the tab is visible and on focus (no socket); bell dropdown on desktop, `/notifications` page on phones.
- `services/notification.service.ts` is still the **citizen SMS**; the in-app reading side is `services/inAppNotification.service.ts`.

### Other backend additions (all additive)
- `GET /admin/system-status` → `{ ai: { status: "online"|"offline"|"not_configured", modelLoaded } }`. `AiClient.health()` asks the AI service's `/health` (3 s timeout, never throws). No URL, secret or error detail is returned.
- `GET /admin/reports/map` (same filters as the list, newest first, at most `ADMIN_MAP_MAX_POINTS` = 500, with `total` and `truncated`). Admin list items now include `location.latitude`/`longitude`.
- Analytics CSV export is built in the browser from the analytics response (no new endpoint).

### Tests (2026-11-16)
- Backend: **215 tests, all passing** with `NODE_OPTIONS=--throw-deprecation` (`app_test` only). New: `tests/notifications.test.ts` (11 tests: auth and validation, fan-out to all admins, AI failure, decisions with reasons, no notification for refused/repeated/keep-delayed/review, full job loop incl. reassignment and rework, ownership and CSRF, mark all/pagination, chat one-row behaviour, system status, map endpoint).
- Frontend: typecheck and production build pass. No automated frontend tests (still undecided).
- Scripted browser check (headless Windows Chrome over CDP, API on 3100 against `app_test`, real AI service; scripts not committed): 40/40 — landing, login (reveal password, wrong credentials), registration with the six-box OTP, gallery report through the 3-step wizard with real analysis, notifications for all roles (bell dropdown, page, mark all read, chat row), admin review/accept/severity/assign with the sticky header, engineer start/photo/complete, rework and attempt 2, confirmation, citizen completed view, chat, reports list, map, analytics, role redirects and a 403 for a citizen on an admin endpoint, no sideways scroll at 390 px on 13 pages, no JavaScript errors.
- Not browser-tested in Phase 6: live camera + GPS (code untouched; last verified in Phase 3), reject/delay dialogs, reassignment through the UI, tablet widths, real phones, the CSV file's contents.

### Six further web features (2026-11-16, same day)
- **Structured logging** (`src/utils/logger.ts`): one JSON object per line (`time`, `level`, `event`, `requestId`, fields); `warn`/`error` on stderr. `middleware/requestLogger.ts` gives every request an id (`X-Request-Id` response header; a well-formed incoming id is reused), stored in `AsyncLocalStorage` so every line written during the request carries it. `http_request` lines hold method, path **without the query string**, status, duration, user id and role. Keys that look sensitive (password, secret, token, otp, cookie, hash, csrf, authorization) are redacted; mobile numbers must be masked by the caller. Not routed through the logger on purpose: the development-only mock SMS sender and the CLI scripts.
- **Admin sorting** (`GET /admin/reports?sort=`): `newest`, `oldest`, `severity`, `waiting`. `severity` = highest effective severity first (admin correction, else the estimate), longest waiting inside each level, none last; implemented as four consecutive groups with the Prisma query API (no raw SQL). `waiting` = oldest first, and without a status filter only open reports (SUBMITTED, UNDER_REVIEW, DELAYED, ACCEPTED).
- **Possible-duplicate hint** (`GET /admin/reports/:id/possible-duplicates`, ADMIN only): other reports within `DUPLICATE_HINT_RADIUS_METERS` (50) and submitted within `DUPLICATE_HINT_WINDOW_DAYS` (30) of the report, nearest first, at most 10 (`config/workflow.ts`). Bounding box in the database, exact haversine distance in code. **Advisory only:** nothing is merged, rejected or blocked, and citizens are never stopped from submitting.
- **Turnaround metrics** (`analytics.turnaround`): `toReview`, `toDecision`, `toCompletion`, each `{ reports, medianHours, averageHours }`, measured from submission using `report_status_history`; each report counts once per measure (first review, first decision, completion); "keep delayed" rows (from = to) are ignored. Included in the CSV export.
- **Retry of a failed analysis** (`POST /admin/reports/:id/retry-analysis`, ADMIN only; `allowedActions.retryAnalysis`): only when `ai_status = FAILED`. Re-sends the stored display copy. On success only the `ai_*` columns and `ai_detections` are written (conditional on still FAILED, so concurrent retries cannot store detections twice); the report status, `admin_severity` and all decisions are untouched. On failure only `ai_error_code` is updated. A second click while one is running gets 409 `ANALYSIS_IN_PROGRESS`; a report that is no longer FAILED gets 409 `ANALYSIS_NOT_RETRYABLE`. **No `report_status_history` row is written**: the latest history note is what citizens see as the reason for a delay or rejection, so a retry note there would be shown to them. The retry is recorded in the structured log (`ai_analysis_retry`, with admin id, outcome and the previous error). A database audit trail would need a new table (migration).
- **Engineer map:** engineer job list items now carry `location { latitude, longitude }` (the same coordinates the job page already shows; own jobs only). The engineer dashboard has a List/Map switch.
- Shared helper `services/analysisRows.ts` (`toDetectionRows`) is used at submission and on retry.
- Tests: `tests/phase6Features.test.ts` (9 tests). Two existing assertions in `adminReports.test.ts` were updated for intended changes (`allowedActions.retryAnalysis`; the SMS-failure warning is now a structured stderr line, still with a masked number). **Backend total: 224 tests, all passing** with `NODE_OPTIONS=--throw-deprecation`.
- Scripted browser check: 15/15 (two reports at one place while the AI service was down → duplicate hint; retry failing safely, then succeeding after the AI service started, with admin severity and status unchanged; AI status pill offline → online; both sort orders; turnaround card; engineer map with only the engineer's job; 390 px; log file checked for request ids and absence of passwords, full mobile numbers and query strings).
- **Browser checks must use their own ports** (API 3100, Vite **5174**, `CORS_ORIGIN=http://localhost:5174`) and confirm they reach the test API before doing anything: the owner often runs the dev stack on 5173/3000 against `public`. Never stop processes by port without checking who started them.

### Still open after Phase 6
- All approved web features (F1–F4, F6–F12) are built. Not built: F13, F15, F16, F17 (deferred by the owner).
- F5 model evaluation and retraining (Kaggle; `backend/ai/weights/best.pt` must not be replaced without approval).
- The two stray untracked files (`backend/api/tsx`, `backend/api/api@1.0.0`) were deleted on 2026-11-16 with the owner's approval.
