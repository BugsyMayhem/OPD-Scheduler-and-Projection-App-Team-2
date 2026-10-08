const API_BASE = '/api';
let main_df = [];
let calculationDone = false;
let currentOpdMismatches = [];
let currentStoreMismatches = [];
let uploadedPdfName = "OPD_Roster";

// DOM Elements
const syncBtn = document.getElementById('syncBtn');
const lastSyncTime = document.getElementById('lastSyncTime');
const pdfUpload = document.getElementById('pdfUpload');
const calcLunchesBtn = document.getElementById('calcLunchesBtn');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const exportDashboardBtn = document.getElementById('exportDashboardBtn');
const rosterBody = document.getElementById('rosterBody');

const opdMismatchAlert = document.getElementById('opdMismatchAlert');
const opdMismatchNames = document.getElementById('opdMismatchNames');
const opdTargetDbName = document.getElementById('opdTargetDbName');

const storeMismatchAlert = document.getElementById('storeMismatchAlert');
const storeMismatchNames = document.getElementById('storeMismatchNames');
const storeTargetDbName = document.getElementById('storeTargetDbName');
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

const ROLES = ["Pickers", "Backroom", "Exceptions", "IP/GMD", "Exclude", "Training"];
let currentStore = localStorage.getItem('opd_selected_store') || '';
const storeSelect = document.getElementById('storeSelect');
let support_df = [];
let all_store_associates_from_file = [];
let support_associates_db = [];

// Initialize
async function init() {
    setupTabs();
    setupStoreSelector();
    setupMobileDrawer();
    setupSupportSubtabs();
    await syncDatabase();
    loadDatabase();
    loadSupportDatabase();
}

function setupMobileDrawer() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebar = document.getElementById('appSidebar');

    if (!sidebar) return;

    const openDrawer = () => {
        sidebar.classList.add('mobile-open');
        sidebarOverlay?.classList.add('active');
    };

    const closeDrawer = () => {
        sidebar.classList.remove('mobile-open');
        sidebarOverlay?.classList.remove('active');
    };

    mobileMenuBtn?.addEventListener('click', openDrawer);
    closeSidebarBtn?.addEventListener('click', closeDrawer);
    sidebarOverlay?.addEventListener('click', closeDrawer);
}

function setupStoreSelector() {
    if (!storeSelect) return;
    storeSelect.addEventListener('change', async (e) => {
        currentStore = e.target.value;
        localStorage.setItem('opd_selected_store', currentStore);
        await syncDatabase();
        loadDatabase();
        loadSupportDatabase();
    });
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

        const storeParam = currentStore ? `?store=${encodeURIComponent(currentStore)}` : '';
        const res = await fetch(`${API_BASE}/associates${storeParam}`);
        const data = await res.json();

        if (data.active_store) {
            currentStore = data.active_store;
            localStorage.setItem('opd_selected_store', currentStore);
        }

        if (data.available_stores && data.available_stores.length > 0) {
            populateStoreDropdown(data.available_stores, currentStore);
        }

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

function populateStoreDropdown(stores, activeStore) {
    if (!storeSelect) return;
    storeSelect.innerHTML = '';
    stores.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = st;
        if (st === activeStore) opt.selected = true;
        storeSelect.appendChild(opt);
    });
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
        <td><input type="text" class="db-input db-userid" value="${assoc['User ID'] || assoc.UserID || assoc.user_id || ''}" placeholder="User ID" style="width: 90px;"></td>
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

// Quick Add OPD Mismatches
const quickAddOpdBtn = document.getElementById('quickAddOpdBtn');
if (quickAddOpdBtn) {
    quickAddOpdBtn.addEventListener('click', () => {
        // Switch to Database tab
        const dbTab = document.querySelector('[data-target="databaseView"]');
        if (dbTab) dbTab.click();

        // Hide OPD mismatch alert
        if (opdMismatchAlert) opdMismatchAlert.classList.add('hidden');

        // Remove empty state if present
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const count = currentOpdMismatches.length;
        currentOpdMismatches.forEach(item => {
            const rawName = typeof item === 'object' && item !== null ? (item.name || '') : String(item || '');
            const userId = typeof item === 'object' && item !== null ? (item.user_id || item['User ID'] || '') : '';
            const role = typeof item === 'object' && item !== null ? (item.role || item.Role || 'Pickers') : 'Pickers';

            // Keep full first and last name with clean capitalization
            let fmtName = rawName.trim().replace(/\b\w/g, l => l.toUpperCase());

            const newRow = createDbRow({
                row_index: 'new',
                Name: fmtName,
                'User ID': userId,
                Role: role,
                'Employment Type': 'Full-Time',
                'Minor Status': 'No',
                'Exclude': 'No'
            });
            dbBody.prepend(newRow);
        });

        currentOpdMismatches = [];

        // Focus the first newly added name input
        const firstInput = dbBody.querySelector('.db-name');
        if (firstInput) firstInput.focus();

        alert(`Added ${count} associate(s) to the OPD database table. Please review and click "Save Changes" to commit.`);
    });
}

