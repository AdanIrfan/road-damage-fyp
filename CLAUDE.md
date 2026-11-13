# CLAUDE.md — Project Guide

**Project:** AI-Powered Road Infrastructure Damage Detection, Severity Assessment and Maintenance Management System
**Type:** Final Year Project (FYP)
**Status:** Phase 1 (backend foundation) complete. The main backend (`backend/api/`) has its Express + TypeScript + Prisma foundation, health endpoints, CORS, error handling and tests. **No application features (authentication, reports, users, etc.) are implemented yet.** The frontend and the AI service have not been started.

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
- Admin accounts are **not** created through public registration. How the first admin account is created (seed script or CLI command) is still to be decided.

---

## 3. Application workflows

### 3.1 Citizen registration
1. The citizen enters their name, mobile number and password.
2. The system sends a one-time verification code by SMS.
3. The citizen enters the code. The account becomes active only after the number is verified.
4. The citizen logs in and receives a JWT. (The login method is not confirmed yet; see §7.2.)

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

### 3.5 Maintenance
1. The engineer sees the assigned job: photos, map location, severity and details.
2. The engineer updates the status: **Pending → Working → Completed**.
3. The engineer adds notes and progress updates.
4. When the job is completed, the engineer uploads photo(s) of the repair.
5. Admins monitor progress. The citizen receives SMS updates when key milestones are reached.
6. When the engineer sets the repair status to **Completed**, the report status does **not** change automatically. An admin checks the repair and confirms it is complete; only then does the report status become `completed`, the final report status.
7. Completed jobs appear in the engineer's history.

### 3.6 Chat
- One-to-one, WhatsApp-style chat between an admin and an engineer over WebSockets.
- Each admin–engineer pair has its own separate conversation. There is **no** shared inbox where several admins share one conversation with an engineer.
- Messages are stored in PostgreSQL so the history is kept.
- Read/delivered status and attachments are optional and must be agreed first.

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

Library choices not listed here (for example the request validation library, the WebSocket library, the EXIF library, password hashing, or frontend state management) must be **proposed to the owner and approved** before use.

---

## 5. Architecture

```text
road-damage-fyp/
├── frontend/src/
│   ├── assets/          static images and icons
│   ├── components/      shared, reusable UI components
│   ├── features/        feature modules (UI + feature-specific hooks/api calls)
│   │   ├── auth/  citizen/  admin/  engineer/  chat/  notifications/
│   ├── hooks/           shared React hooks
│   ├── layouts/         role-specific page layouts
│   ├── lib/             configured clients (API/HTTP client, WebSocket client, map setup)
│   ├── pages/           route-level pages
│   ├── routes/          routing and role-based route guards
│   ├── styles/          Tailwind entry and global styles
│   └── utils/           pure helper functions
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
│   └── ai/                  Python + FastAPI AI inference service
│       ├── app/             FastAPI application source code
│       ├── weights/         best.pt (NOT in Git)
│       ├── tests/
│       └── requirements.txt (not created yet)
│
├── datasets/            dataset_notes.md only (data NOT in Git)
└── docs/                project documentation
```

> **Backend layout (approved):** `backend/api/` is the Node.js + Express main backend (Prisma, PostgreSQL access, uploads and business logic). `backend/ai/` is the Python + FastAPI AI inference service. `backend/ai/requirements.txt` will be created when the AI service is set up. The internal layout of `backend/ai/app/` is still to be agreed. Do not restructure these folders without the owner's approval.

### Main backend layout (`backend/api/`, current)
```text
src/
├── index.ts               entry point: load + validate env, create Prisma client, start server, graceful shutdown
├── app.ts                 createApp(): builds the Express app (no server), so tests can use fake dependencies
├── config/env.ts          .env loading and environment validation
├── db/prisma.ts           Prisma client factory (PrismaPg adapter); one client is created in index.ts and injected
├── routes/
│   ├── index.ts           everything under /api (health + /v1)
│   ├── health.routes.ts   /api/health, /api/health/db
│   └── v1/index.ts        /api/v1 router: all application routes are added here
├── controllers/           request/response handling (thin)
├── services/              business logic and database access
├── middleware/            cors, errorHandler, notFound, requestLogger
├── types/api.ts           shared API response types
├── utils/                 apiResponse (sendSuccess/sendError), httpError (HttpError)
└── generated/prisma/      generated Prisma client (NOT in Git; recreated by `prisma generate`)
tests/
├── *.test.ts              node:test test files
├── helpers/               test helpers (e.g. startTestServer)
└── tsconfig.json          type-checks tests together with src/
```
- Request flow: **route → controller → service → Prisma**. Routes and controllers contain no business logic.
- Dependencies (such as the database check or, later, services) are passed into `createApp()` rather than imported as globals, so tests never need a real database.
- New application features add a router under `src/routes/v1/` (plus controller and service), mounted in `src/routes/v1/index.ts`.

