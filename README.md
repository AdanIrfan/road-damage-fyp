# AI-Powered Road Infrastructure Damage Detection, Severity Assessment and Maintenance Management System

A Final Year Project web application that connects three groups:

- **Citizens**, who report road damage with photographs and location
- **Administrators**, who check reports and assign repair work
- **Maintenance engineers**, who carry out repairs and report their progress

A YOLOv8 model, already trained on the RDD2022 road damage dataset, will analyse each uploaded photograph. It returns the damage class, a confidence score and bounding boxes, which the system uses to make an initial severity estimate.

> **Project status:** Early setup. The repository contains the folder structure and documentation only. **No application features are implemented yet.** Everything under "Planned features" describes what will be built.

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
| Frontend | React + Vite |
| Styling | Tailwind CSS |
| Main backend | Node.js + Express.js |
| ORM | Prisma |
| Database | PostgreSQL |
| AI service | Python + FastAPI |
| AI model | YOLOv8 + PyTorch (existing `best.pt`, inference only) |
| Authentication | JWT |
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
├── frontend/          # React + Vite client
├── backend/
│   ├── api/           # Node.js + Express main backend
│   │   ├── src/       # Main backend source code
│   │   ├── prisma/    # Prisma schema files
│   │   ├── storage/uploads/  # Runtime uploads (not tracked in Git)
│   │   └── tests/
│   └── ai/            # Python + FastAPI AI inference service
│       ├── app/       # FastAPI application source code
│       ├── weights/   # Location of best.pt (not tracked in Git)
│       └── tests/
├── datasets/          # Dataset notes (data itself is not tracked in Git)
└── docs/              # Project documentation
```

`backend/api/package.json` and `backend/ai/requirements.txt` will be added when each service is set up.

## Model weights

The trained `best.pt` file is **not** in this repository. Its intended location is `backend/ai/weights/best.pt`. Weight files are excluded from Git, and how they will be stored and shared is still to be decided. See [`datasets/dataset_notes.md`](datasets/dataset_notes.md).

## Not yet decided

Some implementation details are still open, including:

- SMS provider
- How the main backend calls the AI service
- How locations are stored in PostgreSQL, the Prisma migration workflow, and database hosting
- JWT storage strategy on the frontend
- Severity, workload and duplicate-detection rules
- Testing tools and deployment target

The full list is in [`CLAUDE.md`](CLAUDE.md) (§14).

## Setup

Setup instructions will be added once the frontend, main backend and AI service are set up.
