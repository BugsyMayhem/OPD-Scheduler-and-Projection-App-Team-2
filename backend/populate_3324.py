import pandas as pd
from backend.main import get_gspread_client, get_sheet_id

def setup_3324_tab():
    client = get_gspread_client()
    sheet = client.open_by_key(get_sheet_id())

    df = pd.read_csv('3324 roster.csv')
    valid_rows = df[df['Column1'].notna() & (df['Column1'].str.strip() != '')]

    headers = ['Name', 'User ID', 'Status', 'Employment Type', 'Minor Status', 'Exclude', 'Completed', 'Role', 'Shift Hours']

    rows = [headers]
    for idx, row in valid_rows.iterrows():
        name = str(row['Column1']).strip().title()
        uid = str(row['Column2']).strip() if pd.notna(row['Column2']) else ''
        notes = str(row['Column4']).strip() if pd.notna(row['Column4']) else ''
        
        is_exclude = 'Yes' if ('loa' in notes.lower() or 'notice' in notes.lower()) else 'No'
        
        rows.append([
            name,
            uid,
            'Associate',
            'Full-Time',
            'No',
            is_exclude,
            'No',
            '',
            ''
        ])

    tab_title = '3324 OPD Roster'
    existing_worksheets = [ws.title for ws in sheet.worksheets()]
    if tab_title in existing_worksheets:
        ws = sheet.worksheet(tab_title)
        ws.clear()
    else:
        ws = sheet.add_worksheet(title=tab_title, rows=len(rows)+10, cols=len(headers)+2)

    ws.update(values=rows, range_name='A1')
    print(f'Successfully created/updated tab "{tab_title}" with {len(rows)-1} associates!')

if __name__ == '__main__':
    setup_3324_tab()
