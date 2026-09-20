import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import {
  Wifi,
  WifiOff,
  Ban,
  Lock,
  Server,
  Cpu,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react-native';
import { dashboardService, DashboardCounts } from '../services/dashboardService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

/**
 * The administrator and superadmin landing screen.
 *
 * Ported from the web portal's components/DashboardContent.tsx. What was here
 * before was a mock-up: six cards hardcoded to "0" and "₱0" with nothing behind
 * them, so the first screen an administrator saw after signing in reported
 * nothing about the system it was describing.
 *
 * Same sections as the web, in the same order, off the same endpoint:
 *   RADIUS session counts · RADIUS and SmartOLT integration health ·
 *   this month's support concerns and repair categories · today's support,
 *   visit, job order and application statuses.
 *
 * The charts are bar strips rather than chart.js, matching what LiveMonitor
 * already does on this platform — a horizontal bar per row, which reads better
 * on a narrow screen than a cramped axis anyway.
 */

const DashboardContent: React.FC = () => {
  // App is forced light mode.
  const isDarkMode = false;

  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

  const primaryColor = colorPalette?.primary || '#7c3aed';
  const secondaryColor = colorPalette?.secondary || '#10b981';
  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const fetchCounts = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await dashboardService.getCounts();
      if (response.status === 'success') {
        setCounts(response.data);
        setError(false);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard counts:', err);
      if (!silent) setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    settingsColorPaletteService
      .getActive()
      .then(setColorPalette)
      .catch((err) => console.error('Failed to fetch color palette:', err));

    fetchCounts(false);

    // Polled silently every 20 seconds, as on the web. Silent so a failed poll
    // never replaces a screen full of figures with an error banner.
    const interval = setInterval(() => fetchCounts(true), 20000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchCounts(true);
    setRefreshing(false);
  };

  /** Today, as the scope line under each of the daily panels reads it. */
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

  /** A figure, or "..." while the first load is still in flight. */
  const figure = (value: number | undefined) =>
    loading && !counts ? '...' : (value ?? 0).toLocaleString();

  const MetricCard: React.FC<{
    title: string;
    value?: number;
    icon: React.ReactNode;
  }> = ({ title, value, icon }) => (
    <View
      style={{
        flex: 1,
        minWidth: isTablet ? 160 : 140,
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 12,
        padding: 14,
        backgroundColor: '#ffffff',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text
          style={{ fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b', flexShrink: 1 }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {icon}
      </View>
      <Text style={{ fontSize: 26, fontWeight: '700', color: '#0f172a' }}>{figure(value)}</Text>
    </View>
  );

  const StatusItem: React.FC<{ label: string; value?: number }> = ({ label, value }) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 11,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '500', color: '#475569' }}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a' }}>{figure(value)}</Text>
    </View>
  );

  const Panel: React.FC<{ title: string; scope: string; children: React.ReactNode }> = ({
    title,
    scope,
    children,
  }) => (
    <View
      style={{
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 14,
        padding: 16,
        backgroundColor: '#ffffff',
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, color: '#334155' }}>
        {title}
      </Text>
      <Text style={{ fontSize: 10, letterSpacing: 0.4, color: '#94a3b8', marginTop: 3, marginBottom: 10 }}>
        {scope}
      </Text>
      {children}
    </View>
  );

  /**
   * One integration's health — RADIUS or SmartOLT.
   *
   * The web draws these as two cards side by side; stacked here, but carrying
   * the same three things: whether it is reachable, the server's own error text
   * when it is not, and when the check last ran.
   */
  const ServiceCard: React.FC<{
    name: string;
    subtitle: string;
    icon: React.ReactNode;
    service?: { status: 'online' | 'offline'; message: string | null; updated_at: string | null };
    healthyText: string;
  }> = ({ name, subtitle, icon, service, healthyText }) => {
    const online = service?.status === 'online';

    return (
      <View
        style={{
          borderWidth: 1,
          borderColor: '#d1d5db',
          borderRadius: 14,
          padding: 16,
          backgroundColor: '#ffffff',
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ padding: 9, borderRadius: 10, backgroundColor: '#f1f5f9' }}>{icon}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>{name}</Text>
            <Text style={{ fontSize: 11, color: '#64748b' }}>{subtitle}</Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              borderWidth: 1,
              backgroundColor: online ? '#ecfdf5' : '#fef2f2',
              borderColor: online ? '#a7f3d0' : '#fecaca',
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: online ? '#10b981' : '#ef4444' }} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: online ? '#047857' : '#b91c1c' }}>
              {online ? 'Online' : 'Offline'}
            </Text>
          </View>
        </View>

        {online ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CheckCircle2 size={16} color="#10b981" />
            <Text style={{ flex: 1, fontSize: 12, color: '#475569' }}>{healthyText}</Text>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <AlertTriangle size={16} color="#ef4444" />
              <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: '#b91c1c' }}>
                Connection failed. System is offline.
              </Text>
            </View>
            {/* The server's own words. Monospaced and kept verbatim, because it
                is the only description of what actually went wrong. */}
            {!!service?.message && (
              <View
                style={{
                  padding: 8,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: '#fee2e2',
                  backgroundColor: '#fef2f2',
                  marginLeft: 24,
                }}
              >
                <Text style={{ fontSize: 11, color: '#b91c1c', fontFamily: 'monospace' }}>{service.message}</Text>
              </View>
            )}
          </View>
        )}

        {!!service?.updated_at && (
          <View style={{ borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 8, gap: 2 }}>
            <Text style={{ fontSize: 10, color: '#94a3b8' }}>INTEGRATION TYPE: REST API</Text>
            <Text style={{ fontSize: 10, color: '#94a3b8' }}>
              LAST RUN: {new Date(service.updated_at).toLocaleString()}
            </Text>
          </View>
        )}
      </View>
    );
  };

  /**
   * A labelled bar per row, scaled to the largest value.
   *
   * The same shape LiveMonitor's BarStrip uses, so the two screens read alike;
   * chart.js has no place here and a vertical axis on a phone would be unreadable
   * at these label lengths anyway.
   */
  const BarStrip: React.FC<{ data?: { label: string; count: number }[]; color: string }> = ({ data, color }) => {
    if (!data || data.length === 0) {
      return <Text style={{ fontSize: 12, color: '#94a3b8', paddingVertical: 12 }}>No data for this period.</Text>;
    }

    const max = Math.max(...data.map((d) => Number(d.count) || 0), 1);

    return (
      <View style={{ gap: 9 }}>
        {data.map((row, idx) => {
          const value = Number(row.count) || 0;
          return (
            <View key={`${row.label}-${idx}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ fontSize: 11, color: '#475569', flex: 1 }} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={{ fontSize: 11, fontWeight: '700', color, marginLeft: 6 }}>
                  {value.toLocaleString()}
                </Text>
              </View>
              <View style={{ height: 6, backgroundColor: '#e5e7eb', borderRadius: 3 }}>
                <View style={{ height: 6, width: `${(value / max) * 100}%`, backgroundColor: color, borderRadius: 3 }} />
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  if (loading && !counts) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color={primaryColor} />
        <Text style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>Loading dashboard...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f8fafc' }}
      contentContainerStyle={{ padding: 16, paddingTop: isTablet ? 16 : 60, paddingBottom: 96, gap: 16 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={primaryColor} colors={[primaryColor]} />
      }
    >
      {error && (
        <View style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: '#dc2626' }}>
            Unable to fetch dashboard metrics.
          </Text>
        </View>
      )}

      {/* RADIUS session counts */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <MetricCard title="Online" value={counts?.radius_online} icon={<Wifi size={18} color="#10b981" />} />
        <MetricCard title="Offline" value={counts?.radius_offline} icon={<WifiOff size={18} color="#64748b" />} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <MetricCard title="Disconnected" value={counts?.radius_disconnected} icon={<Ban size={18} color="#ef4444" />} />
        <MetricCard title="Restricted" value={counts?.radius_restricted} icon={<Lock size={18} color="#f97316" />} />
      </View>

      {/* Integration health */}
      <ServiceCard
        name="RADIUS API Connection"
        subtitle="Mikrotik RouterOS Service"
        icon={<Server size={20} color={counts?.services?.radius?.status === 'online' ? '#10b981' : '#ef4444'} />}
        service={counts?.services?.radius}
        healthyText="Syncing user accounts and active sessions normally."
      />
      <ServiceCard
        name="SmartOLT API Connection"
        subtitle="ONU Provisioning Service"
        icon={<Cpu size={20} color={counts?.services?.smartolt?.status === 'online' ? '#10b981' : '#ef4444'} />}
        service={counts?.services?.smartolt}
        healthyText="Provisioning and ONU status checks responding normally."
      />

      {/* This month */}
      <Panel title="Support Concern Analytics" scope={`Scope: ${getMonthlyScope()}`}>
        <BarStrip data={counts?.monthly_support_concerns} color={primaryColor} />
      </Panel>

      <Panel title="Repair Category Distribution" scope={`Scope: ${getMonthlyScope()}`}>
        <BarStrip data={counts?.monthly_repair_categories} color={secondaryColor} />
      </Panel>

      {/* Today */}
      <Panel title="Support Status Today" scope={getTodayScope()}>
        <StatusItem label="In Progress" value={counts?.support_status_in_progress} />
        <StatusItem label="For Visit" value={counts?.support_status_for_visit} />
        <StatusItem label="Resolved" value={counts?.support_status_resolved} />
        <StatusItem label="Failed" value={counts?.support_status_failed} />
      </Panel>

      <Panel title="For Visit Today" scope={getTodayScope()}>
        <StatusItem label="In Progress" value={counts?.visit_status_in_progress} />
        <StatusItem label="Done" value={counts?.visit_status_done} />
        <StatusItem label="Rescheduled" value={counts?.visit_status_rescheduled} />
        <StatusItem label="Failed" value={counts?.visit_status_failed} />
      </Panel>

      <Panel title="Job Order Onsite Status" scope={getTodayScope()}>
        <StatusItem label="Pending" value={counts?.jo_status_pending} />
        <StatusItem label="In Progress" value={counts?.jo_status_in_progress} />
        <StatusItem label="Done" value={counts?.jo_status_done} />
        <StatusItem label="Failed" value={counts?.jo_status_failed} />
      </Panel>

      <Panel title="Application Status" scope={getTodayScope()}>
        <StatusItem label="Scheduled" value={counts?.app_status_scheduled} />
        <StatusItem label="In Progress" value={counts?.app_status_in_progress} />
        <StatusItem label="No Facility" value={counts?.app_status_no_facility} />
        <StatusItem label="Cancelled" value={counts?.app_status_cancelled} />
        <StatusItem label="No Slot" value={counts?.app_status_no_slot} />
        <StatusItem label="Duplicate" value={counts?.app_status_duplicate} />
      </Panel>
    </ScrollView>
  );
};

export default DashboardContent;
