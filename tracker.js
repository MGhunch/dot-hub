// ===== TRACKER MODULE =====
// Extracted from app.js - owns the Tracker view (table, chart, client/month controls)
// Modal lifecycle lives in trackerEditModal.js
// Depends on: $, $$, state, API_BASE, showLoadingModal, hideLoadingModal, showToast, getLogoUrl, ICON_CHEVRON_RIGHT
// Exposes: renderTracker, loadTrackerData, trackerCurrentMonth, trackerIsQuarterView, getTrackerPDF, toggleJobExpand

// ===== TRACKER STATE =====
let trackerClients = {};
let trackerData = [];
let trackerCurrentMonth = getCurrentMonthName();
let trackerIsQuarterView = false;
// trackerCurrentEditData moved to trackerEditModal.js
let expandedJobs = new Set(); // job numbers currently expanded to show monthly breakdown

// ===== CONSTANTS =====
const TRACKER_MONTHS = [
    'October', 'November', 'December',
    'January', 'February', 'March',
    'April', 'May', 'June',
    'July', 'August', 'September'
];

const MONTH_NUM = {
    January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
    July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
};

const calendarQuarters = {
    'Q1-cal': { months: ['January', 'February', 'March'], label: 'Jan > Mar' },
    'Q2-cal': { months: ['April', 'May', 'June'], label: 'Apr > Jun' },
    'Q3-cal': { months: ['July', 'August', 'September'], label: 'Jul > Sep' },
    'Q4-cal': { months: ['October', 'November', 'December'], label: 'Oct > Dec' }
};

const currentCalendarQuarter = (() => {
    const month = new Date().getMonth(); // 0-11
    if (month <= 2) return 'Q1-cal';
    if (month <= 5) return 'Q2-cal';
    if (month <= 8) return 'Q3-cal';
    return 'Q4-cal';
})();

const fallbackTrackerClients = [
    { code: 'ONS', name: 'One NZ - Simplification', committed: 25000, rollover: 0, rolloverUseIn: '', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'ONE', name: 'One NZ - Marketing', committed: 12500, rollover: 2400, rolloverUseIn: 'JAN-MAR', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'ONB', name: 'One NZ - Business', committed: 12500, rollover: 0, rolloverUseIn: '', yearEnd: 'March', currentQuarter: 'Q4' },
    { code: 'SKY', name: 'Sky', committed: 10000, rollover: 0, rolloverUseIn: '', yearEnd: 'June', currentQuarter: 'Q3' },
    { code: 'TOW', name: 'Tower', committed: 10000, rollover: 1500, rolloverUseIn: 'JAN-MAR', yearEnd: 'September', currentQuarter: 'Q2' },
    { code: 'FIS', name: 'Fisher Funds', committed: 4500, rollover: 500, rolloverUseIn: 'JAN-MAR', yearEnd: 'March', currentQuarter: 'Q4' }
];

// ===== HELPERS =====
function getCurrentMonthName() {
    return new Date().toLocaleString('en-US', { month: 'long' });
}

function getClientCurrentQuarter(clientCode) {
    const client = trackerClients[clientCode];
    return client?.currentQuarter || 'Q1';
}

function formatTrackerCurrency(amount) {
    if (Math.abs(amount) >= 1000) {
        return '$' + (amount / 1000).toFixed(Math.abs(amount) % 1000 === 0 ? 0 : 1) + 'K';
    }
    return '$' + Math.abs(amount).toLocaleString();
}

function getQuarterForMonth(month) {
    for (const key in calendarQuarters) {
        if (calendarQuarters[key].months.includes(month)) return key;
    }
    return currentCalendarQuarter;
}

function getQuarterInfoForMonth(clientCode, month) {
    const calQ = getQuarterForMonth(month);
    const quarter = calendarQuarters[calQ];
    const calQNum = parseInt(calQ.replace('Q', '').replace('-cal', ''));
    const clientCurrentCalQ = parseInt(currentCalendarQuarter.replace('Q', '').replace('-cal', ''));
    const clientCurrentLabel = parseInt(getClientCurrentQuarter(clientCode).replace('Q', '') || '1');
    let clientQNum = clientCurrentLabel + (calQNum - clientCurrentCalQ);
    if (clientQNum > 4) clientQNum -= 4;
    if (clientQNum < 1) clientQNum += 4;
    return { quarter: 'Q' + clientQNum, months: quarter.months, label: quarter.label };
}

