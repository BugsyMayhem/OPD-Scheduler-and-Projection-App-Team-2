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
    "stores": {},  # store_name -> {"df": DataFrame, "last_sync": str}
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
                
    # Default to first worksheet
    first_ws = worksheets[0]
    return first_ws, first_ws.title

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
        
        return {
            "status": "success",
            "active_store": active_store,
            "available_stores": db_cache["available_stores"],
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
        worksheets = [ws.title for ws in spreadsheet.worksheets()]
        db_cache["available_stores"] = worksheets
        return {"stores": worksheets}
    except Exception as e:
        return {"stores": db_cache.get("available_stores", [])}

@app.get("/api/sync")
def get_sync(store: Optional[str] = None):
    return sync_sheets(store)

@app.get("/api/associates")
def get_associates(store: Optional[str] = None):
    client = get_gspread_client()
    sheet_id = get_sheet_id()
    
    # Check if we need to sync this specific store
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
    
    if df.empty:
        return {
            "associates": [],
            "active_store": target_store,
            "available_stores": db_cache["available_stores"],
            "last_sync": last_sync,
            "sheet_id": sheet_id,
            "sheet_url": sheet_url
        }
    
    data = df.fillna("").reset_index().rename(columns={"index": "row_index"}).to_dict('records')
    return {
        "associates": data,
        "active_store": target_store,
        "available_stores": db_cache["available_stores"],
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
        
        # Sort associates alphabetically by Name, case-insensitive
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
            
        # Write array starting at A1 natively
        ws.update(values=row_data, range_name="A1")
        
        # Refresh cache for this store after write
        sync_sheets(active_store)
        return {"status": "success", "active_store": active_store}
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
        
    contents = await file.read()
    file_bytes = io.BytesIO(contents)
    
    try:
        if filename_lower.endswith(".csv") or filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls"):
            is_excel = filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls")
            roster_data, mismatches = process_csv(file_bytes, associates_df, is_excel=is_excel)
        else:
            roster_data, mismatches = process_pdf(file_bytes, associates_df)
            
        return {
            "roster": roster_data,
            "mismatches": mismatches,
            "active_store": target_store
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
