"""
Dot Hub
Flask server serving static frontend + API routes for Airtable data.
Ask Dot brain lives in Traffic - this is just data.
"""

from flask import Flask, jsonify, request, send_from_directory, make_response, redirect
from flask_cors import CORS
import requests
import os
from datetime import datetime
import re
import hashlib  # NEW: For auth tokens
import time     # NEW: For auth tokens
import base64   # NEW: For auth tokens

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# ===== CONFIGURATION =====
AIRTABLE_API_KEY = os.environ.get('AIRTABLE_API_KEY')
AIRTABLE_BASE_ID = os.environ.get('AIRTABLE_BASE_ID', 'app8CI7NAZqhQ4G1Y')

HEADERS = {
    'Authorization': f'Bearer {AIRTABLE_API_KEY}',
    'Content-Type': 'application/json'
}

def get_airtable_url(table):
    return f'https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{table}'


# ===== AUTH CONFIGURATION (NEW) =====
POSTMAN_URL = os.environ.get('PA_POSTMAN_URL', '')
TOKEN_SECRET = os.environ.get('TOKEN_SECRET', 'dot-hub-secret-change-me')
HUB_URL = os.environ.get('HUB_URL', 'https://hub.hunch.co.nz')
TOKEN_EXPIRY_DAYS = 7


# ===== AUTH FUNCTIONS (NEW) =====

def generate_token(email, client_code, first_name, access_level='Client WIP'):
    """Generate a signed token containing user info + expiry."""
    expires = int(time.time()) + (TOKEN_EXPIRY_DAYS * 24 * 60 * 60)
    data = f"{email}|{client_code}|{first_name}|{access_level}|{expires}"
    sig = hashlib.sha256(f"{data}|{TOKEN_SECRET}".encode()).hexdigest()[:8]
    token_data = f"{data}|{sig}"
    token = base64.urlsafe_b64encode(token_data.encode()).decode().rstrip('=')
    return token


def verify_token(token):
    """Verify and decode a token. Returns (user_dict, error_string)."""
    try:
        # Add back padding if needed
        padding = 4 - (len(token) % 4)
        if padding != 4:
            token += '=' * padding
        
        token_data = base64.urlsafe_b64decode(token.encode()).decode()
        parts = token_data.split('|')
        
        if len(parts) != 6:
            return None, 'invalid'
        
        email, client_code, first_name, access_level, expires, sig = parts
        
        # Verify signature
        data = f"{email}|{client_code}|{first_name}|{access_level}|{expires}"
        expected_sig = hashlib.sha256(f"{data}|{TOKEN_SECRET}".encode()).hexdigest()[:8]
        
        if sig != expected_sig:
            return None, 'invalid'
        
        # Check expiry
        if int(expires) < time.time():
            return None, 'expired'
        
        return {
            'email': email,
            'client_code': client_code,
            'first_name': first_name,
            'access_level': access_level
        }, None
        
    except Exception as e:
        print(f"[Auth] Token verification error: {e}")
        return None, 'invalid'


def lookup_person(email):
    """Look up a person by email in Airtable People table."""
    if not AIRTABLE_API_KEY or not AIRTABLE_BASE_ID:
        print("[Auth] Warning: Airtable not configured")
        return None
    
    url = get_airtable_url('People')
    params = {
        'filterByFormula': f'LOWER({{Email Address}}) = LOWER("{email}")',
        'maxRecords': 1
    }
    
    try:
        response = requests.get(url, headers=HEADERS, params=params)
        response.raise_for_status()
        data = response.json()
        
        if not data.get('records'):
            return None
        
        record = data['records'][0]
        fields = record.get('fields', {})
        
        return {
            'email': fields.get('Email Address', email),
            'first_name': fields.get('First Name', 'there'),
            'client_code': fields.get('clientCode', ['UNKNOWN'])[0],
            'access_level': fields.get('Access', 'Client WIP')  # Default to most restricted
        }
        
    except Exception as e:
        print(f"[Auth] Airtable lookup error: {e}")
        return None


def update_last_login(email):
    """Update lastLogin timestamp for a person."""
    if not AIRTABLE_API_KEY:
        return
    
    url = get_airtable_url('People')
    params = {
        'filterByFormula': f'LOWER({{Email Address}}) = LOWER("{email}")',
        'maxRecords': 1
    }
    
    try:
        response = requests.get(url, headers=HEADERS, params=params)
        response.raise_for_status()
        records = response.json().get('records', [])
        
        if records:
            record_id = records[0]['id']
            requests.patch(
                f"{url}/{record_id}",
                headers=HEADERS,
                json={'fields': {'lastLogin': datetime.now().isoformat()}}
            )
            print(f"[Auth] Updated lastLogin for {email}")
    except Exception as e:
        print(f"[Auth] Failed to update lastLogin: {e}")