function getCurrentQuarterInfo(clientCode) {
    const quarter = calendarQuarters[currentCalendarQuarter];
    const clientLabel = getClientCurrentQuarter(clientCode);
    return { quarter: clientLabel, months: quarter.months, label: quarter.label };
}

function getPreviousQuarter(clientCode) {
    // Get actual previous calendar quarter
    const calQNum = parseInt(currentCalendarQuarter.replace('Q', '').replace('-cal', ''));
    const prevCalQNum = calQNum === 1 ? 4 : calQNum - 1;
    const prevCalQ = 'Q' + prevCalQNum + '-cal';
    const quarter = calendarQuarters[prevCalQ];
    
    // Calculate client's quarter label for this period
    const clientCurrentQ = parseInt(getClientCurrentQuarter(clientCode).replace('Q', ''));
    const prevQ = clientCurrentQ === 1 ? 'Q4' : 'Q' + (clientCurrentQ - 1);
    return { quarter: prevQ, months: quarter.months, label: quarter.label };
}

function getTrackerMonthSpend(client, month) {
    return trackerData.filter(d => d.client === client && d.month === month && d.spendType === 'Project budget').reduce((sum, d) => sum + d.spend, 0);
}

function getTrackerProjectsForMonth(client, month) {
    return trackerData.filter(d => d.client === client && d.month === month);
}

// ===== HISTORICALLY-CORRECT COMMITTED LOOKUP =====
// Reads committedByMonth (from API, sourced from Budget History) so any
// past/future view shows the right committed amount for that period.
// Falls back to client.committed if the field is missing or the month is out
// of range (e.g. very old data, brand new client).
function getCommittedFor(client, year, monthName) {
    if (!client) return 0;
    const cbm = client.committedByMonth;
    if (cbm) {
        const monthNum = MONTH_NUM[monthName];
        if (monthNum) {
            const key = `${year}-${String(monthNum).padStart(2, '0')}`;
            if (key in cbm) return cbm[key];
        }
    }
    return client.committed || 0;
}

// Resolve which calendar year a given month name belongs to, given the
// quarter currently being viewed. The chart uses chartMonths which carry
// year explicitly; the table/stat-box logic uses month names alone, so we
// derive the year from the chart range.
function getYearForMonth(client, monthName) {
    if (client?.chartMonths) {
        const found = client.chartMonths.find(m => m.month === monthName);
        if (found) return found.year;
    }
    // Fallback: best-effort from today's calendar year
    const today = new Date();
    return today.getFullYear();
}

// Build the natural-language rollover line from the structured object.
// Returns an HTML string (already-formatted), or '' if amount is 0.
function formatRolloverLine(rolloverObj) {
    if (!rolloverObj || !rolloverObj.amount) return '';
    const amt = formatTrackerCurrency(rolloverObj.amount);
    const fromPrev = rolloverObj.fromPrevious || 0;
    const variance = rolloverObj.variance || 0;
    const dir = rolloverObj.varianceDirection;
    const months = (rolloverObj.varianceMonths || []).join('/');
    const prevQ = rolloverObj.previousQuarterLabel || '';

    // No in-quarter movement — single source line
    if (!variance || !dir) {
        return `<strong>${amt}</strong> rollover from ${prevQ}`;
    }

    // In-quarter only (no carry from previous)
    if (!fromPrev) {
        return `<strong>${amt}</strong> rollover (${dir} in ${months})`;
    }

    // Both — full pattern
    const verb = dir === 'over' ? 'less' : 'plus';
    const fromAmt = formatTrackerCurrency(fromPrev);
    const varAmt = formatTrackerCurrency(variance);
    return `<strong>${amt}</strong> rollover (${fromAmt} from ${prevQ}, ${verb} ${varAmt} ${dir} in ${months})`;
}

// ===== DATA LOADING =====
async function loadTrackerClients() {
    try {
        const response = await fetch(`${API_BASE}/tracker/clients`);
        if (!response.ok) throw new Error('API returned ' + response.status);
        const data = await response.json();
        populateTrackerClients(data);
        return true;
    } catch (e) {
        console.log('Using fallback tracker clients');
        populateTrackerClients(fallbackTrackerClients);
        return true;
    }
}

