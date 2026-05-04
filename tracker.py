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
    """Return the structured rollover object using the asymmetric bucket model.

    Two regimes:
    - No carry from previous quarter: months can swing freely, only underspends
      bank toward next quarter. Overspends are written off at quarter close.
    - Carry from previous quarter: monthly overspends chip the carry immediately
      (floor at 0). Monthly underspends do NOT repair the carry — they bank
      separately toward next quarter.

    At quarter close (handled implicitly by the next quarter's calculation):
      - Remaining carry expires.
      - Bank becomes next quarter's carry.

    Args:
      is_closed: When True, the quarter being calculated is treated as fully
        closed — all 3 months process regardless of `today`. Used for historic
        retrospective views. When False (default), in-flight months are skipped.

    Shape:
      {
        'lastQuarter': {
          'remaining': int,                # post-walk carry, floored at 0 (live state)
          'inherited': int,                # carry that came in from prev quarter
          'previousQuarterLabel': str,     # e.g. 'Q1'
          'expiresOn': str,                # ISO date (last day of current quarter)
        } | None,                          # None if no inherited carry AND closed,
                                           # or if remaining=0 AND not closed
        'nextQuarter': {
          'banking': int,                  # sum of monthly underspends only
          'monthsBanked': list,
        } | None,                          # None if nothing banking AND not closed
        'isClosed': bool,
        'currentQuarterLabel': str,        # e.g. 'Q2' — quarter this rollover is FOR
        'nextQuarterLabel': str,           # e.g. 'Q3'
        'quarterKey': str,                 # 'JAN-MAR' style key
      }
    """
    prev_q_num, _ = _quarter_from_today(year_end_month, today)
    prev_q = get_previous_quarter(year_end_month, today)
    curr_q_num, curr_q_first = _quarter_from_today(year_end_month, today)
    curr_q = get_current_quarter(year_end_month, today)

    # ----- Carry from previous quarter -----
    # Sum of (committed - spent) per month, floored at 0 per quarter
    # (a net-over previous quarter writes off — doesn't carry as negative).
    prev_committed_total = 0
    prev_spent_total = 0
    prev_entry_count = 0  # how many tracker entries exist in prev quarter at all
    prev_month_names = {m['month_name'] for m in prev_q['months']}
    for row in tracker_entries:
        if row.get('client') != client_code:
            continue
        if row.get('month') in prev_month_names:
            prev_entry_count += 1
    for m in prev_q['months']:
        prev_committed_total += get_committed(
            client_code, m['year'], m['month_num'],
            budget_history, clients_fallback,
        )
        prev_spent_total += _spend_for_month(
            client_code, m['month_name'], tracker_entries,
        )
    # Note: previous quarter carry uses sum-of-monthly-unders semantics for
    # banking, but to keep this calc tractable across multiple historical
    # quarters we use net for prior-quarter rollup. This matches today's
    # behaviour and isn't visible to clients.
    #
    # Pre-system suppression: if the previous quarter has ZERO tracker entries
    # for this client, that quarter pre-dates the tracker system being live for
    # them. A retainer client with system live in that quarter would have at
    # minimum the "Always on" monthly entries (~$1K each, $3K/quarter), so zero
    # entries = system wasn't tracking them yet. Don't manufacture a phantom
    # carry from "underspend = full committed amount".
    prev_quarter_has_data = prev_entry_count > 0
    if prev_quarter_has_data:
        carry_in = max(0, prev_committed_total - prev_spent_total)
    else:
        carry_in = 0

    # ----- Walk completed months in current quarter -----
    today_first = date(today.year, today.month, 1)
    rollover_remaining = carry_in
    bank = 0
    months_banked = []  # only months where variance > 0 (under)

    for m in curr_q['months']:
        m_first = date(m['year'], m['month_num'], 1)
        if not is_closed and m_first >= today_first:
            continue  # month not yet complete (current month in flight, or future)

        committed = get_committed(
            client_code, m['year'], m['month_num'],
            budget_history, clients_fallback,
        )
        spent = _spend_for_month(
            client_code, m['month_name'], tracker_entries,
        )
        variance = committed - spent

        if variance > 0:
            # Underspend: banks toward next quarter (does NOT repair rollover)
            bank += variance
            months_banked.append(m['month_name'])
        elif variance < 0:
            # Overspend: chips current rollover, floored at 0
            # Excess (beyond rollover) is tracked and written off at quarter close
            overage = -variance
            rollover_remaining = max(0, rollover_remaining - overage)

    # ----- Build structured response -----
    # For LIVE: keep existing hide-on-zero semantics so block stays minimal
    #   when there's nothing to say.
    # For CLOSED (historic retrospective): always populate both buckets so
    #   the story is complete — "$X from Q1, $Y to Q3" — even if values are 0.
    # Pre-system override: if prev quarter had no data at all (system wasn't
    #   live yet), hide the lastQuarter line entirely in BOTH modes — showing
    #   "$0 from Q4" would be technically correct but misleading.
    last_quarter = None
    if prev_quarter_has_data and (is_closed or rollover_remaining > 0):
        last_quarter = {
            'remaining': rollover_remaining,
            'inherited': carry_in,
            'previousQuarterLabel': prev_q['label'],
            'expiresOn': _last_day_of_quarter(curr_q_first).isoformat(),
        }

    next_quarter = None
    if is_closed or bank > 0:
        next_quarter = {
            'banking': bank,
            'monthsBanked': months_banked,
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