// Quick Add Total Store Mismatches
const quickAddStoreBtn = document.getElementById('quickAddStoreBtn');
if (quickAddStoreBtn) {
    quickAddStoreBtn.addEventListener('click', async () => {
        let storeList = [];
        if (all_store_associates_from_file && all_store_associates_from_file.length > 0) {
            storeList = all_store_associates_from_file;
        } else if (currentStoreMismatches && currentStoreMismatches.length > 0) {
            storeList = currentStoreMismatches.map(s => ({
                Name: s.name,
                UserId: s.user_id || '',
                JobName: s.job || 'Store Associate',
                StoreSupport: 'No',
                MinorStatus: 'No',
                Notes: ''
            }));
        }

        if (storeList.length === 0) {
            alert("No store associates to add.");
            return;
        }

        const origHtml = quickAddStoreBtn.innerHTML;
        try {
            quickAddStoreBtn.disabled = true;
            quickAddStoreBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Adding to Store Database...';

            const res = await fetch(`${API_BASE}/support_associates/sync_from_csv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ store_associates: storeList, store: currentStore })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Sync failed');
            }

            const result = await res.json();
            if (storeMismatchAlert) storeMismatchAlert.classList.add('hidden');
            currentStoreMismatches = [];

            alert(`Successfully added ${result.new_added || 0} associates to ${result.support_store || 'Total Store Database'}! (Total registered: ${result.total || 0})`);
            await loadSupportDatabase();
        } catch (err) {
            alert('Error adding store associates: ' + err.message);
        } finally {
            quickAddStoreBtn.disabled = false;
            quickAddStoreBtn.innerHTML = origHtml;
        }
    });
}

// Open Store Directory from alert
const viewStoreDbFromAlertBtn = document.getElementById('viewStoreDbFromAlertBtn');
if (viewStoreDbFromAlertBtn) {
    viewStoreDbFromAlertBtn.addEventListener('click', () => {
        const suppTabBtn = document.querySelector('[data-target="supportView"]');
        if (suppTabBtn) suppTabBtn.click();
        const subtabBtn = document.getElementById('subtabSupportDb');
        if (subtabBtn) subtabBtn.click();
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
            associates: allAssociates,
            store: currentStore
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

        const storeParam = currentStore ? `?store=${encodeURIComponent(currentStore)}` : '';
        const res = await fetch(`${API_BASE}/sync${storeParam}`);
        const data = await res.json();

        if (data.status === 'success') {
            lastSyncTime.textContent = data.last_sync;
            if (data.active_store) {
                currentStore = data.active_store;
                localStorage.setItem('opd_selected_store', currentStore);
            }
            if (data.available_stores) {
                populateStoreDropdown(data.available_stores, currentStore);
            }
            if (data.sheet_url) {
                const openSheetBtn = document.getElementById('openSheetBtn');
                if (openSheetBtn) openSheetBtn.href = data.sheet_url;
                const openSupportSheetBtn = document.getElementById('openSupportSheetBtn');
                if (openSupportSheetBtn) openSupportSheetBtn.href = data.sheet_url;
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
        loadSupportDatabase(); // Refresh store support table after sync
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

        const storeParam = currentStore ? `?store=${encodeURIComponent(currentStore)}` : '';
        const res = await fetch(`${API_BASE}/upload${storeParam}`, {
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
        support_df = data.support_roster || [];
        all_store_associates_from_file = data.store_associates || [];

        // 1. OPD Database Mismatches Alert
        const opdMis = data.opd_mismatches || (data.mismatches || []);
        if (opdTargetDbName) opdTargetDbName.textContent = currentStore || 'OPD Roster';

        if (opdMis.length > 0) {
            currentOpdMismatches = opdMis;
            if (opdMismatchAlert) opdMismatchAlert.classList.remove('hidden');
            const displayNames = opdMis.map(m => {
                if (typeof m === 'object' && m !== null) {
                    return m.user_id ? `${m.name} (${m.user_id})` : m.name;
                }
                return m;
            });
            if (opdMismatchNames) opdMismatchNames.textContent = displayNames.join(', ');
        } else {
            if (opdMismatchAlert) opdMismatchAlert.classList.add('hidden');
            currentOpdMismatches = [];
        }

        // 2. Total Store Database Mismatches Alert
        const storeMis = data.store_mismatches || [];
        const suppSheetTitle = data.support_store || (currentStore ? currentStore.replace(/opd\s*roster/i, 'Store Support') : 'Store Support');
        if (storeTargetDbName) storeTargetDbName.textContent = suppSheetTitle;

        if (storeMis.length > 0) {
            currentStoreMismatches = storeMis;
            if (storeMismatchAlert) storeMismatchAlert.classList.remove('hidden');
            const displayStoreNames = storeMis.map(s => {
                if (typeof s === 'object' && s !== null) {
                    const jobStr = s.job ? ` - ${s.job}` : '';
                    return s.user_id ? `${s.name} (${s.user_id}${jobStr})` : `${s.name}${jobStr}`;
                }
                return s;
            });
            if (storeMismatchNames) storeMismatchNames.textContent = displayStoreNames.join(', ');
        } else {
            if (storeMismatchAlert) storeMismatchAlert.classList.add('hidden');
            currentStoreMismatches = [];
        }

        calculationDone = false;
        renderRoster();
        updateStats();
        renderSupportViews();

        calcLunchesBtn.disabled = main_df.length === 0;
        downloadPdfBtn.disabled = (main_df.length === 0 && support_df.length === 0);
        if (exportDashboardBtn) exportDashboardBtn.disabled = (main_df.length === 0 && support_df.length === 0);
        
        const clearPdfBtn = document.getElementById('clearPdfBtn');
        if (clearPdfBtn) clearPdfBtn.disabled = (main_df.length === 0 && support_df.length === 0);

    } catch (error) {
        alert("Error: " + error.message);
        renderRoster(); // Fallback to previous
        renderSupportViews();
    }

    // Reset file input
    pdfUpload.value = '';
});

// Clear PDF
const clearPdfBtn = document.getElementById('clearPdfBtn');
if (clearPdfBtn) {
    clearPdfBtn.addEventListener('click', () => {
        main_df = [];
        support_df = [];
        all_store_associates_from_file = [];
        calculationDone = false;
        
        // Reset UI metrics
        pickerCount.textContent = '0';
        backroomCount.textContent = '0';
        exceptionCount.textContent = '0';
        const supportCountEl = document.getElementById('supportCount');
        if (supportCountEl) supportCountEl.textContent = '0';
        
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
        
        // Reset Store Support Views
        renderSupportViews();
        
        // Hide mismatches
        if (opdMismatchAlert) opdMismatchAlert.classList.add('hidden');
        if (storeMismatchAlert) storeMismatchAlert.classList.add('hidden');
        currentOpdMismatches = [];
        currentStoreMismatches = [];
        
        // Disable buttons
        calcLunchesBtn.disabled = true;
        downloadPdfBtn.disabled = true;
        if (exportDashboardBtn) exportDashboardBtn.disabled = true;
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
        let clean = name.replace(/[🔴🔵🟡🟠💖💙💛🧡🎓]\s*/gu, '').trim();
        if (role === "Pickers" || role === "Picker") return `🔴 ${clean}`;
        if (role === "Backroom") return `🔵 ${clean}`;
        if (role === "Exceptions") return `🟡 ${clean}`;
        if (role === "IP/GMD" || role === "IPGMD") return `🟠 ${clean}`;
        if (role === "Training") return `🎓 ${clean}`;
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
        if (!row.Role || row.Role === 'Exclude' || row.Role === 'Training') return;
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
            const newRole = e.target.value;
            main_df[idx].Role = newRole;
            // Clean emojis off data store string so they don't compound
            main_df[idx].Associate = main_df[idx].Associate.replace(/[🔴🔵🟡🟠💖💙💛🧡🎓]\s*/gu, '').trim();
            if (newRole === 'Exclude' || newRole === 'Training') {
                main_df[idx]['Break 1'] = 'N/A';
                main_df[idx]['Lunch Time'] = 'N/A';
                main_df[idx]['Break 2'] = 'N/A';
            }
            updateStats();
            if (calculationDone) updateCoverageTable();
            renderRoster(); // Quick re-render to update icons and break fields
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
    const supportCountEl = document.getElementById('supportCount');
    if (supportCountEl) supportCountEl.textContent = support_df ? support_df.length : 0;
}

// Download PDF
downloadPdfBtn.addEventListener('click', () => {
    if (main_df.length === 0 && support_df.length === 0) return;

    // Output Context
    const docTitle = uploadedPdfName;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(docTitle, 14, 20);

    // Prepare OPD Roster Data
    if (main_df.length > 0) {
        const tableData = [];
        main_df.forEach(row => {
            // Strip emojis and minor tags for clean PDF
            let cleanName = row.Associate.replace(/[🔴🔵🟡🟠💖💙💛🧡🎓]/gu, "").replace(/\(M\)/g, "").trim();
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
            startY: 28,
            head: [['Associate', 'Role', 'Shift', 'Break 1', 'Lunch Time', 'Break 2']],
            body: tableData,
            theme: 'striped',
            headStyles: { fillColor: [0, 113, 206] }, // Walmart Blue
            rowPageBreak: 'avoid',
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
    }

    // Add Hourly Coverage Table
    if (calculationDone && main_df.length > 0) {
        let finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY + 12 : 28);
        if (finalY > 230) {
            doc.addPage();
            finalY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("OPD Hourly Staffing Coverage", 14, finalY);

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
                startY: finalY + 4,
                head: headRow,
                body: coverageData,
                theme: 'striped',
                headStyles: { fillColor: [0, 113, 206] },
                rowPageBreak: 'avoid',
                styles: { font: 'helvetica', fontSize: 9 }
            });
        }
    }

    // Add Store Support Coverage Table
    if (support_df && support_df.length > 0) {
        let finalY = (doc.lastAutoTable ? doc.lastAutoTable.finalY + 12 : 28);
        if (finalY > 220) {
            doc.addPage();
            finalY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.text("Daily Store Support Availability (Cross-Trained Associates)", 14, finalY);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(80, 80, 80);
        doc.text(`Total On-Duty Support: ${support_df.length} Associates | Eligible to support OPD throughout their scheduled shifts`, 14, finalY + 5);
        doc.setTextColor(0, 0, 0);

        const supportTableData = [];
        support_df.forEach(s => {
            const cleanName = s.Associate.replace(/[🔴🔵🟡🟠💖💙💛🧡🎓]/gu, "").replace(/\(M\)/g, "").trim();
            supportTableData.push([
                cleanName,
                s.JobName || 'Store Associate',
                s.Shift,
                `${s.Duration ? s.Duration.toFixed(1) : 8} hrs`,
                s.Notes || 'Available to support'
            ]);
        });

        doc.autoTable({
            startY: finalY + 8,
            head: [['Support Associate', 'Home Department / Job Title', 'Scheduled Shift', 'Hours', 'Notes']],
            body: supportTableData,
            theme: 'striped',
            headStyles: { fillColor: [2, 132, 199] }, // Cyan / Walmart Secondary
            styles: { font: 'helvetica', fontSize: 8.5 },
            columnStyles: {
                0: { cellWidth: 46 },
                1: { cellWidth: 50 },
                2: { cellWidth: 35 },
                3: { cellWidth: 20 },
                4: { cellWidth: 35 }
            }
        });

        // Add Hourly Support Availability Breakdown table in PDF
        let suppTableFinalY = doc.lastAutoTable.finalY + 10;
        if (suppTableFinalY > 240) {
            doc.addPage();
            suppTableFinalY = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Hourly Store Support Availability Summary", 14, suppTableFinalY);

        const timelineHours = [];
        const timelineCounts = [];
        const hourlyDetailedRows = [];

        for (let h = 5; h <= 21; h++) {
            let lblH = h <= 12 ? h : h - 12;
            let lblAmpm = h < 12 ? 'AM' : 'PM';
            let nextH = (h + 1) <= 12 ? (h + 1) : (h + 1) - 12;
            let nextAmpm = (h + 1) < 12 ? 'AM' : (h + 1 === 24 ? 'AM' : 'PM');
            
            timelineHours.push(`${lblH}${lblAmpm.toLowerCase()}`);
            
            const staffInHour = [];
            const seenHourAssocs = new Set();

            support_df.forEach(s => {
                if (!s.StartDt || !s.EndDt) return;
                let sd = new Date(s.StartDt);
                let ed = new Date(s.EndDt);
                let sm = sd.getHours() * 60 + sd.getMinutes();
                let em = ed.getHours() * 60 + ed.getMinutes();
                if (em < sm) em += 24 * 60;
                if (sm < (h + 1) * 60 && em > h * 60) {
                    const key = (s.UserId || s.Associate || s.Name || '').toLowerCase().trim();
                    if (!seenHourAssocs.has(key)) {
                        seenHourAssocs.add(key);
                        let cleanName = (s.Name || s.Associate || '')
                            .replace(/[🔴🔵🟡🧡💖💙💛🧡🎓]/gu, '')
                            .replace(/\([A-Z0-9_\-]+\)/gi, '') // Remove (JAKRUEG)
                            .replace(/\(M\)/gi, '')
                            .trim();

                        const nameParts = cleanName.split(/\s+/).filter(Boolean);
                        const dedupParts = [];
                        nameParts.forEach(p => {
                            if (dedupParts.length === 0 || dedupParts[dedupParts.length - 1].toLowerCase() !== p.toLowerCase()) {
                                dedupParts.push(p);
                            }
                        });
                        cleanName = dedupParts.join(' ').trim();
                        staffInHour.push(cleanName);
                    }
                }
            });

            timelineCounts.push(staffInHour.length.toString());

            if (staffInHour.length > 0) {
                hourlyDetailedRows.push({
                    timeRange: `${lblH}:00 ${lblAmpm} - ${nextH}:00 ${nextAmpm}`,
                    count: `${staffInHour.length} Support`,
                    namesText: staffInHour.join('  •  '),
                    namesList: staffInHour
                });
            }
        }

        doc.autoTable({
            startY: suppTableFinalY + 4,
            head: [timelineHours],
            body: [timelineCounts],
            theme: 'grid',
            headStyles: { fillColor: [4, 30, 66], fontSize: 7, halign: 'center' }, // Walmart Dark Blue
            styles: { font: 'helvetica', fontSize: 7.5, halign: 'center' }
        });

        // Add Hour-by-Hour Associate Roster Breakdown in PDF
        if (hourlyDetailedRows.length > 0) {
            let detailFinalY = doc.lastAutoTable.finalY + 10;
            if (detailFinalY > 230) {
                doc.addPage();
                detailFinalY = 20;
            }

            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.text("Hour-by-Hour Store Support Staff On-Duty", 14, detailFinalY);

            const tableBody = hourlyDetailedRows.map(r => [r.timeRange, r.count, r.namesText]);

            doc.autoTable({
                startY: detailFinalY + 4,
                head: [['Hour Window', 'Staff Count', 'Scheduled Support Associates']],
                body: tableBody,
                theme: 'striped',
                headStyles: { fillColor: [0, 113, 206] },
                rowPageBreak: 'avoid',
                styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5 },
                columnStyles: {
                    0: { cellWidth: 38, fontStyle: 'bold' },
                    1: { cellWidth: 26, halign: 'center' },
                    2: { cellWidth: 'auto', textColor: [255, 255, 255] }
                },
                didDrawCell: function(data) {
                    if (data.section === 'body' && data.column.index === 2) {
                        const rowIndex = data.row.index;
                        const rowData = hourlyDetailedRows[rowIndex];
                        if (!rowData || !rowData.namesList || rowData.namesList.length === 0) return;

                        // Repaint background cleanly before custom bold/regular text rendering
                        const isEven = rowIndex % 2 === 0;
                        const bg = isEven ? [255, 255, 255] : [245, 245, 245];
                        doc.setFillColor(bg[0], bg[1], bg[2]);
                        doc.rect(data.cell.x, data.cell.y, data.cell.width, data.cell.height, 'F');

                        // Draw names with alternating bold / regular font
                        const paddingX = 2.5;
                        const startX = data.cell.x + paddingX;
                        const maxX = data.cell.x + data.cell.width - paddingX;
                        let currentX = startX;
                        let currentY = data.cell.y + 4.6;
                        const lineHeight = 3.6;

                        doc.setFontSize(8);

                        rowData.namesList.forEach((name, idx) => {
                            const isBold = (idx % 2 === 0);
                            doc.setFont("helvetica", isBold ? "bold" : "normal");
                            doc.setTextColor(isBold ? 15 : 60, isBold ? 23 : 60, isBold ? 42 : 60);

                            const nameWidth = doc.getTextWidth(name);
                            if (currentX + nameWidth > maxX && currentX > startX) {
                                currentX = startX;
                                currentY += lineHeight;
                            }
                            doc.text(name, currentX, currentY);
                            currentX += nameWidth;

                            if (idx < rowData.namesList.length - 1) {
                                doc.setFont("helvetica", "normal");
                                doc.setTextColor(140, 140, 140);
                                const sep = "  •  ";
                                const sepWidth = doc.getTextWidth(sep);
                                if (currentX + sepWidth > maxX && currentX > startX) {
                                currentX = startX;
                                currentY += lineHeight;
                            }
                            doc.text(sep, currentX, currentY);
                            currentX += sepWidth;
                        }
                    });
                }
            }
        });
    }
    }

    doc.save(`${docTitle}.pdf`);
    exportDecisionDashboardJson(docTitle, main_df, support_df);
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

    for (let h = 5; h < 22; h++) {
        let lblH = h <= 12 ? h : h - 12;
        let lblAmpm = h < 12 ? 'AM' : 'PM';
        let lbl = h === 12 ? "12 PM" : `${lblH} ${lblAmpm} `;

        let pCount = 0, bCount = 0, eCount = 0, ipCount = 0;

        main_df.forEach(r => {
            if (r.Role === 'Exclude' || r.Role === 'Training') return;
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
                    if (h === 5) {
                        // 5 AM - 6 AM: All hands pick (no backroom work needed). Exceptions picker starts and is treated normal.
                        if (r.Role === "Backroom" || r.Role === "IP/GMD" || r.Role === "IPGMD") {
                            act = "Pickers";
                        }
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
            const storeParam = currentStore ? `?store=${encodeURIComponent(currentStore)}` : '';
            const res = await fetch(`${API_BASE}/associates${storeParam}`);
            if (res.ok) {
                const data = await res.json();
                const associates = data.associates;
                
                // Filter out excluded and training ones from manual roster add
                const active = associates.filter(a => a.Exclude?.toLowerCase() !== 'yes' && a.Role?.toLowerCase() !== 'training' && a.Name?.trim() !== '');
                
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
        let fmtName = (assoc.Name || '').trim().replace(/\b\w/g, l => l.toUpperCase());
        const isMinor = assoc['Minor Status']?.toLowerCase() === 'yes';
        const matchName = isMinor ? `(M) ${fmtName}` : fmtName;
        
        let assignedRole = "Pickers";
        const sheetRole = assoc.Role?.toLowerCase() || "";
        if (sheetRole.includes("picker")) assignedRole = "Pickers";
        else if (sheetRole.includes("backroom") || sheetRole.includes("dispense")) assignedRole = "Backroom";
        else if (sheetRole.includes("exception")) assignedRole = "Exceptions";
        else if (sheetRole.includes("ip") || sheetRole.includes("gmd")) assignedRole = "IP/GMD";
        else if (sheetRole.includes("train")) assignedRole = "Training";
        else if (sheetRole.includes("exclude")) assignedRole = "Exclude";
        
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
const exportDashboardBtn = document.getElementById('exportDashboardBtn');
        const clearPdfBtn = document.getElementById('clearPdfBtn');
        if (calcLunchesBtn) calcLunchesBtn.disabled = main_df.length === 0;
        if (downloadPdfBtn) downloadPdfBtn.disabled = main_df.length === 0;
        if (exportDashboardBtn) exportDashboardBtn.disabled = main_df.length === 0;
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

// ==========================================
// STORE SUPPORT IMPLEMENTATION
// ==========================================

// Hourly View state (cards vs matrix)
let currentHourlySupportView = 'cards';
let hourlySupportSearchTerm = '';

function setupSupportSubtabs() {
    const subtabToday = document.getElementById('subtabTodaySupport');
    const subtabDb = document.getElementById('subtabSupportDb');
    const todaySection = document.getElementById('todaySupportSection');
    const dbSection = document.getElementById('supportDbSection');

    if (subtabToday && subtabDb) {
        subtabToday.addEventListener('click', () => {
            subtabToday.classList.add('active');
            subtabDb.classList.remove('active');
            if (todaySection) todaySection.classList.remove('hidden');
            if (dbSection) dbSection.classList.add('hidden');
        });

        subtabDb.addEventListener('click', () => {
            subtabDb.classList.add('active');
            subtabToday.classList.remove('active');
            if (dbSection) dbSection.classList.remove('hidden');
            if (todaySection) todaySection.classList.add('hidden');
        });
    }

    // View Toggle: Hour Cards vs Matrix Table
    const btnViewHourCards = document.getElementById('btnViewHourCards');
    const btnViewMatrix = document.getElementById('btnViewMatrix');
    const cardsContainer = document.getElementById('supportHourCardsContainer');
    const matrixContainer = document.getElementById('supportMatrixContainer');

    if (btnViewHourCards && btnViewMatrix) {
        btnViewHourCards.addEventListener('click', () => {
            currentHourlySupportView = 'cards';
            btnViewHourCards.classList.add('active');
            btnViewMatrix.classList.remove('active');
            if (cardsContainer) cardsContainer.classList.remove('hidden');
            if (matrixContainer) matrixContainer.classList.add('hidden');
        });

        btnViewMatrix.addEventListener('click', () => {
            currentHourlySupportView = 'matrix';
            btnViewMatrix.classList.add('active');
            btnViewHourCards.classList.remove('active');
            if (cardsContainer) cardsContainer.classList.add('hidden');
            if (matrixContainer) matrixContainer.classList.remove('hidden');
        });
    }

    // Search filter for hourly support view
    const hourlySearchInput = document.getElementById('supportHourlySearchInput');
    if (hourlySearchInput) {
        hourlySearchInput.addEventListener('input', (e) => {
            hourlySupportSearchTerm = e.target.value.toLowerCase().trim();
            renderSupportHourCards();
        });
    }
}

function renderSupportViews() {
    renderSupportTimeline();
    updateSupportBanners();
}

function updateSupportBanners() {
    const bannerCount = document.getElementById('bannerSupportCount');
    const bannerHours = document.getElementById('bannerSupportHours');
    const bannerPool = document.getElementById('bannerSupportPool');
    const todayCountBadge = document.getElementById('todaySupportCountBadge');
    const supportCountEl = document.getElementById('supportCount');

    const totalCount = support_df ? support_df.length : 0;
    if (bannerCount) bannerCount.textContent = totalCount;
    if (todayCountBadge) todayCountBadge.textContent = totalCount;
    if (supportCountEl) supportCountEl.textContent = totalCount;

    let totalHrs = 0;
    if (support_df) {
        support_df.forEach(s => {
            totalHrs += (s.Duration || 0);
        });
    }
    if (bannerHours) bannerHours.textContent = `${totalHrs.toFixed(1)} hrs`;

    const activePool = support_associates_db.filter(a => {
        const val = String(a['Store Support'] || a.StoreSupport || '').trim().toLowerCase();
        return val === 'yes' || val === 'true';
    }).length;
    if (bannerPool) bannerPool.textContent = `${activePool} Active`;
}

// Renders the Hour-by-Hour Columns & Cards layout
function renderSupportHourCards() {
    const grid = document.getElementById('supportHourCardsGrid');
    if (!grid) return;

    if (!support_df || support_df.length === 0) {
        grid.innerHTML = `
            <div style="flex: 1; text-align: center; padding: 3rem 1rem; color: #64748b; background: #f8fafc; border-radius: 10px; border: 1px dashed #cbd5e1;">
                <i class="fa-solid fa-handshake-slash fa-2x" style="margin-bottom: 0.75rem; color: #94a3b8; display: block;"></i>
                <h4 style="font-weight: 600; color: #334155; margin-bottom: 0.35rem;">No Store Support Scheduled Today</h4>
                <p style="font-size: 0.85rem; color: #94a3b8; max-width: 480px; margin: 0 auto;">
                    Upload a full store CSV schedule or enable "Store Support" in the Store Directory tab to see hourly support availability.
                </p>
            </div>
        `;
        return;
    }

    // Build timeline hours from 5 AM (5) to 9 PM (21) -> spans 5 AM to 10 PM
    const hours = [];
    for (let h = 5; h <= 21; h++) {
        let lblH = h <= 12 ? h : h - 12;
        let lblAmpm = h < 12 ? 'AM' : 'PM';
        let nextH = (h + 1) <= 12 ? (h + 1) : (h + 1) - 12;
        let nextAmpm = (h + 1) < 12 ? 'AM' : (h + 1 === 24 ? 'AM' : 'PM');
        hours.push({
            hour: h,
            label: `${lblH} ${lblAmpm}`,
            timeRange: `${lblH}:00 ${lblAmpm} - ${nextH}:00 ${nextAmpm}`
        });
    }

    grid.innerHTML = '';

    hours.forEach(h => {
        const hStart = h.hour * 60;
        const hEnd = (h.hour + 1) * 60;

        // Find all associates scheduled during this hour (deduplicated per associate)
        const activeAssocs = [];
        const seenAssocHourKeys = new Set();

        support_df.forEach(assoc => {
            let sm = 0, em = 0;
            if (assoc.StartDt && assoc.EndDt) {
                let sd = new Date(assoc.StartDt);
                let ed = new Date(assoc.EndDt);
                sm = sd.getHours() * 60 + sd.getMinutes();
                em = ed.getHours() * 60 + ed.getMinutes();
                if (em < sm) em += 24 * 60;
            }

            if (sm < hEnd && em > hStart) {
                const assocKey = (assoc.UserId || assoc.Associate || assoc.Name || '').toLowerCase().trim();
                if (assocKey && seenAssocHourKeys.has(assocKey)) return;
                if (assocKey) seenAssocHourKeys.add(assocKey);

                // Apply search filter if active
                if (hourlySupportSearchTerm) {
                    const name = (assoc.Associate || '').toLowerCase();
                    const job = (assoc.JobName || '').toLowerCase();
                    const notes = (assoc.Notes || '').toLowerCase();
                    const shift = (assoc.Shift || '').toLowerCase();
                    if (!name.includes(hourlySupportSearchTerm) && !job.includes(hourlySupportSearchTerm) && !notes.includes(hourlySupportSearchTerm) && !shift.includes(hourlySupportSearchTerm)) {
                        return;
                    }
                }
                activeAssocs.push(assoc);
            }
        });

        const count = activeAssocs.length;
        const hasStaff = count > 0;
        const isPeak = count >= 12;

        const colCard = document.createElement('div');
        colCard.className = `hour-col-card ${hasStaff ? 'has-staff' : ''} ${isPeak ? 'peak-staff' : ''}`;

        // Header
        const countBadgeClass = count === 0 ? 'zero' : (isPeak ? 'peak' : '');
        const countBadgeText = count === 0 ? '0 Support' : `${count} Support`;

        colCard.innerHTML = `
            <div class="hour-col-header">
                <div class="hour-col-time">
                    <span class="hour-col-label">${h.label}</span>
                    <span class="hour-col-sub">${h.timeRange}</span>
                </div>
                <span class="hour-col-count-badge ${countBadgeClass}">
                    ${isPeak ? '<i class="fa-solid fa-fire" style="color: #10b981; font-size: 0.7rem;"></i>' : ''}
                    ${countBadgeText}
                </span>
            </div>
            <div class="hour-col-body">
                ${count === 0 ? `
                    <div class="hour-assoc-empty">
                        <i class="fa-regular fa-clock" style="color: #cbd5e1; font-size: 1.35rem;"></i>
                        <span>No support available</span>
                    </div>
                ` : activeAssocs.map(assoc => {
                    let cleanName = (assoc.Associate || '').replace(/[🔴🔵🟡🧡💖💙💛🧡🎓]/gu, '').replace(/\(M\)/g, '').trim();
                    // Clean duplicate adjacent names like "Graysi Graysi Castillo" -> "Graysi Castillo"
                    const nameParts = cleanName.split(/\s+/);
                    const dedupParts = [];
                    nameParts.forEach(p => {
                        if (dedupParts.length === 0 || dedupParts[dedupParts.length - 1].toLowerCase() !== p.toLowerCase()) {
                            dedupParts.push(p);
                        }
                    });
                    cleanName = dedupParts.join(' ');

                    const jobName = assoc.JobName || 'Store Associate';
                    const isMinor = (assoc.Minor === true || String(assoc.Minor).toLowerCase() === 'yes' || (assoc.Associate && assoc.Associate.includes('(M)')));
                    const notes = assoc.Notes ? String(assoc.Notes).trim() : '';

                    return `
                        <div class="hour-assoc-item">
                            <div class="hour-assoc-top">
                                <span class="hour-assoc-name" title="${cleanName}">${cleanName}</span>
                                ${isMinor ? '<span class="hour-assoc-minor-badge">MINOR</span>' : ''}
                            </div>
                            <div>
                                <span class="hour-assoc-dept" title="${jobName}">${jobName}</span>
                            </div>
                            <div class="hour-assoc-meta">
                                <span class="hour-assoc-shift">
                                    <i class="fa-regular fa-clock" style="color: #94a3b8; font-size: 0.65rem;"></i>
                                    ${assoc.Shift}
                                </span>
                                ${notes ? `<span style="color: #0284c7; font-size: 0.7rem; font-weight: 500;" title="${notes}"><i class="fa-solid fa-tag"></i></span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        grid.appendChild(colCard);
    });
}

function renderSupportTimeline() {
    // Render Hour Columns View
    renderSupportHourCards();

    // Also render Matrix Table View
    const table = document.getElementById('supportTimelineTable');
    const theadRow = document.getElementById('timelineHeadRow');
    const tbody = document.getElementById('supportTimelineBody');
    const tfoot = document.getElementById('supportTimelineFoot');

    if (!table || !theadRow || !tbody || !tfoot) return;

    // Build timeline hours from 5 AM (5) to 9 PM (21) -> spans 5 AM to 10 PM
    const hours = [];
    for (let h = 5; h <= 21; h++) {
        let lblH = h <= 12 ? h : h - 12;
        let lblAmpm = h < 12 ? 'AM' : 'PM';
        hours.push({
            hour: h,
            label: `${lblH} ${lblAmpm}`
        });
    }

    // Set Header
    theadRow.innerHTML = `
        <th class="col-assoc">Associate & Home Dept</th>
        <th class="col-shift">Shift Time</th>
        ${hours.map(h => `<th style="min-width: 44px; padding: 0.5rem 0.2rem;">${h.label}</th>`).join('')}
    `;

    if (!support_df || support_df.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="${hours.length + 2}" style="text-align: center; padding: 2.5rem; color: #64748b;">
                    <i class="fa-solid fa-handshake-slash fa-2x" style="margin-bottom: 0.75rem; color: #94a3b8; display: block;"></i>
                    <p style="font-weight: 500; font-size: 0.95rem;">No store support associates scheduled for today</p>
                    <p style="font-size: 0.82rem; color: #94a3b8; margin-top: 0.25rem;">Upload a whole store schedule CSV or mark associates as "Yes" in the Store Directory</p>
                </td>
            </tr>
        `;
        tfoot.innerHTML = '';
        return;
    }

    tbody.innerHTML = '';
    const hourlyTotals = {};
    hours.forEach(h => { hourlyTotals[h.hour] = 0; });

    support_df.forEach(assoc => {
        let sm = 0, em = 0;
        if (assoc.StartDt && assoc.EndDt) {
            let sd = new Date(assoc.StartDt);
            let ed = new Date(assoc.EndDt);
            sm = sd.getHours() * 60 + sd.getMinutes();
            em = ed.getHours() * 60 + ed.getMinutes();
            if (em < sm) em += 24 * 60;
        }

        const tr = document.createElement('tr');
        
        let hourCellsHtml = '';
        hours.forEach(h => {
            const hStart = h.hour * 60;
            const hEnd = (h.hour + 1) * 60;
            const isActive = (sm < hEnd && em > hStart);
            if (isActive) hourlyTotals[h.hour]++;

            hourCellsHtml += `
                <td>
                    <div class="hour-block ${isActive ? 'active-hour' : ''}" title="${assoc.Associate}: ${h.label} ${isActive ? 'Available' : 'Off'}">
                        ${isActive ? '<i class="fa-solid fa-check" style="font-size: 0.65rem;"></i>' : ''}
                    </div>
                </td>
            `;
        });

        const cleanJob = assoc.JobName || 'Store Associate';
        tr.innerHTML = `
            <td class="col-assoc">
                <div style="font-weight: 600; color: var(--wm-blue-dark);">${assoc.Associate}</div>
                <div class="dept-tag" title="${cleanJob}">${cleanJob}</div>
            </td>
            <td class="col-shift">
                <span class="badge" style="background: #e2e8f0; color: #334155; font-size: 0.78rem;">${assoc.Shift}</span>
            </td>
            ${hourCellsHtml}
        `;
        tbody.appendChild(tr);
    });

    // Footer summary row
    tfoot.innerHTML = `
        <tr class="timeline-summary-row">
            <td colspan="2" style="text-align: right; padding-right: 1rem;">Total Support Available:</td>
            ${hours.map(h => {
                const count = hourlyTotals[h.hour] || 0;
                return `<td><span class="timeline-count-badge ${count === 0 ? 'zero' : ''}">${count}</span></td>`;
            }).join('')}
        </tr>
    `;
}



async function loadSupportDatabase() {
    const tbody = document.getElementById('supportDbBody');
    if (!tbody) return;

    try {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; padding: 2rem;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p>Loading store support database...</p>
                </td>
            </tr>
        `;

        const storeParam = currentStore ? `?store=${encodeURIComponent(currentStore)}` : '';
        const res = await fetch(`${API_BASE}/support_associates${storeParam}`);
        if (!res.ok) throw new Error('Failed to fetch support database');

        const data = await res.json();
        support_associates_db = data.support_associates || [];

        const totalBadge = document.getElementById('totalStoreCountBadge');
        if (totalBadge) totalBadge.textContent = support_associates_db.length;

        const subtext = document.getElementById('supportSheetSubtext');
        if (subtext && data.support_store) {
            subtext.textContent = `Cross-trained store associates in "${data.support_store}" available to support OPD`;
        }
        
        const openSheetBtn = document.getElementById('openSupportSheetBtn');
        if (openSheetBtn && data.sheet_url) {
            openSheetBtn.href = data.sheet_url;
        }

        renderSupportDbTable();
        updateSupportBanners();

    } catch (e) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align:center; padding: 2rem; color: #ef4444;">
                    <i class="fa-solid fa-circle-exclamation fa-2x"></i>
                    <p>Error loading store support database: ${e.message}</p>
                </td>
            </tr>
        `;
    }
}

function renderSupportDbTable() {
    const tbody = document.getElementById('supportDbBody');
    if (!tbody) return;

    if (!support_associates_db || support_associates_db.length === 0) {
        tbody.innerHTML = `
            <tr class="empty-state">
                <td colspan="7" style="text-align:center; padding: 2rem;">
                    <i class="fa-solid fa-users fa-2x" style="color: #94a3b8; margin-bottom: 0.5rem;"></i>
                    <p>No store associates in database. Click "Sync Associates From CSV" to import.</p>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';
    support_associates_db.forEach((assoc, idx) => {
        const tr = document.createElement('tr');
        tr.className = 'support-db-row';
        tr.dataset.idx = idx;

        const rawSupp = String(assoc['Store Support'] || assoc.StoreSupport || '').trim().toLowerCase();
        const isSupport = (rawSupp === 'yes' || rawSupp === 'true' || rawSupp === '1');
        const rawMinor = String(assoc['Minor Status'] || assoc.MinorStatus || '').trim().toLowerCase();
        const isMinor = (rawMinor === 'yes');

        tr.innerHTML = `
            <td style="text-align: center;"><input type="checkbox" class="support-select-checkbox" data-idx="${idx}"></td>
            <td><input type="text" class="support-db-name db-input" value="${assoc.Name || ''}" style="width: 100%;"></td>
            <td><input type="text" class="support-db-userid db-input" value="${assoc['User ID'] || assoc.UserId || ''}" style="width: 100px;"></td>
            <td><input type="text" class="support-db-job db-input" value="${assoc['Job Name'] || assoc.JobName || ''}" style="width: 100%;"></td>
            <td>
                <select class="support-db-status db-input" style="font-weight: 600; color: ${isSupport ? '#15803d' : '#64748b'};">
                    <option value="Yes" ${isSupport ? 'selected' : ''}>✅ Yes (Support)</option>
                    <option value="No" ${!isSupport ? 'selected' : ''}>❌ No</option>
                </select>
            </td>
            <td>
                <select class="support-db-minor db-input" style="width: 70px;">
                    <option value="No" ${!isMinor ? 'selected' : ''}>No</option>
                    <option value="Yes" ${isMinor ? 'selected' : ''}>Yes</option>
                </select>
            </td>
            <td><input type="text" class="support-db-notes db-input" value="${assoc.Notes || ''}" placeholder="e.g. Dispense only" style="width: 100%;"></td>
        `;
        tbody.appendChild(tr);
    });

    // Add change listeners to status dropdowns for color feedback
    document.querySelectorAll('.support-db-status').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const isYes = e.target.value === 'Yes';
            e.target.style.color = isYes ? '#15803d' : '#64748b';
        });
    });

    filterSupportDbTable();
}

function filterSupportDbTable() {
    const searchInput = document.getElementById('supportDbSearchInput');
    const filterSelect = document.getElementById('supportFilterSelect');
    if (!searchInput || !filterSelect) return;

    const query = searchInput.value.toLowerCase().trim();
    const filter = filterSelect.value;
    const rows = document.querySelectorAll('.support-db-row');

    rows.forEach(tr => {
        const name = tr.querySelector('.support-db-name')?.value.toLowerCase() || '';
        const userId = tr.querySelector('.support-db-userid')?.value.toLowerCase() || '';
        const job = tr.querySelector('.support-db-job')?.value.toLowerCase() || '';
        const status = tr.querySelector('.support-db-status')?.value || 'No';

        const matchesQuery = name.includes(query) || userId.includes(query) || job.includes(query);
        let matchesFilter = true;
        if (filter === 'yes') matchesFilter = (status === 'Yes');
        if (filter === 'no') matchesFilter = (status === 'No');

        tr.style.display = (matchesQuery && matchesFilter) ? '' : 'none';
    });
}

// Save Support DB
const saveSupportBatchBtn = document.getElementById('saveSupportBatchBtn');
if (saveSupportBatchBtn) {
    saveSupportBatchBtn.addEventListener('click', async () => {
        const rows = document.querySelectorAll('.support-db-row');
        const updatedList = [];

        rows.forEach(tr => {
            updatedList.push({
                "Name": tr.querySelector('.support-db-name')?.value.trim() || '',
                "User ID": tr.querySelector('.support-db-userid')?.value.trim() || '',
                "Job Name": tr.querySelector('.support-db-job')?.value.trim() || '',
                "Store Support": tr.querySelector('.support-db-status')?.value || 'No',
                "Minor Status": tr.querySelector('.support-db-minor')?.value || 'No',
                "Notes": tr.querySelector('.support-db-notes')?.value.trim() || ''
            });
        });

        const originalText = saveSupportBatchBtn.innerHTML;
        try {
            saveSupportBatchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';
            saveSupportBatchBtn.disabled = true;

            const res = await fetch(`${API_BASE}/support_associates/batch_update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ associates: updatedList, store: currentStore })
            });

            if (!res.ok) throw new Error('Failed to save changes');
            await loadSupportDatabase();
            alert("Store support database saved successfully!");
        } catch (e) {
            alert("Error saving support changes: " + e.message);
        } finally {
            saveSupportBatchBtn.innerHTML = originalText;
            saveSupportBatchBtn.disabled = false;
        }
    });
}

// Sync Support From CSV
const syncSupportFromCsvBtn = document.getElementById('syncSupportFromCsvBtn');
if (syncSupportFromCsvBtn) {
    syncSupportFromCsvBtn.addEventListener('click', async () => {
        if (!all_store_associates_from_file || all_store_associates_from_file.length === 0) {
            alert("No schedule uploaded yet. Please upload a whole store schedule CSV first!");
            return;
        }

        const originalText = syncSupportFromCsvBtn.innerHTML;
        try {
            syncSupportFromCsvBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Syncing...';
            syncSupportFromCsvBtn.disabled = true;

            const res = await fetch(`${API_BASE}/support_associates/sync_from_csv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ store_associates: all_store_associates_from_file, store: currentStore })
            });

            if (!res.ok) throw new Error('Sync failed');
            const result = await res.json();
            alert(`Sync complete! Added ${result.new_added || 0} new associates. Total in directory: ${result.total || 0}`);
            await loadSupportDatabase();
        } catch (e) {
            alert("Error syncing: " + e.message);
        } finally {
            syncSupportFromCsvBtn.innerHTML = originalText;
            syncSupportFromCsvBtn.disabled = false;
        }
    });
}