function populateTrackerClients(data) {
    trackerClients = {};
    
    // If user has client filter, only show their client
    let filteredData = data;
    if (state.clientFilter) {
        filteredData = data.filter(c => c.code === state.clientFilter);
    }
    
    filteredData.forEach(c => {
        trackerClients[c.code] = {
            name: c.name,
            committed: c.committed,
            quarterlyCommitted: c.committed * 3,
            rollover: c.rollover || 0,
            rolloverUseIn: c.rolloverUseIn || '',
            yearEnd: c.yearEnd,
            currentQuarter: c.currentQuarter
        };
    });
    
    const menu = $('tracker-client-menu');
    const trigger = $('tracker-client-trigger');
    if (!menu || !trigger) return;
    
    // If user has client filter, lock the dropdown
    if (state.clientFilter && filteredData.length > 0) {
        const client = filteredData[0];
        trigger.querySelector('span').textContent = client.name;
        trigger.style.pointerEvents = 'none'; // Disable dropdown
        trigger.querySelector('svg')?.classList.add('hidden'); // Hide chevron
        state.trackerClient = client.code;
        return;
    }
    
    menu.innerHTML = '';
    
    // Check if we already have a client set (from deep link)
    const presetClient = state.trackerClient;
    const lastClient = presetClient || localStorage.getItem('trackerLastClient');
    let defaultClient = null;
    let defaultName = '';
    
    filteredData.forEach((c, idx) => {
        const option = document.createElement('div');
        const isDefault = lastClient ? (c.code === lastClient) : (idx === 0);
        option.className = 'custom-dropdown-option' + (isDefault ? ' selected' : '');
        option.dataset.value = c.code;
        option.textContent = c.name;
        menu.appendChild(option);
        if (isDefault) { defaultClient = c.code; defaultName = c.name; }
    });
    
    if (defaultClient) {
        state.trackerClient = defaultClient;
        trigger.querySelector('span').textContent = defaultName;
    } else if (filteredData.length > 0) {
        state.trackerClient = filteredData[0].code;
        trigger.querySelector('span').textContent = filteredData[0].name;
    }
}

