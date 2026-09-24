import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, Image, ScrollView, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationService, type Notification as AppNotification } from '../services/notificationService';
import { formUIService } from '../services/formUIService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import ConfirmationModal from '../modals/MoveToJoModal';

interface HeaderProps {
  onToggleSidebar?: () => void;
  onSearch?: (query: string) => void;
  onNavigate?: (section: string) => void;
  onLogout?: () => void;
  activeSection?: string;
}

const Header: React.FC<HeaderProps> = ({ onToggleSidebar, onSearch, onNavigate, onLogout, activeSection }) => {
  const isDarkMode = false; // Forced light mode as per user request
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const notificationRef = useRef<View>(null);
  const mountedRef = useRef(true);
  const previousCountRef = useRef(0);
  const previousNotificationIdsRef = useRef<Set<number>>(new Set());

  const convertGoogleDriveUrl = (url: string): string => {
    if (!url) return '';
    const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || '';
    return `${apiUrl}/proxy/image?url=${encodeURIComponent(url)}`;
  };

  useEffect(() => {
    const fetchLogo = async () => {
      try {
        const config = await formUIService.getConfig();
        if (config && config.logo_url) {
          const directUrl = convertGoogleDriveUrl(config.logo_url);
          setLogoUrl(directUrl);
        }
      } catch (error) {
        console.error('[Logo] Error fetching logo:', error);
      }
    };
    fetchLogo();
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

    return () => {
      mountedRef.current = false;
    };
  }, []);



  useEffect(() => {
    const fetchInitialData = async () => {
      if (!mountedRef.current) return;

      console.log('[Fetch] Fetching initial notification data...');

      try {
        const data = await notificationService.getRecentApplications(10);
        const count = await notificationService.getUnreadCount();

        console.log('[Fetch] Initial data received:', {
          notificationCount: data.length,
          unreadCount: count,
          notifications: data
        });

        if (mountedRef.current) {
          previousCountRef.current = count;
          setUnreadCount(count);
          setNotifications(data);
          previousNotificationIdsRef.current = new Set(data.map(n => n.id));

          console.log('[Fetch] State updated with initial data');
        }
      } catch (error) {
        console.error('[Fetch] Failed to fetch initial notifications:', error);
      }
    };

    fetchInitialData();

    const interval = setInterval(async () => {
      if (!mountedRef.current) return;

      console.log('[Polling] Checking for new notifications...');

      try {
        const data = await notificationService.getRecentApplications(10);
        const count = await notificationService.getUnreadCount();

        console.log('[Polling] Data received:', {
          notificationCount: data.length,
          unreadCount: count,
          previousIds: Array.from(previousNotificationIdsRef.current)
        });

        if (mountedRef.current) {
          const currentIds = new Set(data.map(n => n.id));
          const newNotifications = data.filter(n => !previousNotificationIdsRef.current.has(n.id));

          if (newNotifications.length > 0) {
            console.log('[Polling] NEW NOTIFICATIONS DETECTED:', newNotifications.length);
            console.log('[Polling] New notification details:', newNotifications);
          } else {
            console.log('[Polling] No new notifications');
          }

          previousNotificationIdsRef.current = currentIds;
          previousCountRef.current = count;
          setUnreadCount(count);
          setNotifications(data);
        }
      } catch (error) {
        console.error('[Polling] Failed to fetch notifications:', error);
      }
    }, 30000);

    console.log('[Polling] Interval started - checking every 30 seconds');

    return () => {
      console.log('[Polling] Interval cleared');
      clearInterval(interval);
    };
  }, []);

  const handleToggleClick = () => {
    if (onToggleSidebar) {
      onToggleSidebar();
    }
  };


  const toggleNotifications = async () => {
    console.log('[UI] Toggling notifications modal');
    setShowNotifications(!showNotifications);

    if (!showNotifications) {
      setLoading(true);
      console.log('[UI] Loading notifications for modal...');

      try {
        const data = await notificationService.getRecentApplications(10);
        console.log('[UI] Notifications loaded for modal:', data);

        if (mountedRef.current) {
          setNotifications(data);
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

  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const loadUser = async () => {
      const storedUser = await AsyncStorage.getItem('authData');
      if (storedUser) {
        try {
          setUser(JSON.parse(storedUser));
        } catch (e) {
          console.error("Failed to parse user data");
        }
      }
    };
    loadUser();
  }, []);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const handleLogoutPress = async () => {
    await AsyncStorage.removeItem('token');
    await AsyncStorage.removeItem('authData');
    if (onLogout) {
      onLogout();
    }
    setIsLogoutModalOpen(false);
  };

  // Customer Header (Role: customer)
  if (user && user.role === 'customer') {
    return (
      <SafeAreaView edges={['top']} style={{
        backgroundColor: '#ffffff',
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        width: '100%',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
        zIndex: 50
      }}>
        <View style={{
          height: 64,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: isTablet ? 48 : 24,
          width: '100%'
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {logoUrl ? (
              <Image
                source={{ uri: logoUrl }}
                style={{ height: 32, width: 100, resizeMode: 'contain' }}
                onError={(e) => {
                  console.error('[Logo] Failed to load image from:', logoUrl);
                }}
              />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{
                  width: 32,
                  height: 32,
                  backgroundColor: '#0f172a',
                  borderRadius: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 8
                }}>
                  <Text style={{ color: '#ffffff', fontWeight: 'bold', fontSize: 12 }}>A</Text>
                </View>
                <Text style={{ color: '#0f172a', fontWeight: 'bold', fontSize: 18, letterSpacing: 0.5 }}>
                  GOWISER <Text style={{ fontWeight: '800', color: '#0f172a' }}>PORTAL</Text>
                </Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 32 }}>
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 24,
              display: isTablet ? 'flex' : 'none'
            }}>
              <Pressable onPress={() => onNavigate?.('customer-dashboard')}>
                <Text style={{
                  color: activeSection === 'customer-dashboard' || !activeSection ? (colorPalette?.primary || '#0f172a') : '#6b7280',
                  fontWeight: 'bold',
                  fontSize: 14
                }}>
                  Dashboard
                </Text>
              </Pressable>
              <Pressable onPress={() => onNavigate?.('customer-bills')}>
                <Text style={{
                  color: activeSection === 'customer-bills' ? (colorPalette?.primary || '#0f172a') : '#6b7280',
                  fontWeight: 'bold',
                  fontSize: 14
                }}>
                  Bills
                </Text>
              </Pressable>
              <Pressable onPress={() => onNavigate?.('customer-support')}>
                <Text style={{
                  color: activeSection === 'customer-support' ? (colorPalette?.primary || '#0f172a') : '#6b7280',
                  fontWeight: 'bold',
                  fontSize: 14
                }}>
                  Support
                </Text>
              </Pressable>
            </View>

          </View>
        </View>

      </SafeAreaView>
    );
  }

  // Admin/Staff Header (Original)
  return (
    <SafeAreaView edges={['top']} style={{
      backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#4b5563' : '#d1d5db',
      width: '100%'
    }}>
      <View style={{
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {logoUrl && (
              <Image
                source={{ uri: logoUrl }}
                style={{ height: 40, width: 120, resizeMode: 'contain' }}
                onError={(e) => {
                  console.error('[Logo] Failed to load image from:', logoUrl);
                }}
              />
            )}
            <Text style={{
              color: isDarkMode ? '#ffffff' : '#111827',
              fontSize: 12,
              fontWeight: '600'
            }}>
              Powered by Sync
            </Text>
          </View>
        </View>

        <View style={{ flex: 1 }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>

          <View style={{ position: 'relative' }}>
            <Pressable
              onPress={toggleNotifications}
              style={{ padding: 8, position: 'relative' }}
            >
              <Bell size={20} color={isDarkMode ? '#9ca3af' : '#4b5563'} />
              {unreadCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 8,
                  height: 8,
                  backgroundColor: '#ef4444',
                  borderRadius: 4
                }} />
              )}
            </Pressable>

            {showNotifications && (
              <View style={{
                position: 'absolute',
                right: 0,
                top: 48,
                width: 384,
                borderRadius: 8,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 8,
                elevation: 8,
                backgroundColor: isDarkMode ? '#1f2937' : '#ffffff',
                borderWidth: 1,
                borderColor: isDarkMode ? '#374151' : '#e5e7eb',
                zIndex: 50
              }}>
                <View style={{
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb'
                }}>
                  <Text style={{
                    fontWeight: '600',
                    color: isDarkMode ? '#ffffff' : '#111827'
                  }}>
                    Recent Applications ({notifications.length})
                  </Text>
                </View>
                <ScrollView style={{ maxHeight: 384 }}>
                  {loading ? (
                    <View style={{
                      padding: 16,
                      alignItems: 'center'
                    }}>
                      <Text style={{
                        color: isDarkMode ? '#9ca3af' : '#4b5563'
                      }}>
                        Loading...
                      </Text>
                    </View>
                  ) : notifications.length === 0 ? (
                    <View style={{
                      padding: 16,
                      alignItems: 'center'
                    }}>
                      <Text style={{
                        color: isDarkMode ? '#9ca3af' : '#4b5563'
                      }}>
                        No new applications
                      </Text>
                    </View>
                  ) : (
                    notifications.map((notification) => (
                      <Pressable
                        key={notification.id}
                        style={{
                          padding: 16,
                          borderBottomWidth: 1,
                          borderBottomColor: isDarkMode ? '#374151' : '#e5e7eb'
                        }}
                      >
                        <Text style={{
                          fontWeight: '500',
                          color: isDarkMode ? '#ffffff' : '#111827'
                        }}>
                          {notification.customer_name}
                        </Text>
                        <Text style={{
                          fontSize: 14,
                          color: isDarkMode ? '#9ca3af' : '#4b5563'
                        }}>
                          Plan: {notification.plan_name}
                        </Text>
                        <Text style={{
                          fontSize: 12,
                          marginTop: 4,
                          color: isDarkMode ? '#6b7280' : '#6b7280'
                        }}>
                          {notification.formatted_date}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default Header;
