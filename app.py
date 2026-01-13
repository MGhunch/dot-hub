"""
Dot Remote API
Flask server for Airtable integration and Claude processing
"""

import os
import json
import time
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# ===== CONFIGURATION =====
AIRTABLE_API_KEY = os.environ.get('AIRTABLE_API_KEY')
AIRTABLE_BASE_ID = os.environ.get('AIRTABLE_BASE_ID', 'app8CI7NAZqhQ4G1Y')
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')

AIRTABLE_HEADERS = {
    'Authorization': f'Bearer {AIRTABLE_API_KEY}',
    'Content-Type': 'application/json'
}

# ===== CONVERSATION MEMORY =====
# Simple in-memory store - sessions expire after 30 mins
conversations = {}
SESSION_TIMEOUT = 30 * 60  # 30 minutes

def get_conversation(session_id):
    """Get or create conversation history for a session"""
    now = time.time()
    
    # Clean up old sessions
    expired = [sid for sid, data in conversations.items() if now - data['last_active'] > SESSION_TIMEOUT]
    for sid in expired:
        del conversations[sid]
    
    if session_id not in conversations:
        conversations[session_id] = {
            'messages': [],
            'context': {},  # Stores last client, job, etc.
            'last_active': now
        }
    else:
        conversations[session_id]['last_active'] = now
    
    return conversations[session_id]

def add_to_conversation(session_id, role, content):
    """Add a message to conversation history"""
    conv = get_conversation(session_id)
    conv['messages'].append({'role': role, 'content': content})
    
    # Keep only last 10 exchanges (20 messages)
    if len(conv['messages']) > 20:
        conv['messages'] = conv['messages'][-20:]

def update_context(session_id, context_update):
    """Update conversation context (last client, job, etc.)"""
    conv = get_conversation(session_id)
    conv['context'].update(context_update)

# ===== STATIC FILES =====
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# ===== HEALTH CHECK =====
@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'service': 'dot-remote-api'})

# ===== CLIENTS =====
@app.route('/clients')
def get_clients():
    """Get list of active clients"""
    try:
        url = f'https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/Clients'
        params = {
            'filterByFormula': '{Active}=TRUE()',
            'fields[]': ['Client Name', 'Client Code', 'Active']
        }
        
        response = requests.get(url, headers=AIRTABLE_HEADERS, params=params)
        response.raise_for_status()
        
        clients = []
        for record in response.json().get('records', []):
            fields = record.get('fields', {})
            clients.append({
                'code': fields.get('Client Code', ''),
                'name': fields.get('Client Name', '')
            })
        
        return jsonify(clients)
    
    except Exception as e:
        print(f'Error fetching clients: {e}')
        return jsonify({'error': str(e)}), 500

# ===== JOBS =====
@app.route('/jobs/all')
def get_all_jobs():
    """Get all active jobs"""
    try:
        url = f'https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/Projects'
        
        filters = ["{Status}!='Archived'"]
        formula = f"AND({','.join(filters)})"
        
        params = {
            'filterByFormula': formula,
            'sort[0][field]': 'Update due friendly',
            'sort[0][direction]': 'asc'
        }
        
        response = requests.get(url, headers=AIRTABLE_HEADERS, params=params)
        response.raise_for_status()
        
        jobs = []
        for record in response.json().get('records', []):
            fields = record.get('fields', {})
            jobs.append({
                'id': record.get('id'),
                'jobNumber': fields.get('Job Number', ''),
                'jobName': fields.get('Project Name', ''),
                'clientCode': fields.get('Client Code', ''),
                'stage': fields.get('Stage', ''),
                'status': fields.get('Status', ''),
                'updateDue': fields.get('Update due friendly', ''),
                'update': fields.get('Update Summary', ''),
                'description': fields.get('Description', ''),
                'projectOwner': fields.get('Project Owner', ''),
                'lastUpdated': fields.get('Last Updated', ''),
                'liveDate': fields.get('Live Date', ''),
                'withClient': fields.get('With Client?', False),
                'channelUrl': fields.get('Channel Url', '')
            })
        
        return jsonify(jobs)
    
    except Exception as e:
        print(f'Error fetching jobs: {e}')
        return jsonify({'error': str(e)}), 500

# ===== SINGLE JOB UPDATE =====
@app.route('/job/<job_number>/update', methods=['POST'])
def update_job(job_number):
    """Update a job's fields"""
    data = request.json
    
    try:
        # First find the record ID
        url = f'https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/Projects'
        params = {
            'filterByFormula': f"{{Job Number}}='{job_number}'",
            'maxRecords': 1
        }
        
        response = requests.get(url, headers=AIRTABLE_HEADERS, params=params)
        response.raise_for_status()
        
        records = response.json().get('records', [])
        if not records:
            return jsonify({'error': 'Job not found'}), 404
        
        record_id = records[0]['id']
        
        # Build fields to update
        fields = {}
        if 'stage' in data:
            fields['Stage'] = data['stage']
        if 'status' in data:
            fields['Status'] = data['status']
        if 'updateDue' in data:
            fields['Update due friendly'] = data['updateDue']
        if 'liveDate' in data:
            fields['Live Date'] = data['liveDate']
        if 'withClient' in data:
            fields['With Client?'] = data['withClient']
        
        if fields:
            update_url = f'https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/Projects/{record_id}'
            update_response = requests.patch(update_url, headers=AIRTABLE_HEADERS, json={'fields': fields})
            update_response.raise_for_status()
        
        return jsonify({'success': True})
    
    except Exception as e:
        print(f'Error updating job: {e}')
        return jsonify({'error': str(e)}), 500

