// ===== EDIT JOB MODAL MODULE =====
// Extracted from app.js - owns the job edit modal + the job name (pencil) sub-modal
// Depends on: $, state, API_BASE, PROXY_BASE, showToast, getLogoUrl, formatDateForInput,
//             setTbcPillState, isTbcActive, autoResizeTextarea, navigateTo, renderWip,
//             currentBagJob, refreshJobBagLeft, loadJobBagUpdates (all from app.js)
// Exposes: openJobModal, closeJobModal, saveJobUpdate,
//          openJobNameModal, closeJobNameModal, saveJobName

// ===== MODAL STATE =====
let currentEditJob = null;

// ===== LISTENERS (one-time setup) =====
function setupEditJobModalListeners() {
    const modal = $('job-edit-modal');
    if (!modal || modal.dataset.listenersAttached) return;
    modal.dataset.listenersAttached = 'true';

    // Auto-resize textareas as user types
    $('job-edit-message')?.addEventListener('input', (e) => autoResizeTextarea(e.target));
    $('job-edit-description')?.addEventListener('input', (e) => autoResizeTextarea(e.target));

    // Job name (pencil) modal close on overlay click
    $('job-name-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'job-name-modal') closeJobNameModal();
    });
}

// ===== OPEN MODAL =====
async function openJobModal(jobNumber) {
    setupEditJobModalListeners();

    const job = state.allJobs.find(j => j.jobNumber === jobNumber);
    if (!job) return;
    
    currentEditJob = job;
    
    // Populate modal fields
    const modal = $('job-edit-modal');
    if (!modal) return;
    
    $('job-modal-title').textContent = `${jobNumber} | ${job.jobName || 'Untitled'}`;
    $('job-modal-logo').src = getLogoUrl(job.clientCode);
    $('job-modal-logo').onerror = function() { this.src = 'images/logos/Unknown.png'; };
    $('job-modal-logo').alt = job.clientCode;
    
    // Hero section
    $('job-edit-message').value = job.update || '';
    $('job-edit-update-due').value = formatDateForInput(job.updateDue);
    setTbcPillState('job-edit-tbc-pill', !job.updateDue);
    
    // Details section
    $('job-edit-description').value = job.description || '';
    $('job-edit-status').value = job.status || 'Incoming';
    $('job-edit-live').value = job.liveDate || 'Tbc';  // Now a dropdown with month values
    $('job-edit-with-client').checked = job.withClient || false;
    
    // Auto-resize textareas
    autoResizeTextarea($('job-edit-message'));
    autoResizeTextarea($('job-edit-description'));
    
    // Set Teams link
    const teamsLink = $('job-modal-teams-link');
    if (job.channelUrl) {
        teamsLink.href = job.channelUrl;
        teamsLink.style.display = 'inline-flex';
    } else {
        teamsLink.style.display = 'none';
    }
    
    // Set Tracker link (opens tracker filtered to this client and current month)
    const trackerLink = $('job-modal-tracker-link');
    trackerLink.onclick = (e) => {
        e.preventDefault();
        closeJobModal();
        const month = new Date().toLocaleString('en-US', { month: 'long' });
        window.location.href = `?view=tracker&client=${job.clientCode}&month=${month}`;
    };
    
    // Set WIP link (opens WIP filtered to this client)
    const wipLink = $('job-modal-wip-link');
    wipLink.onclick = (e) => {
        e.preventDefault();
        closeJobModal();
        state.wipClient = job.clientCode;
        navigateTo('wip');
    };
    
    // Set edit pencil handler
    $('job-modal-edit-btn').onclick = () => openJobNameModal();
    
    // Populate client owner dropdown
    const ownerSelect = $('job-edit-owner');
    ownerSelect.innerHTML = '<option value="">Loading...</option>';
    
    // Show modal immediately
    modal.classList.add('visible');
    
    // Fetch people for this client
    try {
        const clientCode = job.clientCode;
        const response = await fetch(`${API_BASE}/people/${clientCode}`);
        if (response.ok) {
            const people = await response.json();
            console.log(`Loaded ${people.length} people for ${clientCode}`);
            
            ownerSelect.innerHTML = '<option value="">Select...</option>';
            
            // Check if current owner is in the list
            const currentOwner = job.projectOwner || '';
            let ownerFound = false;
            
            people.forEach(person => {
                const option = document.createElement('option');
                option.value = person.name;
                option.textContent = person.name;
                if (person.name === currentOwner) {
                    option.selected = true;
                    ownerFound = true;
                }
                ownerSelect.appendChild(option);
            });
            
            // If current owner not in list but exists, add them at top
            if (currentOwner && !ownerFound) {
                const option = document.createElement('option');
                option.value = currentOwner;
                option.textContent = currentOwner;
                option.selected = true;
                ownerSelect.insertBefore(option, ownerSelect.options[1]);
            }
        } else {
            // Fallback to current owner only
            console.log('People API failed:', response.status);
            ownerSelect.innerHTML = `<option value="${job.projectOwner || ''}">${job.projectOwner || 'Select...'}</option>`;
        }
    } catch (e) {
        console.log('Failed to load people:', e);
        ownerSelect.innerHTML = `<option value="${job.projectOwner || ''}">${job.projectOwner || 'Select...'}</option>`;
    }
}

// ===== CLOSE MODAL =====
function closeJobModal() {
    $('job-edit-modal')?.classList.remove('visible');
    currentEditJob = null;
}