### Separation of responsibilities
- **Frontend:** presentation, user input, client-side validation for user experience, camera/GPS capture, map display. It **never** makes security decisions; the UI hiding something is not access control.
- **Frontend communication (confirmed rule):** the React frontend communicates **only** with the Node.js + Express main backend. It does **not** communicate directly with the Python + FastAPI AI service or with PostgreSQL. The main backend is responsible for communicating with the AI service and for accessing PostgreSQL through Prisma.
- **Main backend (Node.js + Express + Prisma):** the main application backend. Authentication, authorisation, all business rules, report workflow and statuses, EXIF parsing and location verification, assignment calculation, admin–engineer chat (WebSockets), SMS sending, file uploads, and all database access through Prisma. It calls the AI service to analyse images.
- **AI service (Python + FastAPI):** AI inference only. It loads the existing YOLOv8 `best.pt` **once** at startup, accepts an image, and returns detections (class, confidence, bounding box). It does not handle users, authentication, report workflow or the database.
- **Database (PostgreSQL):** accessed only by the main backend, through Prisma.
- Which service computes severity, and how the main backend calls the AI service, are open decisions (§14).
- In the main backend, **routes** call **services**; services call the database (through Prisma) and the AI service. Routes contain no business logic.

---

## 6. AI model integration

- AI inference runs in the separate **Python + FastAPI AI service**.
- Use the **existing trained `best.pt`** (YOLOv8, trained on RDD2022). **Do not train or retrain.**
- Expected location: `backend/ai/weights/best.pt`. The path must be configurable through an environment variable. The file is **not yet in the repository**.
- If the weights file is missing, the AI service must fail with a clear error message rather than produce fake predictions.
- Load the model once (at AI service startup), not once per request.
- Inference output for each detection: class name, confidence, bounding box. The main backend stores the raw detections with the report.
- Read class names **from the model file itself**. Do not hard-code assumed class lists.
- Run inference so that it does not block the async event loop (for example in a thread pool).

### Severity estimation (initial, heuristic)
- Estimate severity from available detection information: **bounding-box area relative to the image, number of detections, confidence**, and possibly damage class.
- Output a simple level (for example `low` / `medium` / `high`). Keep the formula in **one module** with configurable thresholds. Which service hosts it is an open decision (§14).
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
- **Current state:** `backend/api/prisma/schema.prisma` contains only the generator and datasource — **no models**, and **no migrations** have been created or run.
- Local database: PostgreSQL 18 on `localhost:5432`, database `road_damage_db`, dedicated user `road_damage_user` (already created; credentials only in the local `.env`).

#### Prisma 7 setup (current)
- The database URL is **not** in `schema.prisma`. The Prisma CLI reads it from `backend/api/prisma.config.ts`, which loads `backend/api/.env` (Prisma 7 does not load `.env` automatically).
- The client is generated by the `prisma-client` generator (ES modules) into `src/generated/prisma/` and imported from `src/generated/prisma/client.js`.
- The app connects through the `PrismaPg` driver adapter, which owns the connection pool (5 s connection timeout). The `?schema=` URL parameter is read in `src/db/prisma.ts` and passed to the adapter, because the adapter does not read it from the URL.
- Create **one** `PrismaClient` per process (in `src/index.ts`) and inject it; it is disconnected on shutdown.

#### Database migration policy
- **No schema change or migration without the owner's explicit approval.** Propose the model changes first.
- Schema changes are made only in `schema.prisma` and applied only through Prisma migrations (exact workflow, e.g. `migrate dev` locally vs `migrate deploy` elsewhere, is still to be agreed — §14). Never change tables by hand.
- **Never** run destructive commands against the project database without explicit approval: `prisma migrate reset`, `prisma db push --force-reset`, dropping/recreating the database, or changing the database user or password.
- After any schema change, run `npm run prisma:generate` so the generated client matches.
- Migrations that are approved and created must be committed to Git (`prisma/migrations/`).

Expectations:
- Store image **file paths/keys** in the database, not image binaries.
- How locations are stored (for example plain latitude/longitude columns or the PostGIS extension) is an **open decision** (§14). The choice should support nearby and duplicate-report queries.
- Add indexes for common filters (status, severity, created date, assigned engineer).
- Use timezone-aware UTC timestamps (`created_at`, `updated_at`).
- Keep an audit trail of status changes (who, what, when).
- The database connection string comes from environment variables, never from code.

