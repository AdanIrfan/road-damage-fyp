# AI-Powered Road Infrastructure Damage Detection, Severity Assessment and Maintenance Management System

A Final Year Project web application that connects three groups:

- **Citizens**, who report road damage with photographs and location
- **Administrators**, who check reports and assign repair work
- **Maintenance engineers**, who carry out repairs and report their progress

A YOLOv8 model, already trained on the RDD2022 road damage dataset, will analyse each uploaded photograph. It returns the damage class, a confidence score and bounding boxes, which the system uses to make an initial severity estimate.

> **Project status:** Phase 2 — **authentication and user management are implemented** (backend + frontend). Road-damage reporting, AI inference, report review, repair workflows, chat, maps and analytics are **not implemented yet**; they are listed under "Planned features". See [What works today](#what-works-today).

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
| Charts | Recharts |
| Maps | OpenStreetMap + Leaflet |
| Real-time communication | WebSockets (admin–engineer chat) |
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

> The exact way the main backend and the AI service communicate, and which service calculates severity, are **not decided yet**.

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

## Planned features

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

- A report moves to `under_review` only when an admin clicks **Review**.
- A `delayed` report stays delayed until an admin reviews it again.
- After an engineer marks the repair **Completed**, an admin confirms it, and only then does the report become `completed`.

The engineer's **repair status** (Pending, Working, Completed) is a separate field from the report status.

## Note on severity estimation

The first version estimates severity from detection information such as bounding-box size, number of detections and confidence. **This is a rough estimate, not a validated engineering measurement.** Administrators can review and correct it.

## Repository structure

```text
road-damage-fyp/
├── CLAUDE.md          # Project guide: requirements, rules and open decisions
├── README.md
├── frontend/          # React + Vite + Tailwind client (TypeScript)
│   └── src/           # features/ (auth, admin, ...), pages/, layouts/, routes/, lib/api.ts
├── backend/
│   ├── api/           # Node.js + Express main backend (TypeScript)
│   │   ├── src/       # routes → controllers → services → Prisma
│   │   ├── prisma/    # schema.prisma + migrations/
│   │   ├── storage/uploads/  # Runtime uploads (not tracked in Git)
│   │   └── tests/     # node:test suite
│   └── ai/            # Python + FastAPI AI inference service (not started yet)
│       ├── app/
│       ├── weights/   # Location of best.pt (not tracked in Git)
│       └── tests/
├── datasets/          # Dataset notes (data itself is not tracked in Git)
└── docs/              # Project documentation
```

`backend/ai/requirements.txt` will be added when the AI service is set up.

## Model weights

The trained `best.pt` file is **not** in this repository. Its intended location is `backend/ai/weights/best.pt`. Weight files are excluded from Git, and how they will be stored and shared is still to be decided. See [`datasets/dataset_notes.md`](datasets/dataset_notes.md).

## Not yet decided

Some implementation details are still open, including:

- SMS provider (required before production use)
- How the main backend calls the AI service
- How locations are stored in PostgreSQL, and database hosting
- Severity, workload and duplicate-detection rules
- Frontend testing tool and deployment target

The full list is in [`CLAUDE.md`](CLAUDE.md) (§14).

## Local development setup

### Prerequisites
- **Node.js 24** and npm
- **PostgreSQL 18** with a database and a dedicated user (this project uses `road_damage_db` and `road_damage_user`). The user does not need permission to create databases.

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
- `SMS_PROVIDER=mock` — development only; verification codes appear in the backend console.

Never commit `.env`. See `backend/api/.env.example` for all options (CORS origins, default phone country, cookie SameSite).

### 2. Frontend (`frontend`)
```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173 (proxies /api to the backend)
```

Open http://localhost:5173, register as a citizen, read the 6-digit code from the backend console, verify, and log in. Log in with the admin account to manage engineers.

### Checks
```bash
cd backend/api && npm run typecheck && npm test && npm run build
cd frontend && npm run build
```
Backend database tests use a separate `app_test` schema in the same database and never touch your real tables.

### Health endpoints
- http://localhost:3000/api/health — API is running
- http://localhost:3000/api/health/db — PostgreSQL is reachable
