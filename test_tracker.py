"""
test_tracker.py — fixtures from TRACKER-ROLLOVER-BRIEF.md

All scenarios must pass before phase 3 (frontend migration).

Run: pytest test_tracker.py -v
"""

from datetime import date

import pytest

from tracker import (
    get_committed,
    get_current_quarter,
    get_previous_quarter,
    get_chart_months,
    get_rollover,
    get_historic_quarter_dates,
)


# ===== Fixtures =====

# Budget History matches the actual Airtable export.
BUDGET_HISTORY = [
    {'Client': 'ONE', 'Effective From': '2024-01-01', 'Monthly Committed': 12500},
    {'Client': 'ONS', 'Effective From': '2024-01-01', 'Monthly Committed': 25000},
    {'Client': 'ONS', 'Effective From': '2026-01-01', 'Monthly Committed': 20000},
    {'Client': 'ONB', 'Effective From': '2024-01-01', 'Monthly Committed': 12500},
    {'Client': 'SKY', 'Effective From': '2024-01-01', 'Monthly Committed': 10000},
    {'Client': 'TOW', 'Effective From': '2024-01-01', 'Monthly Committed': 10000},
    {'Client': 'FIS', 'Effective From': '2024-01-01', 'Monthly Committed': 4500},
]

# Fallback from Clients table.
CLIENTS_FALLBACK = {
    'ONE': 12500, 'ONS': 20000, 'ONB': 12500,
    'SKY': 10000, 'TOW': 10000, 'FIS': 4500,
}


def sky_q3_underspend_26k():
    """SKY's Q3 (Jan-Mar 2026) underspent by $26K total.
    Committed $30K, spent $4K = $26K under."""
    return [
        {'client': 'SKY', 'month': 'January',  'spend': 1500, 'spendType': 'Project budget', 'ballpark': False},
        {'client': 'SKY', 'month': 'February', 'spend': 1500, 'spendType': 'Project budget', 'ballpark': False},
        {'client': 'SKY', 'month': 'March',    'spend': 1000, 'spendType': 'Project budget', 'ballpark': False},
    ]


# ===== Quarter math =====

class TestQuarterMath:
    """Port of Airtable SWITCH formula. Year-end month maps to last month of Q4."""

    def test_sky_may_is_q4(self):
        # SKY year-end June. May is 11th month of FY -> Q4 month 2 (Apr-Jun).
        q = get_current_quarter('June', date(2026, 5, 3))
        assert q['label'] == 'Q4'
        assert [m['month_name'] for m in q['months']] == ['April', 'May', 'June']
        assert [m['year'] for m in q['months']] == [2026, 2026, 2026]

    def test_sky_june_30_is_q4(self):
        # Last day of FY: June for SKY -> Q4 (year-end month is last month of Q4).
        q = get_current_quarter('June', date(2026, 6, 30))
        assert q['label'] == 'Q4'
        assert [m['month_name'] for m in q['months']] == ['April', 'May', 'June']

    def test_sky_july_1_flips_to_q1(self):
        q = get_current_quarter('June', date(2026, 7, 1))
        assert q['label'] == 'Q1'
        assert [m['month_name'] for m in q['months']] == ['July', 'August', 'September']
        assert [m['year'] for m in q['months']] == [2026, 2026, 2026]

    def test_sky_july_1_previous_is_q4_apr_jun(self):
        prev = get_previous_quarter('June', date(2026, 7, 1))
        assert prev['label'] == 'Q4'
        assert [m['month_name'] for m in prev['months']] == ['April', 'May', 'June']
        assert [m['year'] for m in prev['months']] == [2026, 2026, 2026]

    def test_ons_march_31_is_q4(self):
        # March year-end: March is last month of Q4 (Jan-Mar).
        q = get_current_quarter('March', date(2026, 3, 31))
        assert q['label'] == 'Q4'
        assert [m['month_name'] for m in q['months']] == ['January', 'February', 'March']

    def test_ons_april_1_flips_to_q1(self):
        q = get_current_quarter('March', date(2026, 4, 1))
        assert q['label'] == 'Q1'
        assert [m['month_name'] for m in q['months']] == ['April', 'May', 'June']

    def test_previous_quarter_q1_wraps_to_q4(self):
        # ONS today (May 3 2026) -> current Q1 -> previous Q4 = Jan-Mar 2026
        prev = get_previous_quarter('March', date(2026, 5, 3))
        assert prev['label'] == 'Q4'
        assert [m['month_name'] for m in prev['months']] == ['January', 'February', 'March']
        assert [m['year'] for m in prev['months']] == [2026, 2026, 2026]


