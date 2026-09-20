import React, { useState, useEffect, useRef } from 'react';
import { Bell, Menu, X, Sun, Moon } from 'lucide-react';
import pusher from '../services/pusherService';
import { notificationService, type Notification as AppNotification } from '../services/notificationService';
import { userSettingsService } from '../services/userSettingsService';
import NotificationToast from '../components/NotificationToast';
import { formUIService } from '../services/formUIService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface HeaderProps {
  onToggleSidebar?: () => void;
  onSearch?: (query: string) => void;
  onNavigate?: (section: string) => void;
  onLogout?: () => void;
  activeSection?: string;
}

const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onSearch, onNavigate, onLogout, activeSection }) => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isTogglingDarkMode, setIsTogglingDarkMode] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const previousCountRef = useRef(0);
  const previousNotificationIdsRef = useRef<Set<number>>(new Set());
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
    if (previousNotificationIdsRef.current.has(notification.id)) {
      return;
    }

    setNotifications(prev => {
      // Avoid duplicates again just in case of race conditions
      if (prev.some(n => n.id === notification.id)) return prev;
      const updated = [notification, ...prev].slice(0, 15);
      previousNotificationIdsRef.current = new Set(updated.map(n => n.id));
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

    const appChannel = pusher.subscribe('applications');
    const jobChannel = pusher.subscribe('job-orders');

    appChannel.bind('new-application', handleSocketUpdate);
    jobChannel.bind('job-order-done', handleJobDoneUpdate);

    return () => {
      appChannel.unbind('new-application', handleSocketUpdate);
      jobChannel.unbind('job-order-done', handleJobDoneUpdate);
      pusher.unsubscribe('applications');
      pusher.unsubscribe('job-orders');
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
          previousNotificationIdsRef.current = new Set(filteredData.map(n => n.id));
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

          const newNotifications = filteredData.filter(n => !previousNotificationIdsRef.current.has(n.id));

          if (newNotifications.length > 0) {
            newNotifications.forEach(n => handleNewNotification(n));
          } else {
            // If no new ones, just sync the counts and list in case something was removed (though rare)
            setUnreadCount(filteredData.length);
            setNotifications(filteredData);
            previousNotificationIdsRef.current = new Set(filteredData.map(n => n.id));
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
              <img src={logoUrl} alt="ATSS Fiber" className="h-10 object-contain" />
            ) : (
              <div className="flex items-center">
                <span className="text-slate-900 font-bold text-lg tracking-tight hidden sm:inline uppercase">ATSS <span className="font-black">Fiber</span></span>
                <span className="text-slate-900 font-bold text-lg tracking-tight sm:hidden uppercase">ATSS Fiber</span>
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
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
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
                      key={`${notification.type}-${notification.id}`}
                      className={`p-4 border-b ${isDarkMode ? 'border-gray-700 hover:bg-gray-750' : 'border-gray-200 hover:bg-gray-50'
                        } transition-colors cursor-pointer`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${notification.type === 'job_order_done'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400'
                          }`}
                          style={notification.type === 'job_order_done' ? {} : {
                            backgroundColor: colorPalette?.primary ? `${colorPalette.primary}33` : 'rgba(124, 58, 237, 0.2)',
                            color: colorPalette?.primary || '#7c3aed'
                          }}>
                          {notification.type === 'job_order_done' ? 'Job Done' : 'Application'}
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
                        {notification.type === 'job_order_done' ? 'Completed onsite work' : `Plan: ${notification.plan_name}`}
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
          type={toastNotification.type === 'job_order_done' ? 'success' : 'info'}
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
