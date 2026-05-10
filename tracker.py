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


def _spend_for_month(client_code: str, month_name: str,
                     tracker_entries: list) -> int:
    """Sum tracker spend where:
       - client matches
       - month matches (Tracker.Month is text like 'April')
       - spendType == 'Project budget'

    Ballpark entries ARE counted. Ballpark is a UI hint indicating the spend
    is an estimate that may flex, not a gate on whether it counts as billable
    work. Better to surface planned spend and have a conversation than miss
    actual work because someone forgot to untick a flag.

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


def get_committed_by_month(client_code: str, today: date,
                           budget_history: list,
                           clients_fallback: dict,
                           months_back: int = 24,
                           months_forward: int = 3) -> dict:
    """Return {'YYYY-MM': committed_amount} covering a range around today.

    Default range: 24 months back, current month, 3 months forward (28 entries).
    Used as a lookup table for any UI surface that displays committed values
    for a specific period.
    """
    result = {}
    start = _add_months(date(today.year, today.month, 1), -months_back)
    total_months = months_back + months_forward + 1
    for i in range(total_months):
        d = _add_months(start, i)
        key = f'{d.year:04d}-{d.month:02d}'
        result[key] = get_committed(
            client_code, d.year, d.month, budget_history, clients_fallback,
        )
    return result


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


def _last_day_of_quarter(quarter_first: date) -> date:
    """Last day of the quarter starting at quarter_first (inclusive)."""
    third_month_first = _add_months(quarter_first, 2)
    # First day of the month after the third quarter month, minus one day-equivalent.
    next_month_first = _add_months(third_month_first, 1)
    # date math: subtract one day
    from datetime import timedelta
    return next_month_first - timedelta(days=1)


def get_rollover(client_code: str, today: date,
                 year_end_month: str,
                 budget_history: list,
                 clients_fallback: dict,
                 tracker_entries: list,
                 is_closed: bool = False) -> dict:
    """Return rollover state for the quarter containing today.

    Model: quarterly net.
      - One pot per quarter: this quarter's committed.
      - Inherited rollover from previous quarter sits alongside, expires at
        the close of the quarter it carried into.
      - Spend draws on this quarter's committed first. Only chips inherited
        rollover if the running quarter net goes negative.
      - At quarter close: any net underspend banks to next quarter; any
        inherited rollover not chipped expires.

    Tower-style behaviour (under one month, over the next, even net) produces
    a clean $0 bank and $0 chip — the previous asymmetric bucket model
    double-counted these.

    Live view uses completed months only (in-flight current month and future
    months skipped) so the displayed rollover reflects cumulative state through
    the last completed month. Closed view walks all 3 months.

    Args:
      is_closed: When True, the quarter is treated as fully closed — all 3
        months process regardless of `today`. Used for historic retrospective
        views. When False (default), in-flight + future months are skipped.

    Shape:
      {
        'lastQuarter': {
          'remaining': int,                # inherited - chipped, floored at 0
          'inherited': int,                # carry that came in from prev quarter
          'chipped': int,                  # how much of inherited consumed this quarter
          'previousQuarterLabel': str,     # e.g. 'Q1'
          'expiresOn': str,                # ISO date (last day of current quarter)
        } | None,                          # None if prev quarter had no data,
                                           # or (live mode AND remaining == 0)
        'nextQuarter': {
          'banking': int,                  # net underspend this quarter (>= 0)
          'monthsBanked': list,            # always [] — kept for backward
                                           # compatibility (no longer populated)
        } | None,                          # None if not closed AND banking == 0
        'isClosed': bool,
        'currentQuarterLabel': str,        # e.g. 'Q2' — quarter this rollover is FOR
        'nextQuarterLabel': str,           # e.g. 'Q3'
        'quarterKey': str,                 # 'JAN-MAR' style key
      }
    """
    curr_q_num, curr_q_first = _quarter_from_today(year_end_month, today)
    curr_q = get_current_quarter(year_end_month, today)
    prev_q = get_previous_quarter(year_end_month, today)

    # ===== Inherited from previous quarter =====
    # Previous quarter's banking = max(0, prev_committed - prev_spent).
    #
    # Pre-system suppression: if the previous quarter has ZERO tracker entries
    # for this client, that quarter pre-dates the tracker system being live for
    # them. Don't manufacture a phantom carry from "no entries = full underspend".
    prev_month_names = {m['month_name'] for m in prev_q['months']}
    prev_entry_count = sum(
        1 for row in tracker_entries
        if row.get('client') == client_code
        and row.get('month') in prev_month_names
    )
    prev_quarter_has_data = prev_entry_count > 0

    if prev_quarter_has_data:
        prev_committed_total = 0
        prev_spent_total = 0
        for m in prev_q['months']:
            prev_committed_total += get_committed(
                client_code, m['year'], m['month_num'],
                budget_history, clients_fallback,
            )
            prev_spent_total += _spend_for_month(
                client_code, m['month_name'], tracker_entries,
            )
        inherited = max(0, prev_committed_total - prev_spent_total)
    else:
        inherited = 0

    # ===== Current quarter net =====
    # LIVE: completed months only. CLOSED: all 3 months.
    today_first = date(today.year, today.month, 1)
    curr_committed_total = 0
    curr_spent_total = 0
    for m in curr_q['months']:
        m_first = date(m['year'], m['month_num'], 1)
        if not is_closed and m_first >= today_first:
            continue  # in-flight or future month — skip in live mode
        curr_committed_total += get_committed(
            client_code, m['year'], m['month_num'],
            budget_history, clients_fallback,
        )
        curr_spent_total += _spend_for_month(
            client_code, m['month_name'], tracker_entries,
        )

    net = curr_committed_total - curr_spent_total

    if net >= 0:
        # Net under (or exactly even): banks to next quarter. Inherited untouched.
        banking = net
        chipped = 0
    else:
        # Net over: chips inherited rollover (floor at 0). Anything beyond the
        # carry is written off — no banking.
        overage = -net
        chipped = min(inherited, overage)
        banking = 0

    remaining = inherited - chipped

    # ===== Build response =====
    # Live: hide lastQuarter when there's nothing useful to say (no prev data,
    #   or carry fully chipped — "expired" stories ask more questions than
    #   they answer).
    # Closed: always populate both buckets (with zeros) so the historic story
    #   renders fully — EXCEPT when prev quarter had no data at all (pre-system),
    #   in which case lastQuarter stays hidden.
    last_quarter = None
    if prev_quarter_has_data and (is_closed or remaining > 0):
        last_quarter = {
            'remaining': remaining,
            'inherited': inherited,
            'chipped': chipped,
            'previousQuarterLabel': prev_q['label'],
            'expiresOn': _last_day_of_quarter(curr_q_first).isoformat(),
        }

    next_quarter = None
    if is_closed or banking > 0:
        next_quarter = {
            'banking': banking,
            'monthsBanked': [],  # backward-compat field; no longer populated
        }

    next_q_num = 1 if curr_q_num == 4 else curr_q_num + 1

    return {
        'lastQuarter': last_quarter,
        'nextQuarter': next_quarter,
        'isClosed': is_closed,
        'currentQuarterLabel': f'Q{curr_q_num}',
        'nextQuarterLabel': f'Q{next_q_num}',
        'quarterKey': _quarter_key_from_months(curr_q['months']),
    }


def _quarter_key_from_months(months: list) -> str:
    """Return JAN-MAR style key from the quarter's 3 month dicts.

    Returns '' if months don't map to a standard calendar quarter (shouldn't
    happen with current fiscal calendars but defensive against weird data).
    """
    key_map = {
        (1, 2, 3): 'JAN-MAR',
        (4, 5, 6): 'APR-JUN',
        (7, 8, 9): 'JUL-SEP',
        (10, 11, 12): 'OCT-DEC',
    }
    nums = tuple(m['month_num'] for m in months)
    return key_map.get(nums, '')


def get_historic_quarter_dates(year_end_month: str, today: date,
                                n_quarters: int = 3) -> list:
    """Return a list of representative `today` dates for the previous N quarters.

    Each date is the first day of that quarter — sufficient for `_quarter_from_today`
    to identify the quarter, and works as the `today` parameter for `get_rollover`
    in is_closed=True mode.

    Args:
      n_quarters: How many historic quarters to return. Default 3 (covers a
        full year alongside the current quarter).
    """
    _, curr_q_first = _quarter_from_today(year_end_month, today)
    return [_add_months(curr_q_first, -3 * i) for i in range(1, n_quarters + 1)]
