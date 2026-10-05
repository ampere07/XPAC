import React, { useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  ChartData,
  ChartOptions,
  ScriptableContext,
  TooltipItem,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import {
  RefreshCw, ChevronLeft, ChevronRight, Table2, BarChart3, Search, Wallet, Hash, Receipt, Globe,
} from 'lucide-react';
import {
  financeService,
  FinanceBreakdownRow,
  FinancePeriod,
  FinancePeriodMode,
  FinanceSource,
  FinanceSummary,
} from '../services/financeService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import pusher from '../services/pusherService';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

/**
 * One colour per source, used by every mark on the page — the trend's stacked columns, the
 * split bar under each breakdown row, and the keys beside the totals — so "blue" means
 * recorded over the counter and "orange" means paid online wherever it appears. The pair is
 * checked for colour-blind separation and 3:1 contrast against the card surface of each theme
 * (white, gray-900). It is deliberately not the palette accent, which is configurable and
 * unchecked; the accent stays on the controls, as on every other page.
 */
const SOURCE_COLORS: Record<FinanceSource, { light: string; dark: string }> = {
  transactions: { light: '#2a78d6', dark: '#3987e5' },
  portal: { light: '#eb6834', dark: '#d95926' },
};

const SOURCE_LABELS: Record<FinanceSource, string> = {
  transactions: 'Recorded transactions',
  portal: 'Payment portal',
};

const SOURCE_SHORT: Record<FinanceSource, string> = {
  transactions: 'Recorded',
  portal: 'Online',
};

const SOURCES: FinanceSource[] = ['transactions', 'portal'];

const MODES: { value: FinancePeriodMode; label: string }[] = [
  { value: 'range', label: 'Date range' },
  { value: 'month', label: 'Month' },
  { value: 'months', label: 'Multiple months' },
  { value: 'year', label: 'Year' },
  { value: 'years', label: 'Year range' },
];

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Mirrors FinanceSummaryService::MAX_MONTHS and MAX_SPAN_YEARS. */
const MAX_MONTHS = 36;
const MAX_SPAN_YEARS = 20;

const GRANULARITY_LABELS = { day: 'Daily', month: 'Monthly', year: 'Yearly' };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

const peso = (value: number) =>
  `₱${(value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const compactPeso = (value: number) =>
  `₱${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;

const count = (value: number) => (value ?? 0).toLocaleString('en-US');

const plural = (n: number, word: string) => `${count(n)} ${word}${n === 1 ? '' : 's'}`;

const shareOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

const pct = (value: number) => `${value === 0 || value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;

/** Every mode's own inputs, kept side by side so switching modes never loses a selection. */
interface FilterState {
  mode: FinancePeriodMode;
  from: string;
  to: string;
  month: string;
  months: string[];
  year: number;
  yearFrom: number;
  yearTo: number;
}

const initialFilters = (): FilterState => {
  const now = new Date();
  return {
    mode: 'month',
    from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: ymd(now),
    month: ym(now),
    months: [ym(now)],
    year: now.getFullYear(),
    yearFrom: now.getFullYear() - 1,
    yearTo: now.getFullYear(),
  };
};

/** The request the filters describe, or why they do not describe one yet. */
const toPeriod = (f: FilterState): { period: FinancePeriod | null; problem: string | null } => {
  switch (f.mode) {
    case 'range': {
      if (!f.from || !f.to) return { period: null, problem: 'Pick both a start and an end date.' };
      if (f.from > f.to) return { period: null, problem: 'The start date is after the end date.' };
      const [fromYear, ...fromRest] = f.from.split('-');
      if (`${Number(fromYear) + MAX_SPAN_YEARS}-${fromRest.join('-')}` < f.to) {
        return { period: null, problem: `A date range can cover at most ${MAX_SPAN_YEARS} years.` };
      }
      return { period: { mode: 'range', from: f.from, to: f.to }, problem: null };
    }
    case 'month':
      return f.month
        ? { period: { mode: 'month', month: f.month }, problem: null }
        : { period: null, problem: 'Pick a month.' };
    case 'months':
      return f.months.length > 0
        ? { period: { mode: 'months', months: f.months.slice().sort() }, problem: null }
        : { period: null, problem: 'Pick at least one month.' };
    case 'year':
      return { period: { mode: 'year', year: f.year }, problem: null };
    case 'years':
      if (f.yearFrom > f.yearTo) return { period: null, problem: 'The first year is after the last year.' };
      if (f.yearTo - f.yearFrom >= MAX_SPAN_YEARS) {
        return { period: null, problem: `A year range can cover at most ${MAX_SPAN_YEARS} years.` };
      }
      return { period: { mode: 'years', year_from: f.yearFrom, year_to: f.yearTo }, problem: null };
  }
};

/** One-click periods. Each sets a mode and that mode's inputs, so it can be adjusted after. */
const PRESETS: { label: string; apply: (now: Date) => Partial<FilterState> }[] = [
  { label: 'Today', apply: now => ({ mode: 'range', from: ymd(now), to: ymd(now) }) },
  { label: 'Last 7 days', apply: now => ({ mode: 'range', from: ymd(addDays(now, -6)), to: ymd(now) }) },
  { label: 'Last 30 days', apply: now => ({ mode: 'range', from: ymd(addDays(now, -29)), to: ymd(now) }) },
  { label: 'This month', apply: now => ({ mode: 'month', month: ym(now) }) },
  { label: 'Last month', apply: now => ({ mode: 'month', month: ym(new Date(now.getFullYear(), now.getMonth() - 1, 1)) }) },
  { label: 'This year', apply: now => ({ mode: 'year', year: now.getFullYear() }) },
];

const Finance: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const [filters, setFilters] = useState<FilterState>(initialFilters);
  // The year the month grid is showing in "Multiple months"; picks persist across years.
  const [monthsYear, setMonthsYear] = useState<number>(() => new Date().getFullYear());

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [trendView, setTrendView] = useState<'chart' | 'table'>('chart');

  const { period, problem } = useMemo(() => toPeriod(filters), [filters]);
  const periodKey = period ? JSON.stringify(period) : '';

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch(err => console.error('Failed to fetch color palette:', err));
  }, []);

  useEffect(() => {
    const applyTheme = () => setIsDarkMode(localStorage.getItem('theme') !== 'light');
    applyTheme();

    const observer = new MutationObserver(applyTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Every change of filter refetches. A short pause first, so stepping through months or
  // ticking several boxes sends one request; and only the latest request may land, so a slow
  // answer for an old selection can never overwrite the current one.
  useEffect(() => {
    if (!period) {
      // An unfinished selection (no month picked, dates reversed): keep the last figures, but
      // do not leave a superseded request's spinner running.
      setLoading(false);
      return;
    }

    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      financeService
        .summary(period)
        .then(data => {
          if (!current) return;
          setSummary(data);
          setError(null);
        })
        .catch(err => {
          if (!current) return;
          console.error('Error fetching finance summary:', err);
          setError(err?.response?.data?.message || err?.message || 'Failed to load the finance summary.');
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }, 250);

    return () => {
      current = false;
      window.clearTimeout(timer);
    };
    // periodKey stands in for period, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, refreshTick]);

  // An approval, a revert or a settled online payment moves the totals. Batched, because a
  // batch approval fires one event per transaction. Only unbound on the way out, never
  // unsubscribed: the Sidebar's badges listen on the same channels.
  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setRefreshTick(tick => tick + 1), 1500);
    };

    const bound = ([['transactions', 'transaction-updated'], ['payments', 'payment-updated']] as const).map(
      ([channelName, event]) => {
        const channel = pusher.subscribe(channelName);
        channel.bind(event, refresh);
        return { channel, event };
      }
    );

    return () => {
      window.clearTimeout(timer);
      bound.forEach(({ channel, event }) => channel.unbind(event, refresh));
    };
  }, []);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = ym(now);

  const firstYear = Math.min(summary?.meta.first_year ?? currentYear - 5, filters.year, filters.yearFrom, currentYear);
  const yearOptions: number[] = [];
  for (let y = currentYear; y >= firstYear; y--) yearOptions.push(y);

  const update = (patch: Partial<FilterState>) => setFilters(prev => ({ ...prev, ...patch }));

  const applyPreset = (preset: typeof PRESETS[number]) => update(preset.apply(new Date()));

  const presetActive = (preset: typeof PRESETS[number]) =>
    periodKey !== '' && JSON.stringify(toPeriod({ ...filters, ...preset.apply(now) }).period) === periodKey;

  const toggleMonth = (key: string) =>
    setFilters(prev => {
      if (prev.months.includes(key)) return { ...prev, months: prev.months.filter(m => m !== key) };
      if (prev.months.length >= MAX_MONTHS) return prev;
      return { ...prev, months: prev.months.concat(key).sort() };
    });

  const accent = colorPalette?.primary || '#7c3aed';
  const tone = isDarkMode ? 'dark' : 'light';
  const colorFor = (source: FinanceSource) => SOURCE_COLORS[source][tone];
  const surface = isDarkMode ? '#111827' : '#ffffff';

  const totals = summary?.totals;
  const trend = useMemo(() => summary?.trend ?? [], [summary]);
  const firstLoad = loading && !summary;

  const cardClass = `rounded-xl border p-5 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`;
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const strong = isDarkMode ? 'text-white' : 'text-gray-900';
  const controlClass = `px-3 h-[38px] border rounded text-sm focus:outline-none ${
    isDarkMode ? 'bg-gray-800 border-gray-700 text-white [color-scheme:dark]' : 'bg-white border-gray-300 text-gray-900'
  }`;
  const chipClass = (active: boolean) =>
    `px-3 py-1.5 rounded text-sm border transition-colors ${
      active
        ? 'text-white border-transparent'
        : isDarkMode
          ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
          : 'border-gray-300 text-gray-700 hover:bg-gray-100'
    }`;

  // ── Trend chart ──────────────────────────────────────────────────────────

  const trendData = useMemo<ChartData<'bar', number[], string>>(() => ({
    labels: trend.map(bucket => bucket.label),
    datasets: [
      {
        label: SOURCE_LABELS.transactions,
        data: trend.map(bucket => bucket.transactions),
        backgroundColor: SOURCE_COLORS.transactions[tone],
        // Rounded only where this segment is the top of its column; square on the baseline.
        borderRadius: (ctx: ScriptableContext<'bar'>) =>
          (trend[ctx.dataIndex]?.portal ?? 0) > 0 ? 0 : { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
        maxBarThickness: 24,
        stack: 'collected',
      },
      {
        label: SOURCE_LABELS.portal,
        data: trend.map(bucket => bucket.portal),
        backgroundColor: SOURCE_COLORS.portal[tone],
        // A 2px gap in the card's own colour where this segment sits on a recorded one.
        borderColor: surface,
        borderWidth: (ctx: ScriptableContext<'bar'>) => {
          const bucket = trend[ctx.dataIndex];
          return bucket && bucket.portal > 0 && bucket.transactions > 0 ? { top: 0, right: 0, bottom: 2, left: 0 } : 0;
        },
        borderSkipped: false,
        borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
        maxBarThickness: 24,
        stack: 'collected',
      },
    ],
  }), [trend, tone, surface]);

  const trendOptions = useMemo<ChartOptions<'bar'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    // Hovering anywhere in a column's band reads out both sources for that period.
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
        titleColor: isDarkMode ? '#f1f5f9' : '#0f172a',
        bodyColor: isDarkMode ? '#f1f5f9' : '#0f172a',
        footerColor: isDarkMode ? '#cbd5e1' : '#334155',
        borderColor: isDarkMode ? '#334155' : '#e2e8f0',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        boxWidth: 10,
        boxHeight: 10,
        callbacks: {
          label: (item: TooltipItem<'bar'>) => ` ${peso(Number(item.raw) || 0)}  ${item.dataset.label}`,
          labelColor: (item: TooltipItem<'bar'>) => {
            const color = SOURCE_COLORS[item.datasetIndex === 0 ? 'transactions' : 'portal'][tone];
            return { borderColor: color, backgroundColor: color, borderRadius: 2 };
          },
          footer: (items: TooltipItem<'bar'>[]) => {
            const bucket = items.length ? trend[items[0].dataIndex] : undefined;
            return bucket ? `Total ${peso(bucket.amount)} · ${plural(bucket.count, 'payment')}` : '';
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        border: { color: isDarkMode ? '#374151' : '#d1d5db' },
        ticks: {
          color: isDarkMode ? '#9ca3af' : '#6b7280',
          font: { size: 11 },
          maxRotation: 0,
          autoSkip: true,
          autoSkipPadding: 12,
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        border: { display: false },
        grid: { color: isDarkMode ? 'rgba(255, 255, 255, 0.06)' : '#e5e7eb' },
        ticks: {
          color: isDarkMode ? '#9ca3af' : '#6b7280',
          font: { size: 11 },
          maxTicksLimit: 6,
          callback: (value: string | number) => compactPeso(Number(value)),
        },
      },
    },
  }), [isDarkMode, tone, trend]);

  // ── Pieces ───────────────────────────────────────────────────────────────

  const swatch = (source: FinanceSource) => (
    <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: colorFor(source) }} />
  );

  const legend = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${muted}`}>
      {SOURCES.map(source => (
        <span key={source} className="inline-flex items-center gap-1.5">
          {swatch(source)}
          {SOURCE_LABELS[source]}
        </span>
      ))}
    </div>
  );

  const summaryCard = (title: string, value: string, sub: React.ReactNode, icon: React.ReactNode, key?: FinanceSource) => (
    <div className={cardClass}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider inline-flex items-center gap-1.5 ${muted}`}>
          {key && swatch(key)}
          {title}
        </span>
        <span className={muted}>{icon}</span>
      </div>
      <div className={`text-2xl font-bold break-words ${strong}`}>{firstLoad ? '…' : value}</div>
      <div className={`text-xs mt-1 ${muted}`}>{firstLoad ? ' ' : sub}</div>
    </div>
  );

  const sourceAmount = (source: FinanceSource) => totals?.sources[source].amount ?? 0;
  const sourceCount = (source: FinanceSource) => totals?.sources[source].count ?? 0;

  return (
    <div className={`h-full flex flex-col ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div
        className={`px-4 sm:px-6 py-4 border-b flex-shrink-0 flex items-center justify-between gap-4 ${
          isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'
        }`}
      >
        <div className="min-w-0">
          <h1 className={`text-2xl font-bold ${strong}`}>Finance</h1>
          <p className={`text-xs mt-0.5 truncate ${muted}`}>
            Collected payments · {summary?.period.label ?? '…'}
          </p>
        </div>
        <button
          onClick={() => setRefreshTick(tick => tick + 1)}
          disabled={!period || loading}
          className={`px-4 py-2 border rounded text-sm flex items-center gap-2 transition-colors disabled:opacity-50 flex-shrink-0 ${
            isDarkMode ? 'border-gray-700 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
          }`}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{loading ? 'Updating…' : 'Refresh'}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-6">
          {/* Filters: one row above everything they scope. */}
          <div className={`${cardClass} space-y-4`}>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Period type">
              {MODES.map(option => (
                <button
                  key={option.value}
                  onClick={() => update({ mode: option.value })}
                  aria-pressed={filters.mode === option.value}
                  className={chipClass(filters.mode === option.value)}
                  style={filters.mode === option.value ? { backgroundColor: accent } : undefined}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col xl:flex-row xl:items-start gap-4">
              <div className="flex-1 min-w-0">
                {filters.mode === 'range' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={filters.from}
                      max={filters.to || undefined}
                      onChange={e => update({ from: e.target.value })}
                      className={controlClass}
                      aria-label="From date"
                    />
                    <span className={`text-sm ${muted}`}>to</span>
                    <input
                      type="date"
                      value={filters.to}
                      min={filters.from || undefined}
                      onChange={e => update({ to: e.target.value })}
                      className={controlClass}
                      aria-label="To date"
                    />
                  </div>
                )}

                {filters.mode === 'month' && (
                  <input
                    type="month"
                    value={filters.month}
                    max={currentMonth}
                    onChange={e => update({ month: e.target.value })}
                    className={controlClass}
                    aria-label="Month"
                  />
                )}

                {filters.mode === 'months' && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setMonthsYear(y => y - 1)}
                          disabled={monthsYear <= firstYear}
                          className={`p-1.5 rounded disabled:opacity-30 ${isDarkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'}`}
                          aria-label="Previous year"
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span className={`w-12 text-center text-sm font-semibold ${strong}`}>{monthsYear}</span>
                        <button
                          onClick={() => setMonthsYear(y => y + 1)}
                          disabled={monthsYear >= currentYear}
                          className={`p-1.5 rounded disabled:opacity-30 ${isDarkMode ? 'hover:bg-gray-800 text-gray-300' : 'hover:bg-gray-100 text-gray-700'}`}
                          aria-label="Next year"
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      <span className={`text-xs ${muted}`}>
                        {plural(filters.months.length, 'month')} selected
                        {filters.months.length >= MAX_MONTHS ? ` (the most allowed)` : ''}
                      </span>
                      {filters.months.length > 0 && (
                        <button
                          onClick={() => update({ months: [] })}
                          className={`text-xs underline ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-12 gap-1.5 max-w-3xl">
                      {MONTH_NAMES.map((name, index) => {
                        const key = `${monthsYear}-${pad(index + 1)}`;
                        const selected = filters.months.includes(key);
                        const future = key > currentMonth;
                        return (
                          <button
                            key={key}
                            onClick={() => toggleMonth(key)}
                            disabled={future || (!selected && filters.months.length >= MAX_MONTHS)}
                            aria-pressed={selected}
                            className={`${chipClass(selected)} px-0 disabled:opacity-30 disabled:cursor-not-allowed`}
                            style={selected ? { backgroundColor: accent } : undefined}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {filters.mode === 'year' && (
                  <select
                    value={filters.year}
                    onChange={e => update({ year: Number(e.target.value) })}
                    className={controlClass}
                    aria-label="Year"
                  >
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}

                {filters.mode === 'years' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={filters.yearFrom}
                      onChange={e => update({ yearFrom: Number(e.target.value) })}
                      className={controlClass}
                      aria-label="First year"
                    >
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <span className={`text-sm ${muted}`}>to</span>
                    <select
                      value={filters.yearTo}
                      onChange={e => update({ yearTo: Number(e.target.value) })}
                      className={controlClass}
                      aria-label="Last year"
                    >
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                )}

                {problem && <p className="mt-2 text-sm text-red-500">{problem}</p>}
              </div>

              <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
                <span className={`text-xs mr-1 ${muted}`}>Quick:</span>
                {PRESETS.map(preset => {
                  const active = presetActive(preset);
                  return (
                    <button
                      key={preset.label}
                      onClick={() => applyPreset(preset)}
                      aria-pressed={active}
                      className={`${chipClass(active)} py-1 text-xs`}
                      style={active ? { backgroundColor: accent } : undefined}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && (
            <div className="p-4 rounded border border-red-500/40 bg-red-500/10 text-red-500 text-sm flex items-center justify-between gap-4">
              <span>{error}</span>
              <button onClick={() => setRefreshTick(tick => tick + 1)} className="underline flex-shrink-0">
                Retry
              </button>
            </div>
          )}

          {/* Everything below re-renders against the same period. While a new one loads, the
              previous figures stay on screen, dimmed, rather than flashing to empty. */}
          <div className={`space-y-6 transition-opacity ${loading && summary ? 'opacity-60' : ''}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {summaryCard(
                'Total Collected',
                peso(totals?.amount ?? 0),
                <>
                  <span>{plural(totals?.count ?? 0, 'payment')} · {summary?.period.label}</span>
                  {(totals?.amount ?? 0) > 0 && (
                    <span className="mt-2 flex h-1.5 w-full" aria-hidden="true">
                      {SOURCES.filter(source => sourceAmount(source) > 0).map((source, index, shown) => (
                        <span
                          key={source}
                          className={`${index === shown.length - 1 ? 'rounded-r' : ''} ${index > 0 ? 'ml-0.5' : ''}`}
                          style={{ width: `${shareOf(sourceAmount(source), totals!.amount)}%`, backgroundColor: colorFor(source) }}
                        />
                      ))}
                    </span>
                  )}
                </>,
                <Wallet size={18} />
              )}
              {summaryCard(
                'Payments',
                count(totals?.count ?? 0),
                `Average ${peso(totals?.average ?? 0)} per payment`,
                <Hash size={18} />
              )}
              {summaryCard(
                'Recorded Transactions',
                peso(sourceAmount('transactions')),
                `${plural(sourceCount('transactions'), 'payment')} · ${pct(shareOf(sourceAmount('transactions'), totals?.amount ?? 0))} of total`,
                <Receipt size={18} />,
                'transactions'
              )}
              {summaryCard(
                'Payment Portal',
                peso(sourceAmount('portal')),
                `${plural(sourceCount('portal'), 'payment')} · ${pct(shareOf(sourceAmount('portal'), totals?.amount ?? 0))} of total`,
                <Globe size={18} />,
                'portal'
              )}
            </div>

            {/* Trend */}
            <div className={cardClass}>
              <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                  <h2 className={`text-base font-semibold ${strong}`}>Collections over time</h2>
                  <p className={`text-xs mt-0.5 ${muted}`}>
                    {summary ? `${GRANULARITY_LABELS[summary.period.granularity]} · ${summary.period.label}` : '…'}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {legend}
                  <div className={`flex rounded border overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-300'}`}>
                    {([['chart', BarChart3, 'Chart'], ['table', Table2, 'Table']] as const).map(([view, Icon, label]) => (
                      <button
                        key={view}
                        onClick={() => setTrendView(view)}
                        aria-pressed={trendView === view}
                        title={`Show as ${label.toLowerCase()}`}
                        className={`p-1.5 ${
                          trendView === view
                            ? isDarkMode ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-900'
                            : isDarkMode ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        <Icon size={16} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {firstLoad ? (
                <div className={`h-72 flex items-center justify-center text-sm ${muted}`}>Loading collections…</div>
              ) : trendView === 'chart' ? (
                <div className="h-72">
                  <Bar data={trendData} options={trendOptions} />
                </div>
              ) : (
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className={`sticky top-0 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
                      <tr className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                        <th className={`text-left py-2 pr-3 font-medium ${muted}`}>Period</th>
                        {SOURCES.map(source => (
                          <th key={source} className={`text-right py-2 px-3 font-medium ${muted}`}>{SOURCE_LABELS[source]}</th>
                        ))}
                        <th className={`text-right py-2 px-3 font-medium ${muted}`}>Total</th>
                        <th className={`text-right py-2 pl-3 font-medium ${muted}`}>Payments</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {trend.map(bucket => (
                        <tr key={bucket.key} className={`border-b ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                          <td className={`py-2 pr-3 ${strong}`}>{bucket.label}</td>
                          <td className={`py-2 px-3 text-right ${strong}`}>{peso(bucket.transactions)}</td>
                          <td className={`py-2 px-3 text-right ${strong}`}>{peso(bucket.portal)}</td>
                          <td className={`py-2 px-3 text-right font-semibold ${strong}`}>{peso(bucket.amount)}</td>
                          <td className={`py-2 pl-3 text-right ${muted}`}>{count(bucket.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Breakdowns. Each sums to Total Collected; the bar under a row splits its amount
                by source in the same two colours as the chart. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <BreakdownCard
                title="By Payment Method"
                subtitle="Over-the-counter methods and online channels, listed separately"
                nameHeader="Method"
                rows={summary?.by_payment_method}
                total={totals?.amount ?? 0}
                showSource
                {...{ isDarkMode, colorFor, firstLoad }}
              />
              <BreakdownCard
                title="By Processed By"
                subtitle="Staff who recorded the payment; online payments are their own row"
                nameHeader="Processed by"
                rows={summary?.by_processor}
                total={totals?.amount ?? 0}
                showSource
                {...{ isDarkMode, colorFor, firstLoad }}
              />
              <BreakdownCard
                title="By Region"
                subtitle="The paying customer's region"
                nameHeader="Region"
                rows={summary?.by_region}
                total={totals?.amount ?? 0}
                {...{ isDarkMode, colorFor, firstLoad }}
              />
              <BreakdownCard
                title="By City"
                subtitle="The paying customer's city, with its region"
                nameHeader="City"
                rows={summary?.by_city}
                total={totals?.amount ?? 0}
                {...{ isDarkMode, colorFor, firstLoad }}
              />
              <div className="lg:col-span-2">
                <BreakdownCard
                  title="By Barangay"
                  subtitle="The paying customer's barangay, with its city"
                  nameHeader="Barangay"
                  rows={summary?.by_barangay}
                  total={totals?.amount ?? 0}
                  initialLimit={10}
                  {...{ isDarkMode, colorFor, firstLoad }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface BreakdownCardProps {
  title: string;
  subtitle: string;
  nameHeader: string;
  rows: FinanceBreakdownRow[] | undefined;
  total: number;
  isDarkMode: boolean;
  colorFor: (source: FinanceSource) => string;
  firstLoad: boolean;
  /** Tag each row with its source (methods and processors belong to exactly one). */
  showSource?: boolean;
  /** Rows shown before "Show all". */
  initialLimit?: number;
}

/**
 * A ranked breakdown: the table is the chart. Each row carries its share of the total as text
 * and a bar scaled to the largest row, split by source, so nothing depends on hovering.
 */
const BreakdownCard: React.FC<BreakdownCardProps> = ({
  title, subtitle, nameHeader, rows, total, isDarkMode, colorFor, firstLoad, showSource = false, initialLimit = 8,
}) => {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const all = rows ?? [];
  const largest = all.reduce((max, row) => Math.max(max, row.amount), 0);

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? all.filter(row => `${row.label} ${row.detail ?? ''}`.toLowerCase().includes(needle))
    : all;
  const shown = expanded || needle ? matching : matching.slice(0, initialLimit);

  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const strong = isDarkMode ? 'text-white' : 'text-gray-900';
  const th = `py-2 font-medium whitespace-nowrap ${muted}`;

  return (
    <div className={`rounded-xl border p-5 h-full flex flex-col ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className={`text-base font-semibold ${strong}`}>{title}</h2>
          <p className={`text-xs mt-0.5 ${muted}`}>
            {subtitle}
            {all.length > 0 ? ` · ${all.length.toLocaleString('en-US')} ${all.length === 1 ? 'group' : 'groups'}` : ''}
          </p>
        </div>
        {all.length > initialLimit && (
          <div className="relative w-full sm:w-48">
            <Search size={14} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${muted}`} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={`Search ${nameHeader.toLowerCase()}…`}
              aria-label={`Search ${title.toLowerCase()}`}
              className={`w-full pl-8 pr-3 h-8 border rounded text-sm focus:outline-none ${
                isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'
              }`}
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto flex-1">
        {/* On a phone, Payments and Share move under the amount instead of off-screen. */}
        <table className="w-full sm:min-w-[440px] text-sm">
          <thead>
            <tr className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <th className={`${th} text-left pr-3`}>{nameHeader}</th>
              <th className={`${th} text-right px-3`}>Amount</th>
              <th className={`${th} text-right px-3 hidden sm:table-cell`}>Payments</th>
              <th className={`${th} text-right pl-3 hidden sm:table-cell`}>Share</th>
            </tr>
          </thead>
          <tbody>
            {firstLoad ? (
              <tr><td colSpan={4} className={`py-8 text-center ${muted}`}>Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={4} className={`py-8 text-center ${muted}`}>
                  {needle ? 'Nothing matches your search' : 'No payments collected in this period'}
                </td>
              </tr>
            ) : (
              shown.map(row => {
                const parts = (['transactions', 'portal'] as FinanceSource[]).filter(source => (row.by_source?.[source] ?? 0) > 0);
                const barWidth = largest > 0 ? Math.max((row.amount / largest) * 100, row.amount > 0 ? 1 : 0) : 0;
                const split = parts.map(source => `${SOURCE_SHORT[source]} ${peso(row.by_source[source])}`).join(' · ');

                return (
                  <tr key={row.key} className={`border-b align-top ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                    <td className="py-2.5 pr-3 max-w-0 w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`truncate font-medium ${strong}`} title={row.label}>{row.label}</span>
                        {showSource && row.source && (
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 ${
                              isDarkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: colorFor(row.source) }} />
                            {SOURCE_SHORT[row.source]}
                          </span>
                        )}
                      </div>
                      {row.detail && <div className={`text-xs truncate ${muted}`} title={row.detail}>{row.detail}</div>}
                      <div className="mt-1.5 flex h-2" style={{ width: `${barWidth}%` }} title={split} aria-label={split}>
                        {parts.map((source, index) => (
                          <span
                            key={source}
                            className={`h-full ${index === parts.length - 1 ? 'rounded-r' : ''} ${index > 0 ? 'ml-0.5' : ''}`}
                            style={{ width: `${shareOf(row.by_source[source], row.amount)}%`, backgroundColor: colorFor(source) }}
                          />
                        ))}
                      </div>
                    </td>
                    <td className={`py-2.5 pl-3 sm:pr-3 text-right whitespace-nowrap tabular-nums`}>
                      <div className={`font-semibold ${strong}`}>{peso(row.amount)}</div>
                      <div className={`text-xs sm:hidden ${muted}`}>
                        {row.count.toLocaleString('en-US')} · {pct(shareOf(row.amount, total))}
                      </div>
                    </td>
                    <td className={`py-2.5 px-3 text-right whitespace-nowrap tabular-nums hidden sm:table-cell ${muted}`}>{row.count.toLocaleString('en-US')}</td>
                    <td className={`py-2.5 pl-3 text-right whitespace-nowrap tabular-nums hidden sm:table-cell ${muted}`}>{pct(shareOf(row.amount, total))}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {!needle && matching.length > initialLimit && (
        <button
          onClick={() => setExpanded(open => !open)}
          className={`mt-3 self-start text-xs underline ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
        >
          {expanded ? `Show top ${initialLimit}` : `Show all ${matching.length.toLocaleString('en-US')}`}
        </button>
      )}
    </div>
  );
};

export default Finance;
