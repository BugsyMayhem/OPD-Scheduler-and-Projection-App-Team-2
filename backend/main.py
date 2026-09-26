import re
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import pandas as pd
import io
import os
import json
from typing import List, Dict, Any, Optional
import gspread
from oauth2client.service_account import ServiceAccountCredentials
try:
    from parser import process_pdf, process_csv, calculate_staggered_lunches
except ImportError:
    from backend.parser import process_pdf, process_csv, calculate_staggered_lunches
from dotenv import load_dotenv

# Load environment variables
backend_env = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(backend_env):
    load_dotenv(backend_env, override=True)
load_dotenv(override=True)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Google Sheets setup
SCOPE = ["https://spreadsheets.google.com/feeds", 'https://www.googleapis.com/auth/spreadsheets',
         "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive"]

def get_sheet_id() -> str:
    return os.getenv("SHEET_ID", "1IwnNimOKM_COtfict4eHbeWjgsRXXN-e2m-DGn-ywH4")

db_cache = {
    "stores": {},          # store_name -> {"df": DataFrame, "last_sync": str}
    "support_stores": {},  # support_sheet_name -> {"df": DataFrame, "last_sync": str}
    "available_stores": [],
    "last_sync": "Never"
}

def get_gspread_client():
    # Try reading from environment variable first
    creds_json = os.getenv("GOOGLE_CREDENTIALS_JSON") or os.getenv("CREDENTIALS_JSON")
    if creds_json:
        creds_dict = json.loads(creds_json)
        creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, SCOPE)
        return gspread.authorize(creds)

    # Fallback to credentials.json file (check multiple locations including Render's Secret Files)
    creds_filename = os.getenv("CREDENTIALS_PATH", "credentials.json")
    candidate_paths = [
        os.path.join("/etc/secrets", os.path.basename(creds_filename)),
        "/etc/secrets/credentials.json",
        creds_filename,
        os.path.join(os.path.dirname(__file__), creds_filename),
        os.path.join(os.path.dirname(__file__), "..", creds_filename)
    ]
    
    for path in candidate_paths:
        if os.path.exists(path):
            creds = ServiceAccountCredentials.from_json_keyfile_name(path, SCOPE)
            return gspread.authorize(creds)
        
    raise FileNotFoundError(f"Missing Google Credentials file. Checked: {candidate_paths}")

def get_worksheet(client, sheet_id: str, store_name: Optional[str] = None):
    spreadsheet = client.open_by_key(sheet_id)
    worksheets = spreadsheet.worksheets()
    available = [ws.title for ws in worksheets]
    db_cache["available_stores"] = available
    
    if store_name:
        for ws in worksheets:
            if ws.title.strip().lower() == store_name.strip().lower():
                return ws, ws.title
        # Also try matching store number substring (e.g., "3324" -> "3324 OPD Roster")
        for ws in worksheets:
            if store_name.strip().lower() in ws.title.strip().lower():
                return ws, ws.title
                
    # Default to first non-support worksheet
    for ws in worksheets:
        if not ws.title.lower().endswith("store support"):
            return ws, ws.title
    first_ws = worksheets[0]
    return first_ws, first_ws.title

def get_support_sheet_name(opd_store_title: str) -> str:
    m = re.search(r'(\d+)', opd_store_title)
    if m:
        return f"{m.group(1)} Store Support"
    clean = re.sub(r'(?i)\bopd\s*roster\b', 'Store Support', opd_store_title).strip()
    if clean == opd_store_title:
        return f"{opd_store_title} Store Support"
    return clean

def get_support_worksheet(client, sheet_id: str, store_name: Optional[str] = None):
    spreadsheet = client.open_by_key(sheet_id)
    worksheets = spreadsheet.worksheets()
    
    # Identify active OPD store title first
    _, opd_title = get_worksheet(client, sheet_id, store_name)
    target_support_title = get_support_sheet_name(opd_title)
    
    for ws in worksheets:
        if ws.title.strip().lower() == target_support_title.strip().lower():
            return ws, ws.title
            
    # Match store number in worksheet title
    m = re.search(r'(\d+)', opd_title)
    if m:
        store_num = m.group(1)
        for ws in worksheets:
            if store_num in ws.title and "support" in ws.title.lower():
                return ws, ws.title
                
    # If not found, create new worksheet
    new_ws = spreadsheet.add_worksheet(title=target_support_title, rows=300, cols=10)
    new_ws.append_row(["Name", "User ID", "Job Name", "Store Support", "Minor Status", "Notes"])
    return new_ws, target_support_title

