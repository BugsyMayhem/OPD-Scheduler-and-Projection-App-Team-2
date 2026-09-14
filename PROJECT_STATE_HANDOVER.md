# OPD Scheduler and Projection App - Project State & Handover

**Last Updated:** September 14, 2026
**Repository:** `BugsyMayhem/OPD-Scheduler-and-Projection-App-Team-2`
**Branch:** `main` (clean working tree, synced with origin)

---

## 1. Project Overview & Architecture

This application is an **Online Pickup & Delivery (OPD) Daily Roster & Scheduling tool** (Team 2 edition) designed for store associate management:
- Uploads daily shift schedules (CSV / legacy PDF exports).
- Cross-references shifts against a Google Sheets associate database (tracking roles, minor status, PPH, and exclusions).
- Automatically calculates staggered 15-minute first/second breaks and 1-hour lunch breaks while enforcing:
  - Role-based coverage constraints (Pickers, Backroom, Exceptions, IP/GMD).
  - Strict Minor labor law compliance (first break at ~2 hrs, mandatory lunch before 4.5/5 hours).
  - Overlap prevention across departments.
- Provides real-time hourly coverage projections and generates a formatted PDF export via jsPDF / autoTable.

### Architecture Stack
- **Backend**: Python 3.10+ with `FastAPI`, `uvicorn`, `pandas`, `pdfplumber`, `gspread`, `oauth2client`.
  - Runs on port `8002` (configurable via `.env`).
  - Google Sheets API integration via `credentials.json` (or `GOOGLE_CREDENTIALS_JSON` environment variable for cloud hosting like Render).
- **Frontend**: Vanilla JavaScript (`script.js`), HTML5 (`index.html`), and custom CSS (`styles.css`) using FontAwesome 6 and Outfit typography.
  - Mirrored in both `frontend/` (standalone static files) and `backend/static/` (served directly by FastAPI at `/`).

---

## 2. Recent Development History & Commits

| Commit | Summary | Key Changes |
|---|---|---|
| `2aec794` | **Fix break overlaps, ensure full name & user ID on quick add, and prevent static asset caching** | - Fixed lunch & 15-min break conflicts in schedule calculations.<br>- Prevented duplicate/overlapping break assignments.<br>- Enhanced quick-add functionality so user ID and full name populate correctly into Google Sheets.<br>- Added `Cache-Control: no-cache` middleware in FastAPI to stop browser caching of static JS/CSS assets. |
| `8ee7965` | **Update roster scheduler: CSV upload, 15-min breaks, IP/GMD role, search, dynamic styling** | - Replaced strict PDF-only input with robust CSV schedule parser.<br>- Added automated First Break (`Break 1`) and Second Break (`Break 2`) tracking alongside `Lunch Time`.<br>- Introduced `IP/GMD` role badge and coverage bucket.<br>- Added database search/filter input on Associate Database tab.<br>- Implemented warning color highlights for break/lunch overlaps. |
| `5e55235` | **Render Secret Files support** | Added `/etc/secrets/credentials.json` fallback path resolution for Render cloud deployment. |
| `ed9fb0d` | **Module imports & JSON env creds** | Support raw `GOOGLE_CREDENTIALS_JSON` string in environment variables for zero-file deployments. |
| `63fdaab` | **Static path resolution** | Fixed `backend/static` relative file path resolution. |

---

## 3. Environment & Configuration

### File Locations
- **Backend code**: `backend/main.py`
- **Schedule parsing & break algorithm**: `backend/parser.py`
- **Static frontend (served by backend)**: `backend/static/` (`index.html`, `script.js`, `styles.css`)
- **Root frontend**: `frontend/` (`index.html`, `script.js`, `styles.css`) *(Note: remember to keep `frontend/` and `backend/static/` synced when making frontend changes)*

### Environment Variables (`backend/.env`)
```env
PORT=8002
SHEET_ID=1IwnNimOKM_COtfict4eHbeWjgsRXXN-e2m-DGn-ywH4
CREDENTIALS_PATH=credentials.json
```

> **Google Service Account Credentials**:
> The `credentials.json` file is present in `backend/credentials.json` locally and is excluded from git via `.gitignore`. If setting up a new machine, ensure `credentials.json` is placed in `backend/` or set `GOOGLE_CREDENTIALS_JSON` in your environment.

---

## 4. How to Run Locally on Your Desktop

### 1. Prerequisites
- Python 3.10+ installed and on PATH
- Git

### 2. Setup Virtual Environment
```powershell
cd "d:\Projects\Antigravity\OPD Scheduler and Projection App - Team 2"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

### 3. Ensure Credentials Exist
Make sure `backend\credentials.json` exists or set the environment variable:
```powershell
$env:GOOGLE_CREDENTIALS_JSON = Get-Content -Raw backend\credentials.json
```

### 4. Start the Application
```powershell
python backend\main.py
```
Or with uvicorn:
```powershell
uvicorn backend.main:app --host 0.0.0.0 --port 8002 --reload
```
Navigate in your browser to: `http://localhost:8002`

---

## 5. Current State & Known Behaviors

1. **Working Features**:
   - **Upload Schedule**: Reads exported daily CSV schedule files seamlessly.
   - **Sync with Google Sheets**: Pulls associates list and syncs updates/edits back to Google Sheets.
   - **Quick Add**: Flags associates found in the CSV schedule that aren't yet in Google Sheets, allowing 1-click addition with automatic role guessing.
   - **Role Filtering & Manual Add**: Allows quick role switching (`Pickers`, `Backroom`, `Exceptions`, `IP/GMD`, `Exclude`) and custom shift addition.
   - **Staggered Lunches & 15-Min Breaks**: Calculates optimal break windows so coverage never drops below required thresholds.
   - **Visual Warnings**: Conflicting break slots or capacity bottlenecks turn pink/red in the table.
   - **Hourly Coverage Tab**: Real-time breakdown of staffing across hours (Pickers, Backroom, Exceptions, IP/GMD).
   - **PDF Generation**: Direct export to a clean print-ready roster PDF.

2. **File Synchronization Note**:
   - Both `backend/static/` and `frontend/` exist in this repository. The FastAPI server serves files from `backend/static/`. Always verify changes are updated in `backend/static/` (or copied across both) when editing UI or client-side scripts.
