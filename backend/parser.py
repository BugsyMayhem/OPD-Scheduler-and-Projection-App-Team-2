import pdfplumber
import pandas as pd
import re
from datetime import datetime, timedelta

def parse_time(time_str):
    if not time_str or pd.isna(time_str): return None
    time_str = str(time_str).strip()
    if not time_str or time_str.lower() in ("off", "n/a", "nan", "none", "-", "unassigned"):
        return None
    cleaned = re.sub(r'\s+', ' ', time_str).strip()
    
    formats = [
        "%I:%M:%S %p", "%I:%M %p", "%I:%M%p", "%I%p",
        "%H:%M:%S", "%H:%M",
        "%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y %H:%M",
        "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %I:%M %p", "%Y-%m-%d %H:%M"
    ]
    for fmt in formats:
        try: 
            dt = datetime.strptime(cleaned, fmt)
            return datetime(1900, 1, 1, dt.hour, dt.minute)
        except ValueError: 
            continue
            
    m = re.search(r'(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?', cleaned, re.IGNORECASE)
    if m:
        hr = int(m.group(1))
        mn = int(m.group(2)) if m.group(2) else 0
        ampm = m.group(4).lower() if m.group(4) else None
        if ampm == 'pm' and hr < 12:
            hr += 12
        elif ampm == 'am' and hr == 12:
            hr = 0
        if 0 <= hr <= 23 and 0 <= mn <= 59:
            return datetime(1900, 1, 1, hr, mn)
    return None