def sync_sheets(store_name: Optional[str] = None):
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        ws, active_store = get_worksheet(client, sheet_id, store_name)
        data = ws.get_all_records()
        
        df = pd.DataFrame(data)
        sync_time = pd.Timestamp.now().strftime("%Y-%m-%d %I:%M %p")
        db_cache["stores"][active_store] = {
            "df": df,
            "last_sync": sync_time
        }
        db_cache["last_sync"] = sync_time
        
        # Also sync Store Support sheet
        support_ws, support_title = get_support_worksheet(client, sheet_id, active_store)
        supp_data = support_ws.get_all_records()
        supp_df = pd.DataFrame(supp_data)
        db_cache["support_stores"][support_title] = {
            "df": supp_df,
            "last_sync": sync_time
        }
        
        available_rosters = [s for s in db_cache["available_stores"] if not s.lower().endswith("store support")]
        
        return {
            "status": "success",
            "active_store": active_store,
            "support_store": support_title,
            "available_stores": available_rosters,
            "last_sync": sync_time,
            "sheet_id": sheet_id,
            "sheet_url": f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
        }
    except Exception as e:
        print(f"Failed to sync sheets: {e}")
        return {"status": "error", "message": str(e)}

@app.on_event("startup")
def startup_event():
    sync_sheets()

@app.get("/api/stores")
def get_stores():
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        spreadsheet = client.open_by_key(sheet_id)
        worksheets = [ws.title for ws in spreadsheet.worksheets() if not ws.title.lower().endswith("store support")]
        db_cache["available_stores"] = worksheets
        return {"stores": worksheets}
    except Exception as e:
        return {"stores": [s for s in db_cache.get("available_stores", []) if not s.lower().endswith("store support")]}

@app.get("/api/sync")
def get_sync(store: Optional[str] = None):
    return sync_sheets(store)

@app.get("/api/associates")
def get_associates(store: Optional[str] = None):
    client = get_gspread_client()
    sheet_id = get_sheet_id()
    
    target_store = store
    if not target_store or target_store not in db_cache["stores"]:
        sync_res = sync_sheets(target_store)
        if sync_res.get("status") == "success":
            target_store = sync_res.get("active_store")
        elif not target_store and db_cache["stores"]:
            target_store = list(db_cache["stores"].keys())[0]

    store_entry = db_cache["stores"].get(target_store, {})
    df = store_entry.get("df", pd.DataFrame())
    last_sync = store_entry.get("last_sync", db_cache["last_sync"])
    sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    
    available_rosters = [s for s in db_cache["available_stores"] if not s.lower().endswith("store support")]

    if df.empty:
        return {
            "associates": [],
            "active_store": target_store,
            "available_stores": available_rosters,
            "last_sync": last_sync,
            "sheet_id": sheet_id,
            "sheet_url": sheet_url
        }
    
    data = df.fillna("").reset_index().rename(columns={"index": "row_index"}).to_dict('records')
    return {
        "associates": data,
        "active_store": target_store,
        "available_stores": available_rosters,
        "last_sync": last_sync,
        "sheet_id": sheet_id,
        "sheet_url": sheet_url
    }

class AssociateBatchUpdate(BaseModel):
    associates: List[Dict[str, Any]]
    store: Optional[str] = None

@app.post("/api/associates/batch_update")
def batch_update_associates(payload: AssociateBatchUpdate):
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        ws, active_store = get_worksheet(client, sheet_id, payload.store)
        
        headers = [h for h in ws.row_values(1) if h != "PPH"]
        if not headers:
            headers = ["Name", "User ID", "Status", "Employment Type", "Minor Status", "Exclude", "Completed", "Role"]
        elif "User ID" not in headers:
            if "Name" in headers:
                headers.insert(headers.index("Name") + 1, "User ID")
            else:
                headers.insert(1, "User ID")
            
        row_data = [headers]
        
        sorted_associates = sorted(
            payload.associates,
            key=lambda x: str(x.get("Name", "")).strip().lower()
        )

        for assoc in sorted_associates:
            row = []
            for h in headers:
                row.append(assoc.get(h, ""))
            row_data.append(row)
            
        ws.clear()
        if not row_data:
            row_data = [headers]
            
        ws.update(values=row_data, range_name="A1")
        sync_sheets(active_store)
        return {"status": "success", "active_store": active_store}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/support_associates")