// ===== SAVE UPDATE =====
async function saveJobUpdate() {
    if (!currentEditJob) return;
    
    const jobNumber = currentEditJob.jobNumber;
    const btn = $('job-save-btn');
    
    const status = $('job-edit-status').value;
    const updateDue = $('job-edit-update-due').value;
    const liveDate = $('job-edit-live').value;  // Now a month string from dropdown
    const message = $('job-edit-message').value.trim();
    const withClient = $('job-edit-with-client').checked;
    const description = $('job-edit-description').value.trim();
    const projectOwner = $('job-edit-owner').value;
    
    // Validation: if posting an update, must set next update due date
    // (unless TBC pill is active - that's an intentional choice)
    const originalDue = formatDateForInput(currentEditJob.updateDue);
    const originalUpdate = currentEditJob.update || '';
    const tbcActive = isTbcActive('job-edit-tbc-pill');
    if (message && message !== originalUpdate && !tbcActive && (!updateDue || updateDue === originalDue)) {
        showToast("When's the update due?", 'error');
        $('job-edit-update-due').focus();
        return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Updating...';
    
    // Build payload for Hub's unified update endpoint
    const authorName = state.currentUser?.firstName || state.currentUser?.name || 'Dot';
    const payload = { status, withClient, author: authorName };
    payload.updateDue = updateDue || null;  // Allow clearing to TBC
    if (liveDate) payload.liveDate = liveDate;
    if (message && message !== originalUpdate) payload.message = message;
    if (description !== currentEditJob.description) payload.description = description;
    if (projectOwner !== currentEditJob.projectOwner) payload.projectOwner = projectOwner;
    
    try {
        // Single call to Hub - handles both Projects update and Updates record creation
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error('Update failed');
        
        // Also post to Teams if there's a new message
        if (message && message !== originalUpdate) {
            fetch(`${PROXY_BASE}/proxy/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientCode: jobNumber.split(' ')[0],
                    jobNumber,
                    message
                })
            }).catch(e => console.log('Teams post failed:', e));
        }
        
        // Update local state
        const job = state.allJobs.find(j => j.jobNumber === jobNumber);
        if (job) {
            job.status = status;
            job.withClient = withClient;
            job.updateDue = updateDue || null;  // Allow clearing to TBC
            if (liveDate) job.liveDate = liveDate;
            if (message) job.update = message;
            if (description) job.description = description;
            if (projectOwner) job.projectOwner = projectOwner;
        }

        // Also update currentBagJob if we're editing the same job
        if (currentBagJob?.jobNumber === jobNumber) {
            currentBagJob.status = status;
            currentBagJob.withClient = withClient;
            currentBagJob.updateDue = updateDue;
            currentBagJob.liveDate = liveDate;
            if (message) currentBagJob.update = message;
            if (description) currentBagJob.description = description;
            if (projectOwner) currentBagJob.projectOwner = projectOwner;
            refreshJobBagLeft();
        }
        
        showToast('Job updated.', 'success');
        btn.textContent = 'UPDATE';
        btn.disabled = false;
        closeJobModal();

        // Refresh thread if we're in the Job Bag and a message was posted
        if (message && message !== originalUpdate && currentBagJob?.jobNumber === jobNumber) {
            loadJobBagUpdates(jobNumber);
        }

        // Refresh WIP if visible
        if (state.currentView === 'wip') {
            renderWip();
        }
        
    } catch (e) {
        console.error('Save failed:', e);
        showToast("Hmm, that didn't work.", 'error');
        btn.textContent = 'UPDATE';
        btn.disabled = false;
    }
}

// ===== JOB NAME (PENCIL) SUB-MODAL =====
function openJobNameModal() {
    if (!currentEditJob) return;
    
    $('job-edit-number').value = currentEditJob.jobNumber;
    $('job-edit-job-name').value = currentEditJob.jobName || '';
    $('job-name-modal').classList.add('visible');
}

function closeJobNameModal() {
    $('job-name-modal')?.classList.remove('visible');
}

async function saveJobName() {
    if (!currentEditJob) return;
    
    const newJobNumber = $('job-edit-number').value.trim();
    const newJobName = $('job-edit-job-name').value.trim();
    
    if (!newJobNumber || !newJobName) {
        showToast("Hmm, that didn't work.", 'error');
        return;
    }
    
    try {
        const jobNumber = currentEditJob.jobNumber;
        const payload = {
            projectName: newJobName
        };
        
        // Only include job number change if it's different
        if (newJobNumber !== jobNumber) {
            payload.newJobNumber = newJobNumber;
        }
        
        const response = await fetch(`${API_BASE}/job/${encodeURIComponent(jobNumber)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error('Update failed');
        
        // Update local state
        const job = state.allJobs.find(j => j.jobNumber === currentEditJob.jobNumber);
        if (job) {
            job.jobName = newJobName;
            if (newJobNumber !== currentEditJob.jobNumber) {
                job.jobNumber = newJobNumber;
            }
        }
        
        // Update the main modal title
        $('job-modal-title').textContent = `${newJobNumber} | ${newJobName}`;
        currentEditJob.jobNumber = newJobNumber;
        currentEditJob.jobName = newJobName;
        
        closeJobNameModal();
        showToast('Job updated.', 'success');
        
        // Refresh WIP if visible
        if (state.currentView === 'wip') {
            renderWip();
        }
        
    } catch (e) {
        console.error('Save job name failed:', e);
        showToast("Hmm, that didn't work.", 'error');
    }
}

// ===== EXPOSE TO WINDOW =====
// These are accessed by app.js, tracker.js, and HTML onclick handlers
window.openJobModal = openJobModal;
window.closeJobModal = closeJobModal;
window.saveJobUpdate = saveJobUpdate;
window.openJobNameModal = openJobNameModal;
window.closeJobNameModal = closeJobNameModal;
window.saveJobName = saveJobName;
