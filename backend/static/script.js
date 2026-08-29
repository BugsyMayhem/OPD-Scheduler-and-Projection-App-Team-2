const API_BASE = '/api';
let main_df = [];
let calculationDone = false;
let currentMismatches = [];
let uploadedPdfName = "OPD_Roster";

// DOM Elements
const syncBtn = document.getElementById('syncBtn');
const lastSyncTime = document.getElementById('lastSyncTime');
const pdfUpload = document.getElementById('pdfUpload');
const calcLunchesBtn = document.getElementById('calcLunchesBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const rosterBody = document.getElementById('rosterBody');
const mismatchAlert = document.getElementById('mismatchAlert');
const mismatchText = document.getElementById('mismatchText');
const pickerCount = document.getElementById('pickerCount');
const backroomCount = document.getElementById('backroomCount');
const exceptionCount = document.getElementById('exceptionCount');
const coverageContainer = document.getElementById('coverageContainer');
const coverageBody = document.getElementById('coverageBody');
const emptyRow = document.getElementById('emptyRow');

// Tab/View Elements
const tabBtns = document.querySelectorAll('.tab-btn');
const viewSections = document.querySelectorAll('.view-section');
const dbBody = document.getElementById('dbBody');

// Modal Elements removed

const ROLES = ["Pickers", "Backroom", "Exceptions", "IP/GMD", "Exclude"];



// Initialize
async function init() {
    setupTabs();
    await syncDatabase();
    loadDatabase();
}

function setupTabs() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all
            tabBtns.forEach(b => b.classList.remove('active'));
            viewSections.forEach(v => v.classList.add('hidden'));

            // Add active to clicked
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');

            // Make sure sidebar is visible
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.remove('hidden');
        });
    });
}

async function loadDatabase() {
    try {
        dbBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align:center; padding: 2rem;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p>Loading database...</p>
                </td>
            </tr>
        `;

        const res = await fetch(`${API_BASE}/associates`);
        const data = await res.json();

        if (data.sheet_url) {
            const openSheetBtn = document.getElementById('openSheetBtn');
            if (openSheetBtn) openSheetBtn.href = data.sheet_url;
        }

        if (data.associates && data.associates.length > 0) {
            window.cachedAssociates = data.associates;
            dbBody.innerHTML = '';
            data.associates.forEach(assoc => {
                dbBody.appendChild(createDbRow(assoc));
            });
            filterDatabaseTable();
            if (typeof main_df !== 'undefined' && main_df.length > 0) {
                renderRoster();
            }
        } else {
            dbBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">No associates found in database.</td></tr>`;
        }
    } catch (e) {
        dbBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color:red;">Failed to load database.</td></tr>`;
    }
}

function createDbRow(assoc) {
    const tr = document.createElement('tr');
    tr.className = 'db-row';

    // Hidden fields preserved
    const status = assoc.Status || 'Associate';
    const completed = assoc.Completed || 'Yes';
    const role = assoc.Role || 'Picker';
    const pph = assoc.PPH || '';

    tr.innerHTML = `
        <td style="text-align: center;"><input type="checkbox" class="row-select"></td>
        <td><input type="text" class="db-input db-name" value="${assoc.Name || ''}" placeholder="Name"></td>
        <td><input type="text" class="db-input db-userid" value="${assoc['User ID'] || assoc.UserID || ''}" placeholder="User ID" style="width: 90px;"></td>
        <td>
            <select class="db-input db-minor">
                <option value="No" ${(assoc['Minor Status'] || 'No').toLowerCase() === 'no' ? 'selected' : ''}>No</option>
                <option value="Yes" ${(assoc['Minor Status'] || '').toLowerCase() === 'yes' ? 'selected' : ''}>(M) Yes</option>
            </select>
        </td>
        <td>
            <select class="db-input db-exclude">
                <option value="No" ${(assoc.Exclude || 'No').toLowerCase() === 'no' ? 'selected' : ''}>No</option>
                <option value="Yes" ${(assoc.Exclude || '').toLowerCase() === 'yes' ? 'selected' : ''}>Yes</option>
            </select>
        </td>
        <td>
            <select class="db-input db-role role-${(!role || role === 'Picker' || role === 'Pickers' || role === '') ? 'Picker' : role}">
                <option value="" ${(!role || role === 'Picker' || role === 'Pickers' || role === '') ? 'selected' : ''}>Default (Picker)</option>
                <option value="Backroom" ${role === 'Backroom' ? 'selected' : ''}>Backroom</option>
                <option value="Exceptions" ${role === 'Exceptions' ? 'selected' : ''}>Exceptions</option>
                <option value="IP/GMD" ${role === 'IP/GMD' ? 'selected' : ''}>IP/GMD</option>
            </select>
        </td>
        <td>
            <button class="btn-icon delete-db-btn" title="Delete Locally" style="color:var(--wm-blue);">
                <i class="fa-solid fa-trash"></i>
            </button>
        </td>
    `;

    // Store hidden state attached to the TR element object itself
    tr._assocStatus = status;
    tr._assocCompleted = completed;
    tr._assocType = assoc['Employment Type'] || 'Full-Time';

    const roleSelect = tr.querySelector('.db-role');

    // Update role select colors dynamically
    roleSelect.addEventListener('change', (e) => {
        let clsVal = e.target.value === "" ? "Picker" : e.target.value;
        roleSelect.className = `db-input db-role role-${clsVal}`;
    });

    tr.querySelector('.delete-db-btn').addEventListener('click', () => {
        tr.remove(); // Just delete from UI. Actual delete happens on global save.
    });

    return tr;
}