def get_support_associates(store: Optional[str] = None):
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        
        _, active_store = get_worksheet(client, sheet_id, store)
        target_support_title = get_support_sheet_name(active_store)
        
        if target_support_title not in db_cache["support_stores"]:
            sync_sheets(store)
            
        support_entry = db_cache["support_stores"].get(target_support_title, {})
        df = support_entry.get("df", pd.DataFrame())
        last_sync = support_entry.get("last_sync", db_cache["last_sync"])
        sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
        
        if df.empty:
            return {
                "support_associates": [],
                "support_store": target_support_title,
                "last_sync": last_sync,
                "sheet_url": sheet_url
            }
            
        data = df.fillna("").reset_index().rename(columns={"index": "row_index"}).to_dict('records')
        return {
            "support_associates": data,
            "support_store": target_support_title,
            "last_sync": last_sync,
            "sheet_url": sheet_url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SupportBatchUpdate(BaseModel):
    associates: List[Dict[str, Any]]
    store: Optional[str] = None

@app.post("/api/support_associates/batch_update")
def batch_update_support_associates(payload: SupportBatchUpdate):
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        ws, support_title = get_support_worksheet(client, sheet_id, payload.store)
        
        headers = ws.row_values(1)
        if not headers or "Store Support" not in headers:
            headers = ["Name", "User ID", "Job Name", "Store Support", "Minor Status", "Notes"]
            
        row_data = [headers]
        sorted_associates = sorted(
            payload.associates,
            key=lambda x: str(x.get("Name", "")).strip().lower()
        )
        
        for assoc in sorted_associates:
            row = []
            for h in headers:
                row.append(assoc.get(h, ""))
            row_data.append(row)
            
        ws.clear()
        if not row_data:
            row_data = [headers]
            
        ws.update(values=row_data, range_name="A1")
        sync_sheets(payload.store)
        return {"status": "success", "support_store": support_title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SupportSyncCsv(BaseModel):
    store_associates: List[Dict[str, Any]]
    store: Optional[str] = None

@app.post("/api/support_associates/sync_from_csv")
def sync_support_from_csv(payload: SupportSyncCsv):
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        ws, support_title = get_support_worksheet(client, sheet_id, payload.store)
        
        existing_data = ws.get_all_records()
        headers = ws.row_values(1)
        if not headers or "Store Support" not in headers:
            headers = ["Name", "User ID", "Job Name", "Store Support", "Minor Status", "Notes"]
            
        existing_names = {str(r.get("Name", "")).strip().lower(): r for r in existing_data}
        existing_ids = {str(r.get("User ID", "")).strip().lower(): r for r in existing_data if str(r.get("User ID", "")).strip()}
        
        new_count = 0
        for s in payload.store_associates:
            s_name = str(s.get("Name", "")).strip()
            s_id = str(s.get("UserId", "") or s.get("User ID", "")).strip()
            s_job = str(s.get("JobName", "") or s.get("Job Name", "")).strip()
            
            if not s_name:
                continue
                
            if s_id and s_id.lower() in existing_ids:
                continue
            if s_name.lower() in existing_names:
                continue
                
            new_record = {
                "Name": s_name,
                "User ID": s_id,
                "Job Name": s_job,
                "Store Support": s.get("StoreSupport", "No"),
                "Minor Status": s.get("MinorStatus", "No"),
                "Notes": s.get("Notes", "")
            }
            existing_data.append(new_record)
            existing_names[s_name.lower()] = new_record
            if s_id:
                existing_ids[s_id.lower()] = new_record
            new_count += 1
            
        if new_count > 0:
            sorted_associates = sorted(
                existing_data,
                key=lambda x: str(x.get("Name", "")).strip().lower()
            )
            row_data = [headers]
            for assoc in sorted_associates:
                row = [assoc.get(h, "") for h in headers]
                row_data.append(row)
                
            ws.clear()
            ws.update(values=row_data, range_name="A1")
            sync_sheets(payload.store)
            
        return {"status": "success", "new_added": new_count, "total": len(existing_data), "support_store": support_title}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...), store: Optional[str] = None):
    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".pdf") or filename_lower.endswith(".csv") or filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls")):
        raise HTTPException(status_code=400, detail="File must be a PDF or CSV schedule")
        
    target_store = store
    if not target_store or target_store not in db_cache["stores"]:
        sync_res = sync_sheets(target_store)
        if sync_res.get("status") == "success":
            target_store = sync_res.get("active_store")
            
    store_entry = db_cache["stores"].get(target_store, {})
    associates_df = store_entry.get("df", pd.DataFrame())
    
    # Get support df for active store
    support_sheet_name = get_support_sheet_name(target_store)
    if support_sheet_name not in db_cache["support_stores"]:
        sync_sheets(target_store)
    support_entry = db_cache["support_stores"].get(support_sheet_name, {})
    support_df = support_entry.get("df", pd.DataFrame())
        
    contents = await file.read()
    file_bytes = io.BytesIO(contents)
    
    try:
        if filename_lower.endswith(".csv") or filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls"):
            is_excel = filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls")
            roster_data, opd_mismatches, store_mismatches, support_roster, store_associates = process_csv(file_bytes, associates_df, support_df, is_excel=is_excel)
        else:
            roster_data, opd_mismatches = process_pdf(file_bytes, associates_df)
            store_mismatches = []
            support_roster = []
            store_associates = []
            
        return {
            "roster": roster_data,
            "opd_mismatches": opd_mismatches,
            "store_mismatches": store_mismatches,
            "mismatches": opd_mismatches,
            "support_roster": support_roster,
            "store_associates": store_associates,
            "active_store": target_store,
            "support_store": support_sheet_name
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Schedule processing failed: {str(e)}")

class RosterPayload(BaseModel):
    roster: List[Dict[str, Any]]

@app.post("/api/calculate_lunches")
def calculate_lunches(payload: RosterPayload):
    try:
        updated_roster = calculate_staggered_lunches(payload.roster)
        return {"roster": updated_roster}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files (frontend)
app.mount("/", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static"), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8001))
    uvicorn.run(app, host="0.0.0.0", port=port)
