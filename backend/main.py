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
from parser import process_pdf, calculate_staggered_lunches
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

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
SHEET_ID = os.getenv("SHEET_ID", "1C-b4TtOa_8XywfnVCchv03610wkeYj6dsxbx_ZOG50I")

db_cache = {
    "associates_df": pd.DataFrame(),
    "last_sync": "Never"
}

def get_gspread_client():
    creds_filename = os.getenv("CREDENTIALS_PATH", "credentials.json")
    creds_path = os.path.join(os.path.dirname(__file__), creds_filename)
    if not os.path.exists(creds_path):
        raise FileNotFoundError(f"Missing {creds_path}. Please upload your Service Account JSON key.")
    creds = ServiceAccountCredentials.from_json_keyfile_name(creds_path, SCOPE)
    return gspread.authorize(creds)


def sync_sheets():
    try:
        client = get_gspread_client()
        sheet = client.open_by_key(SHEET_ID).sheet1
        data = sheet.get_all_records()
        
        df = pd.DataFrame(data)
        db_cache["associates_df"] = df
        db_cache["last_sync"] = pd.Timestamp.now().strftime("%Y-%m-%d %I:%M %p")
        return {"status": "success", "last_sync": db_cache["last_sync"]}
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
    if df.empty:
        return {"associates": [], "last_sync": db_cache["last_sync"]}
    
    # Send row index along with data so we know which row to update
    data = df.fillna("").reset_index().rename(columns={"index": "row_index"}).to_dict('records')
    return {"associates": data, "last_sync": db_cache["last_sync"]}

class AssociateBatchUpdate(BaseModel):
    associates: List[Dict[str, Any]]

@app.post("/api/associates/batch_update")
def batch_update_associates(payload: AssociateBatchUpdate):
    try:
        client = get_gspread_client()
        sheet = client.open_by_key(SHEET_ID).sheet1
        
        headers = sheet.row_values(1)
        if not headers:
            headers = ["Name", "Status", "Employment Type", "Minor Status", "Exclude", "Completed", "Role", "PPH"]
            
        if "PPH" not in headers:
            headers.append("PPH")
            
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
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")
        
    if db_cache["associates_df"].empty:
        sync_sheets()
        
    contents = await file.read()
    pdf_file = io.BytesIO(contents)
    
    try:
        roster_data, mismatches = process_pdf(pdf_file, db_cache["associates_df"])
        return {
            "roster": roster_data,
            "mismatches": mismatches
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF Processing failed: {str(e)}")

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