// Quick Add Mismatches
const quickAddBtn = document.getElementById('quickAddBtn');
if (quickAddBtn) {
    quickAddBtn.addEventListener('click', () => {
        // Switch to Database tab
        document.querySelector('[data-target="databaseView"]').click();

        // Hide mismatch alert
        mismatchAlert.classList.add('hidden');

        // Remove empty state if present
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        currentMismatches.forEach(name => {
            // Capitalize format appropriately like parser did
            let parts = name.split(' ');
            let fmtName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}` : parts[0];
            // To ensure capitalization
            fmtName = fmtName.replace(/\b\w/g, l => l.toUpperCase());

            const newRow = createDbRow({ row_index: 'new', Name: fmtName });
            dbBody.prepend(newRow);
        });

        currentMismatches = [];

        // Focus the first newly added name input
        const firstInput = dbBody.querySelector('.db-name');
        if (firstInput) firstInput.focus();
    });
}

const addAssocBtn = document.getElementById('addAssocBtn');
if (addAssocBtn) {
    addAssocBtn.addEventListener('click', () => {
        // Remove empty state if present
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const newRow = createDbRow({ row_index: 'new' });
        dbBody.prepend(newRow);
        newRow.querySelector('.db-name').focus();
    });
}

// Checkbox select all logic
document.getElementById('selectAllCheckbox')?.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    document.querySelectorAll('.row-select').forEach(cb => {
        cb.checked = isChecked;
    });
});

// Delete Selected Button
document.getElementById('deleteSelectedBtn')?.addEventListener('click', () => {
    document.querySelectorAll('.db-row').forEach(tr => {
        const cb = tr.querySelector('.row-select');
        if (cb && cb.checked) {
            tr.remove();
        }
    });
    // Uncheck select all indicator
    const selectAll = document.getElementById('selectAllCheckbox');
    if (selectAll) selectAll.checked = false;
});

// Save Batch Logic
document.getElementById('saveBatchBtn')?.addEventListener('click', async () => {
    const saveBtn = document.getElementById('saveBatchBtn');
    const originalText = saveBtn.innerHTML;
    
    try {
        saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
        saveBtn.disabled = true;

        const allAssociates = [];
        document.querySelectorAll('.db-row').forEach(tr => {
            allAssociates.push({
                "Name": tr.querySelector('.db-name').value,
                "User ID": tr.querySelector('.db-userid').value,
                "Status": tr._assocStatus,
                "Employment Type": tr._assocType || "Full-Time",
                "Minor Status": tr.querySelector('.db-minor').value,
                "Exclude": tr.querySelector('.db-exclude').value,
                "Completed": tr._assocCompleted,
                "Role": tr.querySelector('.db-role').value
            });
        });

        const payload = {
            associates: allAssociates
        };

        const res = await fetch(`${API_BASE}/associates/batch_update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Update failed');

        // Reload data to reflect changes
        loadDatabase();

    } catch (e) {
        alert("Error saving: " + e.message);
        loadDatabase(); // Reload on error to reset UI
    } finally {
        saveBtn.innerHTML = originalText;
        saveBtn.disabled = false;
    }
});

async function syncDatabase() {
    try {
        syncBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
        syncBtn.disabled = true;

        const res = await fetch(`${API_BASE}/sync`);
        const data = await res.json();

        if (data.status === 'success') {
            lastSyncTime.textContent = data.last_sync;
            if (data.sheet_url) {
                const openSheetBtn = document.getElementById('openSheetBtn');
                if (openSheetBtn) openSheetBtn.href = data.sheet_url;
            }
        } else {
            lastSyncTime.textContent = 'Sync Failed';
        }
    } catch (e) {
        lastSyncTime.textContent = 'Connection Error';
    } finally {
        syncBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync Database';
        syncBtn.disabled = false;
        loadDatabase(); // Refresh the table after sync
    }
}

syncBtn.addEventListener('click', syncDatabase);

// File Upload
pdfUpload.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Capture the name of the file to use as the title later, stripping the .pdf extension
    uploadedPdfName = file.name.replace(/\.[^/.]+$/, "");

    const formData = new FormData();
    formData.append('file', file);

    try {
        // Show loading state
        rosterBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center; padding: 2rem;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p>Processing Schedule...</p>
                </td>
            </tr>
        `;

        const res = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.detail || 'Failed to process schedule file');
        }

        const data = await res.json();

        // Append new data to existing df
        main_df = [...main_df, ...data.roster];

        if (data.mismatches && data.mismatches.length > 0) {
            currentMismatches = data.mismatches;
            mismatchAlert.classList.remove('hidden');
            mismatchText.textContent = `These names were found in the schedule but not in the database: ${data.mismatches.join(', ')}`;
        } else {
            mismatchAlert.classList.add('hidden');
            currentMismatches = [];
        }

        calculationDone = false;
        renderRoster();
        updateStats();

        calcLunchesBtn.disabled = main_df.length === 0;
        downloadPdfBtn.disabled = main_df.length === 0;
        
        const clearPdfBtn = document.getElementById('clearPdfBtn');
        if (clearPdfBtn) clearPdfBtn.disabled = main_df.length === 0;

    } catch (error) {
        alert("Error: " + error.message);
        renderRoster(); // Fallback to previous
    }

    // Reset file input
    pdfUpload.value = '';
});

// Clear PDF
const clearPdfBtn = document.getElementById('clearPdfBtn');
if (clearPdfBtn) {
    clearPdfBtn.addEventListener('click', () => {
        main_df = [];
        calculationDone = false;
        
        // Reset UI metrics
        pickerCount.textContent = '0';
        backroomCount.textContent = '0';
        exceptionCount.textContent = '0';
        
        // Reset Tables
        rosterBody.innerHTML = `
            <tr id="emptyRow">
                <td colspan="7" style="text-align:center; padding: 2rem;">
                    Upload a CSV schedule to view roster
                </td>
            </tr>
        `;
        coverageBody.innerHTML = `
            <tr class="empty-state">
                <td colspan="4" style="text-align:center; padding: 2rem;">
                    <i class="fa-solid fa-calculator fa-2x"></i>
                    <p>Generate lunches to see coverage</p>
                </td>
            </tr>
        `;
        
        // Hide mismatches
        mismatchAlert.classList.add('hidden');
        
        // Disable buttons
        calcLunchesBtn.disabled = true;
        downloadPdfBtn.disabled = true;
        clearPdfBtn.disabled = true;
        
        // Reset file input
        pdfUpload.value = '';
    });
}

// Calculate Lunches
calcLunchesBtn.addEventListener('click', async () => {
    if (main_df.length === 0) return;

    try {
        calcLunchesBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
        calcLunchesBtn.disabled = true;

        const res = await fetch(`${API_BASE}/calculate_lunches`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ roster: main_df })
        });

        if (!res.ok) {
            let errorMsg = 'Calculation Failed';
            try {
                const errData = await res.json();
                errorMsg = errData.detail || errorMsg;
            } catch (err) {}
            throw new Error(errorMsg);
        }

        const data = await res.json();
        main_df = data.roster;
        calculationDone = true;

        renderRoster();
        updateCoverageTable();

    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        calcLunchesBtn.innerHTML = '<i class="fa-solid fa-utensils"></i> Generate Lunches';
        calcLunchesBtn.disabled = false;
    }
});

function getLunchOptions() {
    let opts = ["Pending...", "N/A", "No Slot Avail"];
    let start = new Date();
    start.setHours(0, 0, 0, 0); // Start at midnight

    for (let i = 0; i < 48; i++) {
        let h = start.getHours();
        let m = start.getMinutes();
        let ampm = h >= 12 ? 'PM' : 'AM';
        let displayH = h % 12 || 12;
        let displayM = m < 10 ? '0' + m : m;
        opts.push(`${displayH}:${displayM} ${ampm}`);
        start.setMinutes(start.getMinutes() + 30);
    }
    return opts;
}

function getBreakOptions() {
    const opts = ['Pending...', 'N/A', 'No Slot Avail'];
    let start = new Date();
    start.setHours(0, 0, 0, 0); // Start at midnight

    for (let i = 0; i < 96; i++) {
        let h = start.getHours();
        let m = start.getMinutes();
        let ampm = h >= 12 ? 'PM' : 'AM';
        let displayH = h % 12 || 12;
        let displayM = m < 10 ? '0' + m : m;
        opts.push(`${displayH}:${displayM} ${ampm}`);
        start.setMinutes(start.getMinutes() + 15);
    }
    return opts;
}

const LUNCH_OPTIONS = getLunchOptions();
const BREAK_OPTIONS = getBreakOptions();

function renderRoster() {
    if (main_df.length === 0) {
        rosterBody.innerHTML = '';
        rosterBody.appendChild(emptyRow);
        return;
    }

    rosterBody.innerHTML = '';

    // Helper to add icons to names like in original
    const getIconName = (name, role) => {
        let clean = name.replace("🔴 ", "").replace("🔵 ", "").replace("🟡 ", "").replace("🟠 ", "").replace("💖 ", "").replace("💙 ", "").replace("💛 ", "").replace("🧡 ", "");
        if (role === "Pickers" || role === "Picker") return `🔴 ${clean}`;
        if (role === "Backroom") return `🔵 ${clean}`;
        if (role === "Exceptions") return `🟡 ${clean}`;
        if (role === "IP/GMD" || role === "IPGMD") return `🟠 ${clean}`;
        return clean;
    };

    // Sort by Role, then by Shift Start time
    main_df.sort((a, b) => {
        const roleA = ROLES.indexOf(a.Role);
        const roleB = ROLES.indexOf(b.Role);
        if (roleA !== roleB) return roleA - roleB;

        return new Date(a.StartDt) - new Date(b.StartDt);
    });

    // Calculate role-specific break and lunch counts to detect overlaps
    const roleBreakCounts = {};
    const roleLunchCounts = {};

    main_df.forEach(row => {
        if (!row.Role || row.Role === 'Exclude') return;
        if (!roleBreakCounts[row.Role]) roleBreakCounts[row.Role] = {};
        if (!roleLunchCounts[row.Role]) roleLunchCounts[row.Role] = {};

        const b1 = row['Break 1'];
        if (b1 && b1 !== 'Pending...' && b1 !== 'N/A' && b1 !== 'No Slot Avail') {
            roleBreakCounts[row.Role][b1] = (roleBreakCounts[row.Role][b1] || 0) + 1;
        }

        const b2 = row['Break 2'];
        if (b2 && b2 !== 'Pending...' && b2 !== 'N/A' && b2 !== 'No Slot Avail') {
            roleBreakCounts[row.Role][b2] = (roleBreakCounts[row.Role][b2] || 0) + 1;
        }

        const lunch = row['Lunch Time'];
        if (lunch && lunch !== 'Pending...' && lunch !== 'N/A' && lunch !== 'No Slot Avail') {
            roleLunchCounts[row.Role][lunch] = (roleLunchCounts[row.Role][lunch] || 0) + 1;
        }
    });

    main_df.forEach((row, idx) => {
        const tr = document.createElement('tr');

        const displayName = getIconName(row.Associate, row.Role);

        // Role Select
        const roleOptions = ROLES.map(r => `<option value="${r}" ${r === row.Role ? 'selected' : ''}>${r}</option>`).join('');

        // Break 1 Select & Overlap Check (Pink)
        const break1Val = row['Break 1'] || 'Pending...';
        const break1Options = BREAK_OPTIONS.map(b => `<option value="${b}" ${b === break1Val ? 'selected' : ''}>${b}</option>`).join('');
        const isB1Overlap = (roleBreakCounts[row.Role] && roleBreakCounts[row.Role][break1Val] > 1);
        const break1Class = (break1Val === 'No Slot Avail' || isB1Overlap) ? 'lunch-select break-warning' : 'lunch-select';
        const break1Title = isB1Overlap ? `Break overlap in ${row.Role} (${break1Val})` : '';

        // Lunch Select & Overlap Check (Red)
        const lunchVal = row['Lunch Time'] || 'Pending...';
        const lunchOptions = LUNCH_OPTIONS.map(l => `<option value="${l}" ${l === lunchVal ? 'selected' : ''}>${l}</option>`).join('');
        const isLunchOverlap = (roleLunchCounts[row.Role] && roleLunchCounts[row.Role][lunchVal] > 1);
        const lunchClass = (lunchVal === 'No Slot Avail' || isLunchOverlap) ? 'lunch-select lunch-warning' : 'lunch-select';
        const lunchTitle = isLunchOverlap ? `Lunch overlap in ${row.Role} (${lunchVal})` : '';

        // Break 2 Select & Overlap Check (Pink)
        const break2Val = row['Break 2'] || 'Pending...';
        const break2Options = BREAK_OPTIONS.map(b => `<option value="${b}" ${b === break2Val ? 'selected' : ''}>${b}</option>`).join('');
        const isB2Overlap = (roleBreakCounts[row.Role] && roleBreakCounts[row.Role][break2Val] > 1);
        const break2Class = (break2Val === 'No Slot Avail' || isB2Overlap) ? 'lunch-select break-warning' : 'lunch-select';
        const break2Title = isB2Overlap ? `Break overlap in ${row.Role} (${break2Val})` : '';

        tr.innerHTML = `
            <td><strong>${displayName}</strong></td>
            <td>
                <select class="role-select" data-idx="${idx}">
                    ${roleOptions}
                </select>
            </td>
            <td>
                <input type="text" class="shift-input" data-idx="${idx}" value="${row.Shift}" placeholder="e.g. 5am - 2pm" 
                style="width: 155px; padding: 4px; border: 1px solid transparent; background: transparent; font-family: inherit; font-size: inherit; border-radius: 4px;" />
            </td>
            <td>
                <select class="${break1Class}" data-idx="${idx}" data-field="break1" title="${break1Title}">
                    ${break1Options}
                </select>
            </td>
            <td>
                <select class="${lunchClass}" data-idx="${idx}" data-field="lunch" title="${lunchTitle}">
                    ${lunchOptions}
                </select>
            </td>
            <td>
                <select class="${break2Class}" data-idx="${idx}" data-field="break2" title="${break2Title}">
                    ${break2Options}
                </select>
            </td>
            <td>
                <button class="btn-icon delete-row" data-idx="${idx}" title="Delete">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        rosterBody.appendChild(tr);
    });

    // Add Listeners
    document.querySelectorAll('.shift-input').forEach(inp => {
        inp.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-idx');
            const newShift = e.target.value.trim();
            main_df[idx].Shift = newShift;
            updateShiftDates(idx, newShift);

            // Reset lunch and breaks on shift change
            main_df[idx]['Break 1'] = 'Pending...';
            main_df[idx]['Lunch Time'] = 'Pending...';
            main_df[idx]['Break 2'] = 'Pending...';

            if (calculationDone) updateCoverageTable();
            renderRoster(); // re-render to reflect new empty dropdowns
        });

        inp.addEventListener('focus', (e) => {
            e.target.style.border = '1px solid var(--wm-blue)';
            e.target.style.background = '#fff';
        });

        inp.addEventListener('blur', (e) => {
            e.target.style.border = '1px solid transparent';
            e.target.style.background = 'transparent';
        });
    });

    document.querySelectorAll('.role-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-idx');
            main_df[idx].Role = e.target.value;
            main_df[idx].Associate = getIconName(main_df[idx].Associate, e.target.value);
            updateStats();
            if (calculationDone) updateCoverageTable();
            renderRoster(); // Quick re-render to update icons
        });
    });

    document.querySelectorAll('select[data-field="break1"]').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-idx');
            main_df[idx]['Break 1'] = e.target.value;
            renderRoster();
        });
    });

    document.querySelectorAll('select[data-field="lunch"]').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-idx');
            main_df[idx]['Lunch Time'] = e.target.value;
            if (calculationDone) updateCoverageTable();
            renderRoster();
        });
    });

    document.querySelectorAll('select[data-field="break2"]').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = e.target.getAttribute('data-idx');
            main_df[idx]['Break 2'] = e.target.value;
            renderRoster();
        });
    });

    document.querySelectorAll('.delete-row').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = e.currentTarget.getAttribute('data-idx');
            main_df.splice(idx, 1);
            if (main_df.length === 0) {
                calcLunchesBtn.disabled = true;
                downloadPdfBtn.disabled = true;
            }
            renderRoster();
            updateStats();
            if (calculationDone) updateCoverageTable();
        });
    });
}