def send_magic_link_email(email, first_name, token):
    """Send magic link email via Postman."""
    verify_url = f"{HUB_URL}/verify?token={token}"
    
    subject = "Log in. Ask Dot..."
    
    body = f"""<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 16px; line-height: 1.6; color: #333;">

<div style="padding-bottom: 16px; margin-bottom: 20px; border-bottom: 3px solid #ED1C24;">
    <img src="https://raw.githubusercontent.com/MGhunch/dot-hub/main/images/Askdot-header.png" alt="Ask Dot" height="32" style="display: block;">
</div>

<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 500;">Hi {first_name},</p>
<p style="margin: 0 0 24px 0; font-size: 16px; color: #666;">One click and you're in.</p>

<table cellpadding="0" cellspacing="0" style="margin: 0 0 28px 0;">
    <tr>
        <td style="background-color: #ED1C24; border-radius: 30px;">
            <a href="{verify_url}" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 500; color: #ffffff; letter-spacing: 0.1em; text-decoration: none;">OPEN THE HUB</a>
        </td>
    </tr>
</table>

<p style="margin: 0 0 12px 0; font-size: 16px; font-weight: 500;">You can:</p>
<p style="margin: 0 0 24px 0; font-size: 16px; color: #666; line-height: 1.8;">
    → See what's new, what's due and what's next.<br>
    → Let us know if anything needs a nudge.<br>
    → Or just ask Dot for your horoscope.
</p>

<p style="margin: 0 0 24px 0; font-size: 12px; color: #999;">This link expires in 7 days. If you didn't request this, just ignore it.</p>

<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 32px; border-top: 1px solid #eee; padding-top: 16px;">
    <tr>
        <td style="vertical-align: middle; padding-right: 12px;" width="60">
            <img src="https://raw.githubusercontent.com/MGhunch/dot-hub/main/images/ai2-logo.png" alt="hai2" width="56" height="28" style="display: block;">
        </td>
        <td style="vertical-align: middle; font-size: 12px; color: #999;">
            Dot is a robot, but there's humans in the loop.
        </td>
    </tr>
</table>

</div>"""
    
    if not POSTMAN_URL:
        print(f"[Auth] Warning: Postman URL not configured. Would send to: {email}")
        print(f"[Auth] Verify URL: {verify_url}")
        return True  # Return success for testing without Postman
    
    try:
        payload = {
            'to': email,
            'subject': subject,
            'body': body
        }
        
        response = requests.post(POSTMAN_URL, json=payload)
        response.raise_for_status()
        print(f"[Auth] Email sent to {email}")
        return True
        
    except Exception as e:
        print(f"[Auth] Email send error: {e}")
        return False


# ===== AUTH ROUTES (NEW) =====

@app.route('/api/request-login', methods=['POST'])
def handle_request_login():
    """Request a magic link. Expects: { "email": "user@example.com" }"""
    data = request.get_json() or {}
    email = data.get('email', '').strip().lower()
    
    if not email:
        return jsonify({
            'success': False,
            'error': 'no_email',
            'message': 'Please enter an email address'
        }), 400
    
    # Look up in People table
    person = lookup_person(email)
    
    if not person:
        return jsonify({
            'success': False,
            'error': 'not_found',
            'message': "I don't recognise that email"
        }), 404
    
    # Generate token
    token = generate_token(
        email=person['email'],
        client_code=person['client_code'],
        first_name=person['first_name'],
        access_level=person['access_level']
    )
    
    # Send email
    sent = send_magic_link_email(
        email=person['email'],
        first_name=person['first_name'],
        token=token
    )
    
    if not sent:
        return jsonify({
            'success': False,
            'error': 'email_failed',
            'message': 'Failed to send email'
        }), 500
    
    return jsonify({
        'success': True,
        'message': f"Link sent to {person['email']}"
    })