# ===== Committed lookup =====

class TestGetCommitted:

    def test_ons_pre_jan_2026_returns_25k(self):
        # Brief: ONS pre-Jan 2026 -> $25K from Budget History
        assert get_committed('ONS', 2025, 12, BUDGET_HISTORY, CLIENTS_FALLBACK) == 25000

    def test_ons_jan_2026_onwards_returns_20k(self):
        # Brief: ONS post-renegotiation -> $20K
        assert get_committed('ONS', 2026, 1, BUDGET_HISTORY, CLIENTS_FALLBACK) == 20000
        assert get_committed('ONS', 2026, 5, BUDGET_HISTORY, CLIENTS_FALLBACK) == 20000

    def test_sky_always_10k(self):
        assert get_committed('SKY', 2024, 6, BUDGET_HISTORY, CLIENTS_FALLBACK) == 10000
        assert get_committed('SKY', 2026, 5, BUDGET_HISTORY, CLIENTS_FALLBACK) == 10000

    def test_brand_new_client_falls_back_to_clients_table(self):
        # No Budget History entry -> use Clients table value
        fallback = {'NEW': 7500}
        assert get_committed('NEW', 2026, 5, BUDGET_HISTORY, fallback) == 7500

    def test_no_history_no_fallback_returns_zero(self):
        assert get_committed('GHOST', 2026, 5, BUDGET_HISTORY, CLIENTS_FALLBACK) == 0

    def test_pre_seed_date_falls_back(self):
        # Earliest seed is 2024-01-01. A target before that has no matching row.
        assert get_committed('SKY', 2023, 12, BUDGET_HISTORY, CLIENTS_FALLBACK) == 10000  # falls back


# ===== Rollover — quarterly net model =====

