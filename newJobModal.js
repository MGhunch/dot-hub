// ===== NEW JOB MODAL =====
// Extracted from app.js - owns the New Job modal flow
// Depends on: $, loadingDots, getLogoUrl, setTbcPillState, showToast, state, loadJobs
// Exposes: openNewJobModal, onClientSelected, toggleNewJobDropdown, selectNewJobOption, submitNewJob, closeNewJobModal

let newJobState = {
    clientCode: null,
    clientName: null,
    jobNumber: null,
    owner: '',
    status: 'Incoming',
    ballpark: '5000',
    live: 'Tbc'
};

// Helper to set dropdown value
function setNewJobDropdown(id, value, label) {
    const trigger = $(`new-job-${id}-trigger`);
    const menu = $(`new-job-${id}-menu`);
    if (trigger) trigger.querySelector('span').textContent = label || value;
    if (menu) {
        menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
            opt.classList.toggle('selected', opt.dataset.value === value);
        });
    }
}

// Helper to get dropdown value
function getNewJobDropdownValue(id) {
    const menu = $(`new-job-${id}-menu`);
    if (!menu) return '';
    const selected = menu.querySelector('.custom-dropdown-option.selected');
    return selected ? selected.dataset.value : '';
}

// Toggle dropdown open/close
function toggleNewJobDropdown(id) {
    const dropdown = $(`new-job-${id}-dropdown`);
    const trigger = $(`new-job-${id}-trigger`);
    const menu = $(`new-job-${id}-menu`);
    
    if (!dropdown || !trigger || !menu) return;
    
    const isOpen = menu.classList.contains('open');
    
    // Close all other dropdowns first
    document.querySelectorAll('.new-job-modal .custom-dropdown-menu.open').forEach(m => {
        m.classList.remove('open');
        m.previousElementSibling?.classList.remove('open');
    });
    
    if (!isOpen) {
        trigger.classList.add('open');
        menu.classList.add('open');
    }
}

// Select dropdown option
function selectNewJobOption(id, value, label) {
    const menu = $(`new-job-${id}-menu`);
    const trigger = $(`new-job-${id}-trigger`);
    
    // Update selected state
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
    });
    
    // Update trigger text
    trigger.querySelector('span').textContent = label;
    
    // Close dropdown
    trigger.classList.remove('open');
    menu.classList.remove('open');
    
    // Update state
    if (id === 'client') {
        newJobState.clientCode = value;
        newJobState.clientName = label;
        onClientSelected(value, label);
    } else if (id === 'owner') {
        newJobState.owner = value;
    } else if (id === 'status') {
        newJobState.status = value;
    } else if (id === 'ballpark') {
        newJobState.ballpark = value;
    } else if (id === 'live') {
        newJobState.live = value;
    }
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.new-job-modal .custom-dropdown')) {
        document.querySelectorAll('.new-job-modal .custom-dropdown-menu.open').forEach(m => {
            m.classList.remove('open');
            m.previousElementSibling?.classList.remove('open');
        });
    }
});