@app.route('/verify')
def handle_verify():
    """Verify a magic link token and set session cookie."""
    
    # Backdoor for Michael - bookmark hub.hunch.co.nz/verify?pin=9871
    if request.args.get('pin') == '9871':
        response = make_response(redirect('/'))
        session_token = generate_token(
            email='michael@hunch.co.nz',
            client_code='ALL',
            first_name='Michael',
            access_level='Full'
        )
        response.set_cookie(
            'dot_session',
            session_token,
            max_age=TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
            httponly=True,
            secure=True,
            samesite='Lax'
        )
        return response
    
    token = request.args.get('token', '')
    
    if not token:
        return redirect(f"/?error=invalid")
    
    user, error = verify_token(token)
    
    if error == 'expired':
        return redirect(f"/?error=expired")
    
    if error or not user:
        return redirect(f"/?error=invalid")
    
    # Success! Set cookie and redirect to Hub
    response = make_response(redirect('/'))
    
    # Create a session token (signed, same approach)
    session_token = generate_token(
        email=user['email'],
        client_code=user['client_code'],
        first_name=user['first_name'],
        access_level=user['access_level']
    )
    
    response.set_cookie(
        'dot_session',
        session_token,
        max_age=TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite='Lax'
    )
    
    # Log the login
    update_last_login(user['email'])
    
    return response


@app.route('/job/<job_number>')
def handle_job_link(job_number):
    """
    Deep link to job - validates token and opens job modal.
    Used by TO DO email links.
    
    URL format: /job/SKY018?t=<token>
    """
    token = request.args.get('t', '')
    
    if not token:
        return redirect(f"/?error=invalid")
    
    user, error = verify_token(token)
    
    if error == 'expired':
        return redirect(f"/?error=expired")
    
    if error or not user:
        return redirect(f"/?error=invalid")
    
    # Set session cookie
    response = make_response(redirect(f"/?job={job_number}"))
    
    session_token = generate_token(
        email=user['email'],
        client_code=user['client_code'],
        first_name=user['first_name'],
        access_level=user['access_level']
    )
    
    response.set_cookie(
        'dot_session',
        session_token,
        max_age=TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite='Lax'
    )
    
    return response


@app.route('/api/check-session')
def handle_check_session():
    """Check if current session is valid. Used by frontend to determine login state."""
    session_token = request.cookies.get('dot_session')
    
    if not session_token:
        return jsonify({'authenticated': False})
    
    user, error = verify_token(session_token)
    
    if error or not user:
        return jsonify({'authenticated': False})
    
    return jsonify({
        'authenticated': True,
        'user': {
            'email': user['email'],
            'firstName': user['first_name'],
            'clientCode': user['client_code'],
            'accessLevel': user['access_level']
        }
    })


@app.route('/api/logout', methods=['POST'])
def handle_logout():
    """Clear session cookie."""
    response = make_response(jsonify({'success': True}))
    response.delete_cookie('dot_session')
    return response


# ===== AUTH TEST ROUTES (NEW - Remove before production) =====

@app.route('/test/auth/token')
def test_auth_token():
    """Test token generation and verification."""
    token = generate_token(
        email='test@example.com',
        client_code='TEST',
        first_name='Tester',
        access_level='Client WIP'
    )
    user, error = verify_token(token)
    
    return jsonify({
        'token': token,
        'token_length': len(token),
        'verified': user,
        'error': error
    })


@app.route('/test/auth/lookup/<email>')
def test_auth_lookup(email):
    """Test Airtable People lookup."""
    person = lookup_person(email)
    return jsonify({
        'email': email,
        'found': person is not None,
        'person': person
    })


# ===== HEALTH CHECK =====
@app.route('/api/health')
def health():
    return jsonify({
        'status': 'ok',
        'service': 'dot-hub',
        'version': '1.1',  # Bumped for auth
        'features': ['static', 'api', 'universal-schema', 'magic-link-auth']
    })


# ===== STATIC FILES (must be after API routes) =====
@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')


# ===== DATE PARSING HELPERS =====
def parse_airtable_date(date_str):
    """
    Parse Airtable date field into ISO format (YYYY-MM-DD) for JS Date compatibility.
    
    Handles multiple formats:
    - ISO format from API: "2026-01-31" or "2026-01-31T00:00:00.000Z"
    - Local D/M/YYYY format: "31/1/2026" or "2/3/2026"
    """
    if not date_str or str(date_str).upper() == 'TBC':
        return None
    
    date_str = str(date_str).strip()
    
    # Handle ISO format (YYYY-MM-DD) - this is what Airtable API typically sends
    iso_match = re.search(r'^(\d{4})-(\d{2})-(\d{2})', date_str)
    if iso_match:
        return f"{iso_match.group(1)}-{iso_match.group(2)}-{iso_match.group(3)}"
    
    # Handle D/M/YYYY format (e.g., "2/3/2026" or "15/12/2025")
    dmy_match = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', date_str)
    if dmy_match:
        day, month, year = int(dmy_match.group(1)), int(dmy_match.group(2)), int(dmy_match.group(3))
        try:
            return datetime(year, month, day).strftime('%Y-%m-%d')
        except ValueError:
            return None
    
    return None