async function loadTrackerData(clientCode, cacheBust = false) {
    try {
        const url = `${API_BASE}/tracker/data?client=${clientCode}${cacheBust ? '&_t=' + Date.now() : ''}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('API returned ' + response.status);
        const data = await response.json();
        trackerData = data.map(d => ({
            id: d.id, client: d.client, jobNumber: d.jobNumber, projectName: d.projectName,
            owner: d.owner, description: d.description, spend: d.spend, month: d.month,
            spendType: d.spendType, ballpark: d.ballpark
        }));
        return true;
    } catch (e) {
        console.log('Using empty tracker data for:', clientCode);
        trackerData = [];
        return true;
    }
}

// ===== DROPDOWNS =====
function populateMonthDropdown() {
    const menu = $('tracker-month-menu');
    const trigger = $('tracker-month-trigger');
    if (!menu || !trigger) return;
    
    const currentMonth = getCurrentMonthName();
    menu.innerHTML = '';
    
    TRACKER_MONTHS.forEach(month => {
        const option = document.createElement('div');
        const isSelected = month === trackerCurrentMonth;
        option.className = 'custom-dropdown-option' + (isSelected ? ' selected' : '');
        option.dataset.value = month;
        option.textContent = month;
        menu.appendChild(option);
    });
    
    // Update trigger text
    trigger.querySelector('span').textContent = trackerCurrentMonth;
}

function setupTrackerDropdowns() {
    // Populate month dropdown dynamically
    populateMonthDropdown();
    
    setupTrackerDropdown('tracker-client-trigger', 'tracker-client-menu', async (value) => {
        state.trackerClient = value;
        localStorage.setItem('trackerLastClient', value);
        expandedJobs.clear();
        $('tracker-content').style.opacity = '0.5';
        await loadTrackerData(value);
        $('tracker-content').style.opacity = '1';
        renderTrackerContent();
    });
    
    setupTrackerDropdown('tracker-month-trigger', 'tracker-month-menu', (value) => {
        trackerCurrentMonth = value;
        renderTrackerContent();
    });
    
    // Sync month dropdown display with current value (for deep links)
    const monthTrigger = $('tracker-month-trigger');
    const monthMenu = $('tracker-month-menu');
    if (monthTrigger && monthMenu && trackerCurrentMonth) {
        const opt = monthMenu.querySelector(`[data-value="${trackerCurrentMonth}"]`);
        if (opt) {
            monthMenu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            monthTrigger.querySelector('span').textContent = opt.textContent;
        }
    }
    
    const toggle = $('tracker-mode-switch');
    const labelMonth = $('tracker-mode-spend');
    const labelQuarter = $('tracker-mode-pipeline');
    
    // Sync quarter toggle with current value (for deep links)
    if (toggle) {
        toggle.checked = trackerIsQuarterView;
        labelMonth?.classList.toggle('active', !trackerIsQuarterView);
        labelQuarter?.classList.toggle('active', trackerIsQuarterView);
    }
    
    if (toggle) {
        toggle.addEventListener('change', function() {
            trackerIsQuarterView = this.checked;
            labelMonth?.classList.toggle('active', !trackerIsQuarterView);
            labelQuarter?.classList.toggle('active', trackerIsQuarterView);
            expandedJobs.clear();
            renderTrackerContent();
        });
    }
    
    labelMonth?.addEventListener('click', () => {
        if (toggle) toggle.checked = false;
        trackerIsQuarterView = false;
        labelMonth.classList.add('active');
        labelQuarter?.classList.remove('active');
        expandedJobs.clear();
        renderTrackerContent();
    });
    
    labelQuarter?.addEventListener('click', () => {
        if (toggle) toggle.checked = true;
        trackerIsQuarterView = true;
        labelMonth?.classList.remove('active');
        labelQuarter.classList.add('active');
        expandedJobs.clear();
        renderTrackerContent();
    });
}

function setupTrackerDropdown(triggerId, menuId, onChange) {
    const trigger = $(triggerId);
    const menu = $(menuId);
    if (!trigger || !menu) return;
    
    // Only attach trigger listener once (prevents double-toggle on re-render)
    if (!trigger.dataset.listenerAttached) {
        trigger.dataset.listenerAttached = 'true';
        
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            $$('.custom-dropdown-menu.open').forEach(m => {
                if (m.id !== menuId) { m.classList.remove('open'); m.previousElementSibling?.classList.remove('open'); }
            });
            trigger.classList.toggle('open');
            menu.classList.toggle('open');
        });
    }
    
    // Always reattach option listeners (options may be dynamically recreated)
    menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        if (opt.dataset.listenerAttached) return;
        opt.dataset.listenerAttached = 'true';
        
        opt.addEventListener('click', function() {
            const value = this.dataset.value;
            menu.querySelectorAll('.custom-dropdown-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            trigger.querySelector('span').textContent = this.textContent;
            trigger.classList.remove('open');
            menu.classList.remove('open');
            if (onChange) onChange(value);
        });
    });
}

// ===== RENDERING =====
async function renderTracker() {
    const content = $('tracker-content');
    if (!content) return;
    
    // Show loading modal and clear content
    content.innerHTML = '';
    showLoadingModal();
    
    if (Object.keys(trackerClients).length === 0) {
        await loadTrackerClients();
    }
    
    if (state.trackerClient) {
        await loadTrackerData(state.trackerClient);
    }
    
    // Hide loading modal once data is ready
    hideLoadingModal();
    
    setupTrackerDropdowns();
    renderTrackerContent();
}

function toggleJobExpand(jobNumber) {
    if (expandedJobs.has(jobNumber)) {
        expandedJobs.delete(jobNumber);
    } else {
        expandedJobs.add(jobNumber);
    }
    renderTrackerContent();
}

function buildChildRows(jobNumber, isExpanded, spendTypeFilter, isQuarterView) {
    if (!isExpanded) return '';
    
    const children = trackerData
        .filter(d => d.jobNumber === jobNumber && d.spendType === spendTypeFilter && d.spend > 0)
        .sort((a, b) => TRACKER_MONTHS.indexOf(a.month) - TRACKER_MONTHS.indexOf(b.month));
    
    if (children.length === 0) return '';
    
    const safeJob = jobNumber.replace(/'/g, "\\'");
    
    return children.map(c => {
        const isCurrentMonth = !isQuarterView && c.month === trackerCurrentMonth;
        const safeMonth = c.month.replace(/'/g, "\\'");
        return `
            <tr class="tracker-row-child ${isCurrentMonth ? 'current-month' : ''}" onclick="openTrackerDetail('${safeJob}', '${safeMonth}')">
                <td class="chevron-cell"></td>
                <td class="child-month-label">${c.month}</td>
                <td></td>
                <td class="child-description">${c.description || ''}</td>
                ${!isQuarterView ? '<td></td>' : ''}
                <td class="amount ${c.ballpark ? 'ballpark' : ''}">${formatTrackerCurrency(c.spend)}</td>
            </tr>
        `;
    }).join('');
}

function renderTrackerContent() {
    const content = $('tracker-content');
    if (!content || !state.trackerClient) return;
    
    const client = trackerClients[state.trackerClient];
    if (!client) {
        content.innerHTML = `<div class="empty-section"><img src="images/dot-sitting.png" alt="Dot"><span>Select a client to view tracker</span></div>`;
        return;
    }
    
    const rollover = client.rollover || 0;
    const rolloverUseIn = client.rolloverUseIn || '';
    const rolloverObject = client.rolloverObject;
    const qInfo = getQuarterInfoForMonth(state.trackerClient, trackerCurrentMonth);
    const prevQ = getPreviousQuarter(state.trackerClient);

    const labelMap = { 'Jan > Mar': 'JAN-MAR', 'Apr > Jun': 'APR-JUN', 'Jul > Sep': 'JUL-SEP', 'Oct > Dec': 'OCT-DEC' };
    const viewedQuarterKey = labelMap[qInfo.label] || '';

    let toDate, projects, viewedMonths;
    if (trackerIsQuarterView) {
        toDate = qInfo.months.reduce((sum, m) => sum + getTrackerMonthSpend(state.trackerClient, m), 0);
        projects = trackerData.filter(d => d.client === state.trackerClient && qInfo.months.includes(d.month));
        viewedMonths = qInfo.months;
    } else {
        toDate = getTrackerMonthSpend(state.trackerClient, trackerCurrentMonth);
        projects = getTrackerProjectsForMonth(state.trackerClient, trackerCurrentMonth);
        viewedMonths = [trackerCurrentMonth];
    }

    // Total budget — sum of per-month committed values across the viewed period.
    // Uses Budget History via committedByMonth so historical periods show
    // their actual committed amounts, not today's rate.
    const totalBudget = viewedMonths.reduce((sum, m) => {
        const year = getYearForMonth(client, m);
        return sum + getCommittedFor(client, year, m);
    }, 0);
    const remaining = totalBudget - toDate;
    const progress = totalBudget > 0 ? Math.min((toDate / totalBudget) * 100, 100) : 0;
    const isOver = toDate > totalBudget;
    // New rollover behaviour: only show when actively in the current quarter.
    // Old condition (rolloverUseIn === viewedQuarterKey) preserved as fallback.
    const showRolloverNew = rolloverObject && rolloverObject.amount > 0 && viewedQuarterKey === rolloverUseIn;
    const showRolloverOld = !rolloverObject && rollover > 0 && rolloverUseIn && viewedQuarterKey === rolloverUseIn;
    const showRollover = showRolloverNew || showRolloverOld;
    
    const mainProjects = projects.filter(p => p.spendType === 'Project budget');
    const otherProjects = projects.filter(p => p.spendType === 'Extra budget' || p.spendType === 'Project on us');
    
    const groupProjects = (arr) => {
        if (!trackerIsQuarterView) return arr;
        const grouped = {};
        arr.forEach(p => {
            const key = p.jobNumber + '|' + p.projectName;
            if (!grouped[key]) grouped[key] = { ...p, spend: 0, _isGrouped: true };
            grouped[key].spend += p.spend;
        });
        return Object.values(grouped);
    };
    
    const displayMainProjects = groupProjects(mainProjects).sort((a, b) => {
        const aNum = a.jobNumber.split(' ')[1] || '';
        const bNum = b.jobNumber.split(' ')[1] || '';
        if (aNum === '000') return 1;
        if (bNum === '000') return -1;
        return 0;
    });
    const displayOtherProjects = groupProjects(otherProjects);
    
    const spendToDate = {};
    if (!trackerIsQuarterView) {
        const monthOrder = TRACKER_MONTHS;
        const currentMonthIndex = monthOrder.indexOf(trackerCurrentMonth);
        
        trackerData.forEach(d => {
            const dataMonthIndex = monthOrder.indexOf(d.month);
            if (dataMonthIndex !== -1 && currentMonthIndex !== -1 && dataMonthIndex < currentMonthIndex) {
                spendToDate[d.jobNumber] = (spendToDate[d.jobNumber] || 0) + d.spend;
            }
        });
    }
    
    const numbersTitle = trackerIsQuarterView ? `${qInfo.quarter} Numbers` : `${trackerCurrentMonth} Numbers`;
    const amountHeader = trackerIsQuarterView ? `${qInfo.quarter} Total` : trackerCurrentMonth;
    
    content.innerHTML = `
        <div class="tracker-inner">
            <div class="section-title"><span>${numbersTitle}</span> <span class="quarter-context">${qInfo.quarter} (${qInfo.label})</span></div>
            <div class="numbers-section">
                <div class="numbers-grid">
                    <div class="stat-box">
                        <div class="stat-value grey">${formatTrackerCurrency(totalBudget)}</div>
                        <div class="stat-label">Committed</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value">${formatTrackerCurrency(toDate)}</div>
                        <div class="stat-label">To Date</div>
                    </div>
                    <div class="stat-box">
                        <div class="stat-value ${isOver ? 'orange' : 'red'}">${isOver ? '-' : ''}${formatTrackerCurrency(Math.abs(remaining))}</div>
                        <div class="stat-label">To Spend</div>
                    </div>
                </div>
                <div class="tracker-progress-bar">
                    <div class="tracker-progress-fill ${isOver ? 'over' : ''}" style="width: ${progress}%"></div>
                </div>
                ${showRollover ? `
                    <div class="rollover-credit">
                        <div class="rollover-label">Rollover</div>
                        <div class="rollover-amount">${rolloverObject ? formatRolloverLine(rolloverObject) : `<strong>+${formatTrackerCurrency(rollover)}</strong> credit from ${prevQ.quarter}`}</div>
                    </div>
                ` : ''}
            </div>
            
            <div class="section-title">The Work</div>
            <div class="projects-section">
                <table class="projects-table">
                    <thead>
                        <tr>
                            <th class="chevron-col"></th>
                            <th class="project-col">Project Name</th>
                            <th class="owner-col">Owner</th>
                            <th>Description</th>
                            ${!trackerIsQuarterView ? '<th class="amount-col">To Date</th>' : ''}
                            <th class="amount-col">${amountHeader}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayMainProjects.length === 0 ? `
                            <tr><td colspan="${trackerIsQuarterView ? 5 : 6}" style="text-align:center;color:var(--grey-400);padding:24px;">No projects for ${trackerIsQuarterView ? qInfo.quarter : trackerCurrentMonth}</td></tr>
                        ` : displayMainProjects.map(p => {
                            const jobNum = p.jobNumber.split(' ')[1] || '';
                            const showToDateCol = !trackerIsQuarterView && jobNum !== '000' && jobNum !== '001' && (spendToDate[p.jobNumber] || 0) > 0;
                            const isExpanded = expandedJobs.has(p.jobNumber);
                            const safeJob = p.jobNumber.replace(/'/g, "\\'");
                            return `
                                <tr class="tracker-row-clickable ${isExpanded ? 'expanded-parent' : ''}" onclick="openTrackerDetail('${safeJob}', '${trackerCurrentMonth}')">
                                    <td class="chevron-cell"><span class="chevron-indicator ${isExpanded ? 'expanded' : ''}" onclick="event.stopPropagation(); toggleJobExpand('${safeJob}')">${ICON_CHEVRON_RIGHT}</span></td>
                                    <td class="project-name">${p.jobNumber}  -  ${p.projectName}</td>
                                    <td>${p.owner || ''}</td>
                                    <td>${p.description || ''}</td>
                                    ${!trackerIsQuarterView ? `<td class="amount" style="color:var(--grey-400);font-weight:normal;">${showToDateCol ? '(' + formatTrackerCurrency(spendToDate[p.jobNumber]) + ')' : ''}</td>` : ''}
                                    <td class="amount ${p.ballpark ? 'ballpark' : ''}">${formatTrackerCurrency(p.spend)}</td>
                                </tr>
                                ${buildChildRows(p.jobNumber, isExpanded, 'Project budget', trackerIsQuarterView)}
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            
            ${displayOtherProjects.length > 0 ? `
                <div class="section-title">Other Stuff</div>
                <div class="projects-section">
                    <table class="projects-table">
                        <thead>
                            <tr>
                                <th class="chevron-col"></th>
                                <th class="project-col">Project Name</th>
                                <th class="owner-col">Owner</th>
                                <th>Description</th>
                                ${!trackerIsQuarterView ? '<th class="amount-col">To Date</th>' : ''}
                                <th class="amount-col">${amountHeader}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${displayOtherProjects.map(p => {
                                const jobNum = p.jobNumber.split(' ')[1] || '';
                                const showToDateCol = !trackerIsQuarterView && jobNum !== '000' && jobNum !== '001' && (spendToDate[p.jobNumber] || 0) > 0;
                                return `
                                    <tr class="tracker-row-clickable" onclick="openTrackerDetail('${p.jobNumber}', '${trackerCurrentMonth}')">
                                        <td class="chevron-cell"><span class="chevron-indicator">${ICON_CHEVRON_RIGHT}</span></td>
                                        <td class="project-name">${p.jobNumber}  -  ${p.projectName}</td>
                                        <td>${p.owner || ''}</td>
                                        <td>${p.description || ''}</td>
                                        ${!trackerIsQuarterView ? `<td class="amount" style="color:var(--grey-400);font-weight:normal;">${showToDateCol ? '(' + formatTrackerCurrency(spendToDate[p.jobNumber]) + ')' : ''}</td>` : ''}
                                        <td class="amount">${formatTrackerCurrency(p.spend)}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            
            <div class="tracker-bottom-row">
                <div>
                    <div class="section-title">Tracker</div>
                    <div class="chart-section">
                        <div class="chart-wrapper">
                            <div class="y-axis" id="tracker-y-axis"></div>
                            <div class="committed-line" id="tracker-committed-line"></div>
                            <div class="chart-container" id="tracker-chart-container"></div>
                        </div>
                        <div class="chart-legend">
                            <div class="legend-item"><div class="legend-swatch projects"></div><span>Projects</span></div>
                            <div class="legend-item"><div class="legend-swatch committed-swatch"></div><span>Committed</span></div>
                            <div class="legend-item"><div class="legend-swatch incoming-swatch"></div><span>Ballpark</span></div>
                        </div>
                    </div>
                </div>
                <div>
                    <div class="section-title">Notes</div>
                    <div class="notes-section">
                        <ul class="notes-list">
                            <li><strong>Ballparks</strong> - Red numbers are ballparks. Most jobs start as a $5K ballpark before we lock in scope.</li>
                            <li><strong>Rollover</strong> - You can use your rollover credit any time during the quarter. It's extra on top of committed spend.</li>
                        </ul>
                        <button class="pdf-btn" onclick="getTrackerPDF()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                                <line x1="12" y1="18" x2="12" y2="12"></line>
                                <line x1="9" y1="15" x2="15" y2="15"></line>
                            </svg>
                            Get PDF
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    setTimeout(renderTrackerChart, 0);
    setupTrackerModalListeners();
}

function renderTrackerChart() {
    const client = trackerClients[state.trackerClient];
    if (!client) return;

    // ===== Path A: chartMonths from API (historically accurate) =====
    // ===== Path B: legacy fallback if chartMonths missing =====
    const useChartMonths = Array.isArray(client.chartMonths) && client.chartMonths.length === 6;

    const qInfo = getCurrentQuarterInfo(state.trackerClient);
    const prevQ = getPreviousQuarter(state.trackerClient);
    const chartHeight = 160;

    // Build a unified array of 6 entries: { label, year, monthName, committed, isPrevious, isFuture }
    let entries;
    if (useChartMonths) {
        const today = new Date();
        const todayFirst = new Date(today.getFullYear(), today.getMonth(), 1);
        entries = client.chartMonths.map(m => ({
            label: m.month.substring(0, 3),
            year: m.year,
            monthName: m.month,
            committed: m.committed,
            isPrevious: m.isPrevious,
            isFuture: m.isFuture !== undefined
                ? m.isFuture
                : (new Date(m.year, MONTH_NUM[m.month] - 1, 1) > todayFirst)
        }));
    } else {
        const fallbackCommitted = client.committed || 0;
        entries = [
            ...prevQ.months.map(m => ({
                label: m.substring(0, 3),
                year: getYearForMonth(client, m),
                monthName: m,
                committed: fallbackCommitted,
                isPrevious: true,
                isFuture: false
            })),
            ...qInfo.months.map(m => {
                const today = new Date();
                const currentMonthName = today.toLocaleString('en-US', { month: 'long' });
                const idx = qInfo.months.indexOf(m);
                const currentIdx = qInfo.months.indexOf(currentMonthName);
                return {
                    label: m.substring(0, 3),
                    year: getYearForMonth(client, m),
                    monthName: m,
                    committed: fallbackCommitted,
                    isPrevious: false,
                    isFuture: currentIdx !== -1 && idx > currentIdx
                };
            })
        ];
    }

    // yMax based on the tallest committed bar so the chart accommodates rate changes.
    const maxCommitted = Math.max(...entries.map(e => e.committed), 0);
    const yMax = maxCommitted + 10000;

    // Y-axis labels
    const yAxis = $('tracker-y-axis');
    if (yAxis) {
        yAxis.innerHTML = '';
        for (let i = 5; i >= 0; i--) {
            const lbl = document.createElement('span');
            lbl.className = 'y-label';
            lbl.textContent = '$' + Math.round(yMax * i / 5 / 1000) + 'k';
            yAxis.appendChild(lbl);
        }
    }

    // Hide the old single committed line — we draw stepped per-bar lines below.
    const committedLineEl = $('tracker-committed-line');
    if (committedLineEl) {
        committedLineEl.style.display = 'none';
    }

    const container = $('tracker-chart-container');
    if (!container) return;
    container.innerHTML = '';

    // Helper to look up confirmed/ballpark spend for a month
    const monthData = (monthName) => {
        const projects = trackerData.filter(d =>
            d.client === state.trackerClient &&
            d.month === monthName &&
            d.spendType === 'Project budget'
        );
        return {
            confirmed: projects.filter(d => !d.ballpark).reduce((s, d) => s + d.spend, 0),
            ballpark: projects.filter(d => d.ballpark).reduce((s, d) => s + d.spend, 0)
        };
    };

    entries.forEach(entry => {
        const group = document.createElement('div');
        group.className = 'bar-group';
        const barStack = document.createElement('div');
        barStack.className = 'bar-stack';

        // Each bar's stack height is its committed value as a fraction of yMax.
        // This gives us per-bar grey heights (the stepped pattern visually).
        const stackPx = (entry.committed / yMax) * chartHeight;
        barStack.style.height = stackPx + 'px';

        const greyBar = document.createElement('div');
        greyBar.className = entry.isFuture ? 'bar-committed future' : 'bar-committed';
        greyBar.style.height = '100%';
        greyBar.title = 'Committed: ' + formatTrackerCurrency(entry.committed);
        barStack.appendChild(greyBar);

        const { confirmed, ballpark } = monthData(entry.monthName);
        const cmt = entry.committed || 1; // avoid divide-by-zero

        if (confirmed > 0) {
            const redBar = document.createElement('div');
            redBar.className = 'bar-spend';
            // Spend bar is a percentage of the grey (committed) bar's height.
            // Cap visually at 100% of the grey bar; overage shows as a full red bar.
            redBar.style.height = Math.min(100, (confirmed / cmt) * 100) + '%';
            redBar.title = 'Actual: ' + formatTrackerCurrency(confirmed);
            barStack.appendChild(redBar);
        }

        if (ballpark > 0) {
            const dashedBar = document.createElement('div');
            dashedBar.className = 'bar-ballpark';
            dashedBar.style.height = Math.min(100, (ballpark / cmt) * 100) + '%';
            dashedBar.style.bottom = (confirmed > 0 && !entry.isFuture)
                ? Math.min(100, (confirmed / cmt) * 100) + '%'
                : '0';
            dashedBar.title = 'Ballpark: ' + formatTrackerCurrency(ballpark);
            barStack.appendChild(dashedBar);
        }

        // Stepped committed line — draw a dashed cap on top of every bar.
        const cap = document.createElement('div');
        cap.className = 'bar-committed-cap';
        barStack.appendChild(cap);

        const labelEl = document.createElement('span');
        labelEl.className = 'bar-label';
        labelEl.textContent = entry.label;

        group.appendChild(barStack);
        group.appendChild(labelEl);
        container.appendChild(group);
    });
}

// Modal lifecycle (setupTrackerModalListeners, openTrackerDetail, openTrackerEditModal,
// closeTrackerModal, saveTrackerProject) moved to trackerEditModal.js

function getTrackerPDF() {
    const url = `https://dot-tracker-pdf.up.railway.app/pdf?client=${state.trackerClient}&month=${trackerCurrentMonth}${trackerIsQuarterView ? '&quarter=true' : ''}`;
    window.open(url, '_blank');
}

// ===== EXPOSE TO WINDOW =====
// These are accessed by app.js and HTML onclick handlers
window.renderTracker = renderTracker;
window.loadTrackerData = loadTrackerData;
window.getTrackerPDF = getTrackerPDF;
window.toggleJobExpand = toggleJobExpand;

// Expose state for deep link handling in app.js
Object.defineProperty(window, 'trackerCurrentMonth', {
    get: () => trackerCurrentMonth,
    set: (val) => { trackerCurrentMonth = val; }
});

Object.defineProperty(window, 'trackerIsQuarterView', {
    get: () => trackerIsQuarterView,
    set: (val) => { trackerIsQuarterView = val; }
});
