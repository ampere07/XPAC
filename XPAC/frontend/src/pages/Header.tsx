import React, { useState, useEffect, useRef } from 'react';
import { Bell, Menu, X, Sun, Moon } from 'lucide-react';
import pusher from '../services/pusherService';
import { notificationService, type Notification as AppNotification } from '../services/notificationService';
import { userSettingsService } from '../services/userSettingsService';
import NotificationToast from '../components/NotificationToast';
import { formUIService } from '../services/formUIService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { getNavBadgeCounts, EMPTY_NAV_BADGE_COUNTS, NavBadgeCounts } from '../services/navBadgeService';
import { usePermissions } from '../hooks/usePermissions';

interface HeaderProps {
  onToggleSidebar?: () => void;
  onSearch?: (query: string) => void;
  onNavigate?: (section: string, extra?: string) => void;
  onLogout?: () => void;
  activeSection?: string;
}

/**
 * How each notification kind presents itself.
 *
 * Lookup tables rather than nested ternaries: the feed has grown to five kinds and
 * adding a sixth should be one row here, not another branch in three places.
 * `application` is the fallback because it is the oldest kind and the only one that
 * an older payload can arrive without a `type` at all.
 */
const NOTIFICATION_BADGES: Record<string, { label: string; className: string }> = {
  job_order_done: {
    label: 'Job Done',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
  service_order_done: {
    label: 'Service Done',
    className: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
  },
  // Rose, not the sky of a plain completed visit: this one moved money onto a
  // customer's balance and is worth picking out of a run of finished visits.
  service_order_charge_claimed: {
    label: 'Charge Claimed',
    className: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400',
  },
  // Amber: the one kind that asks the reader to decide something rather than
  // reporting something that already happened.
  transaction_revert: {
    label: 'Revert',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  },
  application: {
    label: 'Application',
    className: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  },
};

/**
 * The "Needs attention" rows in the bell dropdown.
 *
 * Distinct from the notification feed below them: the feed is a stream of things that HAPPENED
 * and can be cleared, whereas these are counts of work still OUTSTANDING and clear themselves
 * only when the work is done. Same five counts the sidebar badges use.
 *
 * `section` matches the ids Sidebar/App route on, so a row navigates exactly where the
 * corresponding menu item would.
 */
const ATTENTION_ROWS: { key: keyof NavBadgeCounts; label: string; section: string }[] = [
  { key: 'application', label: 'Applications', section: 'application-management' },
  { key: 'job_order', label: 'Job Orders', section: 'job-order' },
  { key: 'service_order', label: 'Service Orders', section: 'service-order' },
  { key: 'work_order', label: 'Work Orders', section: 'work-order' },
  { key: 'transaction', label: 'Transactions', section: 'transaction-list' },
];

/**
 * Identity of a feed row, for dedupe and for React keys.
 *
 * Kind AND id, because ids are only unique within a kind — one service order
 * legitimately produces both a `service_order_done` and a
 * `service_order_charge_claimed` row carrying its own id, and an id-only key
 * would silently discard the second one as a duplicate of the first.
 */
const notificationKeyFor = (notification: Pick<AppNotification, 'id' | 'type'>) =>
  `${notification.type || 'application'}-${notification.id}`;

/** Toast severity per kind. 'info' is the fallback for anything unmapped. */
const TOAST_TONES: Record<string, 'info' | 'success' | 'warning' | 'error'> = {
  job_order_done: 'success',
  // Warning, not success: a claimed charge is money added to a customer's balance
  // and may want a second look, so it should not read as a job well done.
  service_order_charge_claimed: 'warning',
};

const toastToneFor = (type?: string) => TOAST_TONES[type || ''] ?? 'info';

const badgeLabelFor = (type?: string) => NOTIFICATION_BADGES[type || 'application']?.label ?? 'Notification';
const badgeStyleFor = (type?: string) =>
  (NOTIFICATION_BADGES[type || 'application'] ?? NOTIFICATION_BADGES.application).className;

/** The one-line description under the customer name. */
const summaryFor = (notification: AppNotification): string => {
  switch (notification.type) {
    case 'job_order_done':
      return 'Completed onsite work';
    case 'service_order_done':
      // The concern, so what the visit was about is visible without opening it.
      return notification.plan_name ? `Visit done · ${notification.plan_name}` : 'Completed service visit';
    case 'service_order_charge_claimed':
      // Amount and claimant: the two things checked before deciding whether the
      // charge needs a second look. plan_name carries the formatted amount.
      return notification.technician
        ? `Service charge ${notification.plan_name} · ${notification.technician}`
        : `Service charge ${notification.plan_name}`;
    case 'transaction_revert':
      // The amount, so the size of what is being undone is visible without opening it.
      return `Revert requested · ${notification.plan_name}`;
    default:
      return `Plan: ${notification.plan_name}`;
  }
};

const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onSearch, onNavigate, onLogout, activeSection }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [showNotifications, setShowNotifications] = useState(false);
  // Dashboard refuses a section the role cannot open, so the bell only offers
  // shortcuts into sections this user can open: those it holds, and for a
  // seeded role the bell shortcuts it has always had (WEB_REACHABLE).
  const { canOpen } = usePermissions();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  // Outstanding-work counts shown above the feed. Kept separate from `unreadCount` because
  // "Clear All" dismisses notifications and must never appear to dismiss real pending work.
  const [navBadges, setNavBadges] = useState<NavBadgeCounts>(EMPTY_NAV_BADGE_COUNTS);
  const [loading, setLoading] = useState(false);
  const [isTogglingDarkMode, setIsTogglingDarkMode] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const previousCountRef = useRef(0);
  const previousNotificationIdsRef = useRef<Set<string>>(new Set());
  const [toastNotification, setToastNotification] = useState<AppNotification | null>(null);

  const convertGoogleDriveUrl = (url: string): string => {
    if (!url) return '';
    const apiUrl = process.env.REACT_APP_API_BASE_URL;
    return `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
  };

  const fetchLogo = async () => {
    try {
      const config = await formUIService.getConfig();
      if (config && config.logo_url) {
        const directUrl = convertGoogleDriveUrl(config.logo_url);
        setLogoUrl(directUrl);
      } else {
        setLogoUrl(null);
      }
    } catch (error) {
      console.error('[Logo] Error fetching logo:', error);
    }
  };

  useEffect(() => {
    fetchLogo();
  }, []);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'logoUpdated' || !e.key) {
        fetchLogo();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Also listen for manual dispatch on the same window
    const handleCustomLogoUpdate = () => {
      fetchLogo();
    };
    window.addEventListener('logo-updated', handleCustomLogoUpdate);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('logo-updated', handleCustomLogoUpdate);
    };
  }, []);

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
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    } else {
      console.error('[Notification] API not supported in this browser');
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

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

    return () => observer.disconnect();
  }, []);

  const showBrowserNotification = (notification: AppNotification) => {
    if (!('Notification' in window)) {
      return;
    }

    if (Notification.permission !== 'granted') {
      return;
    }

    try {
      const title = notification.title || (notification.type === 'job_order_done'
        ? '✅ Job Order Completed'
        : '🔔 New Customer Application');

      const body = notification.message || (notification.type === 'job_order_done'
        ? `${notification.customer_name}\nPlan: ${notification.plan_name}\nStatus: Done`
        : `${notification.customer_name}\nPlan: ${notification.plan_name}`);

      const options: NotificationOptions = {
        body: body,
        icon: logoUrl || undefined,
        badge: logoUrl || undefined,
        tag: `${notification.type || 'application'}-${notification.id}`,
        requireInteraction: true,
        silent: false,
        data: { url: window.location.origin }
      };

      // Try to use Service Worker for better background reliability
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(registration => {
          registration.showNotification(title, options);
        });
      } else {
        // Fallback to standard notification if SW not active
        const browserNotification = new Notification(title, options);
        browserNotification.onclick = () => {
          window.focus();
          browserNotification.close();
        };
      }
    } catch (error) {
      console.error('[Browser Notification] Failed to create notification:', error);
    }
  };

  const handleNewNotification = (notification: AppNotification) => {
    if (!mountedRef.current) return;

    // Check against cleared state
    const lastClearedId = parseInt(localStorage.getItem('notifications_last_cleared_id') || '0');
    const lastClearedTime = parseInt(localStorage.getItem('notifications_last_cleared_time') || '0');

    // Normalize timestamp to ms
    const nTime = notification.timestamp ?
      (notification.timestamp > 10000000000 ? notification.timestamp : notification.timestamp * 1000) :
      Date.now();

    let isCleared = false;
    isCleared = (notification.id <= lastClearedId && lastClearedId > 0) || (nTime <= lastClearedTime);

    if (isCleared) {
      return;
    }

    // Check if we already have this notification to avoid duplicates
    if (previousNotificationIdsRef.current.has(notificationKeyFor(notification))) {
      return;
    }

    setNotifications(prev => {
      // Avoid duplicates again just in case of race conditions
      if (prev.some(n => notificationKeyFor(n) === notificationKeyFor(notification))) return prev;
      const updated = [notification, ...prev].slice(0, 15);
      previousNotificationIdsRef.current = new Set(updated.map(notificationKeyFor));
      return updated;
    });

    setUnreadCount(prev => prev + 1);
    setToastNotification(notification);
    showBrowserNotification(notification);
  };

  // Socket.IO Integration
  useEffect(() => {
    const handleSocketUpdate = (data: any) => {
      handleNewNotification({
        id: data.id,
        type: 'application',
        customer_name: data.customer_name,
        plan_name: data.plan_name,
        timestamp: data.timestamp || Date.now(),
        formatted_date: data.formatted_date || 'Just now',
        title: data.title || 'New Application',
        message: data.message || `${data.customer_name} - ${data.plan_name}`
      });
    };

    const handleJobDoneUpdate = (data: any) => {
      handleNewNotification({
        id: data.id,
        type: 'job_order_done',
        customer_name: data.customer_name,
        plan_name: data.plan_name,
        timestamp: data.timestamp || Date.now(),
        formatted_date: data.formatted_date || 'Just now',
        title: data.title || 'Job Order Done',
        message: data.message || `${data.customer_name} - ${data.plan_name}`
      });
    };

    /**
     * A technician claimed a service charge.
     *
     * The socket payload is already the same shape the consolidated feed returns,
     * so `title`/`message` are taken as sent rather than rebuilt here — the desktop
     * notification then reads identically whether it arrived over the socket or was
     * found by the polling fallback.
     */
    const handleServiceChargeUpdate = (data: any) => {
      handleNewNotification({
        id: data.id,
        type: 'service_order_charge_claimed',
        customer_name: data.customer_name,
        plan_name: data.plan_name,
        technician: data.technician ?? null,
        timestamp: data.timestamp || Date.now(),
        formatted_date: data.formatted_date || 'Just now',
        title: data.title || 'Service Charge Claimed',
        message: data.message || `${data.customer_name} - ${data.plan_name}`
      });
    };

    const appChannel = pusher.subscribe('applications');
    const jobChannel = pusher.subscribe('job-orders');
    // 'service-charges', not the shared 'service-orders': other pages unsubscribe
    // that one on unmount, which would silently drop this binding.
    const serviceChannel = pusher.subscribe('service-charges');

    appChannel.bind('new-application', handleSocketUpdate);
    jobChannel.bind('job-order-done', handleJobDoneUpdate);
    serviceChannel.bind('service-charge-claimed', handleServiceChargeUpdate);

    return () => {
      appChannel.unbind('new-application', handleSocketUpdate);
      jobChannel.unbind('job-order-done', handleJobDoneUpdate);
      serviceChannel.unbind('service-charge-claimed', handleServiceChargeUpdate);
      pusher.unsubscribe('applications');
      pusher.unsubscribe('job-orders');
      pusher.unsubscribe('service-charges');
    };
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      if (!mountedRef.current) return;

      try {
        const data = await notificationService.getConsolidatedStream(10);
        const count = await notificationService.getUnreadCount();

        if (mountedRef.current) {
          const lastClearedId = parseInt(localStorage.getItem('notifications_last_cleared_id') || '0');
          const lastClearedTime = parseInt(localStorage.getItem('notifications_last_cleared_time') || '0');

          const filteredData = data.filter(n => {
            const nTime = n.timestamp ? (n.timestamp > 10000000000 ? n.timestamp : n.timestamp * 1000) : Date.now();
            const isCleared = (n.id <= lastClearedId && lastClearedId > 0) || (nTime <= lastClearedTime);
            return !isCleared;
          });

          previousCountRef.current = filteredData.length;
          setUnreadCount(filteredData.length);
          setNotifications(filteredData);
          previousNotificationIdsRef.current = new Set(filteredData.map(notificationKeyFor));
        }
      } catch (error) {
        console.error('[Fetch] Failed to fetch initial notifications:', error);
      }
    };

    fetchInitialData();

    // Keep polling as a backup, but with longer interval if socket is preferred
    const interval = setInterval(async () => {
      if (!mountedRef.current) return;

      try {
        const data = await notificationService.getConsolidatedStream(10);
        const count = await notificationService.getUnreadCount();

        if (mountedRef.current) {
          const lastClearedId = parseInt(localStorage.getItem('notifications_last_cleared_id') || '0');
          const lastClearedTime = parseInt(localStorage.getItem('notifications_last_cleared_time') || '0');

          const filteredData = data.filter(n => {
            const nTime = n.timestamp ? (n.timestamp > 10000000000 ? n.timestamp : n.timestamp * 1000) : Date.now();
            const isCleared = (n.id <= lastClearedId && lastClearedId > 0) || (nTime <= lastClearedTime);
            return !isCleared;
          });

          const newNotifications = filteredData.filter(n => !previousNotificationIdsRef.current.has(notificationKeyFor(n)));

          if (newNotifications.length > 0) {
            newNotifications.forEach(n => handleNewNotification(n));
          } else {
            // If no new ones, just sync the counts and list in case something was removed (though rare)
            setUnreadCount(filteredData.length);
            setNotifications(filteredData);
            previousNotificationIdsRef.current = new Set(filteredData.map(notificationKeyFor));
          }
        }
      } catch (error) {
        console.error('[Polling] Failed to fetch notifications:', error);
      }
    }, 10000); // 10 seconds polling fallback

    return () => {
      clearInterval(interval);
    };
  }, []);

  /**
   * Outstanding-work counts for the bell.
   *
   * Polled on a slower cadence than the notification feed above (which is a 10s fallback for a
   * live stream): these counts change when someone finishes a job, not second by second, and the
   * sidebar is already subscribed to the per-entity broadcasts for immediate updates.
   */
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      getNavBadgeCounts().then(counts => {
        if (!cancelled && mountedRef.current) setNavBadges(counts);
      });
    };

    load();
    const interval = setInterval(load, 2 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    if (showNotifications) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  const handleToggleClick = () => {
    if (onToggleSidebar) {
      onToggleSidebar();
    }
  };

  const handleThemeToggle = async () => {
    const newTheme = !isDarkMode;
    const darkmodeValue = newTheme ? 'active' : 'inactive';

    setIsTogglingDarkMode(true);

    try {
      const authData = localStorage.getItem('authData');
      if (authData) {
        const userData = JSON.parse(authData);
        const userId = userData.id;

        if (userId) {
          await userSettingsService.updateDarkMode(userId, darkmodeValue);

          localStorage.setItem('theme', newTheme ? 'dark' : 'light');
          if (newTheme) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
          setIsDarkMode(newTheme);
        }
      }
    } catch (error) {
      console.error('Failed to update dark mode:', error);
    } finally {
      setIsTogglingDarkMode(false);
    }
  };



  const toggleNotifications = async () => {
    setShowNotifications(!showNotifications);

    if (!showNotifications) {
      setLoading(true);

      try {
        const data = await notificationService.getConsolidatedStream(10);

        const lastClearedId = parseInt(localStorage.getItem('notifications_last_cleared_id') || '0');
        const lastClearedTime = parseInt(localStorage.getItem('notifications_last_cleared_time') || '0');

        const filteredData = data.filter(n => {
          const nTime = n.timestamp ? (n.timestamp > 10000000000 ? n.timestamp : n.timestamp * 1000) : Date.now();
          const isCleared = (n.id <= lastClearedId && lastClearedId > 0) || (nTime <= lastClearedTime);
          return !isCleared;
        });

        if (mountedRef.current) {
          setNotifications(filteredData);
          setUnreadCount(filteredData.length);
        }
      } catch (error) {
        console.error('[UI] Failed to fetch notifications for modal:', error);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    }
  };

  /**
   * Open the record a notification is about.
   *
   * The consolidated feed carries the row id in `id`, keyed by `type` — an
   * application id or a job order id — so each kind routes to its own section and
   * hands the id along as the section payload. Same mechanism Customer already
   * uses to auto-open an account from elsewhere in the app.
   *
   * The panel closes first: the details panel it opens would otherwise appear
   * behind this dropdown.
   */
  const handleNotificationClick = (notification: AppNotification) => {
    setShowNotifications(false);

    if (!onNavigate || !notification.id) return;

    let section: string;
    if (notification.type === 'job_order_done') {
      section = 'job-order';
    } else if (notification.type === 'service_order_done' || notification.type === 'service_order_charge_claimed') {
      // Both point at the same record — the charge is a field on the service order.
      section = 'service-order';
    } else if (notification.type === 'transaction_revert') {
      section = 'transactions-revert';
    } else {
      section = 'application-management';
    }

    // Opening a record in a section this role cannot open would only land on
    // the access-denied screen.
    if (!canOpen(section)) return;

    onNavigate(section, String(notification.id));
  };

  const handleClearAll = () => {

    // Always update the time to "now"
    const now = Date.now();
    localStorage.setItem('notifications_last_cleared_time', now.toString());

    // Set the latest notification ID to localStorage to filter them out
    if (notifications.length > 0) {
      const maxId = Math.max(...notifications.map(n => n.id));
      localStorage.setItem('notifications_last_cleared_id', maxId.toString());
    }

    setNotifications([]);
    setUnreadCount(0);
    // Do not clear previousNotificationIdsRef to prevent polling from re-handling old notifications
    setShowNotifications(false);
  };

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('authData');
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        console.error("Failed to parse user data");
      }
    }
  }, []);

  // Customer Header (Role: customer)
  if (user && user.role === 'customer') {
    return (
      <header className={`bg-white border-b flex flex-col w-full shadow-sm z-[100] sticky top-0 transition-all duration-300 ${isMobileMenuOpen ? 'h-auto' : 'h-16'}`}>
        <div className="h-16 flex items-center justify-between px-6 md:px-12 w-full">
          <div className="flex items-center">
            {/* Logo Section */}
            {logoUrl ? (
              <img src={logoUrl} alt="GOWISER" className="h-10 object-contain" />
            ) : (
              <div className="flex items-center">
                <span className="text-slate-900 font-bold text-lg tracking-tight hidden sm:inline uppercase"><span className="font-black">GOWISER</span></span>
                <span className="text-slate-900 font-bold text-lg tracking-tight sm:hidden uppercase">GOWISER</span>
              </div>
            )}
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <nav className="flex items-center space-x-8 text-sm font-bold">
              <button
                onClick={() => onNavigate?.('customer-dashboard')}
                className="transition hover:opacity-80"
                style={{ color: activeSection === 'customer-dashboard' || !activeSection ? (colorPalette?.primary || '#7c3aed') : '#6b7280' }}
              >
                Dashboard
              </button>
              <button
                onClick={() => onNavigate?.('customer-bills')}
                className="transition hover:opacity-80"
                style={{ color: activeSection === 'customer-bills' ? (colorPalette?.primary || '#7c3aed') : '#6b7280' }}
              >
                Bills
              </button>
              <button
                onClick={() => onNavigate?.('customer-support')}
                className="transition hover:opacity-80"
                style={{ color: activeSection === 'customer-support' ? (colorPalette?.primary || '#7c3aed') : '#6b7280' }}
              >
                Support
              </button>
            </nav>

            <button
              onClick={() => {
                localStorage.removeItem('token');
                localStorage.removeItem('authData');
                if (onLogout) {
                  onLogout();
                } else {
                  window.location.href = '/';
                }
              }}
              className="px-6 py-2 border rounded-full text-sm font-bold transition"
              style={{
                color: colorPalette?.primary || '#7c3aed',
                borderColor: colorPalette?.primary || '#7c3aed'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = `${colorPalette?.primary || '#7c3aed'}10`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              Logout
            </button>
          </div>

          {/* Mobile Hamburger - Right Side */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-1.5 text-gray-700 transition hover:bg-gray-50 active:scale-95"
          >
            {isMobileMenuOpen ? <X className="w-8 h-8" /> : <Menu className="w-8 h-8" />}
          </button>
        </div>

        {/* Mobile Dropdown Navigation */}
        {isMobileMenuOpen && (
          <div className="md:hidden w-full bg-white animate-in slide-in-from-top duration-300 ease-out border-t overflow-hidden">
            <nav className="flex flex-col items-center py-8 space-y-6">
              <button
                onClick={() => {
                  onNavigate?.('customer-dashboard');
                  setIsMobileMenuOpen(false);
                }}
                className={`text-lg transition ${activeSection === 'customer-dashboard' || !activeSection ? 'font-bold text-slate-800' : 'text-gray-600'}`}
              >
                Dashboard
              </button>
              <button
                onClick={() => {
                  onNavigate?.('customer-bills');
                  setIsMobileMenuOpen(false);
                }}
                className={`text-lg transition ${activeSection === 'customer-bills' ? 'font-bold text-slate-800' : 'text-gray-600'}`}
              >
                Bills
              </button>
              <button
                onClick={() => {
                  onNavigate?.('customer-support');
                  setIsMobileMenuOpen(false);
                }}
                className={`text-lg transition ${activeSection === 'customer-support' ? 'font-black text-slate-900' : 'text-gray-600'}`}
              >
                Support
              </button>

              <div className="pt-2 w-full flex justify-center">
                <button
                  onClick={() => {
                    localStorage.removeItem('token');
                    localStorage.removeItem('authData');
                    if (onLogout) {
                      onLogout();
                    } else {
                      window.location.href = '/';
                    }
                  }}
                  className="px-14 py-2 border rounded-full text-sm font-medium transition active:scale-95"
                  style={{
                    color: colorPalette?.primary || '#7c3aed',
                    borderColor: colorPalette?.primary || '#7c3aed'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = `${colorPalette?.primary || '#7c3aed'}10`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Logout
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>
    );
  }

  // Outstanding work the bell can take this user to. Every seeded staff role can
  // open all five queues (WEB_REACHABLE), so this is navBadges.total for them; a
  // custom role counts only the queues it can open, the rows it is shown.
  const attentionTotal = ATTENTION_ROWS.reduce(
    (sum, row) => sum + (canOpen(row.section) ? navBadges[row.key] : 0),
    0
  );

  // Admin/Staff Header (Original)
  return (
    <header className={`${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'
      } border-b h-16 flex items-center px-4`}>
      <div className="flex items-center space-x-4">
        <button
          onClick={handleToggleClick}
          className={`${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-black'
            } p-2 transition-colors cursor-pointer`}
          type="button"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex flex-col items-center space-y-1">
          {logoUrl && (
            <img
              src={logoUrl}
              alt="Logo"
              className="h-10 object-contain"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
              onError={(e) => {
                console.error('[Logo] Failed to load image from:', logoUrl);
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
          <h1 className={`${isDarkMode ? 'text-white' : 'text-gray-900'
            } text-xs font-semibold`}>
            Powered by SYNC
          </h1>
        </div>
      </div>

      <div className="flex-1"></div>

      <div className="flex items-center space-x-2">
        <button
          onClick={handleThemeToggle}
          disabled={isTogglingDarkMode}
          className={`p-2 rounded-full transition-colors ${isDarkMode
            ? 'text-yellow-400 hover:bg-gray-700'
            : 'text-gray-600 hover:bg-gray-100'
            } ${isTogglingDarkMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <div className="relative" ref={notificationRef}>
          <button
            onClick={toggleNotifications}
            className={`p-2 relative ${isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-black'
              } transition-colors`}
          >
            <Bell className="h-5 w-5" />
            {/* Numeric, not a bare dot: the count is the point — staff need to know whether one
                thing is waiting or thirty without opening the panel. Totals the outstanding work
                AND the unread feed, since both are things the bell is telling them about.
                Capped at 99+ so a large backlog cannot stretch the header. */}
            {(attentionTotal + unreadCount) > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                {(attentionTotal + unreadCount) > 99 ? '99+' : (attentionTotal + unreadCount)}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className={`absolute right-0 mt-2 w-96 rounded-lg shadow-lg ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
              } border z-50`}>
              <div className={`p-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'
                } flex justify-between items-center`}>
                <h3 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'
                  }`}>
                  Recent Notifications ({notifications.length})
                </h3>
                {notifications.length > 0 && (
                  <button
                    onClick={handleClearAll}
                    style={{ color: colorPalette?.primary || '#7c3aed' }}
                    className="text-xs font-medium transition-colors"
                  >
                    Clear All
                  </button>
                )}
              </div>
              {/* Needs attention — outstanding work, above the feed and deliberately outside the
                  "Clear All" scope: these clear when the work is done, not when dismissed.
                  Hidden entirely when everything is at zero so a quiet queue costs no space. */}
              {ATTENTION_ROWS.some(row => navBadges[row.key] > 0 && canOpen(row.section)) && (
                <div className={`px-4 py-3 border-b ${isDarkMode ? 'border-gray-700 bg-gray-900/40' : 'border-gray-200 bg-gray-50'}`}>
                  <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Needs Attention
                  </div>
                  <div className="space-y-1">
                    {ATTENTION_ROWS.filter(row => navBadges[row.key] > 0 && canOpen(row.section)).map(row => (
                      <button
                        key={row.key}
                        onClick={() => {
                          setShowNotifications(false);
                          onNavigate?.(row.section);
                        }}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors ${isDarkMode ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-200 text-gray-700'
                          }`}
                      >
                        <span>{row.label}</span>
                        <span
                          className="min-w-[20px] px-1.5 py-0.5 rounded-full text-xs font-bold text-white text-center"
                          style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                        >
                          {navBadges[row.key] > 99 ? '99+' : navBadges[row.key]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="max-h-96 overflow-y-auto">
                {loading ? (
                  <div className={`p-4 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    Loading...
                  </div>
                ) : notifications.length === 0 ? (
                  <div className={`p-4 text-center ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                    }`}>
                    No new applications
                  </div>
                ) : (
                  notifications.map((notification) => (
                    <div
                      key={notificationKeyFor(notification)}
                      onClick={() => handleNotificationClick(notification)}
                      className={`p-4 border-b ${isDarkMode ? 'border-gray-700 hover:bg-gray-750' : 'border-gray-200 hover:bg-gray-50'
                        } transition-colors cursor-pointer`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeStyleFor(notification.type)}`}
                          // Only Application follows the palette; the rest carry a fixed
                          // colour so a status reads the same whatever the theme is set to.
                          style={notification.type && notification.type !== 'application' ? {} : {
                            backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
                            color: colorPalette?.primary || '#7c3aed'
                          }}>
                          {badgeLabelFor(notification.type)}
                        </span>
                        <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                          {notification.formatted_date}
                        </span>
                      </div>
                      <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}>
                        {notification.customer_name}
                      </div>
                      <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'
                        }`}>
                        {summaryFor(notification)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {toastNotification && (
        <NotificationToast
          isVisible={true}
          title={toastNotification.title || (toastNotification.type === 'job_order_done' ? 'Job Order Completed' : 'New Application Received')}
          message={toastNotification.message || `${toastNotification.customer_name} - ${toastNotification.plan_name}`}
          type={toastToneFor(toastNotification.type)}
          onClose={() => setToastNotification(null)}
          onClick={() => {
            setToastNotification(null);
            if (!showNotifications) toggleNotifications();
          }}
        />
      )}
    </header>
  );
};

export default Header;