def format_date_friendly(iso_date):
    """
    Format ISO date (YYYY-MM-DD) as friendly "DD Mon" format.
    e.g., "2026-03-02" -> "02 Mar"
    """
    if not iso_date:
        return None
    
    try:
        date = datetime.strptime(iso_date, '%Y-%m-%d')
        return date.strftime('%d %b')  # "02 Mar"
    except ValueError:
        return iso_date  # Return as-is if parsing fails


def parse_friendly_date(friendly_str):
    """Parse friendly date formats into ISO format (YYYY-MM-DD) - LEGACY"""
    if not friendly_str or friendly_str.upper() == 'TBC':
        return None
    
    # Match "22 Jan" or "22 January" style
    match = re.search(r'(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)', friendly_str, re.IGNORECASE)
    if match:
        day = int(match.group(1))
        month_str = match.group(2).capitalize()
        months = {'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                  'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12}
        month = months.get(month_str)
        if month:
            year = datetime.now().year
            try:
                date = datetime(year, month, day)
                # If date is more than 6 months in the past, assume next year
                if (datetime.now() - date).days > 180:
                    date = datetime(year + 1, month, day)
                return date.strftime('%Y-%m-%d')
            except ValueError:
                return None
    
    # Try full date format "22 January 2026"
    try:
        date = datetime.strptime(friendly_str, '%d %B %Y')
        return date.strftime('%Y-%m-%d')
    except ValueError:
        pass
    
    return None


def parse_status_changed(status_str):
    """Parse Status Changed field into ISO date"""
    if not status_str:
        return None
    
    # ISO format with T
    if 'T' in status_str:
        try:
            return status_str.split('T')[0]
        except:
            pass
    
    # DD/MM/YYYY format
    match = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', status_str)
    if match:
        day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
        try:
            return datetime(year, month, day).strftime('%Y-%m-%d')
        except ValueError:
            return None
    
    return None


def extract_client_code(job_number):
    """Extract client code from job number: 'SKY 017' -> 'SKY'"""
    if not job_number:
        return None
    parts = job_number.split(' ')
    return parts[0] if parts else None


def transform_project(record):
    """
    Transform Airtable record to UNIVERSAL SCHEMA format.
    This matches what Traffic returns so Hub renders consistently.
    """
    fields = record.get('fields', {})
    job_number = fields.get('Job Number', '')
    
    # Parse update - get latest if pipe-separated
    update_summary = fields.get('Update Summary', '') or fields.get('Update', '')
    latest_update = update_summary
    if '|' in update_summary:
        parts = update_summary.split('|')
        latest_update = parts[-1].strip() if parts else update_summary
    
    # Parse dates - 'Update Due' is D/M/YYYY format from Airtable
    update_due = parse_airtable_date(fields.get('Update Due', ''))
    
    # Days Since Update - pre-calculated by Airtable formula
    days_since_update = fields.get('Days Since Update', '-')
    
    # Live In is now a dropdown (month name or "Tbc") - pass through as-is
    live_in = fields.get('Live', '')
    
    # Parse update history - field name is now 'Update History' (capital H)
    update_history_raw = fields.get('Update History', []) or fields.get('Update history', [])
    if isinstance(update_history_raw, str):
        update_history = [u.strip() for u in update_history_raw.split('\n') if u.strip()]
    elif isinstance(update_history_raw, list):
        update_history = update_history_raw
    else:
        update_history = []
    
    # === UNIVERSAL SCHEMA ===
    return {
        # Identity
        'jobNumber': job_number,
        'jobName': fields.get('Project Name', ''),
        'clientCode': extract_client_code(job_number),
        
        # Status
        'stage': fields.get('Stage', 'Triage'),
        'status': fields.get('Status', 'Incoming'),
        'withClient': bool(fields.get('With Client?', False)),
        
        # Dates
        'updateDue': update_due,
        'liveDate': live_in,  # Month name like "Jan", "Feb", "Tbc"
        'daysSinceUpdate': days_since_update,
        
        # Content
        'description': fields.get('Description', ''),
        'theStory': fields.get('The Story', ''),
        'update': latest_update,
        'updateHistory': update_history,
        'projectOwner': fields.get('Project Owner', ''),
        
        # Links
        'channelUrl': fields.get('Channel Url', ''),
        'filesUrl': fields.get('Files Url', ''),
    }