function updateStats() {
    let pickers = 0, backroom = 0, exceptions = 0, ipgmd = 0;
    main_df.forEach(row => {
        if (row.Role === 'Pickers') pickers++;
        if (row.Role === 'Backroom') backroom++;
        if (row.Role === 'Exceptions') exceptions++;
        if (row.Role === 'IP/GMD' || row.Role === 'IPGMD') ipgmd++;
    });

    pickerCount.textContent = pickers;
    backroomCount.textContent = backroom;
    exceptionCount.textContent = exceptions;
    const ipgmdCountEl = document.getElementById('ipgmdCount');
    if (ipgmdCountEl) ipgmdCountEl.textContent = ipgmd;
}

// Download PDF
downloadPdfBtn.addEventListener('click', () => {
    if (main_df.length === 0) return;

    // Output Context
    const docTitle = uploadedPdfName;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(docTitle, 14, 20);

    // Prepare Data
    const tableData = [];
    main_df.forEach(row => {
        // Strip emojis and minor tags for clean PDF
        let cleanName = row.Associate.replace(/[🔴🔵🟡🟠💖💙💛🧡]/g, "").replace(/\(M\)/g, "").trim();
        tableData.push([
            cleanName, 
            row.Role, 
            row.Shift, 
            row['Break 1'] || 'N/A', 
            row['Lunch Time'] || 'N/A', 
            row['Break 2'] || 'N/A'
        ]);
    });

    doc.autoTable({
        startY: 30,
        head: [['Associate', 'Role', 'Shift', 'Break 1', 'Lunch Time', 'Break 2']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [0, 113, 206] }, // Walmart Blue
        styles: { font: 'helvetica', fontSize: 8.5 },
        columnStyles: {
            0: { cellWidth: 46 },
            1: { cellWidth: 28 },
            2: { cellWidth: 34 },
            3: { cellWidth: 26 },
            4: { cellWidth: 26 },
            5: { cellWidth: 26 }
        }
    });

    // Add Hourly Coverage Table
    if (calculationDone) {
        let finalY = doc.lastAutoTable.finalY + 15 || 30;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("Hourly Coverage", 14, finalY);

        const coverageData = [];
        const rows = document.querySelectorAll('#coverageBody tr');
        rows.forEach(row => {
            if (!row.classList.contains('empty-state')) {
                const cells = row.querySelectorAll('td');
                if (cells.length > 0) {
                    coverageData.push(Array.from(cells).map(c => c.innerText.replace(/\n/g, " ")));
                }
            }
        });

        if (coverageData.length > 0) {
            const headCells = document.querySelectorAll('#coverageTable thead th');
            const headRow = [Array.from(headCells).map(th => th.innerText)];

            doc.autoTable({
                startY: finalY + 5,
                head: headRow,
                body: coverageData,
                theme: 'striped',
                headStyles: { fillColor: [0, 113, 206] },
                styles: { font: 'helvetica', fontSize: 10 }
            });
        }
    }

    doc.save(`${docTitle}.pdf`);
});