### 7.2 Authentication (JWT)
- Passwords are hashed with a strong, slow hash (for example bcrypt or argon2). Never store or log plain text passwords.
- JWT access tokens are short-lived and carry the user id and role. The secret comes from the environment.
- Token storage and refresh strategy on the frontend (memory/httpOnly cookie vs localStorage) needs a decision — see Open Decisions.
- Role checks are implemented in the main backend (for example as Express middleware).
- Login identifier: mobile number + password is the **proposed** approach, not a confirmed decision. Whether email login is also supported is undecided.
- Mobile numbers are verified by an OTP sent over SMS. OTPs are stored hashed, expire, and have limited attempts.

### 7.3 REST API expectations
- **Route convention (confirmed):**
  - **All application routes** — authentication, users, reports, assignments, chat history, notifications and other business functionality — are under **`/api/v1`** (for example `/api/v1/reports`). They are added in `src/routes/v1/`.
  - **Operational endpoints** stay unversioned under `/api`: currently only the health endpoints (§7.5).
  - A future breaking change gets a new version prefix (`/api/v2`) instead of changing `/api/v1` behaviour.
- **Response format (implemented):** every JSON response uses one of two shapes (types in `src/types/api.ts`, helpers in `src/utils/apiResponse.ts`):
  - Success: `{ "success": true, "data": ... }`
  - Error: `{ "success": false, "error": { "code": "SOME_CODE", "message": "Safe, human-readable message" } }`
- **Errors (implemented):** throw `HttpError(status, code, message, { cause })` from handlers; the central error handler formats it. Unknown routes return 404 `NOT_FOUND`; invalid JSON 400 `INVALID_JSON`; JSON bodies over 100 KB 413 `PAYLOAD_TOO_LARGE`; anything unexpected 500 `INTERNAL_ERROR` with a generic message. Internal details and causes are logged on the server only. A `stack` field is included **only** for unexpected 5xx errors and **only** when `NODE_ENV=development`.
- Use JSON. Validate every request in the main backend (the validation library is to be agreed). Never return internal fields such as password hashes.
- Use correct HTTP status codes and a consistent error format.
- List endpoints support **pagination**, **sorting** and **filters**, including: location/area, severity, damage class, submission date range, report status, AI confidence range, assigned engineer, assignment status, location verification status, repair status, priority, possible duplicates, and unassigned only.
- Uploads use `multipart/form-data`.
- How the main backend's API is documented is to be agreed. The AI service's FastAPI docs cover only its inference endpoint(s).

### 7.4 WebSocket expectations
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
- Preflight `OPTIONS` requests are answered with 204; allowed methods `GET, HEAD, POST, PUT, PATCH, DELETE`; allowed request headers `Content-Type, Authorization`; preflight cache 600 s; `Access-Control-Allow-Credentials: true` (kept so httpOnly-cookie auth remains possible — JWT storage is still undecided, §14).
- Implemented in `src/middleware/cors.ts`, registered before the body parser and routes.

### 7.7 Environment variables (main backend)
Configured in `backend/api/.env` (never committed; template in `backend/api/.env.example`). Loaded by `src/config/env.ts` with Node's built-in `process.loadEnvFile()`; variables already set in the environment take precedence. Validated at startup: on any problem the server prints the list of problems (never the values) and exits with code 1.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | no | `development` | `development`, `production` or `test`. Stack traces in error responses only in `development`. |
| `PORT` | no | `3000` | 1–65535 |
| `DATABASE_URL` | **yes** | — | `postgresql://road_damage_user:PASSWORD@localhost:5432/road_damage_db?schema=public`. Special characters in the password must be URL-encoded. The placeholder `YOUR_PASSWORD` is rejected. |
| `CORS_ORIGIN` | in production | `http://localhost:5173` (non-production only) | Comma-separated allowed origins (§7.6). |

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
- The accuracy threshold for "poor" must be **configurable**. Its value is **TBD**; do not invent one.
- Note: browsers allow camera and geolocation only on **HTTPS or localhost**.

