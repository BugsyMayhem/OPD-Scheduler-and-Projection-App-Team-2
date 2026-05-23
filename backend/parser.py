import pdfplumber
import pandas as pd
import re
from datetime import datetime, timedelta

def parse_time(time_str):
    if not time_str: return None
    time_str = time_str.strip().lower().replace(" ", "")
    for fmt in ("%I:%M%p", "%I%p", "%I:%M"):
        try: return datetime.strptime(time_str, fmt)
        except ValueError: continue
    return None

def process_pdf(pdf_bytes, df_associates):
    # df_associates columns: Name, Role, Employment Type, Minor Status, Exclude, Completed
    data, mismatches = [], []
    t_regex = r"(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))"
    
    # Pre-process the associates list
    active_associates = df_associates[df_associates['Exclude'].astype(str).str.lower() != 'yes']
    excluded_names = df_associates[df_associates['Exclude'].astype(str).str.lower() == 'yes']['Name'].dropna().str.lower().tolist()
    
    v_list = []
    for _, row in active_associates.iterrows():
        name = str(row['Name']).strip()
        if name and name.lower() != 'nan':
            # Minor Status is 'Yes' or 'No'
            is_minor = str(row['Minor Status']).strip().lower() == 'yes'
            search_name = name.lower()
            
            # Extract basic role mapping from Google Sheet or default to Pickers
            sheet_role = str(row['Role']).strip()
            if "picker" in sheet_role.lower():
                assigned_role = "Pickers"
            elif "backroom" in sheet_role.lower() or "dispense" in sheet_role.lower():
                assigned_role = "Backroom"
            elif "exception" in sheet_role.lower():
                assigned_role = "Exceptions"
            else:
                assigned_role = "Pickers"  # Default
                
            v_list.append({
                "search": search_name, 
                "raw": name,
                "is_minor": is_minor,
                "role": assigned_role
            })
            
    with pdfplumber.open(pdf_bytes) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text: continue
            for line in text.split('\n'):
                m = re.search(t_regex, line.strip(), re.IGNORECASE)
                if m:
                    line_lower = line.lower()
                    if any(ex in line_lower for ex in excluded_names):
                        continue
                        
                    match_entry = None
                    for entry in v_list:
                        if entry["search"] in line_lower:
                            match_entry = entry
                            break 
                            
                    if match_entry:
                        st_dt, en_dt = parse_time(m.group(1)), parse_time(m.group(2))
                        if st_dt and en_dt:
                            real_end = en_dt + timedelta(days=1) if en_dt < st_dt else en_dt
                            parts = match_entry["raw"].title().split()
                            fmt = f"{parts[0]} {parts[1][0]}.".strip() if len(parts) > 1 else parts[0]
                            match_name = f"(M) {fmt}" if match_entry["is_minor"] else fmt
                            
                            data.append({
                                "Associate": match_name, 
                                "Role": match_entry["role"], 
                                "Shift": f"{m.group(1)} - {m.group(2)}", 
                                "Lunch Time": "Pending...", 
                                "StartDt": st_dt.isoformat(), 
                                "EndDt": real_end.isoformat(), 
                                "Duration": (real_end - st_dt).total_seconds() / 3600
                            })
                    else:
                        st_dt, en_dt = parse_time(m.group(1)), parse_time(m.group(2))
                        pot = line.split(m.group(1))[0].strip()
                        if len(pot) > 2 and st_dt and en_dt:
                            real_end = en_dt + timedelta(days=1) if en_dt < st_dt else en_dt
                            parts = pot.title().split()
                            fmt = f"{parts[0]} {parts[1][0]}.".strip() if len(parts) > 1 else parts[0]
                            
                            data.append({
                                "Associate": fmt, 
                                "Role": "Pickers", 
                                "Shift": f"{m.group(1)} - {m.group(2)}", 
                                "Lunch Time": "Pending...", 
                                "StartDt": st_dt.isoformat(), 
                                "EndDt": real_end.isoformat(), 
                                "Duration": (real_end - st_dt).total_seconds() / 3600
                            })
                            mismatches.append(pot)
    return data, list(set(mismatches))

def calculate_staggered_lunches(roster_data):
    if not roster_data: return roster_data
    df = pd.DataFrame(roster_data)
    df['StartDt'] = pd.to_datetime(df['StartDt'], format='mixed', utc=True).dt.tz_localize(None)
    df['EndDt'] = pd.to_datetime(df['EndDt'], format='mixed', utc=True).dt.tz_localize(None)
    final_records = []
    active_roles = ["Pickers", "Picker", "Backroom", "Exceptions"]
    
    # Process excluded first to maintain them
    if "Exclude" in df['Role'].values:
        ex_group = df[df['Role'] == "Exclude"].to_dict('records')
        for item in ex_group:
            item['Lunch Time'] = "N/A"
            item['StartDt'] = item['StartDt'].isoformat()
            item['EndDt'] = item['EndDt'].isoformat()
            final_records.append(item)
        
    for role in active_roles:
        if role not in df['Role'].values:
            continue
            
        role_df = df[df['Role'] == role]
            
        role_group = role_df.sort_values(by='StartDt').copy()
        taken_slots = []
        for _, row in role_group.iterrows():
            try:
                duration_val = float(row.get('Duration', 0))
            except (ValueError, TypeError):
                duration_val = 0
                
            if pd.isna(row['StartDt']) or pd.isna(row['EndDt']) or duration_val < 6:
                row['Lunch Time'] = "N/A"
                row_dict = row.to_dict()
                row_dict['StartDt'] = row_dict['StartDt'].isoformat() if hasattr(row_dict['StartDt'], 'isoformat') else str(row_dict['StartDt'])
                row_dict['EndDt'] = row_dict['EndDt'].isoformat() if hasattr(row_dict['EndDt'], 'isoformat') else str(row_dict['EndDt'])
                final_records.append(row_dict)
                continue
                
            is_10_hour = duration_val >= 10
            shift_offset = 5 if is_10_hour else 4
            early_offset = shift_offset - 1
            late_offset = shift_offset + 1
            
            target = row['StartDt'] + timedelta(hours=shift_offset)
            early = row['StartDt'] + timedelta(hours=early_offset)
            late = row['StartDt'] + timedelta(hours=late_offset)
            latest_start_allowed = row['EndDt'] - timedelta(hours=2)
            safe_limit = min(late, latest_start_allowed)
            curr, found = target, False
            
            while curr <= safe_limit:
                if not any(abs((curr - t).total_seconds()) < 1800 for t in taken_slots):
                    found = True; break
                curr += timedelta(minutes=30)
                
            if not found:
                curr = target - timedelta(minutes=30)
                while curr >= early:
                    if curr <= latest_start_allowed:
                        if not any(abs((curr - t).total_seconds()) < 1800 for t in taken_slots):
                            found = True; break
                    curr -= timedelta(minutes=30)
                    
            if found:
                row['Lunch Time'] = curr.strftime("%I:%M %p").lstrip("0")
                taken_slots.append(curr)
            else:
                row['Lunch Time'] = "No Slot Avail"
            
            row_dict = row.to_dict()
            row_dict['StartDt'] = row_dict['StartDt'].isoformat() if hasattr(row_dict['StartDt'], 'isoformat') else str(row_dict['StartDt'])
            row_dict['EndDt'] = row_dict['EndDt'].isoformat() if hasattr(row_dict['EndDt'], 'isoformat') else str(row_dict['EndDt'])
            final_records.append(row_dict)
            
    return final_records
