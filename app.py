"""
Dot Hub
Flask server serving static frontend + API routes for Airtable data.
Ask Dot brain lives in Traffic - this is just data.
"""

# load_dotenv() — local only, Railway uses env vars directly

from flask import Flask, jsonify, request, send_from_directory, make_response, redirect
from flask_cors import CORS
import requests
import os
from datetime import datetime, date
import re
import hashlib  # NEW: For auth tokens
import time     # NEW: For auth tokens
import base64   # NEW: For auth tokens
import hmac      # PIN: constant-time compare
import threading # PIN: rate-limit lock

import tracker  # Tracker math (quarter, rollover, chart months)

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# ===== CONFIGURATION =====
AIRTABLE_API_KEY = os.environ.get('AIRTABLE_API_KEY')
AIRTABLE_BASE_ID = os.environ.get('AIRTABLE_BASE_ID', 'app8CI7NAZqhQ4G1Y')
WORKERS_URL = os.environ.get('WORKERS_URL', 'https://dot-workers.up.railway.app')

HEADERS = {
    'Authorization': f'Bearer {AIRTABLE_API_KEY}',
    'Content-Type': 'application/json'
}

def get_airtable_url(table):
    return f'https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{table}'


def parse_year_end_month(value):
    """Parse Airtable Year end field — accepts ISO date string or month name.

    Returns a month name (e.g. 'March') or None if unparseable.
    Defensive because schema says Date but data may be stored either way.
    """
    if not value or not isinstance(value, str):
        return None
    # ISO date like "2024-03-31"
    try:
        d = date.fromisoformat(value)
        return tracker.MONTH_NAME[d.month]
    except (ValueError, KeyError):
        pass
    # Already a month name
    if value in tracker.MONTH_NUM:
        return value
    return None


# ===== AUTH CONFIGURATION (NEW) =====
POSTMAN_URL = os.environ.get('PA_POSTMAN_URL', '')
TOKEN_SECRET = os.environ.get('TOKEN_SECRET', 'dot-hub-secret-change-me')
HUB_URL = os.environ.get('HUB_URL', 'https://dot.hunch.co.nz')
TOKEN_EXPIRY_DAYS = 7

# Long-lived session cookie for the trusted device (Full access only).
# Magic-link tokens stay at TOKEN_EXPIRY_DAYS — this only affects the session
# cookie set after a successful login, so a leaked email link never lasts longer.
SESSION_EXPIRY_DAYS = 180

# PIN login (mobile "tap and go" fallback). You-only: the keypad checks against
# this owner's People.Pin and nothing else.
PIN_OWNER_EMAIL = os.environ.get('PIN_OWNER_EMAIL', 'michael@hunch.co.nz')

# Brute-force guard for /api/verify-pin. In-memory, per-IP. Resets on redeploy
# and is per-instance (fine for a single Railway dyno).
PIN_MAX_FAILS = 5
PIN_LOCKOUT_SECONDS = 5 * 60
_pin_attempts = {}          # ip -> {'fails': int, 'locked_until': float}
_pin_attempts_lock = threading.Lock()


# ===== AUTH FUNCTIONS (NEW) =====

def generate_token(email, client_code, first_name, access_level='Client WIP', expiry_days=TOKEN_EXPIRY_DAYS):
    """Generate a signed token containing user info + expiry."""
    expires = int(time.time()) + (expiry_days * 24 * 60 * 60)
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


def lookup_person_with_pin(email):
    """Look up a person including their PIN. Returns dict (with 'pin' as a
    string, or None if unset) or None if not found. Used only by the PIN login."""
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

        fields = data['records'][0].get('fields', {})
        pin_val = fields.get('Pin')
        client_code = fields.get('clientCode', ['UNKNOWN'])
        if isinstance(client_code, list):
            client_code = client_code[0] if client_code else 'UNKNOWN'

        return {
            'email': fields.get('Email Address', email),
            'first_name': fields.get('First Name', 'there'),
            'client_code': client_code,
            'access_level': fields.get('Access', 'Client WIP'),
            'pin': str(pin_val).strip() if pin_val is not None else None
        }

    except Exception as e:
        print(f"[Auth] PIN lookup error: {e}")
        return None


