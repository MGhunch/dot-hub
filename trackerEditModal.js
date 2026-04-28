// ===== TRACKER EDIT MODAL MODULE =====
// Extracted from tracker.js - owns the Tracker row click router + edit modal
// Depends on: $, state, API_BASE, showToast (app.js); trackerData, loadTrackerData, renderTrackerContent (tracker.js); openJobBag, loadJobBagBudget, currentBagJob (app.js)
// Exposes: closeTrackerModal, saveTrackerProject, openTrackerDetail

// ===== MODAL STATE =====
let trackerCurrentEditData = null;

// ===== MODAL =====
function setupTrackerModalListeners() {
    const modal = $('tracker-edit-modal');
    if (!modal || modal.dataset.listenersAttached) return;
    modal.dataset.listenersAttached = 'true';
    
    // Backdrop click to close (only the overlay itself, not children)
    modal.addEventListener('click', (e) => { 
        if (e.target === modal) closeTrackerModal(); 
    });
    
    // Event delegation for stage pills
    const stagePills = $('tracker-stage-pills');
    if (stagePills) {
        stagePills.addEventListener('click', (e) => {
            const pill = e.target.closest('.tracker-stage-pill');
            if (pill) {
                e.stopPropagation();
                stagePills.querySelectorAll('.tracker-stage-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
            }
        });
    }
    
    // Event delegation for type pills
    const typePills = $('tracker-type-pills');
    if (typePills) {
        typePills.addEventListener('click', (e) => {
            const pill = e.target.closest('.tracker-type-pill');
            if (pill) {
                e.stopPropagation();
                typePills.querySelectorAll('.tracker-type-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
            }
        });
    }
}

function setTrackerStagePill(stage) {
    document.querySelectorAll('.tracker-stage-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.value === stage);
    });
}

function setTrackerTypePill(type) {
    document.querySelectorAll('.tracker-type-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.value === type);
    });
}

function getTrackerStagePill() {
    const active = document.querySelector('.tracker-stage-pill.active');
    return active?.dataset.value || 'Simplify';
}

function getTrackerTypePill() {
    const active = document.querySelector('.tracker-type-pill.active');
    return active?.dataset.value || 'Project budget';
}

async function openTrackerEditModal(jobNumber, month) {
    // Get job info from Projects (always exists)
    const job = state.allJobs?.find(j => j.jobNumber === jobNumber);
    if (!job) {
        showToast('Job not found.', 'error');
        return;
    }
    
    // Try to find existing tracker entry (trackerData is in tracker.js)
    const trackerEntry = trackerData.find(p => p.jobNumber === jobNumber && p.month === month) ||
                         trackerData.find(p => p.jobNumber === jobNumber);
    
    // Fetch total spend for this job
    let totalSpend = 0;
    try {
        const budgetRes = await fetch(`${API_BASE}/job/${jobNumber}/budget`);
        if (budgetRes.ok) {
            const budgetData = await budgetRes.json();
            totalSpend = budgetData.total || 0;
        }
    } catch (e) {
        console.log('Could not fetch budget:', e);
    }
    
    const isCreateMode = !trackerEntry;
    
    if (isCreateMode) {
        // CREATE mode
        trackerCurrentEditData = {
            mode: 'create',
            jobNumber: job.jobNumber
        };
        
        $('tracker-edit-name').value = `${jobNumber} | ${job.jobName}`;
        $('tracker-edit-spend').value = '';
        $('tracker-edit-month').value = new Date().toLocaleString('en-US', { month: 'long' });
        $('tracker-edit-description').value = '';
        $('tracker-edit-ballpark').checked = true;
        $('tracker-edit-stage').value = job.stage || 'Simplify';
        $('tracker-edit-spendtype').value = 'Project budget';
        
        $('tracker-save-btn').textContent = 'Create Entry';
        
    } else {
        // UPDATE mode
        trackerCurrentEditData = { ...trackerEntry, mode: 'update' };
        
        $('tracker-edit-name').value = `${jobNumber} | ${trackerEntry.projectName}`;
        $('tracker-edit-spend').value = trackerEntry.spend;
        $('tracker-edit-month').value = trackerEntry.month;
        $('tracker-edit-description').value = trackerEntry.description || '';
        $('tracker-edit-ballpark').checked = trackerEntry.ballpark || false;
        $('tracker-edit-stage').value = job.stage || 'Simplify';
        $('tracker-edit-spendtype').value = trackerEntry.spendType || 'Project budget';
        
        $('tracker-save-btn').textContent = 'Save Changes';
    }
    
    $('tracker-edit-modal')?.classList.add('visible');
}

// Helper: open the right modal for Tracker based on access level
function openTrackerDetail(jobNumber, month) {
    if (state.currentUser?.accessLevel === 'Full') {
        openTrackerEditModal(jobNumber, month);
    } else {
        // openJobBag is in app.js, access via window
        if (typeof openJobBag === 'function') {
            openJobBag(jobNumber);
        }
    }
}

function closeTrackerModal() {
    $('tracker-edit-modal')?.classList.remove('visible');
    const saveBtn = $('tracker-save-btn');
    if (saveBtn) { saveBtn.textContent = 'Save Changes'; saveBtn.disabled = false; }
    trackerCurrentEditData = null;
}

async function saveTrackerProject() {
    if (!trackerCurrentEditData) return;
    
    const isCreateMode = trackerCurrentEditData.mode === 'create';
    const savedJobNumber = trackerCurrentEditData.jobNumber; // Store before close
    
    const payload = {
        jobNumber: trackerCurrentEditData.jobNumber,
        description: $('tracker-edit-description').value,
        spend: parseFloat($('tracker-edit-spend').value) || 0,
        month: $('tracker-edit-month').value,
        spendType: $('tracker-edit-spendtype').value,
        ballpark: $('tracker-edit-ballpark').checked,
        stage: $('tracker-edit-stage').value
    };
    
    if (!isCreateMode) {
        payload.id = trackerCurrentEditData.id;
    }
    
    const saveBtn = $('tracker-save-btn');
    if (saveBtn) { 
        saveBtn.textContent = isCreateMode ? 'Creating...' : 'Saving...'; 
        saveBtn.disabled = true; 
    }
    
    try {
        const endpoint = isCreateMode ? '/tracker/create' : '/tracker/update';
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error('Failed to save');
        
        closeTrackerModal();
        
        // Force fresh data fetch with cache-busting (loadTrackerData is in tracker.js)
        await loadTrackerData(state.trackerClient, true);
        renderTrackerContent();

        // Refresh Job Bag budget if we're viewing this job (currentBagJob is in app.js)
        if (window.currentBagJob?.jobNumber === savedJobNumber) {
            if (typeof loadJobBagBudget === 'function') {
                loadJobBagBudget(window.currentBagJob.jobNumber);
            }
        }

        showToast(isCreateMode ? 'Entry created.' : 'On it.', 'success');
        
    } catch (e) {
        console.error('Save failed:', e);
        showToast("Doh, that didn't work.", 'error');
        if (saveBtn) { 
            saveBtn.textContent = isCreateMode ? 'Create Entry' : 'Save Changes'; 
            saveBtn.disabled = false; 
        }
    }
}

// ===== EXPOSE TO WINDOW =====
// These are accessed by tracker.js, app.js, and HTML onclick handlers
window.closeTrackerModal = closeTrackerModal;
window.saveTrackerProject = saveTrackerProject;
window.openTrackerDetail = openTrackerDetail;
