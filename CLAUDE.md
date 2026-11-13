# CLAUDE.md — Project Guide

**Project:** AI-Powered Road Infrastructure Damage Detection, Severity Assessment and Maintenance Management System
**Type:** Final Year Project (FYP)
**Status:** Setup stage. The folder structure and documentation exist; **no application features are implemented yet.**

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
| Main backend | Node.js + Express.js (TypeScript) |
| ORM | Prisma |
| Database | PostgreSQL |
| AI service | Python + FastAPI, YOLOv8 (Ultralytics) + PyTorch |
| Authentication | JWT |
| Charts | Recharts |
| Maps | OpenStreetMap tiles + Leaflet |
| Real-time chat | WebSockets (admin–engineer chat) |
| Notifications | SMS for citizens — **provider not selected yet** |

MongoDB is **not** part of this project. Do not add MongoDB or any MongoDB-related dependencies.

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
│   ├── api/                 Node.js + Express main backend
│   │   ├── src/             main backend source code
│   │   ├── prisma/          Prisma schema files
│   │   ├── storage/uploads/ runtime uploaded images (NOT in Git)
│   │   ├── tests/
│   │   └── package.json     (not created yet)
│   └── ai/                  Python + FastAPI AI inference service
│       ├── app/             FastAPI application source code
│       ├── weights/         best.pt (NOT in Git)
│       ├── tests/
│       └── requirements.txt (not created yet)
│
├── datasets/            dataset_notes.md only (data NOT in Git)
└── docs/                project documentation
```

> **Backend layout (approved):** `backend/api/` is the Node.js + Express main backend (Prisma, PostgreSQL access, uploads and business logic). `backend/ai/` is the Python + FastAPI AI inference service. `package.json` and `requirements.txt` will be created when each service is set up. The internal layout of `src/` and `app/` is still to be agreed. Do not restructure these folders without the owner's approval.

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
- *Proposed convention:* prefix with `/api/v1`.
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
- TypeScript compiler settings (for example strict mode) are to be agreed.
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
- Use a restrictive CORS policy: list allowed frontend origins explicitly.
- Validate uploads: type, size, random filename, no path traversal.
- Rate-limit login, OTP and report submission.
- Escape user-generated content (chat, notes). Never insert raw HTML.
- Do not include stack traces or internal details in API error responses.
- Use HTTPS in deployment.
- Apply the principle of least privilege to the PostgreSQL database user.
- How the AI service is protected from public access is an open decision (§14).

---

## 12. Testing expectations

- **Main backend:** the test tool is to be agreed. Unit tests for services (haversine/EXIF verification, assignment workload calculation, auth/role checks, and severity calculation if it lives here) and API tests. Use a separate PostgreSQL test database. Mock the AI service in main backend tests.
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
- [ ] Proposed conventions to confirm: `/api/v1` prefix, feature branches
- [ ] Frontend state management and testing tools; main backend testing tool; AI service testing tool (pytest proposed)
- [ ] Request validation library, WebSocket library and API documentation approach for the main backend
- [ ] How the main backend calls the AI service, and how the AI service is protected from public access
- [ ] Which service computes severity (main backend or AI service)
- [ ] Location storage in PostgreSQL (plain latitude/longitude columns or PostGIS)
- [ ] Prisma migration workflow
- [ ] PostgreSQL hosting/deployment (for example local install, Docker or a managed service)
- [ ] Python/Node versions and lint/format tooling
- [ ] Deployment target
