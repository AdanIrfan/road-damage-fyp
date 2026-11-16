# AI-Powered Road Infrastructure Damage Detection, Severity Assessment and Maintenance Management System

A Final Year Project web application that connects three groups:

- **Citizens**, who report road damage with photographs and location
- **Administrators**, who check reports and assign repair work
- **Maintenance engineers**, who carry out repairs and report their progress

A YOLOv8 model, already trained on the RDD2022 road damage dataset, analyses each uploaded photograph. It returns the damage class, a confidence score and bounding boxes, which the system uses to make an initial severity estimate.

> **Project status:** Phase 6 (in progress, not yet committed) — on top of Phases 2–5 the whole frontend has been redesigned ("Civic Ink"), with a public landing page, persistent **in-app notifications for citizens, administrators and engineers**, an AI service status indicator, overview maps and analytics CSV export. Priority, model evaluation and a real SMS provider are **not implemented**. See [What works today](#what-works-today) and [Known limitations](#known-limitations).

## Purpose

Road damage is often reported late, through informal channels, or not at all. This project aims to:

1. Make reporting easy for citizens using photos and GPS location.
2. Use AI to help sort reports by damage type and estimated severity.
3. Give administrators one place to check, prioritise and assign reports.
4. Let engineers manage and record repair work.
5. Keep citizens informed through SMS updates.

## Technology stack (confirmed)

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 (TypeScript), React Router |
| Styling | Tailwind CSS 4 |
| Main backend | Node.js 24 + Express.js 5 (TypeScript) |
| ORM | Prisma 7 |
| Database | PostgreSQL 18 |
| AI service | Python + FastAPI |
| AI model | YOLOv8 + PyTorch (existing `best.pt`, inference only) |
| Authentication | JWT in httpOnly cookies, refresh-token rotation, Argon2id passwords |
| Charts | Recharts 3 (admin analytics) |
| Maps | OpenStreetMap + Leaflet |
| Real-time communication | WebSockets with the `ws` library (admin–engineer chat) |
| Citizen notifications | SMS (provider not yet selected) |

## How the system is organised

The application has three main parts:

1. **Frontend (React):** the website that citizens, admins and engineers use. It talks only to the main backend.
2. **Main backend (Node.js + Express):** the core of the application. It handles:
   - authentication (JWT) and role-based authorisation
   - reports, workflows and business rules
   - photo uploads, EXIF processing and location verification
   - admin–engineer chat over WebSockets
   - SMS notifications
   - all database access, through **Prisma**
3. **AI service (Python + FastAPI):** handles **AI inference only**. It loads the existing YOLOv8 `best.pt` model and returns detection results (damage class, confidence and bounding boxes). It does **not** handle users, authentication, report workflows, or direct database access.

**PostgreSQL** is the project's only database, and only the main backend accesses it.

A typical report flows like this: the citizen submits a photo through the frontend → the main backend checks the location and sends the image to the AI service → the AI service returns detections → the main backend estimates severity, stores the report in PostgreSQL and shows the result to the citizen.

The main backend calls the AI service over an internal URL (`AI_SERVICE_URL`) with a shared secret header; the browser never talks to the AI service. Severity is calculated by the main backend.

## What works today

**Authentication and user management (Phase 2):**

- **Citizen registration** with full name, mobile number and password, then **mobile verification with a 6-digit SMS code (OTP)**. The account is only activated after verification.
  - Codes expire after 10 minutes, allow 5 attempts, can be re-sent after 60 seconds (max 5 per hour), and are stored only as hashes.
  - ⚠️ **No real SMS provider is connected yet.** In development the codes are printed to the backend console ("mock SMS"); nothing is sent to phones. The backend refuses to run in production until a real provider is added.
- **Login / logout** with mobile number and password, for citizens, admins and engineers.
- **Secure sessions:** short-lived access token and rotating refresh token, both in httpOnly cookies (never in `localStorage`); CSRF protection; rate limiting on login, registration and codes.
- **Profiles:** every user can view their profile, change their name and change their password (which logs out their other devices).
- **Admin:** the first admin is created with a command-line script (there is no public admin sign-up). Admins can **create engineer accounts** (with a temporary password the engineer must change), **list/search/filter** engineers, **view and edit** them, and **activate/deactivate** them (deactivation logs the engineer out immediately).
- **Role-based access** enforced by the backend: citizens and engineers cannot use admin functions.
- **Health checks:** `GET /api/health` and `GET /api/health/db`.

**Citizen reporting and AI analysis (Stage 3):**

- Report road damage with **Live camera** (photo + device GPS, accuracy shown) or **Gallery upload** (photo + location picked on an OpenStreetMap map).
- Photos are checked by content (JPEG/PNG, max 10 MB). The original is kept privately; users only ever see a copy with all metadata removed.
- Location check: gallery photos' EXIF GPS is compared with the chosen location (2 km tolerance); live-camera reports with GPS accuracy worse than 100 m are flagged. Nothing is rejected automatically.
- The AI service (YOLOv8 `best.pt`) returns detections; the backend stores them and computes an **estimated** severity. If the AI service is unavailable the report is still saved ("analysis unavailable").
- Citizen dashboard: own reports, status, damage found, estimated severity, map and photo with detection boxes.

**Admin and engineer workflows (Stage 4):**

- **Admin dashboard:** totals by status and severity, work queues (new, under review, delayed, to assign, in progress, awaiting confirmation) and recent reports.
- **Admin reports:** search, filter (status, severity, dates, assignment, repair status, location check, analysis, capture method), sort and paginate; detail page with photo, AI results, map with the photo's EXIF point, citizen, status history and repair work.
- **Review and decisions:** Start review → Accept (optional note) / Reject (reason required) / Delay (reason required). A delayed report can be accepted, rejected or kept delayed with a new reason. Admins can correct the severity (the AI estimate is kept).
- **Assignment:** engineers are suggested by open-job count (fewest first); admins assign and reassign accepted reports.
- **Engineer dashboard:** own jobs, job detail (photo, AI results, severity, map — no citizen identity), repair status **Pending → Working → Completed**, progress notes, repair photos, work history.
- **Repair attempts:** each attempt needs 1–5 repair photos of its own before it can be marked Completed. If an admin asks for more work, the engineer reopens the repair, which starts a new attempt (new photos required). Reassignment also starts a new attempt. Earlier photos and notes are always kept.
- **Completion:** the engineer's Completed status does not finish the report; an admin checks the current attempt and confirms, and only then is the report `completed`.
- **Citizen updates:** the citizen sees rejection/delay reasons and repair progress, and gets an SMS when the report is accepted, rejected, delayed or completed (mock SMS in development).

**Admin–engineer chat and analytics (Phase 5):**

- **Chat (Messages page):** private one-to-one conversations between an admin and an engineer. Each admin–engineer pair has its own conversation; another admin or engineer cannot see it. Messages appear on the other side immediately (WebSocket), are stored in PostgreSQL, and the history stays after a refresh or reconnect. Plain text only, up to 2,000 characters, 30 messages per minute per user. If the connection drops, the page reconnects by itself, sends anything typed during the outage, and loads messages that were missed. Admins can also open a chat from an engineer's page. Citizens have no chat. There are no read receipts, typing indicators, attachments or unread counts (not in scope).
- **Analytics (admin):** charts of reports submitted over time, reports by status, by estimated severity (admin correction where set), damage types detected, repair progress, engineer workload and location verification results, for a chosen period (7 / 30 / 90 days, 12 months, all time or custom dates). Every number comes from the stored reports; each report is counted once, so reassignments and repeated repair attempts do not inflate the figures.

**Redesign, notifications and web improvements (Phase 6):**

- **New interface for all three roles:** dark sidebar on desktop and a bottom tab bar on phones; report reference numbers such as `RD-7F3A2C` (for display only); a progress stepper from Submitted to Completed; distinct indicators for report status, repair status and severity.
- **Public landing page** at `/` for visitors; login, registration and SMS-code pages redesigned (six-box code entry, show/hide password).
- **Citizens:** report cards with photo thumbnails, a list/map switch for their own reports, a three-step submission wizard (method → photo and location → review), and an explanation of how the estimated severity was calculated.
- **Administrators:** operations dashboard (pipeline, map, items needing attention), quick views on the report list, a report page whose actions stay visible while scrolling, an overview map, analytics KPIs and **CSV export**, and an indicator showing whether the AI service is online with its model loaded.
- **Engineers:** phone-first job cards with one clear next action and a guided checklist per repair attempt.
- **Operations extras:** sort reports by highest severity or longest waiting; a non-blocking hint when another report was submitted within 50 m and 30 days (nothing is merged or rejected automatically); turnaround times in analytics; a "Retry analysis" button for reports whose automatic analysis failed (it never changes the status or the administrator's severity); a map of their own jobs for engineers; structured JSON logs with a request id on every response.
- **In-app notifications:** a bell with an unread count for every role; notifications are stored in the database, lead to the relevant report, job or conversation, and can be marked read one by one or all at once. Chat produces one notification per conversation, not one per message.

## Feature plan

The original plan is below. Everything in it is implemented **except**: notifications for admins and engineers (the channel is not decided), and prioritisation (the priority rule is not decided). Citizens' SMS uses the development mock sender until a provider is chosen.

### Citizen
- Self-registration with mobile number verification (by SMS code)
- Submit road damage reports in one of two ways:
  - **Live camera:** the photo is taken in the browser and the device's GPS location is recorded.
  - **Gallery upload:** the citizen picks a photo and chooses the location on a map.
- Location checks:
  - For gallery uploads, GPS data stored inside the photo (EXIF metadata) is compared with the chosen location, within a configurable distance tolerance.
  - For live-camera reports, the browser's GPS location is used. Reports with poor GPS accuracy are flagged.
  - Reports with missing metadata, a location mismatch, or poor GPS accuracy are **flagged for an admin to check, never rejected automatically**.
- AI results: damage class, confidence score and estimated severity
- Report tracking and SMS progress notifications

### Admin
- Secure login (multiple admin accounts are supported)
- View, search, filter and sort all reports
- Review photographs, AI predictions and location checks on an interactive map
- Start a review, then accept, reject or delay reports, and review or correct severity
- Assign reports to engineers based on calculated workload and availability
- Monitor repair progress and confirm when a repair is complete
- Dashboard statistics and charts
- Real-time one-to-one chat with engineers
- Receive relevant notifications (channel not yet decided)

### Maintenance engineer
- Account created by an admin; secure login
- View assigned jobs with photographs, location and severity
- Update repair status (**Pending → Working → Completed**), add notes, upload repair photographs
- View completed assignment history
- Real-time one-to-one chat with admins
- Receive notifications about assignments and messages (channel not yet decided)

## Report lifecycle

Each report has a **report status**, managed by admins:

`submitted` → `under_review` → `accepted` / `rejected` / `delayed` → … → `completed`

- A report moves to `under_review` only when an admin clicks **Start review**. Opening a report changes nothing.
- A `delayed` report stays delayed until an admin decides again (accept, reject, or keep delayed with a new reason).
- `rejected` and `completed` are final.
- After an engineer marks the repair **Completed**, an admin confirms it, and only then does the report become `completed`.

The engineer's **repair status** (Pending, Working, Completed) is a separate field, changed only by the assigned engineer, and belongs to the current **repair attempt** (attempt 1, 2, …). A new attempt starts on assignment, on reassignment and when the engineer reopens a completed repair after admin feedback.

## Note on severity estimation

Severity is estimated from the detections: the sum of *box area share × confidence × class weight* (pothole 1.0, alligator crack 0.8, longitudinal/transverse crack 0.5), mapped to Low / Medium / High. **This is a rough estimate, not a validated engineering measurement.** Administrators can correct it; both values are kept.

## Repository structure

```text
road-damage-fyp/
├── CLAUDE.md          # Project guide: requirements, rules and open decisions
├── README.md
├── frontend/          # React + Vite + Tailwind client (TypeScript)
│   └── src/           # features/ (auth, citizen, admin, engineer, chat), pages/, layouts/, routes/,
│                      # lib/api.ts (HTTP client), lib/chatSocket.ts (chat WebSocket client)
├── backend/
│   ├── api/           # Node.js + Express main backend (TypeScript)
│   │   ├── src/       # routes → controllers → services → Prisma; realtime/ (chat WebSocket)
│   │   ├── prisma/    # schema.prisma + migrations/
│   │   ├── storage/uploads/  # Runtime uploads (not tracked in Git)
│   │   └── tests/     # node:test suite
│   └── ai/            # Python + FastAPI AI inference service (Python 3.12, uv)
│       ├── app/       # FastAPI app: model loading, /health, /v1/detect
│       ├── weights/   # Location of best.pt (not tracked in Git)
│       └── tests/     # pytest suite
├── datasets/          # Dataset notes (data itself is not tracked in Git)
└── docs/              # Project documentation
```

## Model weights

The trained `best.pt` file is **not** in this repository. Its intended location is `backend/ai/weights/best.pt`. Weight files are excluded from Git, and how they will be stored and shared is still to be decided. See [`datasets/dataset_notes.md`](datasets/dataset_notes.md).

## Not yet decided

Some implementation details are still open, including:

- SMS provider (required before production use)
- Notification channel for admins and engineers
- Priority and duplicate-detection rules
- Database hosting, deployment target, frontend testing tool, lint tools

The full list is in [`CLAUDE.md`](CLAUDE.md) (§14).

## Local development setup

### Prerequisites
- **Node.js 24** and npm
- **PostgreSQL 18** with a database and a dedicated user (this project uses `road_damage_db` and `road_damage_user`). The user does not need permission to create databases.
- **Python 3.12** managed with **uv** (for the AI service), and the trained `best.pt` file in `backend/ai/weights/`.

### 0. AI service (`backend/ai`)
```bash
cd backend/ai
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-dev.txt   # CPU-only PyTorch
cp .env.example .env          # set AI_SHARED_SECRET (same value as AI_SERVICE_SECRET in backend/api/.env)
.venv/bin/uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8000
```
The service refuses to start if `best.pt` is missing. Settings: `AI_SHARED_SECRET` (required), `AI_MODEL_PATH`, `AI_CONFIDENCE_THRESHOLD` (0.25), `AI_IOU_THRESHOLD` (0.7), `AI_IMAGE_SIZE` (640), `AI_DEVICE` (cpu).

### 1. Backend (`backend/api`)
```bash
cd backend/api
npm install                 # also generates the Prisma client
cp .env.example .env        # then edit .env (see below)
npm run prisma:migrate:deploy   # creates the tables (non-destructive)
npm run admin:create        # create the first admin account (asks for name, mobile, password)
npm run dev                 # API on http://localhost:3000
```

In `backend/api/.env` set at least:
- `DATABASE_URL` — replace `YOUR_PASSWORD` with your database user's password (URL-encode special characters).
- `AUTH_SECRET` — a long random value, for example the output of `openssl rand -base64 48`.
- `SMS_PROVIDER=mock` — development only; verification codes and citizen notifications appear in the backend console.
- `AI_SERVICE_URL=http://127.0.0.1:8000` and `AI_SERVICE_SECRET` — the same secret as `AI_SHARED_SECRET` in `backend/ai/.env`.

Optional: `AI_REQUEST_TIMEOUT_MS` (30000), `UPLOAD_DIR` (`storage/uploads`), `EXIF_LOCATION_TOLERANCE_KM` (2), `GPS_ACCURACY_THRESHOLD_METERS` (100), `CORS_ORIGIN`, `PHONE_DEFAULT_COUNTRY`, `COOKIE_SAMESITE`. Never commit `.env`; see `backend/api/.env.example`.

Account tools (operators with database access):
- `npm run admin:create` — first admin; `npm run admin:create -- --additional` for more admins.
- `npm run account:reset-password` — reset the password of any existing account (asks for the mobile number, shows the account, asks for the new password twice, hidden). It does not verify or activate accounts.

### 2. Frontend (`frontend`)
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to the backend)
```

Open http://localhost:5173, register as a citizen, read the 6-digit code from the backend console, verify, log in and report damage. Log in with the admin account to review reports and create engineers; engineers log in with their temporary password, change it, and see their assigned jobs. Admins and engineers can message each other under **Messages**; admins see charts under **Analytics**.

The chat uses a WebSocket at `/api/v1/chat/ws` on the same server; the Vite dev server proxies it together with `/api` (`ws: true`), so no extra setup is needed.

Live camera and GPS work only on `http://localhost` or HTTPS. Desktop browsers usually locate by Wi-Fi, which can be hundreds of metres off; phones with GPS outdoors are much more accurate.

### Checks
```bash
cd backend/api && npm run typecheck && npm test && npm run build
cd backend/ai && .venv/bin/python -m pytest
cd frontend && npm run build          # includes the TypeScript check
```
Backend database tests use a separate `app_test` schema in the same database and never touch your real tables. There are no frontend unit tests yet (tool not chosen).

After pulling Phase 5, apply the new chat tables with `npm run prisma:migrate:deploy` (in `backend/api`). The migration only adds the `conversations` and `chat_messages` tables.

### Health endpoints
- http://localhost:3000/api/health — API is running
- http://localhost:3000/api/health/db — PostgreSQL is reachable

## Known limitations

- **SMS:** only the development "mock" sender exists; messages are printed to the backend console. Production refuses to start until a real provider is added. If the server stops between saving a decision and sending its SMS, that SMS is lost (there is no outbox).
- **Notifications for admins and engineers:** none yet; engineers see new jobs on their dashboard, and new chat messages appear only while the Messages page is open (there are no unread counts or alerts).
- **Chat:** one server process only (open connections are tracked in memory; several processes would need shared messaging such as Redis, which is out of scope). Plain text only. An open chat connection stays usable until its 15-minute access token expires even after logout or a password change (the same as the rest of the API); deactivation stops it at the next message.
- **Analytics:** dates are UTC days. The engineer workload chart credits each report to its current engineer. The time series is grouped in the backend from one timestamp per report, which is fine at project scale but not designed for very large data.
- **AI model:** only the `pothole` class has been checked on a real photo; the three crack classes have not been tested yet. Severity is a heuristic estimate.
- **Location accuracy:** depends on the device; laptops often have no GPS. Poor accuracy is flagged for review, never rejected.
- **Sessions:** an access token issued before logout, deactivation or a password reset stays valid for up to 15 minutes.
- **Rate limits** are kept in memory (they reset on restart and assume a single server process).
- **Frontend bundle** is about 913 kB (265 kB compressed) since Recharts was added; Vite warns above 500 kB. Loading the analytics, admin and engineer pages on demand would reduce it.
- **Not implemented yet:** priority, duplicate detection, notifications for admins and engineers, a real SMS provider, chat attachments/read receipts, HEIC photos, forgot-password for users in the app.