def update_last_login(email):
    """Placeholder - lastLogin field not in Airtable schema."""
    print(f"[Auth] Login: {email}")


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
    
    token = request.args.get('token', '')
    
    if not token:
        return redirect(f"/?error=invalid")
    
    user, error = verify_token(token)
    
    if error == 'expired':
        return redirect(f"/?error=expired")
    
    if error or not user:
        return redirect(f"/?error=invalid")
    
    # Success! Set cookie and redirect to Hub with welcome flag
    response = make_response(redirect('/?welcome=1'))

    # Full-access (Hunch team) gets a long-lived session so the trusted device
    # stays logged in. Clients keep the standard window. The magic link itself
    # is unaffected — it was already verified above.
    session_days = SESSION_EXPIRY_DAYS if user['access_level'] == 'Full' else TOKEN_EXPIRY_DAYS

    # Create a session token (signed, same approach)
    session_token = generate_token(
        email=user['email'],
        client_code=user['client_code'],
        first_name=user['first_name'],
        access_level=user['access_level'],
        expiry_days=session_days
    )

    response.set_cookie(
        'dot_session',
        session_token,
        max_age=session_days * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite='Lax'
    )
    
    # Log the login
    update_last_login(user['email'])
    
    return response


@app.route('/job/<job_number>')
def handle_job_link(job_number):
    """Deep link to job - opens job bag directly."""
    return redirect(f"/?job={job_number}")


@app.route('/dev-login')
def dev_login():
    """Local dev only — instant login as Michael, no magic link needed."""
    session_token = generate_token(
        email='michael@hunch.co.nz',
        client_code='ALL',
        first_name='Michael',
        access_level='Full'
    )
    response = make_response(redirect('/'))
    response.set_cookie(
        'dot_session',
        session_token,
        max_age=TOKEN_EXPIRY_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=False,
        samesite='Lax'
    )
    return response


@app.route('/demo')
def demo_login():
    """Demo login — instant access as Demo Inc for platform demos."""
    session_token = generate_token(
        email='demo@hunch.co.nz',
        client_code='DEM',
        first_name='Demo',
        access_level='Client Tracker'
    )
    response = make_response(redirect('/'))
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


@app.route('/api/verify-pin', methods=['POST'])
def handle_verify_pin():
    """Mobile PIN login (you-only). Expects: { "pin": "1234" }.

    Checks the entered PIN against the owner's People.Pin and, on match, sets
    the same long-lived dot_session cookie a magic-link login would. Rate-limited
    per IP to blunt brute-forcing of a 4-digit space.
    """
    # Identify caller (Railway sits behind a proxy — first X-Forwarded-For hop)
    fwd = request.headers.get('X-Forwarded-For', '')
    ip = fwd.split(',')[0].strip() if fwd else (request.remote_addr or 'unknown')
    now = time.time()

    # Rate-limit gate
    with _pin_attempts_lock:
        rec = _pin_attempts.get(ip)
        if rec and rec.get('locked_until', 0) > now:
            retry = int(rec['locked_until'] - now)
            return jsonify({
                'success': False,
                'error': 'locked',
                'message': f"Too many tries. Try again in {retry // 60 + 1} min.",
                'retryAfter': retry
            }), 429

    data = request.get_json() or {}
    pin = str(data.get('pin', '')).strip()

    if not pin.isdigit() or not (4 <= len(pin) <= 10):
        return jsonify({'success': False, 'error': 'invalid',
                        'message': 'Enter your PIN'}), 400

    owner = lookup_person_with_pin(PIN_OWNER_EMAIL)
    real_pin = owner['pin'] if owner else None

    # Constant-time compare; treat a missing/blank stored PIN as never-match
    matched = bool(real_pin) and hmac.compare_digest(pin, real_pin)

    if not matched:
        with _pin_attempts_lock:
            rec = _pin_attempts.get(ip, {'fails': 0, 'locked_until': 0})
            rec['fails'] += 1
            if rec['fails'] >= PIN_MAX_FAILS:
                rec['locked_until'] = now + PIN_LOCKOUT_SECONDS
                rec['fails'] = 0
            _pin_attempts[ip] = rec
        return jsonify({'success': False, 'error': 'wrong',
                        'message': "That's not it"}), 401

    # Success — clear attempts, mint the long session
    with _pin_attempts_lock:
        _pin_attempts.pop(ip, None)

    session_days = SESSION_EXPIRY_DAYS if owner['access_level'] == 'Full' else TOKEN_EXPIRY_DAYS
    session_token = generate_token(
        email=owner['email'],
        client_code=owner['client_code'],
        first_name=owner['first_name'],
        access_level=owner['access_level'],
        expiry_days=session_days
    )

    response = make_response(jsonify({
        'success': True,
        'user': {
            'firstName': owner['first_name'],
            'accessLevel': owner['access_level']
        }
    }))
    response.set_cookie(
        'dot_session',
        session_token,
        max_age=session_days * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite='Lax'
    )
    update_last_login(owner['email'])
    return response


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
                        'firstName': fields.get('First Name', name.split()[0] if name else ''),
                        'email': fields.get('Email Address', ''),
                        'accessLevel': fields.get('Access', 'Client WIP'),
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