# ===== CLIENTS =====
@app.route('/api/clients')
def get_clients():
    """Get list of clients"""
    try:
        url = get_airtable_url('Clients')
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        
        clients = []
        for record in response.json().get('records', []):
            fields = record.get('fields', {})
            clients.append({
                'code': fields.get('Client code', ''),
                'name': fields.get('Clients', ''),
                'teamsId': fields.get('Teams ID', ''),
                'sharepointId': fields.get('Sharepoint ID', '')
            })
        
        clients.sort(key=lambda x: x['name'])
        return jsonify(clients)
    
    except Exception as e:
        print(f'[Hub API] Error fetching clients: {e}')
        return jsonify({'error': str(e)}), 500


# ===== PEOPLE =====
@app.route('/api/people/<client_code>')
def get_people_for_client(client_code):
    """Get contacts for a specific client"""
    try:
        url = get_airtable_url('People')
        
        # Handle One NZ divisions - search for ONE, ONB, or ONS
        if client_code in ['ONE', 'ONB', 'ONS']:
            filter_formula = "AND({Active} = TRUE(), OR({Client Link} = 'ONE', {Client Link} = 'ONB', {Client Link} = 'ONS'))"
        else:
            filter_formula = f"AND({{Active}} = TRUE(), {{Client Link}} = '{client_code}')"
        
        params = {'filterByFormula': filter_formula}
        all_people = []
        offset = None
        
        while True:
            if offset:
                params['offset'] = offset
            
            response = requests.get(url, headers=HEADERS, params=params)
            response.raise_for_status()
            data = response.json()
            
            for record in data.get('records', []):
                fields = record.get('fields', {})
                name = fields.get('Name', fields.get('Full name', ''))
                if name:
                    all_people.append({
                        'name': name,
                        'email': fields.get('Email Address', ''),
                        'clientCode': fields.get('Client Link', '')
                    })
            
            offset = data.get('offset')
            if not offset:
                break
        
        all_people.sort(key=lambda x: x['name'])
        return jsonify(all_people)
    
    except Exception as e:
        print(f'[Hub API] Error fetching people: {e}')
        return jsonify({'error': str(e)}), 500


# ===== NEW JOB =====
@app.route('/api/preview-job-number/<client_code>')
def preview_job_number(client_code):
    """Preview the next job number for a client (does NOT reserve it)"""
    try:
        url = get_airtable_url('Clients')
        params = {
            'filterByFormula': f"{{Client code}} = '{client_code}'",
            'maxRecords': 1
        }
        response = requests.get(url, headers=HEADERS, params=params)
        response.raise_for_status()
        
        records = response.json().get('records', [])
        if not records:
            return jsonify({'error': f'Client {client_code} not found'}), 404
        
        record = records[0]
        fields = record.get('fields', {})
        client_name = fields.get('Clients', client_code)
        
        # Next Job # is the formatted job number (e.g. "HUN 059")
        preview_job_num = fields.get('Next Job #', '')
        if not preview_job_num:
            return jsonify({'error': f'No job number sequence configured for {client_code}'}), 400
        
        print(f'[Hub API] Preview job number: {preview_job_num}')
        
        return jsonify({
            'success': True,
            'clientCode': client_code,
            'clientName': client_name,
            'previewJobNumber': preview_job_num
        })
    
    except Exception as e:
        print(f'[Hub API] Error previewing job number: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/new-job', methods=['POST'])
