"""
tracker.py — Pure functions for tracker math.

Owns:
- Quarter math (current + previous, given a financial year-end month)
- Committed amount lookup (Budget History with fallback to Clients table)
- Rollover calculation (debt-to-client model, floor at zero)
- Chart months (6-month range for the tracker bar chart)

No Flask, no Airtable. Caller assembles data and passes it in.
"""

from datetime import date
from typing import Optional


MONTH_NUM = {
    'January': 1, 'February': 2, 'March': 3, 'April': 4,
    'May': 5, 'June': 6, 'July': 7, 'August': 8,
    'September': 9, 'October': 10, 'November': 11, 'December': 12,
}
MONTH_NAME = {v: k for k, v in MONTH_NUM.items()}


# ===== Internal helpers =====

def _add_months(d: date, n: int) -> date:
    """Return first-of-month date n months from d (n can be negative)."""
    total = d.year * 12 + (d.month - 1) + n
    return date(total // 12, (total % 12) + 1, 1)


def _quarter_from_today(year_end_month: str, today: date) -> tuple:
    """Return (quarter_num, quarter_first_day) for the quarter containing today.

    Mirrors the Airtable SWITCH formula:
      offset = (month - year_end + 12) mod 12
      offset 0 (year-end month itself) -> Q4 (last month of Q4)
      offset 1-3 -> Q1, 4-6 -> Q2, 7-9 -> Q3, 10-11 -> Q4
    """
    year_end_num = MONTH_NUM[year_end_month]
    offset = (today.month - year_end_num + 12) % 12
    offset_1based = offset if offset > 0 else 12  # year-end month becomes 12
    quarter_num = (offset_1based - 1) // 3 + 1
    offset_in_quarter = (offset_1based - 1) % 3
    quarter_first = _add_months(date(today.year, today.month, 1), -offset_in_quarter)
    return quarter_num, quarter_first


def _quarter_months(quarter_first: date) -> list:
    """Return [{'year', 'month_num', 'month_name'}] for the 3 months starting at quarter_first."""
    out = []
    for i in range(3):
        d = _add_months(quarter_first, i)
        out.append({
            'year': d.year,
            'month_num': d.month,
            'month_name': MONTH_NAME[d.month],
        })
    return out


def _confirmed_spend_for_month(client_code: str, month_name: str,
                                tracker_entries: list) -> int:
    """Sum tracker spend where:
       - client matches
       - month matches (Tracker.Month is text like 'April')
       - spendType == 'Project budget'
       - ballpark is False

    Note: Tracker entries don't carry year. Same month name in different years
    can't be disambiguated from this data alone. Acceptable for now: rollover
    only ever reads previous + current quarter (max 6 months), which only
    repeats month names if the year-end is unusual. None of the current main
    clients (March/June/September year-ends) repeat month names within that
    window.
    """
    total = 0
    for row in tracker_entries:
        if row.get('client') != client_code:
            continue
        if row.get('month') != month_name:
            continue
        if row.get('spendType') != 'Project budget':
            continue
        if row.get('ballpark'):
            continue
        spend = row.get('spend', 0)
        if isinstance(spend, str):
            spend = float(spend.replace('$', '').replace(',', '') or 0)
        total += spend
    return int(total)


# ===== Public API =====

def get_committed(client_code: str, year: int, month_num: int,
                  budget_history: list,
                  clients_fallback: dict) -> int:
    """Return the monthly committed amount for client at (year, month_num).

    Looks up Budget History for the most recent record where
    Effective From <= first day of target month. Falls back to
    clients_fallback[client_code] if no Budget History entry applies.

    Args:
      client_code: e.g. 'ONS'
      year, month_num: target month
      budget_history: list of dicts with keys 'Client', 'Effective From'
                      (date or ISO string), 'Monthly Committed'
      clients_fallback: dict {client_code: monthly_committed_int}
    """
    target = date(year, month_num, 1)
    matching = []
    for row in budget_history:
        if row.get('Client') != client_code:
            continue
        eff = row.get('Effective From')
        if isinstance(eff, str):
            eff = date.fromisoformat(eff)
        if eff is None:
            continue
        if eff <= target:
            matching.append((eff, row.get('Monthly Committed', 0)))
    if matching:
        matching.sort(key=lambda x: x[0], reverse=True)
        return int(matching[0][1])
    return int(clients_fallback.get(client_code, 0))


def get_current_quarter(year_end_month: str, today: date) -> dict:
    """Return {'label': 'Qn', 'months': [...]} for the quarter containing today."""
    quarter_num, quarter_first = _quarter_from_today(year_end_month, today)
    return {
        'label': f'Q{quarter_num}',
        'months': _quarter_months(quarter_first),
    }


def get_previous_quarter(year_end_month: str, today: date) -> dict:
    """Return {'label': 'Qn', 'months': [...]} for the quarter immediately before."""
    quarter_num, quarter_first = _quarter_from_today(year_end_month, today)
    prev_first = _add_months(quarter_first, -3)
    prev_q_num = 4 if quarter_num == 1 else quarter_num - 1
    return {
        'label': f'Q{prev_q_num}',
        'months': _quarter_months(prev_first),
    }


def get_chart_months(year_end_month: str, today: date,
                     client_code: str,
                     budget_history: list,
                     clients_fallback: dict) -> list:
    """Return 6 months for the chart: previous quarter + current quarter, in display order.

    Each entry: {'year', 'month', 'committed', 'isPrevious', 'isFuture'}
    """
    prev_q = get_previous_quarter(year_end_month, today)
    curr_q = get_current_quarter(year_end_month, today)
    today_first = date(today.year, today.month, 1)

    out = []
    for m in prev_q['months']:
        m_first = date(m['year'], m['month_num'], 1)
        committed = get_committed(client_code, m['year'], m['month_num'],
                                   budget_history, clients_fallback)
        out.append({
            'year': m['year'],
            'month': m['month_name'],
            'committed': committed,
            'isPrevious': True,
            'isFuture': m_first > today_first,
        })
    for m in curr_q['months']:
        m_first = date(m['year'], m['month_num'], 1)
        committed = get_committed(client_code, m['year'], m['month_num'],
                                   budget_history, clients_fallback)
        out.append({
            'year': m['year'],
            'month': m['month_name'],
            'committed': committed,
            'isPrevious': False,
            'isFuture': m_first > today_first,
        })
    return out


def get_rollover(client_code: str, today: date,
                 year_end_month: str,
                 budget_history: list,
                 clients_fallback: dict,
                 tracker_entries: list) -> dict:
    """Return the structured rollover object.

    Shape:
      {
        'amount': int,                 # final rollover, floored at 0
        'fromPrevious': int,           # carry from previous quarter
        'previousQuarterLabel': str,   # e.g. 'Q3'
        'variance': int,               # abs in-quarter net variance
        'varianceDirection': str|None, # 'under' | 'over' | None
        'varianceMonths': list[str],   # completed months that contributed
      }
    """
    prev_q = get_previous_quarter(year_end_month, today)
    curr_q = get_current_quarter(year_end_month, today)

    # Carry from previous quarter — committed minus confirmed spend, summed
    prev_committed_total = 0
    prev_spent_total = 0
    for m in prev_q['months']:
        prev_committed_total += get_committed(
            client_code, m['year'], m['month_num'],
            budget_history, clients_fallback,
        )
        prev_spent_total += _confirmed_spend_for_month(
            client_code, m['month_name'], tracker_entries,
        )
    from_previous = max(0, prev_committed_total - prev_spent_total)

    # In-quarter variance — completed months only (strictly before today's month)
    today_first = date(today.year, today.month, 1)
    in_quarter_variance = 0  # signed: +ve = under, -ve = over
    variance_months = []
    for m in curr_q['months']:
        m_first = date(m['year'], m['month_num'], 1)
        if m_first >= today_first:
            continue  # current month in flight, future months not yet
        committed = get_committed(
            client_code, m['year'], m['month_num'],
            budget_history, clients_fallback,
        )
        spent = _confirmed_spend_for_month(
            client_code, m['month_name'], tracker_entries,
        )
        var = committed - spent
        if var != 0:
            variance_months.append(m['month_name'])
        in_quarter_variance += var

    # Net zero in-quarter — show single-source line, hide variance
    if in_quarter_variance == 0:
        variance_direction: Optional[str] = None
        variance_months = []
        variance = 0
    elif in_quarter_variance > 0:
        variance_direction = 'under'
        variance = in_quarter_variance
    else:
        variance_direction = 'over'
        variance = -in_quarter_variance

    amount = max(0, from_previous + in_quarter_variance)

    return {
        'amount': amount,
        'fromPrevious': from_previous,
        'previousQuarterLabel': prev_q['label'],
        'variance': variance,
        'varianceDirection': variance_direction,
        'varianceMonths': variance_months,
    }