@app.route('/api/people', methods=['POST'])
def create_person():
    """Create a new Person — a team member (Access=Full) or a client contact."""
    try:
        data = request.get_json() or {}
        first = (data.get('firstName') or '').strip()
        last = (data.get('lastName') or '').strip()
        email = (data.get('email') or '').strip()
        access = (data.get('access') or 'Full').strip()
        client_code = (data.get('clientCode') or '').strip()

        if not first and not last:
            return jsonify({'error': 'Name required'}), 400
        if not email:
            return jsonify({'error': 'Email required'}), 400

        name = f'{first} {last}'.strip()
        url = get_airtable_url('People')

        # Guard against a duplicate email
        existing = requests.get(url, headers=HEADERS, params={
            'filterByFormula': f"LOWER({{Email Address}}) = '{email.lower()}'",
            'maxRecords': 1,
        })
        if existing.ok and existing.json().get('records'):
            return jsonify({'error': 'A person with that email already exists'}), 409

        # NOTE: 'Name' is a computed (formula) field in People — Airtable derives
        # it from First/Last. Writing it causes a 422, so we don't.
        fields = {
            'First Name': first,
            'Last Name': last,
            'Email Address': email,
            'Access': access,
            'Active': True,
        }

        # Client Link only applies to client-access people, and only if a client is chosen
        if access != 'Full' and client_code:
            cl = requests.get(get_airtable_url('Clients'), headers=HEADERS, params={
                'filterByFormula': f"{{Client code}} = '{client_code}'",
                'maxRecords': 1,
            })
            if cl.ok and cl.json().get('records'):
                fields['Client Link'] = [cl.json()['records'][0]['id']]

        resp = requests.post(url, headers=HEADERS, json={'fields': fields})
        if not resp.ok:
            print(f'[Hub API] Airtable rejected person create ({resp.status_code}): {resp.text}')
            return jsonify({'error': 'Airtable rejected the create'}), 502

        print(f'[Hub API] Created person: {name} ({access})')
        return jsonify({'success': True, 'name': name, 'access': access})

    except Exception as e:
        print(f'[Hub API] Error creating person: {e}')
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
        cost = data.get('cost', data.get('ballpark', 5000))  # $ amount; back-compat with old 'ballpark' key
        is_ballpark = bool(data.get('isBallpark', True))  # default True keeps Hub modal unchanged; skill sends False
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

        # Per-step receipt — the job survives a sub-step failure; each step reports its own outcome.
        steps = {'project': 'created', 'tracker': 'pending', 'todo': 'pending', 'folder': 'pending'}
        files_url = None

        # Step 4: Tracker record (best-effort)
        current_month = datetime.now().strftime('%B')  # e.g. "January"
        try:
            tracker_fields = {
                'Link': [project_record_id],
                'Spend': cost,
                'Ballpark': is_ballpark,
                'Month': current_month,
                'Spend type': 'Project budget'
            }
            tr = requests.post(get_airtable_url('Tracker'), headers=HEADERS, json={'fields': tracker_fields})
            tr.raise_for_status()
            steps['tracker'] = 'created'
            print(f"[Hub API] Tracker for {job_number}: ${cost} (ballpark={is_ballpark})")
        except Exception as e:
            steps['tracker'] = f'failed: {e}'
            print(f'[Hub API] Tracker failed for {job_number}: {e}')

        # Step 5: Todo for the job (best-effort)
        try:
            todo_fields = {
                'Title': f'{job_number} {job_name}',
                'Bucket': 'CLIENTS',
                'Done': False,
            }
            cid = _resolve_client_record_id(client_code)
            if cid:
                todo_fields['Client'] = [cid]
            td = requests.post(get_airtable_url('Todo'), headers=HEADERS, json={'fields': todo_fields})
            td.raise_for_status()
            steps['todo'] = 'created'
            print(f'[Hub API] Todo created for {job_number}')
        except Exception as e:
            steps['todo'] = f'failed: {e}'
            print(f'[Hub API] Todo failed for {job_number}: {e}')

        # Step 6: Dropbox folder via workers (best-effort), then write Files Url
        try:
            fr = requests.post(
                f'{WORKERS_URL}/folder',
                json={'clientCode': client_code, 'jobNumber': job_number, 'jobName': job_name},
                timeout=30
            )
            fr_data = fr.json() if fr.content else {}
            if fr.ok and fr_data.get('success'):
                files_url = fr_data.get('dropboxUrl')
                steps['folder'] = 'created'
                if files_url:
                    try:
                        requests.patch(
                            f"{get_airtable_url('Projects')}/{project_record_id}",
                            headers=HEADERS,
                            json={'fields': {'Files Url': files_url}}
                        )
                    except Exception as e:
                        print(f'[Hub API] Files Url patch failed for {job_number}: {e}')
                print(f'[Hub API] Folder created for {job_number}: {files_url}')
            else:
                steps['folder'] = f"failed: {fr_data.get('error', 'unknown')}"
                print(f"[Hub API] Folder failed for {job_number}: {fr_data.get('error')}")
        except Exception as e:
            steps['folder'] = f'failed: {e}'
            print(f'[Hub API] Folder call failed for {job_number}: {e}')

        return jsonify({
            'success': True,
            'jobNumber': job_number,
            'jobName': job_name,
            'recordId': project_record_id,
            'status': status,
            'cost': cost,
            'isBallpark': is_ballpark,
            'filesUrl': files_url,
            'setupTeams': setup_teams,
            'teamId': team_id,
            'steps': steps
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
        
        job = transform_project(records[0])
        
        # Fetch full client name from Clients table
        client_links = records[0].get('fields', {}).get('Client', [])
        if client_links:
            client_record_id = client_links[0]
            try:
                client_url = f"{get_airtable_url('Clients')}/{client_record_id}"
                client_response = requests.get(client_url, headers=HEADERS)
                if client_response.ok:
                    client_fields = client_response.json().get('fields', {})
                    job['clientName'] = client_fields.get('Clients', job['clientCode'])
            except Exception:
                job['clientName'] = job['clientCode']
        else:
            job['clientName'] = job['clientCode']
        
        return jsonify(job)
    
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
        author = data.get('author', 'Dot').strip() or 'Dot'
        
        # Map frontend field names to Airtable field names
        field_mapping = {
            'stage': 'Stage',
            'status': 'Status',
            'updateDue': 'Update Due',
            'liveDate': 'Live',  # Month dropdown: "Jan", "Feb", "Tbc"
            'withClient': 'With Client?',
            'description': 'Description',
            'projectOwner': 'Project Owner',
            'projectName': 'Project Name',
            'newJobNumber': 'Job Number'
        }
        
        airtable_fields = {}
        for key, value in data.items():
            if key in field_mapping:
                airtable_key = field_mapping[key]
                if key in ['updateDue', 'liveDate']:
                    # Empty string or null clears the field in Airtable
                    airtable_fields[airtable_key] = value if value else None
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
                'Author': author,
                'Project Link': [record_id]
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


@app.route('/api/job/<job_number>/story', methods=['PATCH'])
def update_job_story(job_number):
    """Update The Story field on a Project record"""
    try:
        data = request.get_json()
        story = data.get('story', '').strip()

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

        record_id = records[0].get('id')

        patch_response = requests.patch(
            f"{url}/{record_id}",
            headers=HEADERS,
            json={'fields': {'The Story': story}}
        )
        patch_response.raise_for_status()

        return jsonify({'success': True, 'story': story})

    except Exception as e:
        print(f'[Hub API] Error updating story for {job_number}: {e}')
        return jsonify({'error': str(e)}), 500


# ===== TRACKER =====
@app.route('/api/tracker/clients')
def get_tracker_clients():
    """Get clients with tracker/budget info, including rollover and chart data.

    Phase 2: returns `rolloverObject` and `chartMonths` additively.
    Existing fields (rollover, rolloverUseIn, committed, yearEnd, currentQuarter)
    are preserved unchanged so the frontend's old display path still works.
    """
    def parse_currency(val):
        if isinstance(val, (int, float)):
            return val
        if isinstance(val, str):
            return int(val.replace('$', '').replace(',', '') or 0)
        return 0

    try:
        # ===== Fetch Clients =====
        clients_url = get_airtable_url('Clients')
        clients_response = requests.get(clients_url, headers=HEADERS)
        clients_response.raise_for_status()
        clients_records = clients_response.json().get('records', [])

        # ===== Fetch Budget History =====
        # Defensive: if table is missing or fetch fails, fall through to
        # Clients.Monthly Committed for everything.
        budget_history = []
        try:
            bh_url = get_airtable_url('Budget History')
            bh_response = requests.get(bh_url, headers=HEADERS)
            bh_response.raise_for_status()
            for record in bh_response.json().get('records', []):
                fields = record.get('fields', {})
                budget_history.append({
                    'Client': fields.get('Client', ''),
                    'Effective From': fields.get('Effective From', ''),
                    'Monthly Committed': parse_currency(fields.get('Monthly Committed', 0)),
                })
        except Exception as e:
            print(f'[Hub API] Budget History fetch failed (falling back to Clients): {e}')

        # ===== Fetch all Tracker entries (paginated) =====
        # Used for in-quarter variance computation across all retainer clients.
        tracker_entries = []
        try:
            tracker_url = get_airtable_url('Tracker')
            offset = None
            while True:
                params = {}
                if offset:
                    params['offset'] = offset
                tr_response = requests.get(tracker_url, headers=HEADERS, params=params)
                tr_response.raise_for_status()
                data = tr_response.json()
                for record in data.get('records', []):
                    fields = record.get('fields', {})
                    client_code = fields.get('Client Code', '')
                    if isinstance(client_code, list):
                        client_code = client_code[0] if client_code else ''
                    spend = fields.get('Spend', 0)
                    if isinstance(spend, str):
                        spend = float(spend.replace('$', '').replace(',', '') or 0)
                    tracker_entries.append({
                        'client': client_code,
                        'month': fields.get('Month', ''),
                        'spendType': fields.get('Spend type', 'Project budget'),
                        'ballpark': bool(fields.get('Ballpark', False)),
                        'spend': spend,
                    })
                offset = data.get('offset')
                if not offset:
                    break
        except Exception as e:
            print(f'[Hub API] Tracker fetch failed (rollover/chart will be empty): {e}')

        # ===== Build clients_fallback dict =====
        # Used by tracker.get_committed when no Budget History entry applies.
        clients_fallback = {}
        for record in clients_records:
            fields = record.get('fields', {})
            code = fields.get('Client code', '')
            committed = parse_currency(fields.get('Monthly Committed', 0))
            if code:
                clients_fallback[code] = committed

        # ===== Build response =====
        today = date.today()
        clients = []
        for record in clients_records:
            fields = record.get('fields', {})

            monthly = parse_currency(fields.get('Monthly Committed', 0))
            if monthly <= 0:
                continue  # skip non-retainer clients

            code = fields.get('Client code', '')
            year_end_raw = fields.get('Year end', '')
            year_end_month = parse_year_end_month(year_end_raw)

            # Existing fields preserved as-is
            rollover = fields.get('Rollover', 0)
            if isinstance(rollover, (int, float)):
                rollover = max(0, rollover)
            else:
                rollover = 0

            client_data = {
                'code': code,
                'name': fields.get('Clients', ''),
                'committed': monthly,
                'rollover': rollover,
                'rolloverUseIn': fields.get('rolloverUseIn', '') if rollover > 0 else '',
                'yearEnd': year_end_raw,
                'currentQuarter': fields.get('Current Quarter', ''),
            }

            # New fields — additive. If tracker.py errors for any reason,
            # the client gets the existing fields and frontend uses fallback.
            if year_end_month and code:
                try:
                    client_data['rolloverObject'] = tracker.get_rollover(
                        code, today, year_end_month,
                        budget_history, clients_fallback, tracker_entries,
                    )
                    client_data['chartMonths'] = tracker.get_chart_months(
                        year_end_month, today, code,
                        budget_history, clients_fallback,
                    )
                    client_data['committedByMonth'] = tracker.get_committed_by_month(
                        code, today, budget_history, clients_fallback,
                    )

                    # rolloverByQuarter: keyed by JAN-MAR style quarter key.
                    # Includes current quarter (live) + 3 historic (is_closed=True).
                    # Frontend looks up the quarter being viewed and renders
                    # appropriate template based on the isClosed flag.
                    rollover_by_quarter = {}
                    current_obj = client_data['rolloverObject']
                    if current_obj.get('quarterKey'):
                        rollover_by_quarter[current_obj['quarterKey']] = current_obj
                    for historic_today in tracker.get_historic_quarter_dates(
                        year_end_month, today, n_quarters=3,
                    ):
                        historic_obj = tracker.get_rollover(
                            code, historic_today, year_end_month,
                            budget_history, clients_fallback, tracker_entries,
                            is_closed=True,
                        )
                        if historic_obj.get('quarterKey'):
                            rollover_by_quarter[historic_obj['quarterKey']] = historic_obj
                    client_data['rolloverByQuarter'] = rollover_by_quarter
                except Exception as e:
                    print(f'[Hub API] tracker.py error for {code}: {e}')

            clients.append(client_data)

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
                    'jobDescription': '',  # filled below from Projects.Description
                    'spend': spend,
                    'month': fields.get('Month', ''),
                    'spendType': fields.get('Spend type', 'Project budget'),
                    'ballpark': bool(fields.get('Ballpark', False)),
                })
            
            offset = data.get('offset')
            if not offset:
                break
        
        # ===== Attach job-level Description (for grouped quarter-view parent rows) =====
        # Each Tracker row carries its own per-month 'Tracker notes' (-> description),
        # which the quarter view collapses by job. Picking one month's note as the
        # parent line is misleading, so the parent uses the job's canonical
        # Projects.Description instead. Blank stays blank (prompts a backfill).
        job_numbers = sorted({r['jobNumber'] for r in all_records if r.get('jobNumber')})
        if job_numbers:
            desc_by_job = {}
            projects_url = get_airtable_url('Projects')
            # Chunk the OR() filter so a job-heavy client never blows the
            # Airtable formula-length ceiling.
            for i in range(0, len(job_numbers), 40):
                chunk = job_numbers[i:i + 40]
                clauses = ','.join(f"{{Job Number}} = '{jn}'" for jn in chunk)
                formula = f'OR({clauses})' if len(chunk) > 1 else clauses
                proj_resp = requests.get(
                    projects_url,
                    headers=HEADERS,
                    params={'filterByFormula': formula,
                            'fields[]': ['Job Number', 'Description']},
                )
                proj_resp.raise_for_status()
                for prec in proj_resp.json().get('records', []):
                    pf = prec.get('fields', {})
                    jn = pf.get('Job Number', '')
                    if jn:
                        desc_by_job[jn] = pf.get('Description', '')
            for r in all_records:
                r['jobDescription'] = desc_by_job.get(r['jobNumber'], '')
        
        return jsonify(all_records)
    
    except Exception as e:
        print(f'[Hub API] Error fetching tracker data: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/tracker/update', methods=['POST'])