# ===== CLAUDE PARSE (Query Understanding with Memory) =====
@app.route('/claude/parse', methods=['POST'])
def claude_parse():
    """
    Parse a natural language query using Claude
    Returns structured intent for the frontend to execute
    """
    data = request.json
    question = data.get('question', '')
    clients = data.get('clients', [])
    session_id = data.get('sessionId', 'default')
    
    if not question:
        return jsonify({'error': 'No question provided'}), 400
    
    if not ANTHROPIC_API_KEY:
        return jsonify({'error': 'Anthropic API not configured'}), 500
    
    try:
        # Get conversation history and context
        conv = get_conversation(session_id)
        history = conv['messages']
        context = conv['context']
        
        # Build client list for prompt
        client_list = ', '.join([f"{c['code']} ({c['name']})" for c in clients])
        
        # Build context hint
        context_hint = ""
        if context.get('lastClient'):
            context_hint += f"Last discussed client: {context['lastClient']}. "
        if context.get('lastJob'):
            context_hint += f"Last discussed job: {context['lastJob']}. "
        
        system_prompt = f"""You are Dot, the project assistant for Hunch creative agency. You're helpful, a little cheeky, and you know your limits.

WHAT YOU CAN DO:
- Find jobs and projects (by client, status, due date)
- Show what's due, overdue, on hold, with client
- Open the budget tracker
- Help people navigate the system

WHAT YOU CAN'T DO:
- Answer general knowledge questions
- Give opinions on creative work
- Predict the future
- Make coffee (yet)

AVAILABLE CLIENTS: {client_list}

CONVERSATION CONTEXT: {context_hint if context_hint else 'None yet'}

RESPONSE FORMAT:
Return ONLY valid JSON in this exact format:
{{
    "coreRequest": "FIND" | "DUE" | "UPDATE" | "TRACKER" | "HELP" | "UNKNOWN",
    "modifiers": {{
        "client": "CLIENT_CODE or null",
        "status": "In Progress" | "On Hold" | "Incoming" | "Completed" | null,
        "withClient": true | false | null,
        "dateRange": "today" | "week" | "next" | null
    }},
    "searchTerms": [],
    "understood": true | false,
    "fallbackMessage": "Only if understood is false - a cheeky one-liner explaining you can't help with that"
}}

PARSING RULES:
- If user says "them", "that client", "those" - refer to the last discussed client in context
- If user mentions a client name or code, set modifiers.client to the CLIENT_CODE
- "on hold", "waiting", "paused" → status: "On Hold"
- "with client", "with them", "waiting on client" → withClient: true
- "due", "overdue", "deadline", "urgent" → coreRequest: "DUE"
- "show", "list", "find", "check", "all jobs" → coreRequest: "FIND"
- "budget", "spend", "tracker" → coreRequest: "TRACKER"
- Keep searchTerms empty unless user is searching for specific job keywords

WHEN YOU CAN'T HELP:
If the question is outside your scope, set understood: false and write a short, cheeky fallbackMessage. Channel a robot with heart. Examples:
- "I'm a robot, not a search engine. Try Google?"
- "That's above my pay grade. I just do projects."
- "I'm flattered you think I know that, but... no."
- "Beep boop, does not compute. Job stuff only!"
- "I'm a project bot, not a therapist. Beer o'clock?"
- "My talents are limited to jobs and deadlines. Tragic, I know."

Keep fallbackMessages short (under 15 words), warm, and a little self-deprecating. Never be mean."""

        # Build messages with history
        messages = []
        for msg in history[-10:]:  # Last 5 exchanges
            messages.append(msg)
        messages.append({'role': 'user', 'content': question})
        
        response = requests.post(
            'https://api.anthropic.com/v1/messages',
            headers={
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            json={
                'model': 'claude-sonnet-4-20250514',
                'max_tokens': 500,
                'system': system_prompt,
                'messages': messages
            }
        )
        
        response.raise_for_status()
        result = response.json()
        
        # Extract Claude's response
        assistant_message = result.get('content', [{}])[0].get('text', '{}')
        
        # Try to parse as JSON
        try:
            # Clean up response - sometimes Claude adds markdown
            clean_message = assistant_message.strip()
            if clean_message.startswith('```'):
                clean_message = clean_message.split('```')[1]
                if clean_message.startswith('json'):
                    clean_message = clean_message[4:]
            clean_message = clean_message.strip()
            
            parsed = json.loads(clean_message)
            
            # Update conversation history
            add_to_conversation(session_id, 'user', question)
            add_to_conversation(session_id, 'assistant', f"Parsed: {parsed.get('coreRequest')} for {parsed.get('modifiers', {}).get('client', 'no client')}")
            
            # Update context
            if parsed.get('modifiers', {}).get('client'):
                update_context(session_id, {'lastClient': parsed['modifiers']['client']})
            
            return jsonify({'parsed': parsed})
            
        except json.JSONDecodeError as e:
            print(f'JSON parse error: {e}')
            print(f'Raw response: {assistant_message}')
            return jsonify({'parsed': None, 'error': 'Could not parse response'})
    
    except Exception as e:
        print(f'Error calling Claude: {e}')
        return jsonify({'error': str(e)}), 500

# ===== CLEAR SESSION =====
@app.route('/claude/clear', methods=['POST'])
def clear_session():
    """Clear conversation history for a session"""
    data = request.json
    session_id = data.get('sessionId', 'default')
    
    if session_id in conversations:
        del conversations[session_id]
    
    return jsonify({'success': True})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
