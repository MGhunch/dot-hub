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


# ===== Rollover — brief fixtures =====

class TestRollover:
    """All the test fixtures listed in TRACKER-ROLLOVER-BRIEF.md."""

    def test_q3_underspend_no_in_quarter_activity(self):
        # Brief: SKY mid-Q4, $26K Q3 underspend, no in-quarter activity
        # "No in-quarter activity" = no completed months yet in current quarter.
        # April 15 2026: April is in flight, no completed months in Q4.
        result = get_rollover(
            'SKY', date(2026, 4, 15), 'June',
            BUDGET_HISTORY, CLIENTS_FALLBACK,
            sky_q3_underspend_26k(),
        )
        assert result['amount'] == 26000
        assert result['fromPrevious'] == 26000
        assert result['previousQuarterLabel'] == 'Q3'
        assert result['variance'] == 0
        assert result['varianceDirection'] is None
        assert result['varianceMonths'] == []

    def test_april_overspent_5k(self):
        # Brief: SKY mid-Q4, April overspent $5K
        # April committed $10K, spent $15K = $5K over
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['amount'] == 21000
        assert result['fromPrevious'] == 26000
        assert result['variance'] == 5000
        assert result['varianceDirection'] == 'over'
        assert result['varianceMonths'] == ['April']

    def test_april_underspent_5k(self):
        # Brief: SKY mid-Q4, April underspent $5K
        # April committed $10K, spent $5K = $5K under
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['amount'] == 31000
        assert result['fromPrevious'] == 26000
        assert result['variance'] == 5000
        assert result['varianceDirection'] == 'under'
        assert result['varianceMonths'] == ['April']

    def test_april_over_3k_may_under_2k(self):
        # Brief: SKY mid-Q4, April +$3K over, May -$2K under -> net $1K over
        # Today must be June 1+ for May to be a completed month.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 13000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'May',   'spend': 8000,  'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 6, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['amount'] == 25000  # 26000 + (-1000)
        assert result['fromPrevious'] == 26000
        assert result['variance'] == 1000
        assert result['varianceDirection'] == 'over'
        assert result['varianceMonths'] == ['April', 'May']

    def test_ons_uses_20k_post_renegotiation(self):
        # Brief: ONS mid-Q1 2026 (post-renegotiation) uses $20K/month
        # ONS today = May 3 2026 -> Q1 2026 (Apr-Jun), April done, all $20K committed
        # Previous quarter = Q4 (Jan-Mar 2026), $20K each = $60K committed
        # No tracker entries -> $0 spent
        result = get_rollover('ONS', date(2026, 5, 3), 'March',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, [])
        # fromPrevious = max(0, 60000 - 0) = 60000
        # April committed $20K, spent $0 = $20K under
        # amount = 60000 + 20000 = 80000
        assert result['fromPrevious'] == 60000
        assert result['variance'] == 20000
        assert result['varianceDirection'] == 'under'
        assert result['amount'] == 80000

    def test_ons_pre_jan_2026_uses_25k(self):
        # Brief: ONS pre-Jan 2026 month uses $25K/month
        # If today is Dec 15 2025, ONS Q3 (current) = Oct-Dec 2025, Q2 (prev) = Jul-Sep 2025
        # All previous quarter committed $25K (pre-renegotiation)
        result = get_rollover('ONS', date(2025, 12, 15), 'March',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, [])
        # Q3 = Oct-Dec 2025, Q2 = Jul-Sep 2025 (all $25K)
        assert result['fromPrevious'] == 75000  # 3 * 25000
        # Oct, Nov 2025 completed, Dec in flight
        assert result['variance'] == 50000  # 2 * 25000
        assert result['varianceDirection'] == 'under'

    def test_net_zero_in_quarter_with_q3_credit(self):
        # Brief: Net zero in-quarter, Q3 credit exists -> single-source line
        # April -$2K under, May +$2K over -> net 0
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 8000,  'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'May',   'spend': 12000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 6, 15), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['amount'] == 26000
        assert result['fromPrevious'] == 26000
        assert result['variance'] == 0
        assert result['varianceDirection'] is None
        assert result['varianceMonths'] == []

    def test_floor_at_zero_overage_exceeds_carry(self):
        # Brief: Floor case: $5K Q3 credit, $10K in-quarter over -> amount=0
        # SKY Q3 (Jan-Mar) committed $30K, spent $25K = $5K under
        # April committed $10K, spent $20K = $10K over
        entries = [
            {'client': 'SKY', 'month': 'January',  'spend': 9000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 8000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 8000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April',    'spend': 20000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['amount'] == 0
        assert result['fromPrevious'] == 5000
        assert result['variance'] == 10000
        assert result['varianceDirection'] == 'over'
        assert result['varianceMonths'] == ['April']

    def test_no_q3_credit_in_quarter_over(self):
        # Brief: No Q3 credit, in-quarter over -> amount=0
        # Q3 fully spent (no carry), April overspent
        entries = [
            {'client': 'SKY', 'month': 'January',  'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'February', 'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'March',    'spend': 10000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April',    'spend': 15000, 'spendType': 'Project budget', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['amount'] == 0
        assert result['fromPrevious'] == 0
        assert result['variance'] == 5000
        assert result['varianceDirection'] == 'over'

    def test_brand_new_client_no_data(self):
        # Brief: Brand new client, no prior data
        result = get_rollover('NEW', date(2026, 5, 3), 'March',
                               BUDGET_HISTORY, {'NEW': 5000}, [])
        # No tracker entries, no spend, all months "under" by full committed
        # Q4 prev (Jan-Mar 2026): 3*5000 = 15000 committed, $0 spent -> 15000 carry
        # Q1 curr (Apr-Jun): April done, $5K under
        assert result['fromPrevious'] == 15000
        assert result['amount'] == 20000
        assert result['variance'] == 5000

    def test_brand_new_client_no_committed(self):
        # No Budget History, no fallback -> 0 everywhere
        result = get_rollover('GHOST', date(2026, 5, 3), 'March',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, [])
        assert result['amount'] == 0
        assert result['fromPrevious'] == 0
        assert result['variance'] == 0
        assert result['varianceDirection'] is None

    def test_ballpark_excluded_from_variance(self):
        # Brief: Ballpark entries not included in variance math
        # April: $5K confirmed, $7K ballpark. Variance should only see $5K spent.
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April', 'spend': 7000, 'spendType': 'Project budget', 'ballpark': True},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        # April committed $10K, confirmed $5K -> $5K under
        assert result['variance'] == 5000
        assert result['varianceDirection'] == 'under'

    def test_project_on_us_excluded_from_variance(self):
        # Brief: Project on us entries not included in variance math
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000,  'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April', 'spend': 10000, 'spendType': 'Project on us', 'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        # April committed $10K, only $5K Project budget counts -> $5K under
        assert result['variance'] == 5000
        assert result['varianceDirection'] == 'under'

    def test_extra_budget_excluded_from_variance(self):
        # Brief: Extra budget entries not included in variance math
        entries = sky_q3_underspend_26k() + [
            {'client': 'SKY', 'month': 'April', 'spend': 5000, 'spendType': 'Project budget', 'ballpark': False},
            {'client': 'SKY', 'month': 'April', 'spend': 8000, 'spendType': 'Extra budget',   'ballpark': False},
        ]
        result = get_rollover('SKY', date(2026, 5, 3), 'June',
                               BUDGET_HISTORY, CLIENTS_FALLBACK, entries)
        assert result['variance'] == 5000
        assert result['varianceDirection'] == 'under'


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


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