class TestRollover:
    """The quarterly net model (11 May 2026 spec):

    - Inherited carry from previous quarter sits as `lastQuarter.remaining`.
    - This quarter's spend draws on this quarter's committed first.
    - Only chips inherited carry if running quarter net goes negative.
    - At quarter close: net underspend banks to next quarter; any remaining
      inherited carry expires.
    - Tower-style under-then-over within a quarter nets cleanly to $0
      (the previous asymmetric bucket model double-counted these).
    """

    def test_q3_underspend_no_in_quarter_activity(self):
        # SKY started Q4 with $26K rollover from Q3.
        # April still in flight (today Apr 15) — no completed months in Q4.
        result = get_rollover(
            'SKY', date(2026, 4, 15), 'June',
            BUDGET_HISTORY, CLIENTS_FALLBACK,
            sky_q3_underspend_26k(),
        )
        assert result['lastQuarter'] is not None
        assert result['lastQuarter']['remaining'] == 26000
        assert result['lastQuarter']['previousQuarterLabel'] == 'Q3'
        assert result['lastQuarter']['expiresOn'] == '2026-06-30'
        assert result['nextQuarter'] is None

    def test_april_overspent_5k_chips_rollover(self):
        # SKY: April overspent $5K. Carry chipped to $21K. Nothing banking.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 21000
        assert result['nextQuarter'] is None

    def test_april_underspent_5k_banks_does_not_repair(self):
        # SKY: April underspent $5K. Carry stays $26K. $5K banks for next quarter.
        # Under new model, "does not repair" means: net is positive, so carry
        # isn't chipped in the first place. monthsBanked deprecated (always []).
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 26000
        assert result['lastQuarter']['chipped'] == 0
        assert result['nextQuarter']['banking'] == 5000
        assert result['nextQuarter']['monthsBanked'] == []

    def test_monthsBanked_skips_on_commit(self):
        # April under, May exactly on commit, June not yet. Net = $3K under.
        # monthsBanked deprecated (always []).
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 7000,  'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'May',   'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 6, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['nextQuarter']['banking'] == 3000
        assert result['nextQuarter']['monthsBanked'] == []

    def test_under_then_over_evens_within_quarter(self):
        # The Tower-fix headline case: April under $5K, May over $5K. Net = $0.
        # Old asymmetric model: bank $5K AND chip $5K from carry. Double-counted.
        # New model: clean. Bank $0, chip $0, carry untouched.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000,  'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'May',   'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 6, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 26000  # carry untouched
        assert result['lastQuarter']['chipped'] == 0
        assert result['nextQuarter'] is None  # net is $0, nothing banks

    def test_over_then_under_nets_smaller_overage(self):
        # April over $10K, May under $3K. Net = $7K over.
        # Old asymmetric: chip $10K (remaining $16K), bank $3K.
        # New model: chip the net overage only ($7K). Bank nothing.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 20000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'May',   'spend': 7000,  'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 6, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 19000  # 26000 - 7000 net
        assert result['lastQuarter']['chipped'] == 7000
        assert result['nextQuarter'] is None

    def test_under_then_over_chips_only_net_overage(self):
        # April under $5K, May over $10K. Net = $5K over.
        # Old asymmetric: chip $10K, bank $5K separately.
        # New model: net is what chips ($5K). Bank nothing.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000,  'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'May',   'spend': 20000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 6, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 21000  # 26000 - 5000 net
        assert result['lastQuarter']['chipped'] == 5000
        assert result['nextQuarter'] is None

    def test_floor_at_zero_when_overage_exceeds_carry(self):
        # SKY Q3 underspent $5K (not 26K). April overspent $10K. Chip floors at 0.
        entries = [
            {'client': 'SKY', 'month': 'January',  'spend': 9000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 8000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 8000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April',    'spend': 20000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        # Carry $5K, overage $10K → floored at 0 → lastQuarter hidden
        assert result['lastQuarter'] is None
        assert result['nextQuarter'] is None

    def test_no_carry_in_quarter_under_banks(self):
        # No previous quarter underspend (Q3 fully spent). April underspent $3K.
        entries = [
            {'client': 'SKY', 'month': 'January',  'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April',    'spend': 7000,  'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter'] is None
        assert result['nextQuarter']['banking'] == 3000

    def test_no_carry_in_quarter_over_nothing_to_show(self):
        # No carry, April overspent. Nothing chips, nothing banks.
        entries = [
            {'client': 'SKY', 'month': 'January',  'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April',    'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter'] is None
        assert result['nextQuarter'] is None

    def test_brand_new_client_no_data(self):
        result = get_rollover('NEW', date(2026, 5, 3), 'March',
                               BUDGET_HISTORY, {'NEW': 5000}, [])
        # Pre-system suppression: no entries in prev quarter → no phantom carry.
        # Current quarter (Q1 Apr-Jun): April done with $0 spend → $5K under → banking $5K
        assert result['lastQuarter'] is None
        assert result['nextQuarter']['banking'] == 5000

    def test_brand_new_client_no_committed(self):
        # No Budget History, no fallback — all zeros.
        result = get_rollover('GHOST', date(2026, 5, 3), 'March',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, [])
        assert result['lastQuarter'] is None
        assert result['nextQuarter'] is None

    def test_ons_uses_20k_post_renegotiation(self):
        # ONS today May 3 2026, year-end March → Q1 (Apr-Jun)
        # Prev Q4 = Jan-Mar 2026, $20K each, no entries → suppressed (no phantom carry).
        # April done, no spend, $20K under → banks $20K
        result = get_rollover('ONS', date(2026, 5, 3), 'March',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, [])
        assert result['lastQuarter'] is None
        assert result['nextQuarter']['banking'] == 20000

    def test_ons_pre_jan_2026_uses_25k(self):
        # ONS Dec 15 2025, year-end March → Q3 (Oct-Dec)
        # Prev Q2 = Jul-Sep 2025, no entries → suppressed (no phantom carry).
        # Oct + Nov done, no spend → bank $50K (Dec in flight)
        result = get_rollover('ONS', date(2025, 12, 15), 'March',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, [])
        assert result['lastQuarter'] is None
        assert result['nextQuarter']['banking'] == 50000

    def test_ballpark_counted(self):
        # Ballpark is a UI hint only — it does NOT gate spend math.
        # April counts both $5K (confirmed) + $7K (ballpark) = $12K spent.
        # April $2K over (committed $10K) → chips $2K of $26K carry → carry $24K, no banking.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April', 'spend': 7000, 'spendType': 'Project budget', 'ballpark': True},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 24000
        assert result['nextQuarter'] is None

    def test_project_on_us_excluded(self):
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000,  'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April', 'spend': 10000, 'spendType': 'Project on us', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 26000
        assert result['nextQuarter']['banking'] == 5000

    def test_extra_budget_excluded(self):
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April', 'spend': 8000, 'spendType': 'Extra budget',   'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 26000
        assert result['nextQuarter']['banking'] == 5000

    def test_on_commit_each_month_no_movement(self):
        # April spent exactly $10K (committed). No chip, no bank.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter']['remaining'] == 26000
        assert result['nextQuarter'] is None  # nothing banking

    def test_tower_clean_under_then_over_zero_bank(self):
        # The headline Tower case: no carry in, April under $1K, May over $1K.
        # Net = $0 → no banking, no chipping. Carry untouched (and none anyway).
        # Old asymmetric model would have banked $1K AND chipped $1K — double count.
        entries = [
            # Q4 (Jan-Mar) on commit → $0 inherited into Q1
            {'client': 'TOW', 'month': 'January',  'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'TOW', 'month': 'February', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'TOW', 'month': 'March',    'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            # Q1 (Apr-Jun): April under $1K, May over $1K, nets to $0
            {'client': 'TOW', 'month': 'April',    'spend': 9000,  'spendType': 'Project budget', 'ballpark': False},
            {'client': 'TOW', 'month': 'May',      'spend': 11000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        # Tower has March year-end → today Jun 15 → Q1 = Apr-Jun, April + May complete
        result = get_rollover('TOW', date(2026, 6, 15), 'March',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['lastQuarter'] is None  # no inherited (Q4 on commit), nothing to show
        assert result['nextQuarter'] is None  # net $0, nothing banks

    def test_chipped_field_reflects_consumption(self):
        # New field: lastQuarter.chipped = how much of inherited was consumed
        # by this quarter's overspend. inherited - chipped == remaining always.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        lq = result['lastQuarter']
        assert lq['inherited'] == 26000
        assert lq['chipped'] == 5000
        assert lq['remaining'] == 21000
        assert lq['inherited'] - lq['chipped'] == lq['remaining']


# ===== Chart months — historical accuracy =====

class TestChartMonths:
    """The bar chart needs per-month committed values for historical accuracy."""

    def test_ons_chart_spans_renegotiation(self):
        # Today = May 3 2026, ONS year-end March
        # Current Q1 = Apr-Jun 2026 (all $20K)
        # Previous Q4 = Jan-Mar 2026 (all $20K — renegotiation took effect Jan 1)
        # All 6 months at $20K
        chart = get_chart_months('March', date(2026, 5, 3), 'ONS',
                                  BUDGET_HISTORY, CLIENTS_FALLBACK)
        assert len(chart) == 6
        for entry in chart:
            assert entry['committed'] == 20000

    def test_ons_chart_in_dec_2025_shows_step_down(self):
        # Today = Dec 15 2025, ONS year-end March
        # Current Q3 = Oct-Dec 2025 (all $25K, pre-renegotiation)
        # Previous Q2 = Jul-Sep 2025 (all $25K)
        # All $25K — renegotiation hasn't taken effect yet
        chart = get_chart_months('March', date(2025, 12, 15), 'ONS',
                                  BUDGET_HISTORY, CLIENTS_FALLBACK)
        for entry in chart:
            assert entry['committed'] == 25000

    def test_ons_chart_q4_2025_to_q1_2026_steps_down(self):
        # Today = Feb 15 2026, ONS year-end March
        # Current Q4 = Jan-Mar 2026 (all $20K)
        # Previous Q3 = Oct-Dec 2025 (all $25K)
        chart = get_chart_months('March', date(2026, 2, 15), 'ONS',
                                  BUDGET_HISTORY, CLIENTS_FALLBACK)
        # First 3 (previous quarter): $25K
        # Last 3 (current quarter): $20K
        committed_values = [e['committed'] for e in chart]
        assert committed_values == [25000, 25000, 25000, 20000, 20000, 20000]
        # First 3 should be Oct-Dec 2025
        assert chart[0] == {'year': 2025, 'month': 'October',  'committed': 25000, 'isPrevious': True, 'isFuture': False}
        assert chart[2] == {'year': 2025, 'month': 'December', 'committed': 25000, 'isPrevious': True, 'isFuture': False}
        # Last 3 should be Jan-Mar 2026
        assert chart[3] == {'year': 2026, 'month': 'January',  'committed': 20000, 'isPrevious': False, 'isFuture': False}
        assert chart[5] == {'year': 2026, 'month': 'March',    'committed': 20000, 'isPrevious': False, 'isFuture': True}

    def test_sky_chart_all_10k(self):
        # Today = May 3 2026, SKY year-end June
        # Current Q4 = Apr-Jun 2026, Previous Q3 = Jan-Mar 2026, all $10K
        chart = get_chart_months('June', date(2026, 5, 3), 'SKY',
                                  BUDGET_HISTORY, CLIENTS_FALLBACK)
        assert [e['committed'] for e in chart] == [10000] * 6
        # Months in order: Jan, Feb, Mar (prev), Apr, May, Jun (curr)
        assert [e['month'] for e in chart] == [
            'January', 'February', 'March', 'April', 'May', 'June'
        ]

    def test_chart_isfuture_flags(self):
        # Today = May 3 2026, SKY year-end June -> Q4 Apr-May-Jun current
        # April done, May in flight (current month, not future), June future
        chart = get_chart_months('June', date(2026, 5, 3), 'SKY',
                                  BUDGET_HISTORY, CLIENTS_FALLBACK)
        future_flags = [(e['month'], e['isFuture']) for e in chart]
        assert future_flags == [
            ('January', False), ('February', False), ('March', False),
            ('April', False), ('May', False), ('June', True),
        ]

    def test_chart_quarter_boundary_sky_july_1(self):
        # Today = July 1 2026 -> SKY flips to Q1 (Jul-Sep), prev Q4 (Apr-Jun)
        chart = get_chart_months('June', date(2026, 7, 1), 'SKY',
                                  BUDGET_HISTORY, CLIENTS_FALLBACK)
        assert [e['month'] for e in chart] == [
            'April', 'May', 'June', 'July', 'August', 'September'
        ]
        assert chart[0]['isPrevious'] is True
        assert chart[3]['isPrevious'] is False

    def test_chart_brand_new_client_uses_fallback(self):
        # Brief: brand new client falls back to Clients.Monthly Committed
        chart = get_chart_months('March', date(2026, 5, 3), 'NEW',
                                  BUDGET_HISTORY, {'NEW': 7500})
        assert [e['committed'] for e in chart] == [7500] * 6


# ===== committedByMonth — broader historical lookup table =====

from tracker import get_committed_by_month


class TestCommittedByMonth:
    """Lookup table consumed by stat boxes/totals so any viewed period reads the
    historically-correct committed value."""

    def test_default_range_is_28_months(self):
        # 24 back + current + 3 forward = 28
        result = get_committed_by_month(
            'SKY', date(2026, 5, 3), BUDGET_HISTORY, CLIENTS_FALLBACK,
        )
        assert len(result) == 28

    def test_keys_are_yyyy_mm_format(self):
        result = get_committed_by_month(
            'SKY', date(2026, 5, 3), BUDGET_HISTORY, CLIENTS_FALLBACK,
        )
        # Earliest = 24 months back from May 2026 = May 2024
        # Latest = 3 months forward = August 2026
        assert '2024-05' in result
        assert '2026-05' in result
        assert '2026-08' in result
        # Boundary check
        assert '2024-04' not in result
        assert '2026-09' not in result

    def test_sky_all_10k_across_range(self):
        result = get_committed_by_month(
            'SKY', date(2026, 5, 3), BUDGET_HISTORY, CLIENTS_FALLBACK,
        )
        assert all(v == 10000 for v in result.values())

    def test_ons_spans_renegotiation(self):
        # ONS: $25K through Dec 2025, $20K from Jan 2026 onwards
        result = get_committed_by_month(
            'ONS', date(2026, 5, 3), BUDGET_HISTORY, CLIENTS_FALLBACK,
        )
        # Pre-renegotiation
        assert result['2024-06'] == 25000
        assert result['2025-12'] == 25000
        # Renegotiation effective Jan 1 2026
        assert result['2026-01'] == 20000
        assert result['2026-05'] == 20000
        # Forward months (no further changes scheduled)
        assert result['2026-08'] == 20000

    def test_brand_new_client_uses_fallback(self):
        result = get_committed_by_month(
            'NEW', date(2026, 5, 3), BUDGET_HISTORY, {'NEW': 7500},
        )
        assert all(v == 7500 for v in result.values())

    def test_custom_range(self):
        # 6 back + current + 0 forward = 7 entries
        result = get_committed_by_month(
            'SKY', date(2026, 5, 3), BUDGET_HISTORY, CLIENTS_FALLBACK,
            months_back=6, months_forward=0,
        )
        assert len(result) == 7
        assert '2025-11' in result  # 6 months back
        assert '2026-05' in result  # current
        assert '2026-06' not in result  # 0 forward

    def test_stat_box_use_case_ons_q3_2025(self):
        # Stat box for ONS Q3 2025 (Jul-Sep 2025) should show $75K
        # User is looking at this from today (May 2026)
        result = get_committed_by_month(
            'ONS', date(2026, 5, 3), BUDGET_HISTORY, CLIENTS_FALLBACK,
        )
        q_total = result['2025-07'] + result['2025-08'] + result['2025-09']
        assert q_total == 75000  # 3 * 25000 (pre-renegotiation)

    def test_stat_box_use_case_ons_q1_2026(self):
        # Stat box for ONS Q1 2026 (Apr-Jun) should show $60K (post-renegotiation)
        result = get_committed_by_month(
            'ONS', date(2026, 5, 3), BUDGET_HISTORY, CLIENTS_FALLBACK,
        )
        q_total = result['2026-04'] + result['2026-05'] + result['2026-06']
        assert q_total == 60000  # 3 * 20000


class TestHistoricRollover:
    """is_closed=True treats the quarter as fully closed.

    All 3 months process regardless of `today`. Both buckets are populated
    even when zero (so historic story renders fully). Includes new metadata
    fields (isClosed, currentQuarterLabel, nextQuarterLabel, quarterKey).
    """

    def test_live_response_includes_new_metadata(self):
        # Even live calls now return the new metadata fields.
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK,
                               sky_q3_underspend_26k())
        assert result['isClosed'] is False
        assert result['currentQuarterLabel'] == 'Q4'
        assert result['nextQuarterLabel'] == 'Q1'
        assert result['quarterKey'] == 'APR-JUN'

    def test_closed_processes_all_months(self):
        # Looking back at SKY's Q3 (Jan-Mar) as closed.
        # Q2 (Oct-Dec) entries provided so prev_quarter_has_data is true.
        # Q2 spent $30K committed exactly → carry into Q3 = $0.
        # Q3 entries from fixture: $4K total spent. Each month underspent → bank $26K.
        entries = [
            {'client': 'SKY', 'month': 'October',  'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'November', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'December', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
        ] + sky_q3_underspend_26k()
        result = get_rollover('SKY', date(2026, 1, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries,
                               is_closed=True)
        assert result['isClosed'] is True
        assert result['currentQuarterLabel'] == 'Q3'
        assert result['nextQuarterLabel'] == 'Q4'
        assert result['quarterKey'] == 'JAN-MAR'
        # Q2 spent exactly committed → $0 carry into Q3
        assert result['lastQuarter']['inherited'] == 0
        assert result['lastQuarter']['remaining'] == 0
        # Q3 banked $26K toward Q4
        assert result['nextQuarter']['banking'] == 26000

    def test_closed_pre_system_suppresses_last_quarter(self):
        # Pre-system suppression also applies in closed mode: if prev quarter
        # has no entries at all, hide lastQuarter entirely (don't show "$0 from Q4").
        # Q3 (Jan-Mar) entries from fixture, but NO Q2 (Oct-Dec) entries.
        entries = sky_q3_underspend_26k()
        result = get_rollover('SKY', date(2026, 1, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries,
                               is_closed=True)
        # No prev quarter data → lastQuarter hidden (even though closed)
        assert result['lastQuarter'] is None
        # Banking still computed normally
        assert result['nextQuarter'] is not None
        assert result['nextQuarter']['banking'] == 26000

    def test_closed_historic_overspend_chips_carry(self):
        # Tower-style: $14.5K carry into a quarter, that quarter overspends.
        # Set up: Q2 (Oct-Dec) entries totaling $15.5K → carry into Q3 = $14.5K.
        # Q3 (Jan-Mar) entries: each month $15K spent ($5K over).
        # Walk Q3: carry $14.5K - $5K - $5K - $4.5K → 0 (floored).
        # No banking (all months over).
        entries = [
            # Q2 setup: $15.5K spent → $14.5K carry into Q3
            {'client': 'SKY', 'month': 'October',  'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'November', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'December', 'spend': 5500, 'spendType': 'Project budget', 'ballpark': False},
            # Q3 walk: $15K each month
            {'client': 'SKY', 'month': 'January',  'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 1, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries,
                               is_closed=True)
        # Inherited tells the "what did they have" story
        assert result['lastQuarter']['inherited'] == 14500
        # Remaining: $14.5K - $5K - $5K - $5K = -$0.5K → floored to 0
        assert result['lastQuarter']['remaining'] == 0
        # Nothing banked (all months overspent)
        assert result['nextQuarter']['banking'] == 0

    def test_closed_historic_smaller_overspend_partial_chip(self):
        # Carry survives the chip with some left over.
        # Q2 (Oct-Dec) underspent: $15.5K spent → $14.5K carry.
        # Q3 each month $11K spent ($1K over per month) = $3K over total.
        # Walk: $14.5K - $1K - $1K - $1K = $11.5K remaining. Bank $0.
        entries = [
            {'client': 'SKY', 'month': 'October',  'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'November', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'December', 'spend': 5500, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'January',  'spend': 11000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 11000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 11000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 1, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries,
                               is_closed=True)
        assert result['lastQuarter']['inherited'] == 14500
        assert result['lastQuarter']['remaining'] == 11500
        assert result['nextQuarter']['banking'] == 0

    def test_closed_historic_underspends_bank(self):
        # Carry inherited AND new banking from underspends.
        # Q2: $15.5K spent → $14.5K carry in.
        # Q3: each month $7K spent ($3K under) → bank $9K total. Carry untouched.
        entries = [
            {'client': 'SKY', 'month': 'October',  'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'November', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'December', 'spend': 5500, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'January',  'spend': 7000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 7000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 7000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 1, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries,
                               is_closed=True)
        assert result['lastQuarter']['inherited'] == 14500
        # Carry not chipped (net is positive)
        assert result['lastQuarter']['remaining'] == 14500
        assert result['lastQuarter']['chipped'] == 0
        # Net under $9K → banks $9K
        assert result['nextQuarter']['banking'] == 9000
        assert result['nextQuarter']['monthsBanked'] == []  # deprecated, always []

    def test_closed_zero_buckets_still_populated(self):
        # No carry, no banking, but is_closed=True → buckets still populated with zeros.
        # Q2 (Oct-Dec) all $10K committed exactly = $30K spent → $0 carry.
        # Q3 same, no variance → $0 bank.
        entries = [
            {'client': 'SKY', 'month': 'October',  'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'November', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'December', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'January',  'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 1, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries,
                               is_closed=True)
        # For closed, both buckets always populated even at 0
        assert result['lastQuarter'] is not None
        assert result['lastQuarter']['inherited'] == 0
        assert result['lastQuarter']['remaining'] == 0
        assert result['nextQuarter'] is not None
        assert result['nextQuarter']['banking'] == 0

    def test_quarter_key_for_each_quarter(self):
        # SKY (June year-end): Q1=Jul-Sep, Q2=Oct-Dec, Q3=Jan-Mar, Q4=Apr-Jun
        q1 = get_rollover('SKY', date(2025, 8, 15), 'June',
                          BUDGET_HISTORY, CLIENTS_FALLBACK, [], is_closed=True)
        assert q1['quarterKey'] == 'JUL-SEP'
        assert q1['currentQuarterLabel'] == 'Q1'

        q2 = get_rollover('SKY', date(2025, 11, 15), 'June',
                          BUDGET_HISTORY, CLIENTS_FALLBACK, [], is_closed=True)
        assert q2['quarterKey'] == 'OCT-DEC'
        assert q2['currentQuarterLabel'] == 'Q2'

        q4 = get_rollover('SKY', date(2026, 5, 3), 'June',
                          BUDGET_HISTORY, CLIENTS_FALLBACK, [], is_closed=False)
        assert q4['quarterKey'] == 'APR-JUN'
        assert q4['currentQuarterLabel'] == 'Q4'
        assert q4['nextQuarterLabel'] == 'Q1'  # wraps


class TestHistoricQuarterDates:
    """get_historic_quarter_dates returns representative dates for past quarters."""

    def test_three_quarters_back_from_sky_q4(self):
        # SKY Q4 = Apr-Jun. Back 3 → Jan-Mar (Q3), Oct-Dec (Q2), Jul-Sep (Q1).
        dates = get_historic_quarter_dates('June', date(2026, 5, 3), n_quarters=3)
        assert len(dates) == 3
        # Most recent first
        assert dates[0] == date(2026, 1, 1)   # Q3 first day
        assert dates[1] == date(2025, 10, 1)  # Q2 first day
        assert dates[2] == date(2025, 7, 1)   # Q1 first day

    def test_each_date_lands_in_the_right_quarter(self):
        # Each date, when fed back to get_rollover, identifies the right quarter.
        dates = get_historic_quarter_dates('June', date(2026, 5, 3), n_quarters=3)
        labels = []
        for d in dates:
            r = get_rollover('SKY', d, 'June',
                             BUDGET_HISTORY, CLIENTS_FALLBACK, [], is_closed=True)
            labels.append(r['currentQuarterLabel'])
        assert labels == ['Q3', 'Q2', 'Q1']

    def test_default_is_three(self):
        dates = get_historic_quarter_dates('June', date(2026, 5, 3))
        assert len(dates) == 3


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