async function openNewJobModal() {
    const modal = $('new-job-modal');
    if (!modal) return;
    
    // Reset state
    newJobState = { 
        clientCode: null, 
        clientName: null, 
        jobNumber: null,
        owner: '',
        status: 'Incoming',
        ballpark: '5000',
        live: 'Tbc'
    };
    
    // Reset form inputs
    $('new-job-name').value = '';
    $('new-job-description').value = '';
    $('new-job-with-client').checked = false;
    $('new-job-logo').src = 'images/logos/Unknown.png';
    $('new-job-number-wrapper').style.display = 'none';
    
    // Reset create button (in case previous attempt was interrupted)
    const createBtn = $('new-job-create-btn');
    if (createBtn) {
        createBtn.disabled = false;
        createBtn.textContent = 'CREATE JOB';
    }
    
    // Reset dropdowns
    $('new-job-client-trigger').querySelector('span').textContent = 'Select client...';
    $('new-job-client-menu').innerHTML = loadingDots('small');
    $('new-job-owner-trigger').querySelector('span').textContent = 'Select client first...';
    $('new-job-owner-menu').innerHTML = '';
    setNewJobDropdown('status', 'Incoming', 'Incoming');
    setNewJobDropdown('ballpark', '5000', '$5,000');
    setNewJobDropdown('live', 'Tbc', 'Tbc');
    
    // Set default update due (+5 working days)
    const updateDue = getWorkingDaysFromNow(5);
    $('new-job-update-due').value = updateDue;
    setTbcPillState('new-job-tbc-pill', false);
    
    // Show form and confirmation hidden
    $('new-job-form').style.display = 'block';
    $('new-job-step-3').style.display = 'none';
    
    modal.classList.add('visible');
    
    // Load clients into dropdown
    try {
        const response = await fetch('/api/clients');
        const clients = await response.json();
        
        // Top clients to show first
        const topClientCodes = ['ONE', 'ONS', 'ONB', 'SKY', 'TOW', 'FIS', 'HUN'];
        const topClients = [];
        const otherClients = [];
        
        clients.forEach(c => {
            if (topClientCodes.includes(c.code)) {
                topClients.push(c);
            } else {
                otherClients.push(c);
            }
        });
        
        // Sort top clients by the order in topClientCodes
        topClients.sort((a, b) => topClientCodes.indexOf(a.code) - topClientCodes.indexOf(b.code));
        
        let html = '';
        
        // Add top clients
        topClients.forEach(c => {
            html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectNewJobOption('client', '${c.code}', '${c.name.replace(/'/g, "\\'")}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
        });
        
        // Add other clients with header
        if (otherClients.length > 0) {
            html += '<div class="custom-dropdown-option section-header">Other</div>';
            otherClients.forEach(c => {
                html += `<div class="custom-dropdown-option" data-value="${c.code}" onclick="selectNewJobOption('client', '${c.code}', '${c.name.replace(/'/g, "\\'")}')"><img src="${getLogoUrl(c.code)}" alt="${c.code}" style="width: 24px; height: 24px; border-radius: 50%; margin-right: 10px; vertical-align: middle;" onerror="this.src='images/logos/Unknown.png'">${c.name}</div>`;
            });
        }
        
        $('new-job-client-menu').innerHTML = html;
    } catch (err) {
        console.error('Error loading clients:', err);
        $('new-job-client-menu').innerHTML = '<div class="custom-dropdown-option" style="color: var(--red)">Failed to load</div>';
    }
    
    // Add click handlers for static dropdowns
    setupStaticDropdownHandlers();
}

function setupStaticDropdownHandlers() {
    // Status options
    $('new-job-status-menu').querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.onclick = () => selectNewJobOption('status', opt.dataset.value, opt.textContent);
    });
    
    // Ballpark options
    $('new-job-ballpark-menu').querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.onclick = () => selectNewJobOption('ballpark', opt.dataset.value, opt.textContent);
    });
    
    // Live options
    $('new-job-live-menu').querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.onclick = () => selectNewJobOption('live', opt.dataset.value, opt.textContent);
    });
}

async function onClientSelected(code, name) {
    if (!code) {
        // Reset if no client selected
        newJobState.clientCode = null;
        newJobState.clientName = null;
        newJobState.jobNumber = null;
        $('new-job-logo').src = 'images/logos/Unknown.png';
        $('new-job-number-wrapper').style.display = 'none';
        $('new-job-owner-trigger').querySelector('span').textContent = 'Select client first...';
        $('new-job-owner-menu').innerHTML = '';
        return;
    }
    
    newJobState.clientCode = code;
    newJobState.clientName = name;
    
    // Update logo
    const logo = $('new-job-logo');
    logo.src = getLogoUrl(code);
    logo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
    
    // Show number wrapper with loading state
    $('new-job-number').textContent = '...';
    $('new-job-number-wrapper').style.display = 'inline';
    
    // Preview job number
    try {
        const response = await fetch(`/api/preview-job-number/${code}`);
        const data = await response.json();
        
        if (data.error) {
            $('new-job-number').textContent = 'Error';
            console.error('Preview error:', data.error);
        } else {
            newJobState.jobNumber = data.previewJobNumber;
            $('new-job-number').textContent = data.previewJobNumber;
        }
    } catch (err) {
        console.error('Error previewing job number:', err);
        $('new-job-number').textContent = 'Error';
    }
    
    // Load owners for this client
    $('new-job-owner-trigger').querySelector('span').textContent = 'Loading...';
    $('new-job-owner-menu').innerHTML = '';
    
    try {
        const response = await fetch(`/api/people/${code}`);
        const people = await response.json();
        
        let html = `<div class="custom-dropdown-option" data-value="" onclick="selectNewJobOption('owner', '', 'Select...')">Select...</div>`;
        people.forEach(p => {
            html += `<div class="custom-dropdown-option" data-value="${p.name}" onclick="selectNewJobOption('owner', '${p.name.replace(/'/g, "\\'")}', '${p.name.replace(/'/g, "\\'")}')">${p.name}</div>`;
        });
        
        $('new-job-owner-menu').innerHTML = html;
        $('new-job-owner-trigger').querySelector('span').textContent = 'Select...';
        newJobState.owner = '';
    } catch (err) {
        console.error('Error loading owners:', err);
        $('new-job-owner-trigger').querySelector('span').textContent = 'Failed to load';
    }
}