def create_new_job():
    """Create a new job in Airtable - reserves job number atomically, creates Tracker record"""
    try:
        data = request.json
        
        client_code = data.get('clientCode')
        job_name = data.get('jobName')
        description = data.get('description', '')
        owner = data.get('owner', '')
        update_due = data.get('updateDue', '')
        live = data.get('live', 'Tbc')
        status = data.get('status', 'Incoming')  # Incoming, In Progress, On Hold
        ballpark = data.get('ballpark', 5000)  # Default $5000
        setup_teams = data.get('setupTeams', False)
        
        if not client_code or not job_name:
            return jsonify({'error': 'Missing required fields'}), 400
        
        # Step 1: Get client record and reserve job number atomically
        client_url = get_airtable_url('Clients')
        client_response = requests.get(
            client_url,
            headers=HEADERS,
            params={'filterByFormula': f"{{Client code}} = '{client_code}'", 'maxRecords': 1}
        )
        client_response.raise_for_status()
        client_records = client_response.json().get('records', [])
        
        if not client_records:
            return jsonify({'error': f'Client {client_code} not found'}), 404
        
        client_record = client_records[0]
        client_record_id = client_record.get('id')
        client_fields = client_record.get('fields', {})
        
        # Get Team ID for setup worker
        team_id = client_fields.get('Teams ID', '')
        
        # Read the formatted job number directly
        job_number = client_fields.get('Next Job #', '')
        if not job_number:
            return jsonify({'error': f'No job number sequence configured for {client_code}'}), 400
        
        # Get raw number to increment
        next_num = client_fields.get('Next #', 0)
        try:
            next_num = int(next_num)
        except (ValueError, TypeError):
            return jsonify({'error': f'Invalid Next # value for {client_code}'}), 400
        
        # Step 2: Increment the client's Next # 
        update_response = requests.patch(
            f"{client_url}/{client_record_id}",
            headers=HEADERS,
            json={'fields': {'Next #': next_num + 1}}
        )
        update_response.raise_for_status()
        
        print(f'[Hub API] Reserved job number: {job_number}')
        
        # Step 3: Create the project record
        fields = {
            'Job Number': job_number,
            'Project Name': job_name,
            'Status': status,
            'Stage': 'Triage',
            'With Client?': False
        }
        
        # Add optional fields if provided
        if description:
            fields['Description'] = description
        if owner:
            fields['Project Owner'] = owner
        if update_due:
            fields['Update Due'] = update_due
        if live and live != 'Tbc':
            fields['Live'] = live
        
        url = get_airtable_url('Projects')
        print(f'[Hub API] Creating project with fields: {fields}')
        response = requests.post(
            url,
            headers=HEADERS,
            json={'fields': fields}
        )
        
        print(f'[Hub API] Airtable response: {response.status_code} - {response.text}')
        
        response.raise_for_status()
        
        created_record = response.json()
        project_record_id = created_record.get('id')
        print(f'[Hub API] Created new job: {job_number} - {job_name}')
        
        # Step 4: Create Tracker record with ballpark
        current_month = datetime.now().strftime('%B')  # e.g. "January"
        
        tracker_url = get_airtable_url('Tracker')
        tracker_fields = {
            'Link': [project_record_id],  # Link to the Project record
            'Spend': ballpark,
            'Ballpark': True,
            'Month': current_month,
            'Spend type': 'Project budget'
        }
        
        tracker_response = requests.post(
            tracker_url,
            headers=HEADERS,
            json={'fields': tracker_fields}
        )
        tracker_response.raise_for_status()
        print(f'[Hub API] Created Tracker record for {job_number} with ballpark ${ballpark}')
        
        return jsonify({
            'success': True,
            'jobNumber': job_number,
            'jobName': job_name,
            'recordId': project_record_id,
            'status': status,
            'setupTeams': setup_teams,
            'teamId': team_id
        })
    
    except Exception as e:
        print(f'[Hub API] Error creating job: {e}')
        return jsonify({'error': str(e)}), 500


# ===== JOBS =====
@app.route('/api/jobs/all')
def get_all_jobs():
    """
    Get jobs in universal schema format.
    
    Query params:
        status: 'active' (default), 'completed', 'all'
        client: filter by client code (e.g., 'SKY', 'TOW')
    """
    try:
        url = get_airtable_url('Projects')
        
        # Parse query params
        status_filter = request.args.get('status', 'active')
        client_filter = request.args.get('client')
        
        # Build status filter
        if status_filter == 'active':
            statuses = ['Incoming', 'In Progress', 'On Hold']
        elif status_filter == 'completed':
            statuses = ['Completed']
        elif status_filter == 'all':
            statuses = ['Incoming', 'In Progress', 'On Hold', 'Completed', 'Archived']
        else:
            statuses = ['Incoming', 'In Progress', 'On Hold']
        
        formula_parts = [f"{{Status}} = '{s}'" for s in statuses]
        filter_formula = f"OR({', '.join(formula_parts)})"
        
        # Add client filter if provided
        if client_filter:
            filter_formula = f"AND({filter_formula}, FIND('{client_filter}', {{Job Number}})=1)"
        
        params = {'filterByFormula': filter_formula}
        
        all_jobs = []
        offset = None
        
        while True:
            if offset:
                params['offset'] = offset
            
            response = requests.get(url, headers=HEADERS, params=params)
            response.raise_for_status()
            data = response.json()
            
            for record in data.get('records', []):
                all_jobs.append(transform_project(record))
            
            offset = data.get('offset')
            if not offset:
                break
        
        return jsonify(all_jobs)
    
    except Exception as e:
        print(f'[Hub API] Error fetching jobs: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/job/<job_number>')