// Support search and filter event listeners
const supportDbSearchInput = document.getElementById('supportDbSearchInput');
if (supportDbSearchInput) supportDbSearchInput.addEventListener('input', filterSupportDbTable);

const supportFilterSelect = document.getElementById('supportFilterSelect');
if (supportFilterSelect) supportFilterSelect.addEventListener('change', filterSupportDbTable);

// Select all checkbox
const selectAllSupportCheckbox = document.getElementById('selectAllSupportCheckbox');
if (selectAllSupportCheckbox) {
    selectAllSupportCheckbox.addEventListener('change', (e) => {
        document.querySelectorAll('.support-select-checkbox').forEach(cb => {
            cb.checked = e.target.checked;
        });
    });
}


if (exportDashboardBtn) {
    exportDashboardBtn.addEventListener('click', () => {
        if (main_df.length === 0 && support_df.length === 0) return;
        exportDecisionDashboardJson(uploadedPdfName, main_df, support_df);
    });
}


// Export structured data for Store Fulfillment Decision Dashboard
function exportDecisionDashboardJson(docTitle, main_df, support_df) {
    if (!main_df || (main_df.length === 0 && (!support_df || support_df.length === 0))) {
        alert("Please upload a roster and calculate lunches before exporting.");
        return;
    }

    try {
        const slots = [];
        // Operational windows from 5 AM to 9 PM (hours 5 to 21, spanning 5 AM to 10 PM)
        for (let h = 5; h <= 21; h++) {
            let startH = h <= 12 ? h : h - 12;
            let startAmpm = h < 12 ? 'AM' : 'PM';
            let endH = (h + 1) <= 12 ? (h + 1) : (h + 1) - 12;
            let endAmpm = (h + 1) < 12 ? 'AM' : ((h + 1) === 24 ? 'AM' : 'PM');
            let hourLabel = `${startH} ${startAmpm} - ${endH} ${endAmpm}`;

            // 1. Calculate active scheduled pickers in this hour (accounting for lunches)
            let pickerCount = 0;
            let pickerNames = [];

            if (Array.isArray(main_df)) {
                main_df.forEach(r => {
                    if (r.Role === 'Exclude' || r.Role === 'Training') return;
                    if (!r.StartDt) return;
                    let sd = new Date(r.StartDt);
                    let ed = new Date(r.EndDt);
                    let sm = sd.getHours() * 60 + sd.getMinutes();
                    let em = ed.getHours() * 60 + ed.getMinutes();
                    if (em < sm) em += 24 * 60;

                    if (sm <= h * 60 && em >= (h + 1) * 60) {
                        let on_l = false;
                        if (r['Lunch Time'] && r['Lunch Time'] !== 'N/A' && r['Lunch Time'] !== 'Pending...' && r['Lunch Time'] !== 'No Slot Avail') {
                            let lm = parseTimeToMinutes(r['Lunch Time']);
                            if (lm !== null) {
                                if (lm < (h + 1) * 60 && (lm + 60) > h * 60) {
                                    on_l = true;
                                }
                            }
                        }

                        if (!on_l) {
                            let act = r.Role;
                            if (h === 5) {
                                // 5 AM - 6 AM: All hands pick (no backroom work needed). Exceptions picker starts and is treated normal.
                                if (r.Role === "Backroom" || r.Role === "IP/GMD" || r.Role === "IPGMD") {
                                    act = "Pickers";
                                }
                            }
                            if (act === "Pickers") {
                                pickerCount++;
                                let cleanName = (r.Associate || '')
                                    .replace(/[🔴🔵🟡🧡💖💙💛🧡🎓]/gu, '')
                                    .replace(/\([A-Z0-9_\-]+\)/gi, '')
                                    .replace(/\(M\)/g, '')
                                    .trim();
                                if (cleanName) pickerNames.push(cleanName);
                            }
                        }
                    }
                });
            }

            // 2. Gather store support available in this hour
            const availableSupport = [];
            const seenSupport = new Set();

            if (Array.isArray(support_df)) {
                support_df.forEach((s, sIdx) => {
                    if (!s.StartDt || !s.EndDt) return;
                    let sd = new Date(s.StartDt);
                    let ed = new Date(s.EndDt);
                    let sm = sd.getHours() * 60 + sd.getMinutes();
                    let em = ed.getHours() * 60 + ed.getMinutes();
                    if (em < sm) em += 24 * 60;

                    if (sm < (h + 1) * 60 && em > h * 60) {
                        const key = (s.UserId || s.Associate || s.Name || '').toLowerCase().trim();
                        if (key && !seenSupport.has(key)) {
                            seenSupport.add(key);
                            let cleanName = (s.Name || s.Associate || '')
                                .replace(/[🔴🔵🟡🧡💖💙💛🧡🎓]/gu, '')
                                .replace(/\([A-Z0-9_\-]+\)/gi, '')
                                .replace(/\(M\)/g, '')
                                .trim();
                            const parts = cleanName.split(/\s+/).filter(Boolean);
                            const dedup = [];
                            parts.forEach(p => {
                                if (dedup.length === 0 || dedup[dedup.length - 1].toLowerCase() !== p.toLowerCase()) dedup.push(p);
                            });
                            cleanName = dedup.join(' ').trim();

                            let deptName = s.JobName || s.Job || s.Role || 'Store Support';
                            availableSupport.push({
                                id: s.UserId || `supp-${h}-${sIdx}`,
                                name: cleanName,
                                job: deptName,
                                department: deptName,
                                jobTitle: s.JobName || deptName,
                                shift: s.Shift || ''
                            });
                        }
                    }
                });
            }

            slots.push({
                id: `slot-${h - 4}`,
                hourIndex: h - 5,
                hour: hourLabel,
                hourLabel: hourLabel,
                scheduledPickers: pickerCount,
                pickerNames: pickerNames,
                availableStoreSupport: availableSupport
            });
        }

        const storeNum = (currentStore && currentStore.match(/\d+/)) ? currentStore.match(/\d+/)[0] : "1012";
        const todayStr = new Date().toISOString().slice(0, 10);
        const exportPayload = {
            version: "1.0",
            exportDate: new Date().toISOString(),
            date: todayStr,
            store: `Store ${storeNum}`,
            storeNumber: storeNum,
            rosterName: docTitle || uploadedPdfName || "OPD Roster",
            slots: slots
        };

        // 1. Download file to user browser
        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `opd_schedule_export_${todayStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // 2. Also non-blocking POST to server for 1-click cloud sync
        fetch(`${API_BASE}/decision_dashboard_schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exportPayload)
        }).catch(err => console.log("Non-blocking backend schedule cache:", err));

    } catch (err) {
        console.error("Failed to export decision dashboard JSON:", err);
    }
}
