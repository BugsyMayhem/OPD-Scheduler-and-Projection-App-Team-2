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

# Google Sheets setup
SCOPE = ["https://spreadsheets.google.com/feeds", 'https://www.googleapis.com/auth/spreadsheets',
         "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive"]

def get_sheet_id() -> str:
    return os.getenv("SHEET_ID", "1IwnNimOKM_COtfict4eHbeWjgsRXXN-e2m-DGn-ywH4")

db_cache = {
    "associates_df": pd.DataFrame(),
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


def sync_sheets():
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        sheet = client.open_by_key(sheet_id).sheet1
        data = sheet.get_all_records()
        
        df = pd.DataFrame(data)
        db_cache["associates_df"] = df
        db_cache["last_sync"] = pd.Timestamp.now().strftime("%Y-%m-%d %I:%M %p")
        return {
            "status": "success",
            "last_sync": db_cache["last_sync"],
            "sheet_id": sheet_id,
            "sheet_url": f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
        }
    except Exception as e:
        print(f"Failed to sync sheets: {e}")
        return {"status": "error", "message": str(e)}

@app.on_event("startup")
def startup_event():
    sync_sheets()

@app.get("/api/sync")
def get_sync():
    return sync_sheets()

@app.get("/api/associates")
def get_associates():
    if db_cache["associates_df"].empty:
        sync_sheets()
    df = db_cache["associates_df"]
    sheet_id = get_sheet_id()
    sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit"
    if df.empty:
        return {"associates": [], "last_sync": db_cache["last_sync"], "sheet_id": sheet_id, "sheet_url": sheet_url}
    
    # Send row index along with data so we know which row to update
    data = df.fillna("").reset_index().rename(columns={"index": "row_index"}).to_dict('records')
    return {"associates": data, "last_sync": db_cache["last_sync"], "sheet_id": sheet_id, "sheet_url": sheet_url}

class AssociateBatchUpdate(BaseModel):
    associates: List[Dict[str, Any]]

@app.post("/api/associates/batch_update")
def batch_update_associates(payload: AssociateBatchUpdate):
    try:
        client = get_gspread_client()
        sheet_id = get_sheet_id()
        sheet = client.open_by_key(sheet_id).sheet1
        
        headers = [h for h in sheet.row_values(1) if h != "PPH"]
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
            
        sheet.clear()
        if not row_data:
            row_data = [headers]
            
        # Write array starting at A1 natively
        sheet.update(values=row_data, range_name="A1")
        
        # Refresh cache after write
        sync_sheets()
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    filename_lower = file.filename.lower()
    if not (filename_lower.endswith(".pdf") or filename_lower.endswith(".csv") or filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls")):
        raise HTTPException(status_code=400, detail="File must be a PDF or CSV schedule")
        
    if db_cache["associates_df"].empty:
        sync_sheets()
        
    contents = await file.read()
    file_bytes = io.BytesIO(contents)
    
    try:
        if filename_lower.endswith(".csv") or filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls"):
            is_excel = filename_lower.endswith(".xlsx") or filename_lower.endswith(".xls")
            roster_data, mismatches = process_csv(file_bytes, db_cache["associates_df"], is_excel=is_excel)
        else:
            roster_data, mismatches = process_pdf(file_bytes, db_cache["associates_df"])
            
        return {
            "roster": roster_data,
            "mismatches": mismatches
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