def get_job(job_number):
    """Get a single job by job number"""
    try:
        url = get_airtable_url('Projects')
        params = {
            'filterByFormula': f"{{Job Number}} = '{job_number}'",
            'maxRecords': 1
        }
        
        response = requests.get(url, headers=HEADERS, params=params)
        response.raise_for_status()
        
        records = response.json().get('records', [])
        if not records:
            return jsonify({'error': 'Job not found'}), 404
        
        return jsonify(transform_project(records[0]))
    
    except Exception as e:
        print(f'[Hub API] Error fetching job: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/job/<job_number>/update', methods=['POST'])
def update_job(job_number):
    """
    Update a job's fields and optionally create an Updates record.
    
    This is the unified update endpoint - replaces Traffic's /card-update.
    
    1. Updates Projects table (stage, status, dates, etc.)
    2. Creates Updates record (if message provided)
    """
    try:
        data = request.get_json()
        
        # Find the record
        url = get_airtable_url('Projects')
        params = {
            'filterByFormula': f"{{Job Number}} = '{job_number}'",
            'maxRecords': 1
        }
        response = requests.get(url, headers=HEADERS, params=params)
        response.raise_for_status()
        
        records = response.json().get('records', [])
        if not records:
            return jsonify({'error': 'Job not found'}), 404
        
        record = records[0]
        record_id = record.get('id')
        
        # Extract message for Updates table (separate from Projects fields)
        message = data.get('message', '').strip()
        update_due = data.get('updateDue')
        
        # Map frontend field names to Airtable field names
        field_mapping = {
            'stage': 'Stage',
            'status': 'Status',
            'updateDue': 'Update Due',
            'liveDate': 'Live',  # Month dropdown: "Jan", "Feb", "Tbc"
            'withClient': 'With Client?',
            'description': 'Description',
            'projectOwner': 'Project Owner',
            'projectName': 'Project Name'
        }
        
        airtable_fields = {}
        for key, value in data.items():
            if key in field_mapping:
                airtable_key = field_mapping[key]
                if key in ['updateDue', 'liveDate'] and value:
                    airtable_fields[airtable_key] = value
                elif key == 'withClient':
                    airtable_fields[airtable_key] = bool(value)
                else:
                    airtable_fields[airtable_key] = value
        
        # Also patch the Update field on Project so WIP cards stay current
        if message:
            airtable_fields['Update'] = message
        
        results = {
            'project_update': None,
            'update_record': None
        }
        
        # 1. Update Projects table
        if airtable_fields:
            update_response = requests.patch(
                f"{url}/{record_id}",
                headers=HEADERS,
                json={'fields': airtable_fields}
            )
            update_response.raise_for_status()
            results['project_update'] = {'success': True, 'updated': list(airtable_fields.keys())}
            print(f'[Hub API] Updated project {job_number}: {list(airtable_fields.keys())}')
        
        # 2. Create Updates record (if message provided)
        if message:
            updates_url = get_airtable_url('Updates')
            
            update_fields = {
                'Update': message,
                'Project Link': [record_id]  # Linked record field
            }
            
            if update_due:
                update_fields['Update Due'] = update_due
            
            updates_response = requests.post(
                updates_url,
                headers=HEADERS,
                json={'fields': update_fields}
            )
            updates_response.raise_for_status()
            
            new_record = updates_response.json()
            results['update_record'] = {'success': True, 'record_id': new_record.get('id')}
            print(f'[Hub API] Created update record for {job_number}: {new_record.get("id")}')
        
        return jsonify({'success': True, 'results': results})
    
    except Exception as e:
        print(f'[Hub API] Error updating job: {e}')
        return jsonify({'error': str(e)}), 500


