// src/pages/LiveMonitor.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions
} from 'chart.js';
import {
  Activity,
  BarChart3,
  LineChart,
  PieChart,
  List,
  RefreshCw,
  Settings,
  Save,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  Move,
  LayoutGrid,
  Maximize,
  Minimize,
  Table,
  Plus,
  Minus
} from 'lucide-react';
import { Responsive } from 'react-grid-layout';
// @ts-ignore - Ignore type issues with legacy import if any
import { WidthProvider } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { paymentMethodService, PaymentMethod } from '../services/paymentMethodService';
import apiClient from '../config/api';
import { useOrganizationStore } from '../store/organizationStore';
import TechLiveLocationMap from '../components/TechLiveLocationMap';

import {
  WidgetConfig,
  WidgetData,
  WidgetState,
  WidgetResponse,
  DashboardTemplate,
  WIDGETS,
  CHART_COLORS,
  DEFAULT_VISIBLE_WIDGETS,
  CURRENCY_WIDGETS
} from '../types/monitor.types';

const ResponsiveGridLayout = WidthProvider(Responsive);

// Widgets an "administrator" (non-superadmin) is allowed to see in Live Monitor.
const ADMIN_WIDGET_IDS = ['tech_availability', 'team_detailed_queue', 'agent_detailed_queue', 'tech_live_location'];

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const LiveMonitor: React.FC = () => {
  const [widgets, setWidgets] = useState<Record<string, any>>({});
  const [widgetStates, setWidgetStates] = useState<Record<string, WidgetState>>({});
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [lastUpdate, setLastUpdate] = useState('');
  const [now, setNow] = useState(new Date());
  const [barangays, setBarangays] = useState<string[]>([]);
  const [showWidgetMenu, setShowWidgetMenu] = useState(false);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [templates, setTemplates] = useState<DashboardTemplate[]>([]);
  const [currentTemplateName, setCurrentTemplateName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDraggable, setIsDraggable] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string | number>('All');

  const { organizations, fetchOrganizations } = useOrganizationStore();
  const authData = JSON.parse(localStorage.getItem('authData') || '{}');
  const userOrgId = authData.organization_id;
  const isSuperAdmin = userOrgId === null || userOrgId === undefined;

  // Administrators (role_id 1 / role name "administrator") may access Live Monitor but
  // are limited to a fixed subset of widgets. Superadmins (role_id 7) keep full access.
  // Detected purely by role — org id is not reliably present in authData.
  const roleRaw: any = authData.role;
  const userRoleName = (typeof roleRaw === 'string' ? roleRaw : (roleRaw?.role_name || roleRaw?.name || authData.role_name || '')).toString().toLowerCase();
  const isAdministrator = userRoleName === 'administrator' || String(authData.role_id ?? '') === '1';
  const isWidgetAllowed = (id: string) => !isAdministrator || ADMIN_WIDGET_IDS.includes(id);

  // React Grid Layout state

  const [layouts, setLayouts] = useState<any>({ lg: [] });

  // Widgets are only movable/resizable in Edit Layout mode. We gate this with per-item
  // isDraggable/isResizable flags (which override the grid-level props) rather than
  // `static` — `static` would also disable compaction and leave newly-added widgets
  // (placed with y: Infinity) unpositioned and hidden.
  const displayLayouts = useMemo(() => {
    const out: any = {};
    Object.keys(layouts || {}).forEach((bp) => {
      out[bp] = (layouts[bp] || []).map((item: any) => ({
        ...item,
        isDraggable,
        isResizable: isDraggable,
      }));
    });
    return out;
  }, [layouts, isDraggable]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchOrganizations();
    }
  }, [isSuperAdmin, fetchOrganizations]);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshInterval = useRef<NodeJS.Timeout | null>(null);
  const tickerInterval = useRef<NodeJS.Timeout | null>(null);
  // Use a ref for the polling function to avoid stale closures of states (widgetStates, barangays, etc.)
  // and ensure the interval always calls the latest version of fetchAllWidgets.
  const buildHandleUrl = React.useCallback((params: Record<string, string | number | undefined>) => {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== '') searchParams.append(key, String(val));
    });

    if (selectedOrgId !== 'All') {
      searchParams.append('organization_id', String(selectedOrgId));
    }

    return `/monitor/handle?${searchParams.toString()}`;
  }, [selectedOrgId]);

  const fetchWidget = React.useCallback(async (id: string, state: WidgetState) => {
    const config = WIDGETS[id];
    // Skip hidden widgets entirely — no point fetching data that won't be displayed
    if (!config || !state || !state.visible) return;

    try {
      const widgetState = state || {
        viewType: id === 'tech_availability' ? 'grid' : 'bar',
        scope: 'overall',
        year: new Date().getFullYear().toString(),
        bgy: 'All',
        visible: true
      };

      const url = buildHandleUrl({
        action: config.api,
        param: config.param || '',
        scope: widgetState.scope,
        year: widgetState.year || '',
        bgy: widgetState.bgy || 'All',
        start: widgetState.startDate || '',
        end: widgetState.endDate || '',
        payment_mode: widgetState.paymentMode || '',
        custom_start_time: widgetState.customStartTime || ''
      });

      const response = await apiClient.get(url);
      const data = response.data as WidgetResponse;

      if (data.status === 'success' && data.data) {
        let finalData = data.data;

        // Custom label mapping for Online Status widget
        if (id === 'online_status' && Array.isArray(finalData)) {
          finalData = finalData.map((item: any) => {
            if (item.label === 'Restricted') return { ...item, label: 'Restricted' };
            if (item.label === 'Disconnected') return { ...item, label: 'Disconnected' };
            return item;
          });
        }

        setWidgets(prev => ({ ...prev, [id]: { config, data: finalData } }));

        if (data.barangays && barangays.length === 0) {
          setBarangays(data.barangays.map((b) => b.Name));
        }
      }
    } catch (error) {
      console.error(`Error fetching widget ${id}:`, error);
    }
  }, [barangays, buildHandleUrl]);

  const updateWidgetGrid = (id: string, w: number, h: number) => {
    setLayouts((prev: any) => {
      const nextLayouts = { ...prev };
      Object.keys(nextLayouts).forEach(bp => {
        if (nextLayouts[bp]) {
          nextLayouts[bp] = nextLayouts[bp].map((item: any) => {
            if (item.i === id) {
              return { ...item, w, h };
            }
            return item;
          });
        }
      });
      localStorage.setItem('dashboard_layouts', JSON.stringify(nextLayouts));
      return nextLayouts;
    });
    // Trigger resize to force update
    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  };

  const fetchAllWidgets = React.useCallback(async (states?: Record<string, WidgetState>) => {
    // Check if it's 11:59 PM to do the reset
    const now = new Date();
    const todayStr = now.toDateString();
    const isResetTime = now.getHours() === 23 && now.getMinutes() >= 59;
    const lastResetDate = localStorage.getItem('widget_last_reset_date');
    const storedDay = localStorage.getItem('widget_last_day') || todayStr;

    // We reset either exactly at 11:59 PM, or if the day has changed completely since we last checked
    const shouldReset = (isResetTime && lastResetDate !== todayStr) || (todayStr !== storedDay);

    if (shouldReset) {
      if (isResetTime) localStorage.setItem('widget_last_reset_date', todayStr);
      localStorage.setItem('widget_last_day', todayStr);

      // Auto-reset custom starting time for technician availability
      setWidgetStates(prev => {
        if (prev['tech_availability'] && prev['tech_availability'].customStartTime && prev['tech_availability'].customStartTime !== '08:00') {
          const nextStates = {
            ...prev,
            tech_availability: { ...prev['tech_availability'], customStartTime: '08:00' }
          };
          localStorage.setItem('widget_state_tech_availability', JSON.stringify(nextStates['tech_availability']));
          return nextStates;
        }
        return prev;
      });
    } else {
      localStorage.setItem('widget_last_day', todayStr);
    }

    const timestamp = new Date().toLocaleTimeString();
    setLastUpdate(timestamp);

    const currentStates = states || widgetStates;

    // Only fetch visible widgets — hidden ones are skipped to avoid wasting requests
    const visibleIds = Object.keys(WIDGETS).filter(id => currentStates[id]?.visible);

    // Batch requests in groups of 4 to avoid flooding the server with 20+ simultaneous requests.
    // The 6 heavy yearly widgets (invoice/transactions/portal amount+count) each do a
    // full-year GROUP BY scan, so firing them all at once bogs down the DB connection pool.
    const BATCH_SIZE = 4;
    for (let i = 0; i < visibleIds.length; i += BATCH_SIZE) {
      const batch = visibleIds.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(id => fetchWidget(id, currentStates[id])));
    }
  }, [fetchWidget, widgetStates]);

  // Use a ref for the polling function to avoid stale closures of states (widgetStates, barangays, etc.)
  // and ensure the interval always calls the latest version of fetchAllWidgets.
  const pollingRef = useRef<((states?: Record<string, WidgetState>) => Promise<void>) | undefined>(undefined);

  useEffect(() => {
    pollingRef.current = fetchAllWidgets;
  }, [fetchAllWidgets]);

  useEffect(() => {
    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };
    fetchColorPalette();

    const checkDarkMode = () => {
      const theme = localStorage.getItem('theme');
      setIsDarkMode(theme === 'dark' || theme === null);
    };

    checkDarkMode();

    const observer = new MutationObserver(() => {
      checkDarkMode();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'theme' || !e.key) {
        checkDarkMode();
        // Also update document element class just in case Header didn't do it yet for this window
        const theme = localStorage.getItem('theme');
        if (theme === 'dark' || theme === null) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    const initialStates: Record<string, WidgetState> = {};
    Object.keys(WIDGETS).forEach(id => {
      const savedState = localStorage.getItem(`widget_state_${id}`);
      if (savedState) {
        let state = JSON.parse(savedState);

        // Sanitize view types for widgets that don't allow table/grid anymore
        if (state.viewType === 'table' && !id.includes('detailed_queue')) {
          state.viewType = 'bar';
        }
        if (state.viewType === 'grid' && id !== 'tech_availability') {
          state.viewType = 'bar';
        }

        initialStates[id] = state;
      } else {
        const YEARLY_LINE_WIDGETS = ['invoice_mon_count', 'invoice_mon_amount', 'transactions_mon_count', 'transactions_mon_amount', 'portal_mon_count', 'portal_mon_amount'];
        initialStates[id] = {
          viewType: id === 'tech_availability' ? 'grid' : (id.includes('detailed_queue') ? 'table' : (YEARLY_LINE_WIDGETS.includes(id) ? 'line' : 'bar')),
          scope: 'overall',
          year: new Date().getFullYear().toString(),
          bgy: 'All',
          visible: DEFAULT_VISIBLE_WIDGETS.includes(id),
          fontSize: 12,
          customStartTime: id === 'tech_availability' ? '08:00' : '00:00'
        };
      }
    });

    // Administrators only ever see the allowed widgets — force those visible and
    // hide everything else regardless of any saved/default state.
    if (isAdministrator) {
      Object.keys(initialStates).forEach(id => {
        initialStates[id].visible = ADMIN_WIDGET_IDS.includes(id);
      });
    }

    // Initialize layout from saved state or default
    const savedLayouts = localStorage.getItem('dashboard_layouts');
    let initialLayouts: any = { lg: [] };

    if (savedLayouts) {
      initialLayouts = JSON.parse(savedLayouts);
    } else {
      // Create default layout - ONLY for visible widgets to ensure they file left-to-right
      const visibleIds = Object.keys(WIDGETS).filter(id => DEFAULT_VISIBLE_WIDGETS.includes(id));
      const defaultLayout = visibleIds.map((id, i) => {
        const config = WIDGETS[id];
        return {
          i: id,
          x: (i * 4) % 12,
          y: Math.floor(i / 3) * (config.h || 6),
          w: config.w || 4,
          h: config.h || 6,
          minW: 2,
          minH: 3
        };
      });
      initialLayouts = { lg: defaultLayout, md: defaultLayout, sm: defaultLayout, xs: defaultLayout, xxs: defaultLayout };
    }

    // Ensure all visible widgets are in the layout (fixes resizing issue on font change if missing)
    Object.keys(initialStates).forEach(id => {
      if (initialStates[id].visible) {
        const config = WIDGETS[id];
        // Check if present in layouts
        Object.keys(initialLayouts).forEach((bp) => {
          const layout = (initialLayouts as any)[bp];
          if (Array.isArray(layout) && !layout.find((item: any) => item.i === id)) {
            // Add missing widget
            (initialLayouts as any)[bp] = [
              ...layout,
              {
                i: id,
                x: 0,
                y: Infinity,
                w: config.w || 4,
                h: config.h || 6,
                minW: 2,
                minH: 3
              }
            ];
          }
        });
      }
    });

    setLayouts(initialLayouts);

    setWidgetStates(initialStates);

    // First loads
    fetchAllWidgets(initialStates);
    loadTemplates();

    const interval = setInterval(() => {
      if (pollingRef.current) pollingRef.current();
    }, 15000);
    refreshInterval.current = interval;

    const ticker = setInterval(() => {
      setNow(new Date());
    }, 1000);
    tickerInterval.current = ticker;

    const fetchPaymentMethods = async () => {
      try {
        const res = await paymentMethodService.getAll();
        if (res.success && Array.isArray(res.data)) {
          setPaymentMethods(res.data);
        }
      } catch (err) {
        console.error('Failed to fetch payment methods:', err);
      }
    };
    fetchPaymentMethods();

    return () => {
      if (refreshInterval.current) clearInterval(refreshInterval.current);
      if (tickerInterval.current) clearInterval(tickerInterval.current);
      observer.disconnect();
      window.removeEventListener('storage', handleStorageChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateWidgetState = (id: string, updates: Partial<WidgetState>) => {
    setWidgetStates(prev => {
      const updatedState = { ...prev[id], ...updates };
      const newState = { ...prev, [id]: updatedState };
      localStorage.setItem(`widget_state_${id}`, JSON.stringify(updatedState));

      // Fetch the specific widget immediately with the updated state
      if (updatedState.visible) {
        fetchWidget(id, updatedState);
      }

      return newState;
    });
  };

  const ensureWidgetInLayout = (widgetId: string) => {
    const config = WIDGETS[widgetId];
    if (!config) return;

    setLayouts((prevLayouts: any) => {
      const newLayouts = { ...(prevLayouts || {}) };
      const breakpoints = ['lg', 'md', 'sm', 'xs', 'xxs'];
      const columnCounts = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

      let updated = false;

      breakpoints.forEach(bp => {
        if (!newLayouts[bp]) {
          newLayouts[bp] = [];
          updated = true;
        }

        const currentLayout = newLayouts[bp];
        if (Array.isArray(currentLayout) && !currentLayout.find((item: any) => item.i === widgetId)) {
          const cols = (columnCounts as any)[bp];
          const w = Math.min(config.w || 4, cols);
          const h = config.h || 6;

          // Sequence horizontally left to right
          const newX = (currentLayout.length * w) % cols;
          const newY = Math.floor((currentLayout.length * w) / cols) * h;

          newLayouts[bp] = [
            ...currentLayout,
            {
              i: widgetId,
              x: newX,
              y: newY,
              w: w,
              h: h,
              minW: 2,
              minH: 3
            }
          ];
          updated = true;
        }
      });

      if (updated) {
        localStorage.setItem('dashboard_layouts', JSON.stringify(newLayouts));
        return newLayouts;
      }
      return prevLayouts;
    });
  };

  const handleAdminTimeOut = async (techId: number) => {
    if (!window.confirm('Are you sure you want to manually time out this technician?')) return;

    try {
      const response = await apiClient.post('/tech-in-out/time-out', { tech_id: techId });

      const data = response.data as any;
      if (data.success) {
        fetchAllWidgets();
      } else {
        alert(data.message || 'Failed to time out technician');
      }
    } catch (error) {
      console.error('Error timing out technician:', error);
      alert('An error occurred while trying to time out the technician');
    }
  };

  const toggleWidgetVisibility = (id: string) => {
    // Administrators can only toggle their allowed widgets.
    if (!isWidgetAllowed(id)) return;
    setWidgetStates(prev => {
      const isVisible = !prev[id]?.visible;
      const nextStates = {
        ...prev,
        [id]: { ...prev[id], visible: isVisible }
      };

      // Recalculate layout for all visible widgets to ensure 3-column flow
      const visibleIds = Object.keys(WIDGETS).filter(wid => nextStates[wid]?.visible);
      const breakpoints = ['lg', 'md', 'sm', 'xs', 'xxs'];
      const columnCounts = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };

      const newLayouts: any = {};
      breakpoints.forEach(bp => {
        const cols = (columnCounts as any)[bp];
        newLayouts[bp] = visibleIds.map((vid, idx) => {
          const config = WIDGETS[vid];
          const w = Math.min(config.w || 4, cols);
          const h = config.h || 6;
          const itemsPerRow = Math.max(1, Math.floor(cols / w));

          return {
            i: vid,
            x: (idx % itemsPerRow) * w,
            y: Math.floor(idx / itemsPerRow) * h,
            w,
            h,
            minW: 2,
            minH: 3
          };
        });
      });

      setLayouts(newLayouts);
      localStorage.setItem('dashboard_layouts', JSON.stringify(newLayouts));
      localStorage.setItem(`widget_state_${id}`, JSON.stringify(nextStates[id]));

      // Force a re-layout/resize
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
        fetchAllWidgets(nextStates);
      }, 150);

      return nextStates;
    });
  };

  const generateChartData = (widgetData: WidgetData[], widgetId: string, viewType: string) => {
    if (!widgetData || widgetData.length === 0) return null;

    let data = widgetData;
    // Filter out non-month labels when in months mode for Payment Methods
    if (widgetId === 'pay_method_mon' && widgetStates[widgetId]?.paymentMode === 'months') {
      // Keep only numeric month labels from 1..12
      const monthOnly = widgetData.filter(d => {
        const m = parseInt(d.label);
        return !isNaN(m) && m >= 1 && m <= 12;
      });

      // Build a month -> value map (sum if duplicates)
      const monthMap = new Map<number, number>();
      monthOnly.forEach(d => {
        const m = parseInt(d.label);
        const v = Number(d.value || 0);
        monthMap.set(m, (monthMap.get(m) || 0) + v);
      });

      // Pad to full Jan..Dec with zeros and ensure correct order
      data = Array.from({ length: 12 }, (_, i) => {
        const monthIndex = i + 1; // 1..12
        return { label: String(monthIndex), value: monthMap.get(monthIndex) || 0 } as WidgetData;
      });
    }

    const isMonthly = (widgetId.includes('_mon') || widgetId.startsWith('invoice_') || widgetId.startsWith('transactions_') || widgetId.startsWith('portal_')) &&
      !(widgetId === 'pay_method_mon' && widgetStates[widgetId]?.paymentMode === 'type');

    const formatLabel = (label: string) => {
      const monthNum = parseInt(label);
      if (widgetId === 'pay_method_mon' && widgetStates[widgetId]?.paymentMode === 'type') {
        const match = paymentMethods.find(pm => String(pm.id) === label);
        return match ? match.payment_method : label;
      }
      if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
        return MONTH_NAMES[monthNum - 1];
      }
      return label;
    };

    const labels = data.map(d => formatLabel(d.label));

    // Handle multi-series data (e.g., Invoice Yearly Count with Paid/Unpaid statuses per month)
    if (data[0].series) {
      const seriesKeys = Array.from(new Set(data.flatMap(d => Object.keys(d.series || {}))));
      const isLine = viewType === 'line';

      return {
        labels,
        datasets: seriesKeys.map((key, idx) => {
          const color = CHART_COLORS[idx % CHART_COLORS.length];
          return {
            label: key,
            data: data.map(d => Number(d.series?.[key] || 0)),
            backgroundColor: isLine ? color + '33' : color, // transparent fill for line
            borderColor: isLine ? color : undefined,
            borderWidth: isLine ? 2 : 0,
            tension: isLine ? 0.3 : undefined,
            pointRadius: isLine ? 4 : undefined,
            pointHoverRadius: isLine ? 6 : undefined,
            fill: false,
          };
        })
      };
    }

    // Handle simple data (single value per label)
    if (viewType === 'bar') {
      // For monthly/timeline widgets, we prefer a single dataset with colored bars or primary color
      // rather than 12 legend items.
      if (isMonthly) {
        return {
          labels,
          datasets: [{
            label: WIDGETS[widgetId]?.title || 'Value',
            data: data.map(d => Number(d.value || 0)),
            backgroundColor: CHART_COLORS[0],
            borderWidth: 0
          }]
        };
      }

      // Default bar chart: each item gets its own legend entry
      return {
        labels,
        datasets: data.map((d, idx) => {
          const dataArr = new Array(data.length).fill(null);
          dataArr[idx] = Number(d.value || 0);
          return {
            label: d.label,
            data: dataArr,
            backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
            borderWidth: 0
          };
        })
      };
    }

    return {
      labels,
      datasets: [{
        label: WIDGETS[widgetId]?.title || 'Count',
        data: data.map(d => Number(d.value || 0)),
        backgroundColor: viewType === 'line' ? CHART_COLORS[0] : data.map((_, idx) => CHART_COLORS[idx % CHART_COLORS.length]),
        borderColor: CHART_COLORS[0],
        borderWidth: viewType === 'line' ? 2 : 0,
        tension: 0.3
      }]
    };
  };

  const getChartOptions = (type: string, fontSize: number): ChartOptions<any> => {
    const baseOptions: ChartOptions<any> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: isDarkMode ? '#999' : '#333',
            boxWidth: 12,
            font: { size: fontSize }
          }
        },
        tooltip: {
          titleFont: { size: fontSize },
          bodyFont: { size: fontSize },
          footerFont: { size: fontSize },
          callbacks: {
            label: function (context: any) {
              let label = context.dataset.label || '';
              if (label) label += ': ';

              const raw = context.parsed?.y ?? context.raw;
              const val = Number(raw ?? 0);

              // detect currency widgets by container id (we set id on wrapper)
              const widgetId = context.chart.canvas?.parentElement?.id;
              if (widgetId && CURRENCY_WIDGETS.includes(widgetId)) {
                label += '₱' + val.toLocaleString('en-PH', { minimumFractionDigits: 2 });
              } else {
                label += val.toLocaleString();
              }
              return label;
            }
          }
        }
      }
    };

    if (type !== 'pie' && type !== 'doughnut') {
      baseOptions.scales = {
        x: {
          stacked: false,
          ticks: { color: isDarkMode ? '#999' : '#333', font: { size: fontSize } },
          grid: { color: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }
        },
        y: {
          stacked: false,
          grace: '10%',
          ticks: { color: isDarkMode ? '#999' : '#333', font: { size: fontSize } },
          grid: { color: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }
        }
      };
    }

    return baseOptions;
  };

  const renderChart = (id: string, chartData: any, viewType: string, fontSize: number) => {
    const options = getChartOptions(viewType, fontSize);

    // Custom plugin to show values on top of bars
    const dataLabelPlugin = {
      id: 'dataLabelPlugin',
      afterDatasetsDraw: (chart: any) => {
        const { ctx, data } = chart;
        ctx.save();

        // Process each bar group (x-axis index) separately
        for (let labelIdx = 0; labelIdx < data.labels.length; labelIdx++) {
          const labelsAtThisIndex: { x: number, y: number, text: string }[] = [];

          // 1. Collect all labels and their target positions for this x-axis index
          data.datasets.forEach((dataset: any, dsIdx: number) => {
            const meta = chart.getDatasetMeta(dsIdx);
            if (meta.hidden) return;

            const bar = meta.data[labelIdx];
            if (!bar) return;

            const rawValue = dataset.data[labelIdx];
            const value = Number(rawValue || 0);
            if (value === 0) return; // Skip zeros to avoid clutter

            let text = '';
            if (CURRENCY_WIDGETS.includes(id)) {
              text = '₱' + value.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
            } else {
              text = value.toLocaleString();
            }

            const { x, y } = bar.tooltipPosition();
            labelsAtThisIndex.push({ x, y, text });
          });

          // 2. Sort labels by Y coordinate (bottom to top, so largest Y first in Chart.js)
          labelsAtThisIndex.sort((a, b) => b.y - a.y);

          // 3. Draw labels with collision avoidance
          const labelFontSize = Math.max(8, fontSize - 2);
          const minGap = labelFontSize + 2;
          let lastY = 99999;
          let lastX = -99999;

          labelsAtThisIndex.forEach((item) => {
            let targetY = item.y - 4;

            // Only shift label up if it would overlap with a previous label in the SAME vertical column
            // (Vertical collision avoidance for stacked bars)
            if (Math.abs(lastX - item.x) < 10 && lastY - targetY < minGap) {
              targetY = lastY - minGap;
            }

            ctx.fillStyle = isDarkMode ? '#e5e7eb' : '#374151';
            ctx.font = `600 ${labelFontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(item.text, item.x, targetY);

            lastY = targetY;
            lastX = item.x;
          });
        }
        ctx.restore();
      }
    };

    switch (viewType) {
      case 'line':
        return <Line data={chartData} options={options} />;
      case 'pie':
        return <Pie data={chartData} options={options} />;
      case 'doughnut':
        return <Doughnut data={chartData} options={options} />;
      case 'bar':
      default:
        return <Bar data={chartData} options={options} plugins={[dataLabelPlugin]} />;
    }
  };

  const renderListView = (widgetData: WidgetData[], widgetId: string, fontSize: number) => {
    const isCurrency = CURRENCY_WIDGETS.includes(widgetId);

    if (widgetData[0]?.series) {
      return (
        <div className="space-y-2 overflow-y-auto flex-1 custom-scrollbar">
          {widgetData.map((row, idx) => (
            <div
              key={idx}
              className={`rounded-lg border p-3 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
              style={{ fontSize: `${fontSize}px` }}
            >
              <div
                className={`font-semibold mb-2 border-b pb-2 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}
                style={{ fontSize: `${fontSize * 1.1}px` }}
              >
                {row.label}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(row.series || {}).map(([key, value]) => (
                  <div key={key} className={`text-center p-2 rounded ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}>
                    <div className="opacity-70" style={{ fontSize: `${fontSize * 0.8}px` }}>{key}</div>
                    <div className="font-bold" style={{ fontSize: `${fontSize}px`, color: colorPalette?.primary || '#7c3aed' }}>
                      {isCurrency
                        ? `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                        : Number(value).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-2 overflow-y-auto flex-1 custom-scrollbar" style={{ fontSize: `${fontSize}px` }}>
        {widgetData.map((row, idx) => (
          <div
            key={idx}
            className={`rounded-lg border p-3 text-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
          >
            <div className="opacity-70 truncate" title={row.label} style={{ fontSize: `${fontSize * 0.8}px` }}>
              {row.label}
            </div>
            <div className="font-bold" style={{ fontSize: `${fontSize * 1.5}px`, color: colorPalette?.primary || '#7c3aed' }}>
              {isCurrency
                ? `₱${Number(row.value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                : Number(row.value || 0).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const formatDuration = (startTime: string | null, endTime?: string | null) => {
    if (!startTime || startTime === '-') return '--';
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : now.getTime();
    const diff = Math.max(0, end - start);

    const s = Math.floor(diff / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);

    if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  };



  const renderGridView = (widgetData: WidgetData[], widgetId: string, fontSize: number) => {
    const state = widgetStates[widgetId];
    const cols = state?.gridCols || 4;
    const rows = state?.gridRows;

    return (
      <div 
        className="grid gap-4 overflow-y-auto p-2 pb-4 flex-1 custom-scrollbar"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: rows ? `repeat(${rows}, 1fr)` : 'auto'
        }}
      >
        {widgetData.map((row, idx) => {
          const meta: any = (row as any).meta || {};
          const status = meta.status || 'Unknown';
          const isAvailable = status === 'Available';
          const isOffline = status === 'Offline';

          const bgColor = isAvailable
            ? (isDarkMode ? 'bg-gradient-to-br from-green-500/20 to-green-600/5 border-green-500/40 shadow-[0_8px_30px_rgb(0,0,0,0.12)]' : 'bg-gradient-to-br from-green-50 to-green-100 border-green-200 shadow-md')
            : isOffline
              ? (isDarkMode ? 'bg-gradient-to-br from-gray-500/20 to-gray-600/5 border-gray-500/40 shadow-[0_8px_30px_rgb(0,0,0,0.12)]' : 'bg-gradient-to-br from-gray-50 to-gray-100 border-gray-200 shadow-md')
              : (isDarkMode ? 'bg-gradient-to-br from-orange-500/20 to-orange-600/5 border-orange-500/40 shadow-[0_8px_30px_rgb(0,0,0,0.12)]' : 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 shadow-md');

          const textColor = isAvailable
            ? (isDarkMode ? 'text-green-400' : 'text-green-700')
            : isOffline
              ? (isDarkMode ? 'text-gray-400' : 'text-gray-700')
              : (isDarkMode ? 'text-orange-400' : 'text-orange-700');

          const badgeBg = isAvailable
            ? 'bg-green-500 text-white'
            : isOffline
              ? 'bg-gray-500 text-white'
              : 'bg-orange-500 text-white';

          let timeString = formatDuration(meta.since, meta.time_out || meta.end_time);
          return (
            <div
              key={idx}
              className={`rounded-2xl border p-4 flex flex-col justify-between items-center relative transition-all hover:scale-[1.02] ${bgColor}`}
              style={{
                fontSize: `${fontSize}px`,
                minHeight: `${fontSize * 24}px`,
                width: '100%'
              }}
            >
              {/* Status - Top Left */}
              <div className={`absolute top-4 left-4 font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm ${badgeBg}`} style={{ fontSize: `${fontSize * 0.7}px` }}>
                {status}
              </div>

              {/* Admin Actions - Top Right */}
              <div className="absolute top-4 right-4 flex items-center">
                {meta.time_in && !meta.time_out ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAdminTimeOut(meta.tech_id); }}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-3 rounded-md shadow-md transition-all hover:scale-105 uppercase tracking-wider"
                    style={{ fontSize: `${fontSize * 0.65}px` }}
                  >
                    Time Out
                  </button>
                ) : (!meta.time_in && !meta.time_out) ? (
                  <div
                    className={`italic opacity-80 font-bold uppercase tracking-tight`}
                    style={{ fontSize: `${fontSize * 0.6}px` }}
                  >
                    no time in/out
                  </div>
                ) : null}
              </div>

              {/* Name - Top Center (slightly pushed down to not overlap with status if name is long) */}
              <div className="w-full text-center mt-6">
                <div className={`font-bold truncate px-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={{ fontSize: `${fontSize * 1.9}px` }} title={row.label}>
                  {row.label}
                </div>
              </div>

              {/* Details - Moved */}
              {meta.details && (
                <div className="w-full flex justify-center mt-2">
                  <div
                    className={`px-3 py-1 rounded-full font-bold uppercase tracking-wide text-center truncate max-w-[90%] ${meta.is_pullout
                        ? 'bg-red-600/20 text-red-500 border border-red-500/30'
                        : meta.details.toLowerCase().includes('job order')
                          ? 'bg-blue-600/20 text-blue-500 border border-blue-500/30'
                          : meta.details.toLowerCase().includes('service order')
                            ? 'bg-purple-600/20 text-purple-500 border border-purple-500/30'
                            : 'opacity-60 ' + (isDarkMode ? 'text-gray-400' : 'text-gray-600')
                      }`}
                    style={{ fontSize: `${fontSize * 0.75}px` }}
                    title={meta.details}
                  >
                    {meta.details}
                  </div>
                </div>
              )}

              {/* Time - Center Large (Working Time / Accumulated Availability) */}
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className={`font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-800'}`} style={{ fontSize: `${fontSize * 3}px` }}>
                  {meta.primary_time_str || timeString}
                </div>
                
                <div className="flex flex-col items-center mt-1 space-y-0.5">
                  {/* Sub-totals display */}
                  <div className="flex flex-col items-center">
                    {meta.total_working_str && (
                      <div className={`font-semibold ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} style={{ fontSize: `${fontSize * 0.9}px` }}>
                        Daily Working: {meta.total_working_str}
                      </div>
                    )}
                    {meta.total_available_str && (
                      <div className={`font-semibold ${isDarkMode ? 'text-green-400' : 'text-green-600'}`} style={{ fontSize: `${fontSize * 0.9}px` }}>
                        Daily Available: {meta.total_available_str}
                      </div>
                    )}
                    {meta.technicians && meta.technicians.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-current/10 w-full">
                        <div className="opacity-60 font-bold uppercase tracking-tighter mb-1" style={{ fontSize: `${fontSize * 0.7}px` }}>Technicians</div>
                        <div className="flex flex-wrap justify-center gap-1">
                          {meta.technicians.map((t: string, i: number) => (
                            <span key={i} className={`px-2 py-0.5 rounded font-bold ${isDarkMode ? 'bg-white/10 text-white' : 'bg-black/5 text-black'}`} style={{ fontSize: `${fontSize * 0.7}px` }}>
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Current State Duration Info */}
                  {meta.since && (
                    <div className={`opacity-60 mt-1 border-t pt-1 ${isDarkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'}`} style={{ fontSize: `${fontSize * 0.7}px` }}>
                      {isAvailable ? 'Currently available: ' : isOffline ? 'Offline since: ' : 'Job started: '} <span className="font-bold">{timeString}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // The "Type" column carries a job order's fixed "Installation (Joborder)" or a
  // service order's concern with " (Service Order)" appended. Both halves matter
  // — the concern is what an operator wants to filter by, the suffix is what
  // separates a job order from a service order — so the option value stays the
  // whole string and only the label is shortened.
  const TYPE_SUFFIX = /\s*\((joborder|job order|service order|work order)\)\s*$/i;

  // Concerns are free text and reach the queue in whatever case they were typed
  // — "For Pullout" and "for pullout" are the same concern and were listing as
  // two separate options, splitting the rows between them. Options are keyed on
  // the lower-cased type so those fold into one, and the filter compares the
  // same way.
  // Has this row been started again since it last stopped?
  //
  // Reaching the queue with BOTH timestamps set normally means one run that
  // finished. It means the opposite when the start is the later of the two: the
  // recorded end belongs to an earlier attempt and a new run is underway. That
  // is what a rescheduled visit looks like when a technician picks it back up
  // without the stored status ever leaving "Reschedule".
  //
  // Compared on the ISO fields the widget sends alongside the display strings,
  // never on the formatted "Mmm d, yyyy h:mm AM" text. A row without them (an
  // older payload) simply is not treated as restarted.
  const isRestarted = (row: any) => {
    const started = Date.parse(row?.start_time ?? '');
    const ended = Date.parse(row?.end_time ?? '');
    return Number.isFinite(started) && Number.isFinite(ended) && started > ended;
  };

  // Statuses that mean the work is over, whatever the timestamps say. A row that
  // reached one of these is never running, so it never reads "On Going" and its
  // timer never ticks — a Failed visit whose times happen to look restarted must
  // not come back to life.
  const FINISHED_STATUSES = ['done', 'resolved', 'completed', 'failed', 'cancelled', 'canceled'];

  const isFinishedStatus = (status: any) =>
    FINISHED_STATUSES.includes(String(status ?? '').trim().toLowerCase());

  const typeFilterKey = (type: string) => type.trim().toLowerCase();

  const typeFilterGroups = (data: any, selected?: string) => {
    // key -> every spelling seen, with how often
    const variants = new Map<string, Map<string, number>>();

    const note = (raw: string) => {
      const type = raw.trim();
      if (!type) return;
      const key = typeFilterKey(type);
      const seen = variants.get(key) ?? new Map<string, number>();
      seen.set(type, (seen.get(type) ?? 0) + 1);
      variants.set(key, seen);
    };

    (Array.isArray(data) ? data : []).forEach((row: any) => {
      if (typeof row?.type === 'string') note(row.type);
    });

    // A selection whose rows have all finished still belongs in the list, or the
    // dropdown would silently snap back to "All Types" on the next poll.
    if (selected && selected !== 'all') note(selected);

    const jobOrders: { key: string; label: string }[] = [];
    const services: { key: string; label: string }[] = [];
    const others: { key: string; label: string }[] = [];

    Array.from(variants.entries()).forEach(([key, seen]) => {
      // Show the spelling someone actually capitalised, and among equals the one
      // used most — never "for pullout" when "For Pullout" is also on the board.
      const label = Array.from(seen.entries()).sort((a, b) => {
        const cased = Number(/[A-Z]/.test(b[0])) - Number(/[A-Z]/.test(a[0]));
        return cased !== 0 ? cased : b[1] - a[1];
      })[0][0];

      const entry = { key, label };

      if (key.includes('(joborder)') || key.includes('(job order)')) jobOrders.push(entry);
      else if (key.includes('(service order)')) services.push(entry);
      else others.push(entry);
    });

    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

    return {
      jobOrders: jobOrders.sort(byLabel),
      services: services.sort(byLabel),
      others: others.sort(byLabel),
    };
  };

  const typeFilterLabel = (type: string) => type.replace(TYPE_SUFFIX, '').trim() || type;

  const applyTypeFilter = (data: any, selected?: string) => {
    if (!Array.isArray(data) || !selected || selected === 'all') return data;
    return data.filter((row: any) =>
      typeof row?.type === 'string' && typeFilterKey(row.type) === selected
    );
  };

  const renderTable = (data: any[], id: string, fontSize: number) => {
    if (!Array.isArray(data) || data.length === 0) {
      return (
        <div className={`text-center py-8 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          No Data Available
        </div>
      );
    }

    const isTeamQueue = id === 'team_detailed_queue';

    return (
      <div className="overflow-x-auto">
        <table className={`min-w-full text-left ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`} style={{ fontSize: `${fontSize}px` }}>
          <thead className={`font-semibold border-b ${isDarkMode ? 'border-gray-800 text-gray-400' : 'border-gray-200 text-gray-500'}`}>
            <tr>
              <th className="py-2 px-3">{id === 'agent_detailed_queue' ? 'Agent Name' : 'Team Name'}</th>
              <th className="py-2 px-3">Type</th>
              <th className="py-2 px-3">Customer</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3">Start Time</th>
              {isTeamQueue && <th className="py-2 px-3">End Time</th>}
              {isTeamQueue && <th className="py-2 px-3">Duration</th>}
            </tr>
          </thead>
          <tbody className="">
            {data.map((row, idx) => {
              const isDuplicate = idx > 0 && data[idx - 1].team_name === row.team_name;
              const borderClass = (!isDuplicate && idx > 0) ? (isDarkMode ? 'border-t border-gray-700/50' : 'border-t border-gray-200') : '';
              const hasEnd = !!row.end;
              // A restarted row's stored end belongs to the attempt before this
              // one, so the timer runs from the new start rather than freezing at
              // an end that has already been superseded.
              // Open-ended: still running. A restarted row's stored end belongs to
              // the attempt before this one, so it is not an end at all — the
              // timer runs from the new start, and the End Time column shows "-"
              // rather than a time that precedes the start beside it.
              const openEnded = !isFinishedStatus(row.status) && (!hasEnd || isRestarted(row));
              const duration = isTeamQueue ? formatDuration(row.start, openEnded ? null : row.end) : null;

              return (
                <tr key={idx} className={`${isDarkMode ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'} ${borderClass}`}>
                  <td className="py-2 px-3 font-medium">
                    {!isDuplicate ? (
                      <div>
                        <div className={isDarkMode ? 'text-white' : 'text-gray-900'}>{row.team_name}</div>
                        {row.technicians && Array.isArray(row.technicians) && row.technicians.length > 0 && (
                          <div className="flex flex-col mt-1">
                            {row.technicians.map((tech: string, tIdx: number) => (
                              <div key={tIdx} className={`font-bold uppercase tracking-tight leading-tight ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                {tech}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : ""}
                  </td>
                  <td className="py-2 px-3">
                    <span className={`uppercase tracking-wide font-bold ${row.type?.toLowerCase().includes('(joborder)')
                      ? 'text-blue-500'
                      : row.type?.toLowerCase().includes('(work order)')
                        ? 'text-orange-500'
                        : 'text-purple-500'
                      }`}>
                      {row.type}
                    </span>
                  </td>
                  <td className="py-2 px-3">{row.customer}</td>
                  <td className="py-2 px-3">
                    {(() => {
                      const s = row.status?.toLowerCase() ?? '';

                      // "On Going" means the work is running right now, which the
                      // timestamps say and the stored status does not.
                      //
                      // A rescheduled visit that a technician starts again gets a
                      // fresh start_time and its end_time cleared, but its stored
                      // status stays "Reschedule" — so the board kept showing
                      // RESCHEDULE for a job actively being worked. Reading the
                      // clock instead fixes that, and keeps a reschedule that was
                      // NOT restarted (it carries an end_time) reading RESCHEDULE.
                      //
                      // Same rule the Duration column beside it already uses, so
                      // the two can no longer disagree.
                      const hasStarted = !!row.start && row.start !== '-';
                      const isOngoing = hasStarted && openEnded;
                      const label = isOngoing ? 'On Going' : (row.status || '-');
                      // Ongoing is checked first: the label already reads "On
                      // Going", and leaving the stored status to pick the colour
                      // painted a restarted reschedule purple under a blue label.
                      const color = isOngoing
                        ? 'text-blue-400'
                        : s === 'reschedule'
                          ? 'text-purple-500'
                          : s === 'done' || s === 'resolved' || s === 'completed'
                            ? 'text-green-500'
                            : s === 'failed'
                              ? 'text-red-500'
                              : 'text-orange-500';
                      return (
                        <span className={`font-bold uppercase ${color}`}>
                          {isOngoing && <span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1.5 animate-pulse" />}
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">{row.start || '-'}</td>
                  {isTeamQueue && (
                    <td className="py-2 px-3 whitespace-nowrap">{openEnded ? '-' : (row.end || '-')}</td>
                  )}
                  {isTeamQueue && (
                    <td className="py-2 px-3 whitespace-nowrap font-mono font-bold">
                      {row.start && row.start !== '-' ? (
                        <span className={!openEnded
                          ? (isDarkMode ? 'text-gray-400' : 'text-gray-500')
                          : 'text-green-500'
                        }>
                          {openEnded && (
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1.5 animate-pulse" />
                          )}
                          {duration}
                        </span>
                      ) : '-'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderWidget = (id: string) => {
    const widget = widgets[id];
    const state = widgetStates[id];

    if (!widget || !state) {
      return (
        <div className={`text-center py-8 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          <RefreshCw className="animate-spin mx-auto mb-2" size={20} />
          Loading...
        </div>
      );
    }

    // Technician Live Location — interactive Leaflet map (renders even with zero technicians)
    if (id === 'tech_live_location') {
      return (
        <TechLiveLocationMap
          data={Array.isArray(widget.data) ? (widget.data as any) : []}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
        />
      );
    }

    // Default font size if not set
    const fontSize = state.fontSize || 12;

    const hasData = widget.data && (Array.isArray(widget.data) ? widget.data.length > 0 : true);

    if (!hasData) {
      return (
        <div className={`text-center py-8 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {widget.data ? 'No Data Available' : 'Loading...'}
        </div>
      );
    }

    // Handler for table view - only for detailed queues
    if (state.viewType === 'table' && (id === 'team_detailed_queue' || id === 'agent_detailed_queue')) {
      return (
        <div className="h-full overflow-y-auto custom-scrollbar">
          {renderTable(applyTypeFilter(widget.data, state.typeFilter), id, fontSize)}
        </div>
      );
    }

    // Grid view - only for tech availability
    if (state.viewType === 'grid' && id === 'tech_availability') return renderGridView(widget.data, id, fontSize);

    // Default list view fallback for tech availability if not grid
    if (id === 'tech_availability') return renderListView(widget.data, id, fontSize);

    // Regular list view
    if (state.viewType === 'list') return renderListView(widget.data, id, fontSize);

    const chartData = generateChartData(widget.data, id, state.viewType);
    if (!chartData) {
      return (
        <div className={`text-center py-8 text-sm ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          No Data Available
        </div>
      );
    }

    // IMPORTANT: put id on the chart container so tooltip can detect widgetId for currency
    return (
      <div className="flex-1 min-h-0" id={id}>
        {renderChart(id, chartData, state.viewType, fontSize)}
      </div>
    );
  };

  const renderFilters = (id: string, config: WidgetConfig) => {
    const state = widgetStates[id];
    if (!config.hasFilters || !state) return null;

    const fontSize = state.fontSize || 12;

    return (
      <div className="flex gap-2 items-center text-xs flex-wrap" style={{ fontSize: `${fontSize}px` }}>
        {id === 'pay_method_mon' && (
          <select
            value={state.paymentMode || 'type'}
            onChange={(e) => updateWidgetState(id, { paymentMode: e.target.value as any })}
            className={`px-2 py-1 rounded border text-xs ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
          >
            <option value="type">Type of Payment</option>
            <option value="months">Months</option>
          </select>
        )}

        {id === 'tech_availability' && (
          <div className="flex items-center gap-2 ml-2">
            <span className="text-lg opacity-80 font-bold uppercase tracking-wide">Start:</span>
            <input
              type="time"
              value={state.customStartTime || '08:00'}
              onChange={(e) => updateWidgetState(id, { customStartTime: e.target.value })}
              className={`px-4 py-2 rounded-lg border-2 text-lg outline-none transition-all font-black ${isDarkMode
                  ? 'bg-gray-800 border-gray-700 text-white focus:border-purple-500'
                  : 'bg-white border-gray-300 text-gray-900 focus:border-purple-500'
                }`}
              title="Availability Starting Time"
            />
          </div>
        )}

        {(id !== 'pay_method_mon' || state.paymentMode !== 'months') &&
          (config.filterType === 'toggle_today' || config.filterType === 'date' || config.filterType === 'date_bgy') && (
            <select
              value={state.scope}
              onChange={(e) => updateWidgetState(id, { scope: e.target.value as any })}
              className={`px-2 py-1 rounded border text-xs ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
            >
              <option value="overall">Overall</option>
              <option value="today">Today</option>
              <option value="weekly">1 Week</option>
              <option value="3weeks">3 Weeks</option>
              <option value="monthly">1 Month</option>
              <option value="3months">3 Months</option>
              <option value="yearly">1 Year</option>
            </select>
          )}

        {config.filterType === 'year' && (
          <select
            value={state.year}
            onChange={(e) => updateWidgetState(id, { year: e.target.value })}
            className={`px-2 py-1 rounded border text-xs ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
          >
            <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>
            <option value={new Date().getFullYear() - 1}>{new Date().getFullYear() - 1}</option>
            <option value={new Date().getFullYear() - 2}>{new Date().getFullYear() - 2}</option>
          </select>
        )}

        {(config.filterType === 'bgy_only' || config.filterType === 'date_bgy') && barangays.length > 0 && (
          <select
            value={state.bgy}
            onChange={(e) => updateWidgetState(id, { bgy: e.target.value })}
            className={`px-2 py-1 rounded border text-xs ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
          >
            <option value="All">All Brgy</option>
            {barangays.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        )}

        {/* Optional: custom date range UI if you want it:
            set scope='custom' and set startDate/endDate
            (You already support it in backend)
        */}
      </div>
    );
  };

  // -------- TEMPLATES (MATCH YOUR BACKEND ACTIONS) --------

  const loadTemplates = async () => {
    try {
      const url = buildHandleUrl({ action: 'list_templates' });
      const response = await apiClient.get(url);
      const data = response.data as any;

      if (data.status === 'success' && Array.isArray(data.data)) {
        setTemplates(data.data);
      } else {
        console.error('Template list error:', data);
      }
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  };

  const saveTemplate = async () => {
    if (!currentTemplateName.trim()) {
      window.alert('Please enter a template name');
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiClient.post('/monitor/handle', {
        action: 'save_template',
        name: currentTemplateName,
        layout: JSON.stringify(widgetStates),
        // We now save the visual layout (positions/sizes) in 'style_data' for backward compatibility 
        // or ideally, we should update the DB schema to have a 'positions_data' column. 
        // For now, let's piggyback on style_data to store the layouts as 'layoutPositions'
        styles: JSON.stringify({
          darkMode: isDarkMode,
          layoutPositions: layouts
        })
      });

      const data = response.data as any;
      if (data.status === 'success') {
        window.alert('Template saved successfully!');
        setCurrentTemplateName('');
        loadTemplates();
        setShowTemplateMenu(false);
      } else {
        console.error('Save template failed:', data);
        window.alert(data.message || 'Failed to save template');
      }
    } catch (error) {
      console.error('Error saving template:', error);
      window.alert('Failed to save template');
    } finally {
      setIsLoading(false);
    }
  };

  const loadTemplate = async (templateId: number) => {
    setIsLoading(true);
    try {
      const url = buildHandleUrl({ action: 'load_template', id: templateId });
      const response = await apiClient.get(url);
      const data = response.data as any;

      if (data.status === 'success' && data.data) {
        const template = data.data as DashboardTemplate;

        const layoutData = typeof template.layout_data === 'string'
          ? JSON.parse(template.layout_data)
          : template.layout_data || {};

        const styleData = typeof template.style_data === 'string'
          ? JSON.parse(template.style_data)
          : template.style_data || {};

        setWidgetStates(layoutData);

        if (styleData.darkMode !== undefined) {
          setIsDarkMode(!!styleData.darkMode);
          localStorage.setItem('theme', styleData.darkMode ? 'dark' : 'light');
        }

        if (styleData.layoutPositions) {
          setLayouts(styleData.layoutPositions);
          localStorage.setItem('dashboard_layouts', JSON.stringify(styleData.layoutPositions));
        }

        Object.entries(layoutData).forEach(([id, state]) => {
          localStorage.setItem(`widget_state_${id}`, JSON.stringify(state));
        });

        fetchAllWidgets(layoutData as any);
        window.alert('Template loaded successfully!');
      } else {
        console.error('Load template failed:', data);
        window.alert(data.message || 'Failed to load template');
      }
    } catch (error) {
      console.error('Error loading template:', error);
      window.alert('Failed to load template');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteTemplate = async (templateId: number) => {
    if (!window.confirm('Are you sure you want to delete this template?')) return;

    setIsLoading(true);
    try {
      const response = await apiClient.post('/monitor/handle', {
        action: 'delete_template',
        id: templateId
      });

      const data = response.data as any;
      if (data.status === 'success') {
        window.alert('Template deleted successfully!');
        loadTemplates();
      } else {
        console.error('Delete template failed:', data);
        window.alert(data.message || 'Failed to delete template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
      window.alert('Failed to delete template');
      setIsLoading(false);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  return (
    <div ref={containerRef} className={`min-h-screen ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'} ${isFullscreen ? 'overflow-y-auto' : ''}`}>
      {/* Header */}
      <div className={`sticky top-0 z-20 border-b ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
        <div className={`${isFullscreen ? 'max-w-none px-6' : 'container mx-auto px-4'} py-3 flex items-center justify-between flex-wrap gap-4`}>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Activity size={24} style={{ color: colorPalette?.primary || '#7c3aed' }} />
              Live Monitor
            </h1>
            <span className="text-xs uppercase tracking-wider text-gray-500">
              Real-time Dashboard Analytics
            </span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {isSuperAdmin && (
              <select
                value={selectedOrgId}
                onChange={(e) => {
                  setSelectedOrgId(e.target.value);
                  setTimeout(() => fetchAllWidgets(), 100);
                }}
                className={`px-3 py-2 rounded border text-sm font-semibold ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
              >
                <option value="All">All Organizations</option>
                {organizations.map(org => (
                  <option key={org.id} value={org.id}>{org.organization_name}</option>
                ))}
              </select>
            )}

            <div className="text-sm text-gray-500">
              Updated: <span className={isDarkMode ? 'text-white' : 'text-gray-900'}>{lastUpdate}</span>
            </div>

            <button
              onClick={() => setShowTemplateMenu(!showTemplateMenu)}
              className={`px-3 py-2 rounded flex items-center gap-2 ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'}`}
              title="Manage Templates"
            >
              <Save size={16} />
              Templates
            </button>

            <button
              onClick={() => setShowWidgetMenu(!showWidgetMenu)}
              className={`px-3 py-2 rounded flex items-center gap-2 ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'}`}
              title="Widget Settings"
            >
              <Settings size={16} />
              Widgets
            </button>

            <button
              onClick={() => fetchAllWidgets()}
              className="px-4 py-2 rounded text-white text-sm flex items-center gap-2 transition-opacity hover:opacity-90"
              style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              title="Refresh All Widgets"
            >
              <RefreshCw size={16} />
            </button>

            <button
              onClick={() => setIsDraggable(prev => !prev)}
              className={`px-3 py-2 rounded flex items-center gap-2 transition-colors ${
                isDraggable
                  ? 'text-white'
                  : isDarkMode
                    ? 'bg-gray-800 hover:bg-gray-700'
                    : 'bg-gray-100 hover:bg-gray-200'
              }`}
              style={isDraggable ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
              title={isDraggable ? 'Exit Edit Mode' : 'Edit Layout'}
            >
              <Move size={16} />
              <span className="hidden sm:inline">{isDraggable ? 'Done' : 'Edit Layout'}</span>
            </button>

            <button
              onClick={toggleFullscreen}
              className={`px-3 py-2 rounded flex items-center gap-2 ${isDarkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'}`}
              title={isFullscreen ? "Exit Full Screen" : "Full Screen"}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Full Screen"}</span>
            </button>

          </div>
        </div>
      </div>

      {/* Template Menu */}
      {showTemplateMenu && (
        <div className={`border-b ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
          <div className={`${isFullscreen ? 'max-w-none px-6' : 'container mx-auto px-4'} py-4`}>
            <h3 className="text-sm font-semibold mb-3">Dashboard Templates</h3>

            <div className="mb-4 flex gap-2">
              <input
                type="text"
                value={currentTemplateName}
                onChange={(e) => setCurrentTemplateName(e.target.value)}
                placeholder="Template name..."
                className={`flex-1 px-3 py-2 rounded border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
              />
              <button
                onClick={saveTemplate}
                disabled={isLoading || !currentTemplateName.trim()}
                className="px-4 py-2 disabled:bg-gray-600 rounded text-white text-sm flex items-center gap-2 transition-opacity hover:opacity-90"
                style={{ backgroundColor: (isLoading || !currentTemplateName.trim()) ? undefined : (colorPalette?.primary || '#7c3aed') }}
              >
                <Save size={16} />
                Save Current Layout
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`p-3 rounded border flex items-center justify-between ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{template.template_name}</div>
                    <div className="text-xs text-gray-500">{new Date(template.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button
                      onClick={() => loadTemplate(template.id)}
                      disabled={isLoading}
                      className="p-2 rounded hover:text-white transition-colors"
                      style={{ hover: { backgroundColor: colorPalette?.primary || '#7c3aed' } } as any}
                      title="Load Template"
                    >
                      <Upload size={14} />
                    </button>
                    <button
                      onClick={() => deleteTemplate(template.id)}
                      disabled={isLoading}
                      className="p-2 rounded hover:bg-red-600 hover:text-white transition-colors"
                      title="Delete Template"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* Widget Menu */}
      {showWidgetMenu && (
        <div className={`border-b ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
          <div className={`${isFullscreen ? 'max-w-none px-6' : 'container mx-auto px-4'} py-4`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Toggle Widgets</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const ids = Object.keys(WIDGETS).filter(isWidgetAllowed);
                    const nextStates = { ...widgetStates };
                    ids.forEach(id => {
                      nextStates[id] = { ...nextStates[id], visible: true };
                      localStorage.setItem(`widget_state_${id}`, JSON.stringify(nextStates[id]));
                    });

                    // Reflow All
                    const breakpoints = ['lg', 'md', 'sm', 'xs', 'xxs'];
                    const columnCounts = { lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 };
                    const newLayouts: any = {};
                    breakpoints.forEach(bp => {
                      const cols = (columnCounts as any)[bp];
                      newLayouts[bp] = ids.map((vid, idx) => {
                        const config = WIDGETS[vid];
                        const w = Math.min(config.w || 4, cols);
                        const h = config.h || 6;
                        const itemsPerRow = Math.max(1, Math.floor(cols / w));
                        return {
                          i: vid,
                          x: (idx % itemsPerRow) * w,
                          y: Math.floor(idx / itemsPerRow) * h,
                          w, h, minW: 2, minH: 3
                        };
                      });
                    });

                    setWidgetStates(nextStates);
                    setLayouts(newLayouts);
                    localStorage.setItem('dashboard_layouts', JSON.stringify(newLayouts));

                    // Trigger resize to fix all layouts
                    setTimeout(() => {
                      window.dispatchEvent(new Event('resize'));
                      fetchAllWidgets(nextStates);
                    }, 200);
                  }}
                  className="text-xs px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white"
                >
                  <Eye size={12} className="inline mr-1" />
                  Show All
                </button>
                <button
                  onClick={() => {
                    const ids = Object.keys(WIDGETS).filter(isWidgetAllowed);
                    setWidgetStates(prev => {
                      const nextStates = { ...prev };
                      ids.forEach(id => {
                        nextStates[id] = { ...nextStates[id], visible: false };
                        localStorage.setItem(`widget_state_${id}`, JSON.stringify(nextStates[id]));
                      });
                      return nextStates;
                    });
                  }}
                  className="text-xs px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white"
                >
                  <EyeOff size={12} className="inline mr-1" />
                  Hide All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {Object.entries(WIDGETS).filter(([id]) => isWidgetAllowed(id)).map(([id, config]) => (
                <label
                  key={id}
                  className={`flex items-center gap-2 p-2 rounded cursor-pointer ${isDarkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-100'}`}
                >
                  <input
                    type="checkbox"
                    checked={widgetStates[id]?.visible || false}
                    onChange={() => toggleWidgetVisibility(id)}
                    className="rounded"
                  />
                  <span className="text-sm">{config.title}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Widgets Grid - Replaced with ResponsiveGridLayout */}
      <div className={`${isFullscreen ? 'max-w-none px-2' : 'container mx-auto px-4'} py-6`}>
        <ResponsiveGridLayout
          className="layout"
          layouts={displayLayouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={60}
          compactType="horizontal"
          isDraggable={isDraggable}
          isResizable={isDraggable}
          onLayoutChange={(currentLayout: any, allLayouts: any) => {
            if (isDraggable) { // Only save if in edit mode to avoid saving 'static' states if any
              setLayouts(allLayouts);
              localStorage.setItem('dashboard_layouts', JSON.stringify(allLayouts));
            }
          }}
          draggableHandle=".drag-handle"
        >
          {Object.keys(WIDGETS).filter(id => widgetStates[id]?.visible && isWidgetAllowed(id)).map((id, visibleIdx) => {
            const config = WIDGETS[id];
            const itemsPerRow = Math.max(1, Math.floor(12 / (config.w || 4)));

            return (
              <div
                key={id}
                data-grid={{
                  w: config.w,
                  h: config.h || 6,
                  x: (visibleIdx * (config.w || 4)) % 12,
                  y: Math.floor(visibleIdx / itemsPerRow) * (config.h ? config.h : 6),
                  minW: 2,
                  minH: 3
                }}
                className={`shadow-lg transition-shadow bg-transparent ${isDraggable ? 'ring-2 ring-opacity-50' : ''}`}
                style={isDraggable && colorPalette?.primary ? { '--tw-ring-color': colorPalette.primary } as React.CSSProperties : {}}
              >
                <div className={`h-full w-full rounded-lg border-l-4 flex flex-col ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}
                  style={{
                    borderLeftColor: colorPalette?.primary || '#7c3aed',
                  }}
                >
                  <div className="p-4 flex-1 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between mb-4 flex-wrap gap-2 slide-header">
                      <div className="flex items-center gap-2">
                        {isDraggable && (
                          <div className="drag-handle cursor-move p-1 rounded hover:bg-white/10" title="Drag to move">
                            <Move size={14} className="text-gray-400" />
                          </div>
                        )}
                        <h3
                          className="font-bold uppercase tracking-wide truncate"
                          style={{ fontSize: `${(widgetStates[id]?.fontSize || 12) + 2}px`, color: colorPalette?.primary || '#7c3aed' }}
                        >
                          {config.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-2 ml-auto">
                        {renderFilters(id, config)}
                      </div>
                    </div>

                    <div className="flex gap-1 mb-3 flex-wrap">
                      <div className={`flex items-center rounded p-0.5 mr-2 border ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                        <button
                          onClick={() => updateWidgetState(id, { fontSize: Math.max(8, (widgetStates[id]?.fontSize || 12) - 1) })}
                          className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-200 text-gray-600 hover:text-black'}`}
                          title="Decrease Font Size"
                        >
                          <Minus size={12} />
                        </button>
                        <span className={`text-[10px] px-1 min-w-[20px] text-center font-mono opacity-70 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          {widgetStates[id]?.fontSize || 12}
                        </span>
                        <button
                          onClick={() => updateWidgetState(id, { fontSize: (widgetStates[id]?.fontSize || 12) + 1 })}
                          className={`p-1 rounded transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-white' : 'hover:bg-gray-200 text-gray-600 hover:text-black'}`}
                          title="Increase Font Size"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      {id !== 'team_detailed_queue' && id !== 'agent_detailed_queue' && id !== 'tech_availability' && (
                        <>
                          <button
                            onClick={() => updateWidgetState(id, { viewType: 'bar' })}
                            className={`p-1.5 rounded transition-colors ${widgetStates[id]?.viewType === 'bar'
                              ? 'text-white'
                              : isDarkMode
                                ? 'bg-gray-800 hover:bg-gray-700'
                                : 'bg-gray-100 hover:bg-gray-200'
                              }`}
                            style={widgetStates[id]?.viewType === 'bar' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                            title="Bar Chart"
                          >
                            <BarChart3 size={14} />
                          </button>

                          <button
                            onClick={() => updateWidgetState(id, { viewType: 'line' })}
                            className={`p-1.5 rounded transition-colors ${widgetStates[id]?.viewType === 'line'
                              ? 'text-white'
                              : isDarkMode
                                ? 'bg-gray-800 hover:bg-gray-700'
                                : 'bg-gray-100 hover:bg-gray-200'
                              }`}
                            style={widgetStates[id]?.viewType === 'line' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                            title="Line Chart"
                          >
                            <LineChart size={14} />
                          </button>

                          <button
                            onClick={() => updateWidgetState(id, { viewType: 'pie' })}
                            className={`p-1.5 rounded transition-colors ${widgetStates[id]?.viewType === 'pie'
                              ? 'text-white'
                              : isDarkMode
                                ? 'bg-gray-800 hover:bg-gray-700'
                                : 'bg-gray-100 hover:bg-gray-200'
                              }`}
                            style={widgetStates[id]?.viewType === 'pie' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                            title="Pie Chart"
                          >
                            <PieChart size={14} />
                          </button>

                          <button
                            onClick={() => updateWidgetState(id, { viewType: 'list' })}
                            className={`p-1.5 rounded transition-colors ${widgetStates[id]?.viewType === 'list'
                              ? 'text-white'
                              : isDarkMode
                                ? 'bg-gray-800 hover:bg-gray-700'
                                : 'bg-gray-100 hover:bg-gray-200'
                              }`}
                            style={widgetStates[id]?.viewType === 'list' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                            title="List View"
                          >
                            <List size={14} />
                          </button>
                        </>
                      )}

                      {id === 'team_detailed_queue' && (() => {
                        const { jobOrders, services, others } = typeFilterGroups(
                          widgets[id]?.data,
                          widgetStates[id]?.typeFilter
                        );

                        return (
                          <select
                            value={widgetStates[id]?.typeFilter || 'all'}
                            onChange={(e) => updateWidgetState(id, { typeFilter: e.target.value })}
                            title="Filter by type"
                            className={`text-[11px] font-semibold rounded px-2 py-1 border outline-none cursor-pointer ${isDarkMode
                              ? 'bg-gray-800 border-gray-700 text-gray-200'
                              : 'bg-white border-gray-300 text-gray-700'
                              }`}
                          >
                            <option value="all">All Types</option>
                            {jobOrders.length > 0 && (
                              <optgroup label="Job Order">
                                {jobOrders.map(({ key, label }) => (
                                  <option key={key} value={key}>{typeFilterLabel(label)}</option>
                                ))}
                              </optgroup>
                            )}
                            {services.length > 0 && (
                              <optgroup label="Service Order">
                                {services.map(({ key, label }) => (
                                  <option key={key} value={key}>{typeFilterLabel(label)}</option>
                                ))}
                              </optgroup>
                            )}
                            {others.length > 0 && (
                              <optgroup label="Other">
                                {others.map(({ key, label }) => (
                                  <option key={key} value={key}>{typeFilterLabel(label)}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        );
                      })()}

                      {(id === 'team_detailed_queue' || id === 'agent_detailed_queue') && (
                        <button
                          onClick={() => updateWidgetState(id, { viewType: 'table' })}
                          className={`p-1.5 rounded transition-colors ${widgetStates[id]?.viewType === 'table'
                            ? 'text-white'
                            : isDarkMode
                              ? 'bg-gray-800 hover:bg-gray-700'
                              : 'bg-gray-100 hover:bg-gray-200'
                            }`}
                          style={widgetStates[id]?.viewType === 'table' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                          title="Table View"
                        >
                          <Table size={14} />
                        </button>
                      )}

                      {id === 'tech_availability' && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => updateWidgetState(id, { viewType: 'grid' })}
                            className={`p-1.5 rounded transition-colors ${widgetStates[id]?.viewType === 'grid'
                              ? 'text-white'
                              : isDarkMode
                                ? 'bg-gray-800 hover:bg-gray-700'
                                : 'bg-gray-100 hover:bg-gray-200'
                              }`}
                            style={widgetStates[id]?.viewType === 'grid' ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                            title="Grid View"
                          >
                            <LayoutGrid size={14} />
                          </button>
                          <button
                            onClick={() => {
                              updateWidgetState(id, { isEditingGrid: !widgetStates[id]?.isEditingGrid });
                            }}
                            className={`p-1.5 rounded transition-colors ${widgetStates[id]?.isEditingGrid
                              ? 'text-white'
                              : isDarkMode
                                ? 'bg-gray-800 hover:bg-gray-700'
                                : 'bg-gray-100 hover:bg-gray-200'
                              }`}
                            style={widgetStates[id]?.isEditingGrid ? { backgroundColor: colorPalette?.primary || '#7c3aed' } : {}}
                            title="Edit Grid Layout"
                          >
                            <Settings size={14} />
                          </button>
                        </div>
                      )}
                    </div>

                    {id === 'tech_availability' && widgetStates[id]?.isEditingGrid && (
                      <div className={`flex items-center gap-3 mb-3 p-2 rounded border ${isDarkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase opacity-60">Cols:</span>
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={widgetStates[id]?.gridCols || 4}
                            onChange={(e) => updateWidgetState(id, { gridCols: parseInt(e.target.value) || 1 })}
                            className={`w-12 px-1 py-0.5 text-xs rounded border ${isDarkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-black'}`}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase opacity-60">Rows:</span>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={widgetStates[id]?.gridRows || 2}
                            onChange={(e) => updateWidgetState(id, { gridRows: parseInt(e.target.value) || 1 })}
                            className={`w-12 px-1 py-0.5 text-xs rounded border ${isDarkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-gray-300 text-black'}`}
                          />
                        </div>
                        <button
                          onClick={() => {
                            updateWidgetState(id, { isEditingGrid: false });
                          }}
                          className="ml-auto p-1 rounded hover:bg-green-600 hover:text-white transition-colors"
                          title="Save and Close"
                        >
                          <Save size={14} />
                        </button>
                      </div>
                    )}

                    {renderWidget(id)}
                  </div>
                </div>
              </div>
            );
          })}
        </ResponsiveGridLayout>

        {
          Object.values(widgetStates).length > 0 && Object.values(widgetStates).every(state => !state.visible) && (
            <div className="text-center py-20">
              <Activity size={48} className="mx-auto mb-4 text-gray-400" />
              <h3 className="text-lg font-semibold mb-2">No Widgets Visible</h3>
              <p className="text-gray-500 mb-4">Enable some widgets to start monitoring your system</p>
              <button
                onClick={() => setShowWidgetMenu(true)}
                className="px-6 py-3 rounded text-white font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
              >
                Open Widget Settings
              </button>
            </div>
          )
        }
      </div>
    </div>
  );
};

export default LiveMonitor;