def normalize_name_for_match(name_str):
    if not name_str or pd.isna(name_str):
        return ""
    s = str(name_str).strip()
    # Handle "Last, First" -> "First Last"
    if "," in s:
        parts = s.split(",", 1)
        s = f"{parts[1].strip()} {parts[0].strip()}"
    # Remove special chars and extra spaces
    s = re.sub(r'[^a-zA-Z\s]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip().lower()

def format_display_name(raw_name, is_minor=False):
    s = str(raw_name).strip()
    if "," in s:
        parts = s.split(",", 1)
        s = f"{parts[1].strip()} {parts[0].strip()}"
    tokens = [t for t in re.sub(r'[^a-zA-Z\s]', ' ', s).split() if t]
    if not tokens:
        return raw_name
    fmt = " ".join([t.title() for t in tokens])
    return f"(M) {fmt}" if is_minor else fmt

def build_associates_lookup(df_associates):
    active_associates = df_associates[df_associates['Exclude'].astype(str).str.lower() != 'yes']
    excluded_names = df_associates[df_associates['Exclude'].astype(str).str.lower() == 'yes']['Name'].dropna().tolist()
    excluded_normalized = [normalize_name_for_match(n) for n in excluded_names if n]

    v_list = []
    for _, row in active_associates.iterrows():
        name = str(row['Name']).strip()
        if name and name.lower() != 'nan':
            is_minor = str(row.get('Minor Status', '')).strip().lower() == 'yes'
            norm_name = normalize_name_for_match(name)
            name_tokens = set(norm_name.split())
            
            sheet_role = str(row.get('Role', '')).strip()
            if "picker" in sheet_role.lower():
                assigned_role = "Pickers"
            elif "backroom" in sheet_role.lower() or "dispense" in sheet_role.lower():
                assigned_role = "Backroom"
            elif "exception" in sheet_role.lower():
                assigned_role = "Exceptions"
            elif "ip" in sheet_role.lower() or "gmd" in sheet_role.lower() or "in home" in sheet_role.lower() or "delivery" in sheet_role.lower():
                assigned_role = "IP/GMD"
            else:
                assigned_role = "Pickers"
                
            v_list.append({
                "norm_name": norm_name,
                "tokens": name_tokens,
                "raw": name,
                "is_minor": is_minor,
                "role": assigned_role
            })
    return v_list, excluded_normalized

def match_associate(target_raw, v_list, excluded_normalized):
    target_norm = normalize_name_for_match(target_raw)
    if not target_norm:
        return None, False
        
    for ex in excluded_normalized:
        if ex and (ex == target_norm or ex in target_norm or target_norm in ex):
            return None, True  # Excluded

    # Exact normalized match
    for entry in v_list:
        if entry["norm_name"] == target_norm:
            return entry, False
            
    # Substring match
    for entry in v_list:
        if entry["norm_name"] in target_norm or target_norm in entry["norm_name"]:
            return entry, False

    # Token overlap match (e.g. first and last name match even if middle name exists)
    target_tokens = set(target_norm.split())
    if len(target_tokens) >= 2:
        for entry in v_list:
            if len(entry["tokens"]) >= 2 and entry["tokens"].issubset(target_tokens):
                return entry, False
            if len(entry["tokens"]) >= 2 and target_tokens.issubset(entry["tokens"]):
                return entry, False

    return None, False

def parse_shift_times(shift_str, start_val=None, end_val=None):
    t_regex = r"(\d{1,2}(?::\d{2})?(?::\d{2})?\s*(?:am|pm)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?(?::\d{2})?\s*(?:am|pm)?)"
    
    st_dt, en_dt = None, None
    shift_label = ""
    
    if start_val is not None and end_val is not None and not (pd.isna(start_val) and pd.isna(end_val)):
        st_dt = parse_time(str(start_val))
        en_dt = parse_time(str(end_val))
        if st_dt and en_dt:
            shift_label = f"{st_dt.strftime('%I:%M %p').lstrip('0')} - {en_dt.strftime('%I:%M %p').lstrip('0')}"
            
    if (not st_dt or not en_dt) and shift_str and not pd.isna(shift_str):
        s = str(shift_str).strip()
        m = re.search(t_regex, s, re.IGNORECASE)
        if m:
            st_dt = parse_time(m.group(1))
            en_dt = parse_time(m.group(2))
            if st_dt and en_dt:
                shift_label = f"{st_dt.strftime('%I:%M %p').lstrip('0')} - {en_dt.strftime('%I:%M %p').lstrip('0')}"
                
    if st_dt and en_dt:
        real_end = en_dt + timedelta(days=1) if en_dt < st_dt else en_dt
        duration = (real_end - st_dt).total_seconds() / 3600
        return {
            "shift_label": shift_label,
            "st_dt": st_dt,
            "end_dt": real_end,
            "duration": duration
        }
    return None

def process_csv(file_bytes_or_buffer, df_associates, is_excel=False):
    v_list, excluded_normalized = build_associates_lookup(df_associates)
    data, mismatches = [], []

    if is_excel:
        df = pd.read_excel(file_bytes_or_buffer)
    else:
        # Read CSV with encoding fallback
        try:
            df = pd.read_csv(file_bytes_or_buffer, encoding='utf-8')
        except UnicodeDecodeError:
            if hasattr(file_bytes_or_buffer, 'seek'):
                file_bytes_or_buffer.seek(0)
            df = pd.read_csv(file_bytes_or_buffer, encoding='latin1')

    if df.empty:
        return data, mismatches

    # Clean headers
    df.columns = [str(c).strip() for c in df.columns]
    col_map = {c.lower().replace(" ", "").replace("_", "").replace("-", ""): c for c in df.columns}

    # Find Name column
    name_col = None
    for alias in ["name", "associatename", "associate", "employeename", "employee", "worker", "person", "full_name", "fullname"]:
        if alias in col_map:
            name_col = col_map[alias]
            break
    if not name_col:
        # Check first column with text
        for col in df.columns:
            if df[col].dtype == object or df[col].dtype == 'string':
                name_col = col
                break
        if not name_col:
            name_col = df.columns[0]

    # Find Start/End columns or Shift column
    start_col = None
    end_col = None
    shift_col = None
    role_col = None

    for alias in ["shift", "schedule", "scheduledshift", "hours", "scheduledhours", "time", "shifttime"]:
        if alias in col_map:
            shift_col = col_map[alias]
            break
            
    for alias in ["start", "starttime", "in", "intime", "shiftstart", "begin"]:
        if alias in col_map:
            start_col = col_map[alias]
            break

    for alias in ["end", "endtime", "out", "outtime", "shiftend", "finish"]:
        if alias in col_map:
            end_col = col_map[alias]
            break

    for alias in ["role", "job", "jobcode", "jobdescription", "dept", "department", "position", "title"]:
        if alias in col_map:
            role_col = col_map[alias]
            break

    user_id_col = None
    for alias in ["associateuserid", "userid", "user_id", "win", "id", "win_id", "associate_id"]:
        if alias in col_map:
            user_id_col = col_map[alias]
            break

    for _, row in df.iterrows():
        raw_name = str(row.get(name_col, '')).strip()
        if not raw_name or raw_name.lower() in ("nan", "none", "total", "summary", "off"):
            continue

        shift_val = row.get(shift_col) if shift_col else None
        start_val = row.get(start_col) if start_col else None
        end_val = row.get(end_col) if end_col else None

        parsed_shift = parse_shift_times(shift_val, start_val, end_val)
        if not parsed_shift:
            # Fallback: scan all cells in row for a time or shift pattern
            for val in row.values:
                parsed_shift = parse_shift_times(val)
                if parsed_shift:
                    break

        if not parsed_shift:
            continue

        match_entry, is_excluded = match_associate(raw_name, v_list, excluded_normalized)
        if is_excluded:
            continue

        user_id_val = str(row.get(user_id_col, '')).strip() if user_id_col else ""
        if user_id_val and user_id_val.lower() in ("nan", "none", "-", ""):
            user_id_val = ""

        if match_entry:
            best_name = raw_name if (len(raw_name) > len(match_entry["raw"]) and len(raw_name.split()) >= len(match_entry["raw"].split())) else match_entry["raw"]
            disp_name = format_display_name(best_name, match_entry["is_minor"])
            assigned_role = match_entry["role"]
        else:
            disp_name = format_display_name(raw_name, is_minor=False)
            csv_role = str(row.get(role_col, '')).strip().lower() if role_col else ""
            if "picker" in csv_role:
                assigned_role = "Pickers"
            elif "backroom" in csv_role or "dispense" in csv_role:
                assigned_role = "Backroom"
            elif "exception" in csv_role:
                assigned_role = "Exceptions"
            elif "ip" in csv_role or "gmd" in csv_role or "in home" in csv_role or "delivery" in csv_role:
                assigned_role = "IP/GMD"
            else:
                assigned_role = "Pickers"
            mismatches.append({
                "name": disp_name,
                "user_id": user_id_val,
                "role": assigned_role
            })

        if user_id_val:
            disp_name = f"{disp_name} ({user_id_val})"

        data.append({
            "Associate": disp_name,
            "Role": assigned_role,
            "Shift": parsed_shift["shift_label"],
            "Break 1": "Pending...",
            "Lunch Time": "Pending...",
            "Break 2": "Pending...",
            "StartDt": parsed_shift["st_dt"].isoformat(),
            "EndDt": parsed_shift["end_dt"].isoformat(),
            "Duration": parsed_shift["duration"]
        })

    seen_mismatches = set()
    unique_mismatches = []
    for m in mismatches:
        key = (m["name"], m.get("user_id", ""))
        if key not in seen_mismatches:
            seen_mismatches.add(key)
            unique_mismatches.append(m)

    return data, unique_mismatches

def process_pdf(pdf_bytes, df_associates):
    v_list, excluded_normalized = build_associates_lookup(df_associates)
    data, mismatches = [], []
    t_regex = r"(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))"
    
    with pdfplumber.open(pdf_bytes) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text: continue
            for line in text.split('\n'):
                m = re.search(t_regex, line.strip(), re.IGNORECASE)
                if m:
                    pot = line.split(m.group(1))[0].strip()
                    st_dt = parse_time(m.group(1))
                    en_dt = parse_time(m.group(2))
                    if not st_dt or not en_dt:
                        continue
                        
                    real_end = en_dt + timedelta(days=1) if en_dt < st_dt else en_dt
                    duration = (real_end - st_dt).total_seconds() / 3600
                    shift_label = f"{st_dt.strftime('%I:%M %p').lstrip('0')} - {en_dt.strftime('%I:%M %p').lstrip('0')}"

                    match_entry, is_excluded = match_associate(line, v_list, excluded_normalized)
                    if is_excluded:
                        continue
                        
                    if match_entry:
                        best_name = pot if (len(pot) > len(match_entry["raw"]) and len(pot.split()) >= len(match_entry["raw"].split())) else match_entry["raw"]
                        disp_name = format_display_name(best_name, match_entry["is_minor"])
                        assigned_role = match_entry["role"]
                    else:
                        if len(pot) > 1:
                            disp_name = format_display_name(pot, is_minor=False)
                            mismatches.append({
                                "name": disp_name,
                                "user_id": "",
                                "role": "Pickers"
                            })
                        else:
                            continue
                        assigned_role = "Pickers"
                        
                    data.append({
                        "Associate": disp_name, 
                        "Role": assigned_role, 
                        "Shift": shift_label, 
                        "Break 1": "Pending...",
                        "Lunch Time": "Pending...", 
                        "Break 2": "Pending...",
                        "StartDt": st_dt.isoformat(), 
                        "EndDt": real_end.isoformat(), 
                        "Duration": duration
                    })

    seen_mismatches = set()
    unique_mismatches = []
    for m in mismatches:
        key = (m["name"], m.get("user_id", ""))
        if key not in seen_mismatches:
            seen_mismatches.add(key)
            unique_mismatches.append(m)

    return data, unique_mismatches

def find_best_slot(target_dt, min_dt, max_dt, slot_counter, step_minutes=15):
    """
    Finds the optimal time slot between min_dt and max_dt in step_minutes increments.
    Prioritizes slots with the lowest occupancy count (0 first, then 1, etc.),
    and breaks ties by closeness to the ideal target_dt.
    """
    if min_dt > max_dt:
        return None

    # Align min_dt up to the nearest step_minutes boundary
    curr = min_dt.replace(second=0, microsecond=0)
    rem = curr.minute % step_minutes
    if rem != 0:
        curr += timedelta(minutes=(step_minutes - rem))

    candidate_slots = []
    while curr <= max_dt:
        candidate_slots.append(curr)
        curr += timedelta(minutes=step_minutes)

    if not candidate_slots:
        return None

    def score_slot(s):
        occupancy = slot_counter.get(s, 0)
        dist_seconds = abs((s - target_dt).total_seconds())
        # Slight bias towards being at or after target_dt rather than too early
        bias = 0 if s >= target_dt else 1
        return (occupancy, dist_seconds, bias, s)

    best_slot = min(candidate_slots, key=score_slot)
    slot_counter[best_slot] = slot_counter.get(best_slot, 0) + 1
    return best_slot

def calculate_staggered_lunches(roster_data):
    """
    Calculates staggered 15-minute breaks and 30-minute lunches with:
    1. Unified break tracking per role (Break 1 & Break 2 share slot counts).
    2. Dynamic slot search across allowable windows to minimize concurrent breaks.
    3. Guaranteed chronological ordering: Start -> Break 1 -> Lunch -> Break 2 -> End.
    4. Minimum buffer spacing between breaks and lunches.
    """
    if not roster_data:
        return roster_data

    df = pd.DataFrame(roster_data)
    df['StartDt'] = pd.to_datetime(df['StartDt'], format='mixed', utc=True).dt.tz_localize(None)
    df['EndDt'] = pd.to_datetime(df['EndDt'], format='mixed', utc=True).dt.tz_localize(None)
    final_records = []
    active_roles = ["Pickers", "Picker", "Backroom", "Exceptions", "IP/GMD", "IPGMD"]

    # Process excluded first to maintain them
    if "Exclude" in df['Role'].values:
        ex_group = df[df['Role'] == "Exclude"].to_dict('records')
        for item in ex_group:
            item['Break 1'] = "N/A"
            item['Lunch Time'] = "N/A"
            item['Break 2'] = "N/A"
            item['StartDt'] = item['StartDt'].isoformat() if hasattr(item['StartDt'], 'isoformat') else str(item['StartDt'])
            item['EndDt'] = item['EndDt'].isoformat() if hasattr(item['EndDt'], 'isoformat') else str(item['EndDt'])
            final_records.append(item)

    for role in active_roles:
        if role not in df['Role'].values:
            continue

        role_df = df[df['Role'] == role].copy()
        # Sort by start time, then duration descending to prioritize full shifts
        role_df = role_df.sort_values(by=['StartDt', 'Duration'], ascending=[True, False])

        # Unified counters per role
        role_break_counter = {}
        role_lunch_counter = {}

        assigned_items = []
        for _, row in role_df.iterrows():
            row_dict = row.to_dict()
            st = row['StartDt']
            en = row['EndDt']

            try:
                duration_val = float(row.get('Duration', 0))
            except (ValueError, TypeError):
                duration_val = (en - st).total_seconds() / 3600 if pd.notna(st) and pd.notna(en) else 0

            has_valid_times = pd.notna(st) and pd.notna(en) and duration_val > 0

            if not has_valid_times:
                row_dict['Break 1'] = "N/A"
                row_dict['Lunch Time'] = "N/A"
                row_dict['Break 2'] = "N/A"
                assigned_items.append(row_dict)
                continue

            needs_lunch = duration_val >= 6.0
            needs_b2 = duration_val >= 7.0

            # --- 1. LUNCH TIME (Shifts >= 6 hours) ---
            lunch_dt = None
            if needs_lunch:
                is_10h = duration_val >= 10.0
                ideal_lunch_offset = 5.0 if is_10h else 4.0
                target_lunch = st + timedelta(hours=ideal_lunch_offset)

                min_lunch = st + timedelta(hours=3.0)
                max_lunch = min(st + timedelta(hours=5.5), en - timedelta(hours=2.5))
                if max_lunch < min_lunch:
                    max_lunch = en - timedelta(hours=2.0)
                if max_lunch < min_lunch:
                    min_lunch = st + timedelta(hours=2.0)

                lunch_dt = find_best_slot(target_lunch, min_lunch, max_lunch, role_lunch_counter, step_minutes=30)
                if lunch_dt:
                    row_dict['Lunch Time'] = lunch_dt.strftime("%I:%M %p").lstrip("0")
                else:
                    row_dict['Lunch Time'] = "No Slot Avail"
            else:
                row_dict['Lunch Time'] = "N/A"

            # --- 2. BREAK 1 (Target ~2 hours into shift) ---
            target_b1 = st + timedelta(hours=2.0)
            min_b1 = st + timedelta(minutes=75)

            if lunch_dt:
                max_b1 = lunch_dt - timedelta(minutes=75)
            else:
                max_b1 = en - timedelta(minutes=45)

            if max_b1 < min_b1:
                min_b1 = st + timedelta(minutes=45)
                max_b1 = (lunch_dt - timedelta(minutes=30)) if lunch_dt else (en - timedelta(minutes=30))

            b1_dt = find_best_slot(target_b1, min_b1, max_b1, role_break_counter, step_minutes=15)
            if b1_dt:
                row_dict['Break 1'] = b1_dt.strftime("%I:%M %p").lstrip("0")
            else:
                row_dict['Break 1'] = "No Slot Avail"

            # --- 3. BREAK 2 (Shifts >= 7 hours, Target ~2 hours after lunch) ---
            if needs_b2 and lunch_dt:
                target_b2 = lunch_dt + timedelta(hours=2.0)
                min_b2 = lunch_dt + timedelta(minutes=75)
                max_b2 = en - timedelta(minutes=30)

                if max_b2 < min_b2:
                    min_b2 = lunch_dt + timedelta(minutes=45)
                    max_b2 = en - timedelta(minutes=15)

                b2_dt = find_best_slot(target_b2, min_b2, max_b2, role_break_counter, step_minutes=15)
                if b2_dt:
                    row_dict['Break 2'] = b2_dt.strftime("%I:%M %p").lstrip("0")
                else:
                    row_dict['Break 2'] = "No Slot Avail"
            elif needs_b2 and not lunch_dt:
                target_b2 = st + timedelta(hours=5.5)
                min_b2 = (b1_dt + timedelta(hours=2)) if b1_dt else (st + timedelta(hours=4))
                max_b2 = en - timedelta(minutes=30)
                b2_dt = find_best_slot(target_b2, min_b2, max_b2, role_break_counter, step_minutes=15)
                if b2_dt:
                    row_dict['Break 2'] = b2_dt.strftime("%I:%M %p").lstrip("0")
                else:
                    row_dict['Break 2'] = "No Slot Avail"
            else:
                row_dict['Break 2'] = "N/A"

            row_dict['StartDt'] = row_dict['StartDt'].isoformat() if hasattr(row_dict['StartDt'], 'isoformat') else str(row_dict['StartDt'])
            row_dict['EndDt'] = row_dict['EndDt'].isoformat() if hasattr(row_dict['EndDt'], 'isoformat') else str(row_dict['EndDt'])
            assigned_items.append(row_dict)

        final_records.extend(assigned_items)

    return final_records