# ===== TRACKER =====
@app.route('/api/tracker/clients')
def get_tracker_clients():
    """Get clients with tracker/budget info"""
    try:
        url = get_airtable_url('Clients')
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        
        def parse_currency(val):
            if isinstance(val, (int, float)):
                return val
            if isinstance(val, str):
                return int(val.replace('$', '').replace(',', '') or 0)
            return 0
        
        clients = []
        for record in response.json().get('records', []):
            fields = record.get('fields', {})
            
            monthly = parse_currency(fields.get('Monthly Committed', 0))
            if monthly > 0:
                # Rollover is now a formula field in Clients - number or 0
                rollover = fields.get('Rollover', 0)
                if isinstance(rollover, (int, float)):
                    rollover = max(0, rollover)  # Ensure non-negative
                else:
                    rollover = 0
                
                clients.append({
                    'code': fields.get('Client code', ''),
                    'name': fields.get('Clients', ''),
                    'committed': monthly,
                    'rollover': rollover,
                    'rolloverUseIn': 'JAN-MAR' if rollover > 0 else '',  # Current quarter
                    'yearEnd': fields.get('Year end', ''),
                    'currentQuarter': fields.get('Current Quarter', '')
                })
        
        clients.sort(key=lambda x: x['name'])
        return jsonify(clients)
    
    except Exception as e:
        print(f'[Hub API] Error fetching tracker clients: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/tracker/data')
def get_tracker_data():
    """Get tracker spend data for a client"""
    client_code = request.args.get('client')
    if not client_code:
        return jsonify({'error': 'Client code required'}), 400
    
    try:
        url = get_airtable_url('Tracker')
        params = {'filterByFormula': f"{{Client Code}} = '{client_code}'"}
        
        all_records = []
        offset = None
        
        while True:
            if offset:
                params['offset'] = offset
            
            response = requests.get(url, headers=HEADERS, params=params)
            response.raise_for_status()
            data = response.json()
            
            for record in data.get('records', []):
                fields = record.get('fields', {})
                
                # Handle lookup fields that may return as lists
                job_number = fields.get('Job Number', '')
                if isinstance(job_number, list):
                    job_number = job_number[0] if job_number else ''
                
                project_name = fields.get('Project Name', '')
                if isinstance(project_name, list):
                    project_name = project_name[0] if project_name else ''
                
                owner = fields.get('Owner', '')
                if isinstance(owner, list):
                    owner = owner[0] if owner else ''
                
                spend = fields.get('Spend', 0)
                if isinstance(spend, str):
                    spend = float(spend.replace('$', '').replace(',', '') or 0)
                
                # Skip zero spend records
                if spend == 0:
                    continue
                
                all_records.append({
                    'id': record.get('id'),
                    'client': client_code,
                    'jobNumber': job_number,
                    'projectName': project_name,
                    'owner': owner,
                    'description': fields.get('Tracker notes', ''),
                    'spend': spend,
                    'month': fields.get('Month', ''),
                    'spendType': fields.get('Spend type', 'Project budget'),
                    'ballpark': bool(fields.get('Ballpark', False)),
                })
            
            offset = data.get('offset')
            if not offset:
                break
        
        return jsonify(all_records)
    
    except Exception as e:
        print(f'[Hub API] Error fetching tracker data: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/tracker/update', methods=['POST'])
def update_tracker():
    """Update a tracker record"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        record_id = data.get('id')
        if not record_id:
            return jsonify({'error': 'Record ID required'}), 400
        
        field_mapping = {
            'description': 'Tracker notes',
            'spend': 'Spend',
            'month': 'Month',
            'spendType': 'Spend type',
            'ballpark': 'Ballpark'
        }
        
        airtable_fields = {}
        for key, value in data.items():
            if key in field_mapping:
                airtable_fields[field_mapping[key]] = value
        
        if not airtable_fields:
            return jsonify({'error': 'No valid fields to update'}), 400
        
        url = get_airtable_url('Tracker')
        response = requests.patch(
            f"{url}/{record_id}",
            headers=HEADERS,
            json={'fields': airtable_fields}
        )
        response.raise_for_status()
        
        return jsonify({'success': True})
    
    except Exception as e:
        print(f'[Hub API] Error updating tracker: {e}')
        return jsonify({'error': str(e)}), 500


# ===== STATIC FILES CATCH-ALL (must be last) =====
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)


# ===== RUN =====
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