### EXIF verification (gallery uploads only)
- The EXIF comparison runs **only for gallery uploads**.
- Read EXIF GPS on the main backend from the **original** upload, before any image processing removes it.
- Compare EXIF coordinates with the manually selected location using the haversine (great-circle) distance.
- The tolerance is **configurable** (a few kilometres; the default value is to be agreed).
- Gallery outcomes: `verified` (distance ≤ tolerance), `mismatch` (distance > tolerance), `no_metadata` (no EXIF GPS in the image), `not_checked` (the location check has not been run yet).
- **Live-camera reports** get no EXIF comparison. Their status is `browser_gps` (location taken from browser GPS). They are never marked `no_metadata` just because browser camera images lack EXIF GPS.
- **Never automatically reject.** `mismatch` and `no_metadata` reports, and live-camera reports with poor GPS accuracy, are flagged for admin review.
- Remember that many apps and browsers strip EXIF data, so missing metadata is common and is not proof of fraud.

### Location privacy
- Photos and coordinates are personal data. Show only what each role needs.
- Consider removing EXIF from the copy shown to other users while keeping the extracted values in the database (to be decided).
- Never log exact coordinates or image contents unnecessarily.
- Never commit real user uploads or location data to Git.

---

## 9. SMS notifications

- **The provider is not selected yet.** Do not pick one without the owner's approval.
- Put SMS behind a **provider-agnostic interface** in the main backend's services layer (for example `send_sms(to, message)`). During development use a console/log implementation that does not send real SMS messages.
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
  | `npm test` | `node --import tsx --test "tests/**/*.test.ts"` — runs all tests (no real database needed) |
  | `npm run build` | `prisma generate && tsc` — generates the Prisma client and compiles to `dist/` |
  | `npm start` | `node dist/index.js` — runs the compiled build (production) |
  | `npm run prisma:generate` | regenerates the Prisma client (`src/generated/prisma/`) |
  | `npm run prisma:validate` / `npm run prisma:format` | validates / formats `prisma/schema.prisma` |
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
- Rate-limit login, OTP and report submission.
- Escape user-generated content (chat, notes). Never insert raw HTML.
- Do not include stack traces or internal details in API error responses.
- Use HTTPS in deployment.
- Apply the principle of least privilege to the PostgreSQL database user.
- How the AI service is protected from public access is an open decision (§14).

---

## 12. Testing expectations

- **Main backend:** tests currently use Node's built-in test runner (`node:test` + `node:assert`, run through `tsx`; no extra dependency) and `fetch` against the app started on a random port (`tests/helpers/testServer.ts`). Formal confirmation of the tool is still listed in §14. Unit tests for services (haversine/EXIF verification, assignment workload calculation, auth/role checks, and severity calculation if it lives here) and API tests. Use a separate PostgreSQL test database. Mock the AI service in main backend tests.
- **Current main backend tests** (`backend/api/tests/`): health endpoints (200, 503 without leaking details, no database use for `/api/health`), Helmet headers, CORS (allowed/disallowed origins, preflights, exact matching), error handling (404, invalid JSON, payload too large, hidden/visible stack, `HttpError`) and environment validation. They use fake dependencies and **do not need a database**.
- **AI service:** pytest is the *proposed* default (not yet confirmed). Mock the model in unit tests so they don't need `best.pt`. If inference integration tests exist, skip them clearly when the weights are missing.
- **Frontend:** the testing tool (for example Vitest + React Testing Library) is to be agreed.
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
- [ ] EXIF parsing library
- [ ] Storage approach for `best.pt` and datasets (Git LFS / cloud / manual)
- [ ] Default EXIF location tolerance (km)
- [ ] Browser GPS accuracy threshold for flagging live-camera reports (configurable; value TBD)
- [ ] Severity heuristic formula and thresholds
- [ ] Engineer workload/availability formula
- [ ] Priority definition (derived from severity? set manually by the admin?)
- [ ] Duplicate-report detection rule (distance + time window?)
- [ ] JWT storage and refresh strategy on the frontend
- [ ] How the first admin account is created
- [ ] Notification channel for admins and engineers (no in-app channel is confirmed)
- [ ] Login identifier (mobile number + password proposed; email support undecided)
- [ ] Whether Reject and Delay require a reason (proposed)
- [ ] Proposed convention to confirm: feature branches
- [ ] Frontend state management and testing tools; main backend testing tool (`node:test` currently in use — confirm); AI service testing tool (pytest proposed)
- [ ] Request validation library, WebSocket library and API documentation approach for the main backend
- [ ] How the main backend calls the AI service, and how the AI service is protected from public access
- [ ] Which service computes severity (main backend or AI service)
- [ ] Location storage in PostgreSQL (plain latitude/longitude columns or PostGIS)
- [ ] Prisma migration workflow
- [ ] PostgreSQL hosting/deployment (for example local install, Docker or a managed service)
- [ ] Python version and lint/format tooling
- [ ] Deployment target
