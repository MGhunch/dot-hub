/**
 * Hub Ask Dot - Unified Changes
 * 
 * Replace the existing askClaude() and processQuestion() functions 
 * in app.js with these versions.
 * 
 * WHAT CHANGES:
 * - askClaude() → askDot() - calls Traffic instead of /claude/parse
 * - processQuestion() - handles new response types (action, answer, confirm, clarify, redirect)
 * - getFilteredJobsFromResponse() - DELETE (no longer needed, backend does filtering)
 * 
 * WHAT STAYS THE SAME:
 * - renderResponse() - still works
 * - createUniversalCard() - still works
 * - All the WIP/Tracker code - unchanged
 */

// ===================
// CONFIGURATION
// ===================

// Add Traffic endpoint (add this near the top with other config)
const TRAFFIC_BASE = 'https://dot-traffic.up.railway.app';


// ===================
// REPLACE: askClaude() → askDot()
// ===================

async function askDot(question) {
    try {
        const sessionId = state.currentUser?.name || 'anonymous';
        
        const response = await fetch(`${TRAFFIC_BASE}/traffic`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                source: 'hub',
                content: question,
                senderEmail: state.currentUser?.email || 'hub@hunch.co.nz',
                senderName: state.currentUser?.name || 'Hub User',
                sessionId: sessionId
            })
        });
        
        if (!response.ok) {
            console.log('Traffic API error:', response.status);
            return null;
        }
        
        return await response.json();
    } catch (e) {
        console.log('Traffic API error:', e);
        return null;
    }
}


// ===================
// REPLACE: processQuestion()
// ===================

async function processQuestion(question) {
    resetInactivityTimer();
    addThinkingDots();
    
    console.log('Query:', question);
    
    const response = await askDot(question);
    
    removeThinkingDots();
    
    console.log('Dot response:', response);
    
    if (!response) {
        renderResponse({ 
            message: "Hmm, I'm having trouble thinking right now. Try again?",
            nextPrompt: "What can Dot do?"
        });
        return;
    }
    
    // Handle different response types
    switch (response.type) {
        case 'answer':
            // Simple answer, maybe with job cards
            renderResponse({
                message: response.message,
                jobs: response.jobs || [],
                nextPrompt: response.nextPrompt
            });
            break;
            
        case 'action':
            // Worker was called (or will be called)
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: response.nextPrompt
            });
            // Could show a success indicator here
            break;
            
        case 'confirm':
            // Need user to pick a job
            renderResponse({
                message: response.message,
                jobs: response.jobs || [],
                nextPrompt: null
            });
            break;
            
        case 'clarify':
            // Need more info from user
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: null
            });
            break;
            
        case 'redirect':
            // Redirect to WIP or Tracker
            renderResponse({
                message: response.message,
                jobs: [],
                nextPrompt: null
            });
            // Navigate to the view
            if (response.redirectTo) {
                setTimeout(() => {
                    navigateTo(response.redirectTo);
                    // Apply filters if provided
                    if (response.redirectParams?.client) {
                        if (response.redirectTo === 'wip') {
                            state.wipClient = response.redirectParams.client;
                            renderWip();
                        } else if (response.redirectTo === 'tracker') {
                            state.trackerClient = response.redirectParams.client;
                            renderTracker();
                        }
                    }
                }, 1500);  // Short delay so user sees the message
            }
            break;
            
        case 'error':
            // Something went wrong
            renderResponse({
                message: response.message || "Sorry, I got in a muddle over that one.",
                jobs: [],
                nextPrompt: "What can Dot do?"
            });
            break;
            
        default:
            // Fallback - treat as answer
            renderResponse({
                message: response.message || "I'm not sure what happened there.",
                jobs: response.jobs || [],
                nextPrompt: response.nextPrompt
            });
    }
}


// ===================
// DELETE: getFilteredJobsFromResponse()
// ===================
// 
// This function is no longer needed - the backend now returns 
// actual job objects instead of filters. Delete the entire 
// getFilteredJobsFromResponse() function from app.js.
//
// OLD: Claude returns filters, frontend filters jobs locally
// NEW: Dot returns actual jobs, frontend just renders them


// ===================
// OPTIONAL: Clear session endpoint
// ===================

async function clearDotSession() {
    try {
        const sessionId = state.currentUser?.name || 'anonymous';
        await fetch(`${TRAFFIC_BASE}/traffic/clear`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
        });
    } catch (e) {
        console.log('Failed to clear session:', e);
    }
}

// Call this on sign out:
// In signOut() function, add: clearDotSession();