async function submitNewJob() {
    // Prevent double submit
    const createBtn = $('new-job-create-btn');
    if (createBtn.disabled) return;
    
    // Validate client selected
    if (!newJobState.clientCode) {
        $('new-job-client-trigger').classList.add('input-error');
        setTimeout(() => $('new-job-client-trigger').classList.remove('input-error'), 2000);
        return;
    }
    
    // Validate job name
    const jobName = $('new-job-name').value.trim();
    if (!jobName) {
        $('new-job-name').focus();
        $('new-job-name').classList.add('input-error');
        setTimeout(() => $('new-job-name').classList.remove('input-error'), 2000);
        return;
    }
    
    createBtn.disabled = true;
    createBtn.textContent = 'CREATING...';
    
    // Show processing toast
    showToast('Setting up job...', 'info');
    
    // Get form values
    const description = $('new-job-description').value.trim();
    const ballpark = parseInt(newJobState.ballpark, 10);
    
    // Build brief object for Setup Worker
    // Map form fields → brief fields (Worker expects brief format from Claude extraction)
    // Form uses UI-friendly names, brief uses extraction schema names
    const brief = {
        jobName: jobName,           // same
        theJob: description || null, // form: description → brief: theJob
        owner: newJobState.owner || null,  // same
        costs: ballpark ? `$${ballpark.toLocaleString()}` : null,  // form: ballpark (number) → brief: costs (string)
        when: newJobState.live || null,    // form: live → brief: when
        updateDue: $('new-job-update-due').value || null  // same
    };
    
    // Build payload for Setup Worker
    const payload = {
        clientCode: newJobState.clientCode,
        clientName: newJobState.clientName,
        senderEmail: `${state.currentUser?.name?.toLowerCase() || 'hub'}@hunch.co.nz`,
        senderName: state.currentUser?.fullName || state.currentUser?.name || 'Hub User',
        subjectLine: `New job: ${jobName}`,
        brief: brief
    };
    
    try {
        // Call Setup Worker directly - it handles everything
        const response = await fetch('https://dot-workers.up.railway.app/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!data.success) {
            alert('Error creating job: ' + (data.error || 'Unknown error'));
            createBtn.disabled = false;
            createBtn.textContent = 'CREATE JOB';
            return;
        }
        
        // Use the actual job number from the response
        const createdJobNumber = data.jobNumber;
        
        // Show confirmation
        const confirmLogo = $('new-job-confirm-logo');
        confirmLogo.src = getLogoUrl(newJobState.clientCode);
        confirmLogo.onerror = function() { this.src = 'images/logos/Unknown.png'; };
        $('new-job-confirm-title').textContent = createdJobNumber;
        $('new-job-confirm-text').textContent = 'Job created';
        
        // Show results summary
        const results = data.results || {};
        if (results.channel?.success) {
            $('new-job-confirm-subtext').textContent = 'Teams channel ready ✓';
            $('new-job-confirm-subtext').style.display = 'block';
        } else if (results.channel?.skipped) {
            $('new-job-confirm-subtext').textContent = 'Teams not configured for this client';
            $('new-job-confirm-subtext').style.display = 'block';
        } else {
            $('new-job-confirm-subtext').style.display = 'none';
        }
        
        $('new-job-form').style.display = 'none';
        $('new-job-step-3').style.display = 'block';
        
        // Refresh jobs list (don't let this fail the whole thing)
        try {
            await loadJobs();
        } catch (refreshErr) {
            console.error('Error refreshing jobs list:', refreshErr);
        }
        
    } catch (err) {
        console.error('Error creating job:', err);
        alert('Failed to create job. Please try again.');
        createBtn.disabled = false;
        createBtn.textContent = 'CREATE JOB';
    }
}

function closeNewJobModal() {
    $('new-job-modal')?.classList.remove('visible');
    newJobState = { clientCode: null, clientName: null, jobNumber: null, status: 'soon' };
}

function getWorkingDaysFromNow(days) {
    const date = new Date();
    let added = 0;
    while (added < days) {
        date.setDate(date.getDate() + 1);
        const dayOfWeek = date.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            added++;
        }
    }
    return date.toISOString().split('T')[0];
}

// Close new job modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.id === 'new-job-modal') {
        closeNewJobModal();
    }
});

// ===== EXPOSE TO WINDOW =====
// These are accessed by app.js and HTML onclick handlers
window.openNewJobModal = openNewJobModal;
window.onClientSelected = onClientSelected;
window.toggleNewJobDropdown = toggleNewJobDropdown;
window.selectNewJobOption = selectNewJobOption;
window.submitNewJob = submitNewJob;
window.closeNewJobModal = closeNewJobModal;