def update_tracker():
    """Update a tracker record, and optionally Stage on the linked Project"""
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

        # If stage provided, also patch the Projects record
        stage = data.get('stage')
        job_number = data.get('jobNumber')
        if stage and job_number:
            projects_url = get_airtable_url('Projects')
            params = {
                'filterByFormula': f"{{Job Number}} = '{job_number}'",
                'maxRecords': 1
            }
            proj_response = requests.get(projects_url, headers=HEADERS, params=params)
            proj_response.raise_for_status()
            records = proj_response.json().get('records', [])
            if records:
                proj_id = records[0].get('id')
                requests.patch(
                    f"{projects_url}/{proj_id}",
                    headers=HEADERS,
                    json={'fields': {'Stage': stage}}
                )
                print(f'[Hub API] Updated Stage to {stage} for {job_number}')

        return jsonify({'success': True})

    except Exception as e:
        print(f'[Hub API] Error updating tracker: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/tracker/create', methods=['POST'])
def create_tracker():
    """Create a new tracker record linked to a Project"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No data provided'}), 400

        job_number = data.get('jobNumber')
        if not job_number:
            return jsonify({'error': 'Job number required'}), 400

        # Look up the Project record to get its ID
        projects_url = get_airtable_url('Projects')
        params = {
            'filterByFormula': f"{{Job Number}} = '{job_number}'",
            'maxRecords': 1
        }
        proj_response = requests.get(projects_url, headers=HEADERS, params=params)
        proj_response.raise_for_status()
        records = proj_response.json().get('records', [])
        
        if not records:
            return jsonify({'error': f'Project not found: {job_number}'}), 404
        
        project_record_id = records[0].get('id')
        
        # Create the Tracker record
        tracker_url = get_airtable_url('Tracker')
        tracker_fields = {
            'Link': [project_record_id],
            'Spend': data.get('spend', 0),
            'Ballpark': data.get('ballpark', True),
            'Month': data.get('month', datetime.now().strftime('%B')),
            'Spend type': data.get('spendType', 'Project budget'),
            'Tracker notes': data.get('description', '')
        }
        
        tracker_response = requests.post(
            tracker_url,
            headers=HEADERS,
            json={'fields': tracker_fields}
        )
        tracker_response.raise_for_status()
        
        print(f'[Hub API] Created Tracker record for {job_number}')
        
        # If stage provided, also patch the Projects record
        stage = data.get('stage')
        if stage:
            requests.patch(
                f"{projects_url}/{project_record_id}",
                headers=HEADERS,
                json={'fields': {'Stage': stage}}
            )
            print(f'[Hub API] Updated Stage to {stage} for {job_number}')

        return jsonify({'success': True})

    except Exception as e:
        print(f'[Hub API] Error creating tracker: {e}')
        return jsonify({'error': str(e)}), 500


# ===== JOB BAG =====

@app.route('/api/job/<job_number>/updates', methods=['GET'])
def get_job_updates(job_number):
    """Get all Updates records for a job, ordered by Created Time asc"""
    try:
        updates_url = get_airtable_url('Updates')
        params = {
            'filterByFormula': f"{{Job Number}} = '{job_number}'",
            'sort[0][field]': 'Created Time',
            'sort[0][direction]': 'asc'
        }
        response = requests.get(updates_url, headers=HEADERS, params=params)
        response.raise_for_status()

        updates = []
        for record in response.json().get('records', []):
            fields = record.get('fields', {})
            updates.append({
                'id': record.get('id'),
                'update': fields.get('Update', ''),
                'author': fields.get('Author', 'Dot'),
                'created_time': fields.get('Created Time', ''),
                'backdate': fields.get('Backdate', '')
            })

        return jsonify(updates)

    except Exception as e:
        print(f'[Hub API] Error fetching updates for {job_number}: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/job/<job_number>/updates', methods=['POST'])
def post_job_update(job_number):
    """Create a new update record for a job"""
    try:
        data = request.get_json()
        text = (data.get('text') or '').strip()
        author = (data.get('author') or 'Dot').strip()
        backdate = (data.get('date') or '').strip()

        if not text:
            return jsonify({'error': 'Update text required'}), 400

        # Find project record
        projects_url = get_airtable_url('Projects')
        params = {
            'filterByFormula': f"{{Job Number}} = '{job_number}'",
            'maxRecords': 1
        }
        response = requests.get(projects_url, headers=HEADERS, params=params)
        response.raise_for_status()
        records = response.json().get('records', [])
        if not records:
            return jsonify({'error': 'Job not found'}), 404

        project_record_id = records[0].get('id')

        # Create the update record
        updates_url = get_airtable_url('Updates')
        new_fields = {
            'Update': text,
            'Author': author,
            'Project Link': [project_record_id]
        }
        if backdate:
            new_fields['Backdate'] = backdate

        new_record = {'fields': new_fields}
        create_response = requests.post(updates_url, headers=HEADERS, json=new_record)
        create_response.raise_for_status()

        # Also patch the Project's Update field so WIP cards stay current
        patch_response = requests.patch(
            f"{projects_url}/{project_record_id}",
            headers=HEADERS,
            json={'fields': {'Update': text}}
        )
        patch_response.raise_for_status()
        print(f'[Hub API] Patched Project.Update for {job_number}')

        created = create_response.json()
        fields = created.get('fields', {})

        return jsonify({
            'id': created.get('id'),
            'update': fields.get('Update', ''),
            'author': fields.get('Author', author),
            'created_time': fields.get('Created Time', ''),
            'backdate': fields.get('Backdate', '')
        })

    except Exception as e:
        print(f'[Hub API] Error posting update for {job_number}: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/job/<job_number>/updates/<record_id>', methods=['PATCH'])
def patch_job_update(job_number, record_id):
    """Edit the text and optional backdate of an existing update record"""
    try:
        data = request.get_json()
        text = (data.get('text') or '').strip()
        if not text:
            return jsonify({'error': 'Update text required'}), 400

        fields = {'Update': text}
        backdate = (data.get('backdate') or '').strip()
        if backdate:
            fields['Backdate'] = backdate

        updates_url = get_airtable_url('Updates')
        patch_response = requests.patch(
            f"{updates_url}/{record_id}",
            headers=HEADERS,
            json={'fields': fields}
        )
        patch_response.raise_for_status()
        return jsonify({'success': True})

    except Exception as e:
        print(f'[Hub API] Error patching update {record_id}: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/job/<job_number>/updates/<record_id>', methods=['DELETE'])
def delete_job_update(job_number, record_id):
    """Delete an update record"""
    try:
        updates_url = get_airtable_url('Updates')
        del_response = requests.delete(
            f"{updates_url}/{record_id}",
            headers=HEADERS
        )
        del_response.raise_for_status()
        return jsonify({'success': True})

    except Exception as e:
        print(f'[Hub API] Error deleting update {record_id}: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/job/<job_number>/budget')
def get_job_budget(job_number):
    """Get total spend for a job from Tracker table"""
    try:
        url = get_airtable_url('Tracker')
        params = {
            'filterByFormula': f"{{Job Number}} = '{job_number}'"
        }

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
                spend = fields.get('This month', 0) or fields.get('Spend', 0)
                if isinstance(spend, str):
                    spend = float(spend.replace('$', '').replace(',', '') or 0)
                all_records.append({
                    'id': record.get('id'),
                    'month': fields.get('Month', ''),
                    'spendType': fields.get('Spend type', ''),
                    'notes': fields.get('Tracker notes', ''),
                    'spend': float(spend),
                    'ballpark': bool(fields.get('Ballpark', False))
                })

            offset = data.get('offset')
            if not offset:
                break

        total = sum(r['spend'] for r in all_records)

        return jsonify({
            'total': total,
            'entries': all_records
        })

    except Exception as e:
        print(f'[Hub API] Error fetching budget for {job_number}: {e}')
        return jsonify({'error': str(e)}), 500


# ===== TODOS API =====
def _todo_record_to_dict(record):
    """Convert an Airtable Todos record into the API shape."""
    fields = record.get('fields', {})
    client_link = fields.get('Client', [])
    client_name_lookup = fields.get('Clients (from Client)', [])
    return {
        'id': record.get('id'),
        'title': fields.get('Title', ''),
        'bucket': fields.get('Bucket', 'OTHER'),
        'clientId': client_link[0] if client_link else None,
        'clientName': client_name_lookup[0] if client_name_lookup else None,
        'urgent': bool(fields.get('Urgent', False)),
        'done': bool(fields.get('Done', False)),
        'due': fields.get('Due') or None,
        'doneDate': fields.get('Completed') or None,
        'created': fields.get('Created', ''),
    }


def _resolve_client_record_id(client_code_or_name):
    """Look up a Clients record by code or name. Returns record ID or None."""
    if not client_code_or_name:
        return None
    url = get_airtable_url('Clients')
    formula = f"OR({{Client code}} = '{client_code_or_name}', {{Clients}} = '{client_code_or_name}')"
    response = requests.get(url, headers=HEADERS, params={'filterByFormula': formula, 'maxRecords': 1})
    response.raise_for_status()
    records = response.json().get('records', [])
    return records[0]['id'] if records else None


@app.route('/api/todos', methods=['GET'])
def get_todos():
    """Get all todos, sorted newest first."""
    try:
        url = get_airtable_url('Todo')
        all_records = []
        offset = None
        while True:
            params = {'sort[0][field]': 'Created', 'sort[0][direction]': 'desc'}
            if offset:
                params['offset'] = offset
            response = requests.get(url, headers=HEADERS, params=params)
            response.raise_for_status()
            data = response.json()
            for record in data.get('records', []):
                all_records.append(_todo_record_to_dict(record))
            offset = data.get('offset')
            if not offset:
                break
        return jsonify(all_records)
    except Exception as e:
        print(f'[Hub API] Error fetching todos: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/todos', methods=['POST'])
def create_todo():
    """Create a todo. Accepts: title (req), bucket (CLIENTS|OTHER, default OTHER),
    client (code or name), urgent (bool), confidence (High|Low), due."""
    try:
        data = request.get_json() or {}
        title = (data.get('title') or '').strip()
        if not title:
            return jsonify({'error': 'Title required'}), 400
        bucket = data.get('bucket', 'OTHER').upper()
        if bucket not in ('CLIENTS', 'OTHER'):
            return jsonify({'error': 'Bucket must be CLIENTS or OTHER'}), 400

        fields = {
            'Title': title,
            'Bucket': bucket,
            'Done': False,
            'Urgent': bool(data.get('urgent', False)),
        }
        confidence = data.get('confidence')
        if confidence in ('High', 'Low'):
            fields['Confidence'] = confidence
        due = data.get('due')
        if due:
            fields['Due'] = due
        client_input = data.get('client')
        if client_input:
            client_id = _resolve_client_record_id(client_input)
            if client_id:
                fields['Client'] = [client_id]
            else:
                print(f"[Hub API] Could not resolve client '{client_input}' - creating without link")

        url = get_airtable_url('Todo')
        response = requests.post(url, headers=HEADERS, json={'fields': fields})
        response.raise_for_status()
        print(f"[Hub API] Created todo: {title} ({bucket})")
        return jsonify(_todo_record_to_dict(response.json()))
    except Exception as e:
        print(f'[Hub API] Error creating todo: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/todos/<record_id>', methods=['PATCH'])
def update_todo(record_id):
    """Update a todo. Accepts any of: title, bucket, urgent, done, client."""
    try:
        data = request.get_json() or {}
        field_mapping = {
            'title': 'Title',
            'bucket': 'Bucket',
            'due': 'Due',
            'done': 'Done',
        }
        airtable_fields = {}
        for key, value in data.items():
            if key in field_mapping:
                airtable_fields[field_mapping[key]] = value
        if 'client' in data:
            client_input = data.get('client')
            if client_input:
                client_id = _resolve_client_record_id(client_input)
                if client_id:
                    airtable_fields['Client'] = [client_id]
            else:
                airtable_fields['Client'] = []
        if not airtable_fields:
            return jsonify({'error': 'No valid fields to update'}), 400

        url = get_airtable_url('Todo')
        response = requests.patch(f"{url}/{record_id}", headers=HEADERS, json={'fields': airtable_fields})
        response.raise_for_status()
        return jsonify(_todo_record_to_dict(response.json()))
    except Exception as e:
        print(f'[Hub API] Error updating todo {record_id}: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/api/todos/<record_id>', methods=['DELETE'])
def delete_todo(record_id):
    """Delete a todo permanently."""
    try:
        url = get_airtable_url('Todo')
        response = requests.delete(f"{url}/{record_id}", headers=HEADERS)
        response.raise_for_status()
        print(f'[Hub API] Deleted todo {record_id}')
        return jsonify({'success': True})
    except Exception as e:
        print(f'[Hub API] Error deleting todo {record_id}: {e}')
        return jsonify({'error': str(e)}), 500


# ===== STATIC FILES CATCH-ALL (must be last) =====
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)


# ===== RUN =====
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