// Hourly Coverage Logic translated from Python to JS
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    let ts = timeStr.toLowerCase().replace(" ", "");
    let match = ts.match(/(\d+):?(\d+)?(am|pm)/);
    if (!match) return null;

    let h = parseInt(match[1]);
    let m = match[2] ? parseInt(match[2]) : 0;
    let ampm = match[3];

    if (h === 12 && ampm === 'am') h = 0;
    if (h !== 12 && ampm === 'pm') h += 12;

    return h * 60 + m;
}

function toLocalISOString(date) {
    const pad = (n) => n < 10 ? '0' + n : n;
    return date.getFullYear() + '-' +
        pad(date.getMonth() + 1) + '-' +
        pad(date.getDate()) + 'T' +
        pad(date.getHours()) + ':' +
        pad(date.getMinutes()) + ':' +
        pad(date.getSeconds());
}

function updateShiftDates(idx, shiftStr) {
    const parts = shiftStr.split('-');
    if (parts.length !== 2) return;

    let st = parseTimeToMinutes(parts[0].trim());
    let et = parseTimeToMinutes(parts[1].trim());

    if (st === null || et === null) return;

    let sh = Math.floor(st / 60);
    let sm = st % 60;
    let eh = Math.floor(et / 60);
    let em = et % 60;

    let baseStart = new Date(main_df[idx].StartDt);
    baseStart.setHours(sh, sm, 0, 0);

    let baseEnd = new Date(main_df[idx].StartDt); // Use start date as baseline
    baseEnd.setHours(eh, em, 0, 0);

    if (baseEnd < baseStart) {
        baseEnd.setDate(baseEnd.getDate() + 1); // Crosses midnight
    }

    main_df[idx].StartDt = toLocalISOString(baseStart);
    main_df[idx].EndDt = toLocalISOString(baseEnd);
    main_df[idx].Duration = (baseEnd - baseStart) / (1000 * 60 * 60);
}

