import React, { useState, useEffect } from 'react';
import { dashboardService, DashboardCounts } from '../services/dashboardService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { Wifi, WifiOff, Ban, Lock, Server, Cpu, AlertTriangle, CheckCircle2 } from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const DashboardContent: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const fetchCounts = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const response = await dashboardService.getCounts();
      if (response.status === 'success') {
        setCounts(response.data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard counts:', err);
      if (!silent) {
        setError(true);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
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

    const fetchColorPalette = async () => {
      try {
        const activePalette = await settingsColorPaletteService.getActive();
        setColorPalette(activePalette);
      } catch (err) {
        console.error('Failed to fetch color palette:', err);
      }
    };

    fetchCounts(false);
    fetchColorPalette();
    
    // Poll for the latest data silently every 20 seconds
    const interval = setInterval(() => fetchCounts(true), 20000);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, []);

  const chartOptions = {
    indexAxis: 'x' as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
        titleColor: isDarkMode ? '#f1f5f9' : '#0f172a',
        bodyColor: isDarkMode ? '#f1f5f9' : '#0f172a',
        borderColor: isDarkMode ? '#334155' : '#e2e8f0',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 12,
        displayColors: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grace: '20%',
        grid: {
          color: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
        },
        ticks: {
          color: isDarkMode ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
          font: {
            size: 10,
          },
        },
      },
      x: {
        grid: {
          display: false,
        },
        ticks: {
          color: isDarkMode ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
          font: {
            size: 10,
            weight: 600,
          },
          maxRotation: 45,
          minRotation: 45,
        },
      },
    },
  };

  const topLabelsPlugin = {
    id: 'topLabels',
    afterDraw(chart: any) {
      const { ctx, data } = chart;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.font = 'bold 13px Inter, sans-serif';

      // Shadow for white text on light backgrounds or vice versa
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
      ctx.shadowBlur = 2;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1;

      data.datasets.forEach((dataset: any, i: number) => {
        const meta = chart.getDatasetMeta(i);
        meta.data.forEach((bar: any, index: number) => {
          const value = dataset.data[index];
          if (value > 0) {
            // Check actual DOM class for most reliable theme detection
            const isActuallyDark = document.documentElement.classList.contains('dark');
            ctx.fillStyle = isActuallyDark ? '#FFFFFF' : '#000000';
            ctx.fillText(value.toLocaleString(), bar.x, bar.y - 10);
          }
        });
      });
      ctx.restore();
    }
  };

  const getChartData = (data: { label: string; count: number }[] | undefined, primaryColor: string) => ({
    labels: data?.map(d => d.label) || [],
    datasets: [
      {
        data: data?.map(d => d.count) || [],
        backgroundColor: primaryColor,
        borderRadius: 8,
        barThickness: 24,
      },
    ],
  });

  const metricCard = (title: string, value: number | undefined, icon: React.ReactNode, iconColor: string) => (
    <div className={`relative overflow-hidden rounded-xl border p-4 sm:p-6 transition-all duration-300 ${isDarkMode
      ? 'bg-transparent border-gray-700'
      : 'bg-transparent border-gray-400'
      }`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs sm:text-sm font-semibold uppercase tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
          {title}
        </span>
        <div className={iconColor}>
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <h3 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {loading && !counts ? '...' : (value ?? 0).toLocaleString()}
        </h3>
      </div>
    </div>
  );

  const statusItem = (label: string, value: number | undefined) => (
    <div className={`flex items-center justify-between py-3 px-2 border-b last:border-0 ${isDarkMode ? 'border-gray-700/50' : 'border-gray-300'
      }`}>
      <div className="flex items-center gap-3">
        <span className={`font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{label}</span>
      </div>
      <span className={`text-lg font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-900'}`}>
        {loading && !counts ? '...' : (value ?? 0).toLocaleString()}
      </span>
    </div>
  );

  const getTodayScope = () => {
    const today = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const month = pad(today.getMonth() + 1);
    const date = pad(today.getDate());
    const year = today.getFullYear();
    return `${month}/${date}/${year} 00:00:00 - ${month}/${date}/${year} 23:59:59`;
  };

  const getMonthlyScope = () => {
    const today = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const startMonth = pad(today.getMonth() + 1);
    const year = today.getFullYear();
    const end = new Date(year, today.getMonth() + 1, 0);
    const endMonth = pad(end.getMonth() + 1);
    const endDate = pad(end.getDate());
    return `${startMonth}/01/${year} 00:00:00 - ${endMonth}/${endDate}/${year} 23:59:59`;
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-slate-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8">
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-3 text-[#FF4500]">
            <p className="font-medium text-sm">Unable to fetch dashboard metrics.</p>
          </div>
        )}

        {/* Top Row: Radius Monitor Status */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {metricCard("Online", counts?.radius_online, <Wifi size={20} />, "text-emerald-500")}
          {metricCard("Offline", counts?.radius_offline, <WifiOff size={20} />, "text-slate-500")}
          {metricCard("Disconnected", counts?.radius_disconnected, <Ban size={20} />, "text-red-500")}
          {metricCard("Restricted", counts?.radius_restricted, <Lock size={20} />, "text-orange-500")}
        </div>

        {/* Service Integration Health Statuses */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* RADIUS API Status */}
          <div className={`relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 ${isDarkMode
            ? 'bg-transparent border-gray-700'
            : 'bg-transparent border-gray-400'
            }`}>
            {/* Background Glow */}
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-[40px] pointer-events-none -z-10 ${
              counts?.services?.radius?.status === 'online' ? 'bg-emerald-500/10' : 'bg-red-500/10'
            }`} />

            <div className="flex flex-wrap items-start gap-3 mb-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`p-2.5 rounded-xl shrink-0 ${
                  isDarkMode ? 'bg-slate-800' : 'bg-slate-100'
                }`}>
                  <Server className={`h-5 w-5 sm:h-6 sm:w-6 ${
                    counts?.services?.radius?.status === 'online' ? 'text-emerald-500' : 'text-red-500'
                  }`} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold tracking-tight text-sm sm:text-base">RADIUS API Connection</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Mikrotik RouterOS Service</p>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2 shrink-0">
                {counts?.services?.radius?.status === 'online' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-500 border border-red-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    Offline
                  </span>
                )}
              </div>
            </div>

            <div className={`mt-4 text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              {counts?.services?.radius?.status === 'online' ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span>Syncing user accounts and active sessions normally.</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-start gap-2 text-red-500 font-semibold">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Connection failed. System is offline.</span>
                  </div>
                  {counts?.services?.radius?.message && (
                    <p className={`text-xs ml-6 p-2 rounded bg-red-500/5 border border-red-500/10 font-mono overflow-x-auto whitespace-pre-wrap ${
                      isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>
                      {counts.services.radius.message}
                    </p>
                  )}
                </div>
              )}
            </div>

            {counts?.services?.radius?.updated_at && (
              <div className={`mt-6 pt-4 border-t text-[10px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 ${
                isDarkMode ? 'border-gray-800 text-slate-500' : 'border-gray-200 text-slate-400'
              }`}>
                <span>INTEGRATION TYPE: REST API</span>
                <span>LAST RUN: {new Date(counts.services.radius.updated_at).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* SmartOLT API Status */}
          <div className={`relative overflow-hidden rounded-2xl border p-6 transition-all duration-300 ${isDarkMode
            ? 'bg-transparent border-gray-700'
            : 'bg-transparent border-gray-400'
            }`}>
            {/* Background Glow */}
            <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-[40px] pointer-events-none -z-10 ${
              counts?.services?.smartolt?.status === 'online' ? 'bg-emerald-500/10' : 'bg-red-500/10'
            }`} />

            <div className="flex flex-wrap items-start gap-3 mb-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`p-2.5 rounded-xl shrink-0 ${
                  isDarkMode ? 'bg-slate-800' : 'bg-slate-100'
                }`}>
                  <Cpu className={`h-5 w-5 sm:h-6 sm:w-6 ${
                    counts?.services?.smartolt?.status === 'online' ? 'text-emerald-500' : 'text-red-500'
                  }`} />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold tracking-tight text-sm sm:text-base">SmartOLT API Connection</h3>
                  <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>GPON Management Cloud</p>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2 shrink-0">
                {counts?.services?.smartolt?.status === 'online' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Online
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-500 border border-red-500/20">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                    Offline
                  </span>
                )}
              </div>
            </div>

            <div className={`mt-4 text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-600'}`}>
              {counts?.services?.smartolt?.status === 'online' ? (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  <span>ONU validation and profile provisioning functioning normally.</span>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-start gap-2 text-red-500 font-semibold">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Connection failed. API is unreachable.</span>
                  </div>
                  {counts?.services?.smartolt?.message && (
                    <p className={`text-xs ml-6 p-2 rounded bg-red-500/5 border border-red-500/10 font-mono overflow-x-auto whitespace-pre-wrap ${
                      isDarkMode ? 'text-red-400' : 'text-red-600'
                    }`}>
                      {counts.services.smartolt.message}
                    </p>
                  )}
                </div>
              )}
            </div>

            {counts?.services?.smartolt?.updated_at && (
              <div className={`mt-6 pt-4 border-t text-[10px] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 ${
                isDarkMode ? 'border-gray-800 text-slate-500' : 'border-gray-200 text-slate-400'
              }`}>
                <span>INTEGRATION TYPE: SMARTOLT API v1</span>
                <span>LAST CHECKED: {new Date(counts.services.smartolt.updated_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Middle Row: Support Monthly Summary */}
        <div className={`rounded-2xl border p-8 ${isDarkMode ? 'bg-transparent border-gray-700' : 'bg-transparent border-gray-400'}`}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 md:mb-8 gap-2 sm:gap-4">
            <h2 className={`text-base sm:text-xl font-bold uppercase tracking-widest ${isDarkMode ? 'text-slate-100' : 'text-slate-800'}`}>Support Monthly Summary</h2>
            <div className={`text-[10px] sm:text-xs font-medium break-all sm:break-normal ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
              Scope: {getMonthlyScope()}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-12 min-h-[300px] md:min-h-[350px]">
            {/* Chart: Support Concern Analytics */}
            <div className={`rounded-xl p-6 border ${isDarkMode ? 'bg-transparent border-gray-700' : 'bg-transparent border-gray-400'}`}>
              <p className="font-bold uppercase tracking-widest text-xs opacity-70 mb-6">Support Concern Analytics</p>
              <div className="h-[250px] relative">
                <Bar
                  options={chartOptions}
                  data={getChartData(counts?.monthly_support_concerns || [], colorPalette?.primary || 'rgba(99, 102, 241, 0.8)')}
                  plugins={[topLabelsPlugin]}
                />
              </div>
            </div>

            {/* Chart: Repair Category Distribution */}
            <div className={`rounded-xl p-6 border ${isDarkMode ? 'bg-transparent border-gray-700' : 'bg-transparent border-gray-400'}`}>
              <p className="font-bold uppercase tracking-widest text-xs opacity-70 mb-6">Repair Category distribution</p>
              <div className="h-[250px] relative">
                <Bar
                  options={chartOptions}
                  data={getChartData(counts?.monthly_repair_categories || [], colorPalette?.secondary || 'rgba(16, 185, 129, 0.8)')}
                  plugins={[topLabelsPlugin]}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Row: Detailed Statuses (Job Orders and Applications Added) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">

          {/* Support Status Today */}
          <div className={`rounded-2xl border p-6 ${isDarkMode ? 'bg-transparent border-gray-700' : 'bg-transparent border-gray-400'}`}>
            <h3 className="font-bold uppercase tracking-widest text-xs mb-1 opacity-70">Support Status Today</h3>
            <p className={`text-[10px] mb-5 tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{getTodayScope()}</p>
            <div className="space-y-0">
              {statusItem("In Progress", counts?.support_status_in_progress)}
              {statusItem("For Visit", counts?.support_status_for_visit)}
              {statusItem("Resolved", counts?.support_status_resolved)}
              {statusItem("Failed", counts?.support_status_failed)}
            </div>
          </div>

          {/* For Visit Today */}
          <div className={`rounded-2xl border p-6 ${isDarkMode ? 'bg-transparent border-gray-700' : 'bg-transparent border-gray-400'}`}>
            <h3 className="font-bold uppercase tracking-widest text-xs mb-1 opacity-70">For Visit Today</h3>
            <p className={`text-[10px] mb-5 tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{getTodayScope()}</p>
            <div className="space-y-0">
              {statusItem("In Progress", counts?.visit_status_in_progress)}
              {statusItem("Done", counts?.visit_status_done)}
              {statusItem("Rescheduled", counts?.visit_status_rescheduled)}
              {statusItem("Failed", counts?.visit_status_failed)}
            </div>
          </div>

          {/* Job Order Onsite Status Today */}
          <div className={`rounded-2xl border p-6 ${isDarkMode ? 'bg-transparent border-gray-700' : 'bg-transparent border-gray-400'}`}>
            <h3 className="font-bold uppercase tracking-widest text-xs mb-1 opacity-70">Job Order Onsite Status</h3>
            <p className={`text-[10px] mb-5 tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{getTodayScope()}</p>
            <div className="space-y-0">
              {statusItem("Pending", counts?.jo_status_pending)}
              {statusItem("In Progress", counts?.jo_status_in_progress)}
              {statusItem("Done", counts?.jo_status_done)}
              {statusItem("Failed", counts?.jo_status_failed)}
            </div>
          </div>

          {/* Applications Status Today */}
          <div className={`rounded-2xl border p-6 ${isDarkMode ? 'bg-transparent border-gray-700' : 'bg-transparent border-gray-400'}`}>
            <h3 className="font-bold uppercase tracking-widest text-xs mb-1 opacity-70">Application Status</h3>
            <p className={`text-[10px] mb-5 tracking-wider ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>{getTodayScope()}</p>
            <div className="space-y-0">
              {statusItem("Scheduled", counts?.app_status_scheduled)}
              {statusItem("In Progress", counts?.app_status_in_progress)}
              {statusItem("No Facility", counts?.app_status_no_facility)}
              {statusItem("Cancelled", counts?.app_status_cancelled)}
              {statusItem("No Slot", counts?.app_status_no_slot)}
              {statusItem("Duplicate", counts?.app_status_duplicate)}
            </div>
          </div>

        </div>

        {/* Floating Background Glows */}
        {isDarkMode && (
          <>
            <div className="fixed top-0 -left-64 w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none -z-10 animate-pulse" />
            <div className="fixed bottom-0 -right-64 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none -z-10 animate-pulse duration-[5000ms]" />
          </>
        )}

      </div>
    </div>
  );
};

export default DashboardContent;
