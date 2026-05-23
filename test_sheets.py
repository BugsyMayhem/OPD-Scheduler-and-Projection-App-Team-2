import gspread
from oauth2client.service_account import ServiceAccountCredentials
import os
from dotenv import load_dotenv

# Try loading from backend/.env first
backend_env = os.path.join(os.path.dirname(__file__), 'backend', '.env')
if os.path.exists(backend_env):
    load_dotenv(backend_env)
else:
    load_dotenv()

SCOPE = ["https://spreadsheets.google.com/feeds", 'https://www.googleapis.com/auth/spreadsheets',
         "https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive"]
SHEET_ID = os.getenv("SHEET_ID", '1C-b4TtOa_8XywfnVCchv03610wkeYj6dsxbx_ZOG50I')

def test_connection():
    try:
        creds_path = os.path.join(os.getcwd(), 'backend', 'credentials.json')
        print(f"Using creds at: {creds_path}")
        creds = ServiceAccountCredentials.from_json_keyfile_name(creds_path, SCOPE)
        client = gspread.authorize(creds)
        sheet = client.open_by_key(SHEET_ID).sheet1
        data = sheet.get_all_records()
        print(f"Successfully connected! Found {len(data)} records.")
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    test_connection()