function updateCoverageTable() {
    if (!calculationDone) {
        coverageBody.innerHTML = `
            <tr class="empty-state">
                <td colspan="4">
                    <div class="empty-content">
                        <i class="fa-solid fa-chart-simple fa-3x" style="font-size: 3rem; margin-bottom: 1rem; color: #cbd5e1;"></i>
                        <p>Upload a roster and generate lunches to view coverage</p>
                    </div>
                </td>
            </tr>
            `;
        return;
    }

    coverageBody.innerHTML = '';

    for (let h = 4; h < 22; h++) {
        let lblH = h <= 12 ? h : h - 12;
        let lblAmpm = h < 12 ? 'AM' : 'PM';
        let lbl = h === 12 ? "12 PM" : `${lblH} ${lblAmpm} `;

        let pCount = 0, bCount = 0, eCount = 0, ipCount = 0;

        main_df.forEach(r => {
            if (r.Role === 'Exclude') return;
            if (!r.StartDt) return;
            let sd = new Date(r.StartDt);
            let ed = new Date(r.EndDt);

            let sm = sd.getHours() * 60 + sd.getMinutes();
            let em = ed.getHours() * 60 + ed.getMinutes();

            if (sm <= h * 60 && em >= (h + 1) * 60) {
                let on_l = false;
                if (r['Lunch Time'] && r['Lunch Time'] !== 'N/A' && r['Lunch Time'] !== 'Pending...' && r['Lunch Time'] !== 'No Slot Avail') {
                    let lm = parseTimeToMinutes(r['Lunch Time']);
                    if (lm !== null) {
                        let l_start_min = lm;
                        let l_end_min = lm + 60;
                        let h_start_min = h * 60;
                        let h_end_min = (h + 1) * 60;

                        if (l_start_min < h_end_min && l_end_min > h_start_min) {
                            on_l = true;
                        }
                    }
                }

                if (!on_l) {
                    let act = r.Role;
                    if (h === 4) {
                        if (r.Role === "Backroom" || r.Role === "Exceptions" || r.Role === "IP/GMD" || r.Role === "IPGMD") act = "Pickers";
                    } else if (h === 5) {
                        if (r.Role === "Backroom" && bCount >= 2) act = "Pickers";
                    }
                    if (act === "Pickers") pCount++;
                    if (act === "Backroom") bCount++;
                    if (act === "Exceptions") eCount++;
                    if (act === "IP/GMD" || act === "IPGMD") ipCount++;
                }
            }
        });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${lbl}</strong></td>
            <td>${pCount} <span style="color:#aaa; font-size: 0.8em">(${pCount * 70})</span></td>
            <td>${bCount} <span style="color:#aaa; font-size: 0.8em">(${bCount * 5})</span></td>
            <td>${eCount}</td>
            <td>${ipCount}</td>
        `;
        coverageBody.appendChild(tr);
    }
}



// Start
init();

// Manual Add Modal Logic
const manualAddModal = document.getElementById('manualAddModal');
const openManualAddBtn = document.getElementById('openManualAddBtn');
const closeManualAddBtn = document.getElementById('closeManualAddBtn');
const manualAddSelect = document.getElementById('manualAddSelect');
const submitManualAddBtn = document.getElementById('submitManualAddBtn');

if (openManualAddBtn && manualAddModal) {
    openManualAddBtn.addEventListener('click', async () => {
        manualAddModal.classList.remove('hidden');
        manualAddSelect.innerHTML = '<option value="">Loading...</option>';
        
        try {
            const res = await fetch(`${API_BASE}/associates`);
            if (res.ok) {
                const data = await res.json();
                const associates = data.associates;
                
                // Filter out excluded ones
                const active = associates.filter(a => a.Exclude?.toLowerCase() !== 'yes' && a.Name?.trim() !== '');
                
                manualAddSelect.innerHTML = '<option value="">Select Associate...</option>';
                active.forEach(a => {
                    const opt = document.createElement('option');
                    // Store full associate object as JSON string in value
                    opt.value = JSON.stringify(a);
                    opt.textContent = a.Name;
                    manualAddSelect.appendChild(opt);
                });
            }
        } catch (e) {
            manualAddSelect.innerHTML = '<option value="">Failed to load</option>';
        }
    });

    closeManualAddBtn.addEventListener('click', () => {
        manualAddModal.classList.add('hidden');
    });

    submitManualAddBtn.addEventListener('click', () => {
        const selectedVal = manualAddSelect.value;
        const startVal = document.getElementById('manualAddStart').value;
        const endVal = document.getElementById('manualAddEnd').value;
        
        if (!selectedVal || !startVal || !endVal) {
            alert("Please fill all fields");
            return;
        }
        
        const assoc = JSON.parse(selectedVal);
        
        // Parse time
        const today = new Date();
        const startSplit = startVal.split(':');
        const endSplit = endVal.split(':');
        
        let startDt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(startSplit[0]), parseInt(startSplit[1]));
        let endDt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), parseInt(endSplit[0]), parseInt(endSplit[1]));
        
        if (endDt < startDt) {
            endDt.setDate(endDt.getDate() + 1);
        }
        
        const durationHours = (endDt - startDt) / (1000 * 60 * 60);
        
        // Format shift string
        const formatTime = (d) => {
            let h = d.getHours();
            let m = d.getMinutes();
            const ampm = h >= 12 ? 'pm' : 'am';
            h = h % 12 || 12;
            const mStr = m < 10 ? '0'+m : m;
            return `${h}:${mStr}${ampm}`;
        };
        const shiftStr = `${formatTime(startDt)} - ${formatTime(endDt)}`;
        
        // Format Name
        let parts = assoc.Name.split(' ');
        let fmtName = parts.length > 1 ? `${parts[0]} ${parts[1][0]}` : parts[0];
        // Capitalize
        fmtName = fmtName.replace(/\b\w/g, l => l.toUpperCase());
        const isMinor = assoc['Minor Status']?.toLowerCase() === 'yes';
        const matchName = isMinor ? `(M) ${fmtName}` : fmtName;
        
        // Role determination
        let assignedRole = "Pickers";
        const sheetRole = assoc.Role?.toLowerCase() || "";
        if (sheetRole.includes("picker")) assignedRole = "Pickers";
        else if (sheetRole.includes("backroom") || sheetRole.includes("dispense")) assignedRole = "Backroom";
        else if (sheetRole.includes("exception")) assignedRole = "Exceptions";
        
        const pad = (n) => n < 10 ? '0' + n : n;
        const localIsoString = (d) => {
            return d.getFullYear() + '-' +
                   pad(d.getMonth() + 1) + '-' +
                   pad(d.getDate()) + 'T' +
                   pad(d.getHours()) + ':' +
                   pad(d.getMinutes()) + ':' +
                   pad(d.getSeconds());
        };
        
        const newRow = {
            Associate: matchName,
            Role: assignedRole,
            Shift: shiftStr,
            "Break 1": "Pending...",
            "Lunch Time": "Pending...",
            "Break 2": "Pending...",
            StartDt: localIsoString(startDt),
            EndDt: localIsoString(endDt),
            Duration: durationHours
        };
        
        // Ensure main_df exists and append
        if (typeof main_df === 'undefined' || !main_df) main_df = [];
        main_df.push(newRow);
        
        // Update UI
        calculationDone = false;
        renderRoster();
        updateStats();
        
        const calcLunchesBtn = document.getElementById('calcLunchesBtn');
        const downloadPdfBtn = document.getElementById('downloadPdfBtn');
        const clearPdfBtn = document.getElementById('clearPdfBtn');
        if (calcLunchesBtn) calcLunchesBtn.disabled = main_df.length === 0;
        if (downloadPdfBtn) downloadPdfBtn.disabled = main_df.length === 0;
        if (clearPdfBtn) clearPdfBtn.disabled = main_df.length === 0;
        
        manualAddModal.classList.add('hidden');
    });
}

// Database Search Filter
const dbSearchInput = document.getElementById('dbSearchInput');
function filterDatabaseTable() {
    if (!dbSearchInput) return;
    const query = dbSearchInput.value.toLowerCase().trim();
    const rows = document.querySelectorAll('.db-row');
    let visibleCount = 0;

    rows.forEach(tr => {
        const name = tr.querySelector('.db-name')?.value.toLowerCase() || '';
        const userId = tr.querySelector('.db-userid')?.value.toLowerCase() || '';
        if (name.includes(query) || userId.includes(query)) {
            tr.style.display = '';
            visibleCount++;
        } else {
            tr.style.display = 'none';
        }
    });

    let noMatchRow = document.getElementById('dbNoMatchRow');
    if (visibleCount === 0 && rows.length > 0 && query !== '') {
        if (!noMatchRow) {
            noMatchRow = document.createElement('tr');
            noMatchRow.id = 'dbNoMatchRow';
            noMatchRow.innerHTML = `<td colspan="7" style="text-align:center; padding: 2rem; color: #666;"><i class="fa-solid fa-user-slash fa-lg"></i> <span style="margin-left: 8px;">No associates found matching "${dbSearchInput.value}"</span></td>`;
            dbBody.appendChild(noMatchRow);
        } else {
            noMatchRow.style.display = '';
            const msgSpan = noMatchRow.querySelector('span');
            if (msgSpan) msgSpan.textContent = `No associates found matching "${dbSearchInput.value}"`;
        }
    } else if (noMatchRow) {
        noMatchRow.style.display = 'none';
    }
}

if (dbSearchInput) {
    dbSearchInput.addEventListener('input', filterDatabaseTable);
}
