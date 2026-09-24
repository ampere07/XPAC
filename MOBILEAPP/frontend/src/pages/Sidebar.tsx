import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, Animated, useWindowDimensions, ScrollView, LayoutAnimation, Platform, UIManager } from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import {
  FileCheck, Wrench, MapPinned, Settings, LayoutDashboard, ReceiptText, LifeBuoy,
  Menu as MenuIcon, Package, List, ClipboardCheck, X, ChevronUp,
  CreditCard, FileText, Receipt, Clock,
  MessageSquare, Network, AlertCircle, Router, Server, Wifi, Send, Cable, MapPin, Mail,
  MessageSquareText, Wallet, Gauge, Layers, Ticket
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import { useNavBadgeCounts, NavBadgeCounts } from '../hooks/useNavBadgeCounts';
import { useCustomerDataContextOptional } from '../contexts/CustomerDataContext';
import { usePermissions } from '../hooks/usePermissions';
import { AuthLike, ROLE, isLockedRole, permissionForSection } from '../config/permissions';

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  isCollapsed?: boolean;
  userRole: string;
  userEmail?: string;
  roleId?: number | string;
  /** The signed-in account, so the bar follows a /me/permissions refresh. */
  auth?: AuthLike | null;
}

/**
 * A tab-bar entry.
 *
 * What a role may open is decided by the permission table, keyed on `id`
 * through config/permissions.ts: the same key the screen itself checks and the
 * API demands.
 */
interface MenuItem {
  id: string;
  label: string;
  icon: React.ElementType;
  /** The key(s) this entry is listed under, when not the one its section resolves to. */
  requires?: string | string[];
  /**
   * Restrict this entry to particular seeded roles, on top of the permission
   * check. Needed where keys cannot express the answer: SuperAdmin holds the
   * wildcard, which matches the customer and agent portal keys too, and those
   * entries have only ever been shown to the customer and the agent. Custom
   * roles are decided by their keys alone.
   */
  onlyRoles?: number[];
  isMenuPage?: boolean;
}

interface NavGroup {
  title: string;
  items: MenuItem[];
}

/**
 * Count bubble on a bottom-bar icon.
 *
 * Renders nothing at zero: an empty queue is shown by the absence of a badge, and
 * a "0" would draw the eye to the one tab with nothing to do. Anything past 99 is
 * capped, because the bubble has to stay inside the tab.
 */
const NavBadge: React.FC<{ count?: number }> = ({ count }) => {
  if (!count || count < 1) return null;

  const label = count > 99 ? '99+' : String(count);

  return (
    <View
      style={{
        position: 'absolute',
        top: -6,
        // Nudged further right as the label grows so the bubble stays clear of the
        // icon instead of creeping across it.
        right: label.length > 1 ? -14 : -8,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        paddingHorizontal: 4,
        backgroundColor: '#ef4444',
        alignItems: 'center',
        justifyContent: 'center',
        // Keeps the bubble legible where it overlaps the icon.
        borderWidth: 1.5,
        borderColor: '#ffffff',
      }}
      // One announcement for the tab rather than a stray number after the label.
      accessibilityLabel={`${label} pending`}
    >
      <Text style={{ color: '#ffffff', fontSize: 9, fontWeight: '700', lineHeight: 12 }}>
        {label}
      </Text>
    </View>
  );
};

const MAX_VISIBLE_ITEMS = 4;
const GRID_COLUMNS = 3;

const Sidebar: React.FC<SidebarProps> = ({ activeSection, onSectionChange, userRole, roleId, auth }) => {
  const { can, roleId: resolvedRoleId } = usePermissions(auth);
  /**
   * Badges are a technician feature: these tabs are that role's personal work
   * queue, so a count on them is actionable. For an administrator the same tabs
   * list every record in the system, where a badge in the thousands is noise.
   */
  // role_id 2 is Technician; 4 is Agent. The same test the Job Order page and both
  // order contexts use to decide whether to scope a list to one technician.
  const isTechnician =
    (userRole || '').toLowerCase().trim() === 'technician' || String(roleId) === '2';

  const badgeCounts = useNavBadgeCounts(isTechnician);

  /**
   * A prepaid account has no bills — invoice generation is disabled for it — so the tab that would
   * open the SOA/Invoices screen is named for what it actually shows: the top-up history. Read
   * from the already-loaded customer detail, so this costs no request. Undefined for every
   * non-customer role, which keeps the label at its postpaid default.
   */
  const customerData = useCustomerDataContextOptional();
  const billingNavLabel = customerData?.isPrepaid ? 'History' : 'Bills';

  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const [isMenuExpanded, setIsMenuExpanded] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState(300);
  const { width } = useWindowDimensions();
  const glideAnim = useRef(new Animated.Value(0)).current;
  const expandAnim = useRef(new Animated.Value(0)).current;
  const containerHeightAnim = useRef(new Animated.Value(68)).current;

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

  // ─── Navigation groups with role-based access ───
  const navGroups: NavGroup[] = [
    {
      title: 'Operations',
      items: [
        { id: 'agent-dashboard', label: 'Dashboard', icon: LayoutDashboard, onlyRoles: [ROLE.AGENT] },
        { id: 'customer-dashboard', label: 'Dashboard', icon: LayoutDashboard, onlyRoles: [ROLE.CUSTOMER] },
        { id: 'applicationManagement', label: 'Application', icon: FileCheck },
        { id: 'job-order', label: 'Job Order', icon: Wrench },
        { id: 'service-order', label: 'Service Order', icon: Settings },
        { id: 'work-order', label: 'Work Order', icon: ClipboardCheck },
        { id: 'lcp-nap-location', label: 'LCP/NAP', icon: MapPinned },
      ],
    },
    {
      title: 'Billing',
      items: [
        { id: 'customer-bills', label: billingNavLabel, icon: ReceiptText, onlyRoles: [ROLE.CUSTOMER] },
        { id: 'overdue', label: 'Overdue', icon: Clock },
      ],
    },
    {
      title: 'Agent',
      items: [
        { id: 'commission', label: 'History', icon: ReceiptText },
        // An agent reads their own invoices here (the server scopes the list);
        // generating, status changes and pay-outs are admin-only in the page.
        { id: 'agent-invoices', label: 'Invoices', icon: FileText },
      ],
    },
    {
      title: 'Inventory',
      items: [
        { id: 'inventory', label: 'Inventory', icon: Package },
        { id: 'inventory-category-list', label: 'Categories', icon: List },
      ],
    },
    {
      title: 'Configurations',
      items: [
        { id: 'promo-list', label: 'Promos', icon: Ticket },
        { id: 'plan-list', label: 'Plans', icon: Layers },
        { id: 'location-list', label: 'Locations', icon: MapPin },
        { id: 'lcp-list', label: 'LCP List', icon: Network },
        { id: 'nap-list', label: 'NAP List', icon: Network },
        { id: 'usage-type-list', label: 'Usage Types', icon: Gauge },
        { id: 'payment-method-list', label: 'Payment', icon: CreditCard },
        { id: 'work-category-list', label: 'Work Cat.', icon: Wrench },
        { id: 'radius-config', label: 'RADIUS', icon: Wifi },
        { id: 'smart-olt-config', label: 'SmartOLT', icon: Server },
        { id: 'sms-config', label: 'SMS Config', icon: Send },
        { id: 'pppoe-setup', label: 'PPPoE', icon: Router },
        { id: 'concern-config', label: 'Concerns', icon: AlertCircle },
        { id: 'billing-config', label: 'Billing Cfg', icon: Receipt },
      ],
    },
    {
      title: 'Logs',
      items: [
        { id: 'sms-logs', label: 'SMS Logs', icon: MessageSquareText },
        { id: 'email-logs', label: 'Email Logs', icon: Mail },
        { id: 'file-log-viewer', label: 'File Logs', icon: FileText },
        { id: 'expenses-log', label: 'Expenses', icon: Wallet },
      ],
    },
    {
      title: 'Account',
      items: [
        { id: 'customer-support', label: 'Support', icon: LifeBuoy, onlyRoles: [ROLE.CUSTOMER] },
        { id: 'menu', label: 'Menu', icon: MenuIcon, isMenuPage: true, requires: [] },
      ],
    },
  ];

  // ─── Permission filtering ───
  const filterMenuByRole = (items: MenuItem[]): MenuItem[] =>
    items.filter(item => {
      if (item.onlyRoles && isLockedRole(resolvedRoleId) && !item.onlyRoles.includes(resolvedRoleId)) {
        return false;
      }
      return can(item.requires ?? permissionForSection(item.id));
    });

  // Build filtered groups (only groups with at least 1 visible item)
  const filteredNavGroups = navGroups
    .map(group => ({ title: group.title, items: filterMenuByRole(group.items) }))
    .filter(group => group.items.length > 0);

  // Flatten for bottom bar logic
  const allFilteredItems = filteredNavGroups.flatMap(g => g.items);
  const navigationItems = allFilteredItems.filter(item => !item.isMenuPage);
  const menuPageItem = allFilteredItems.find(item => item.isMenuPage);

  const needsExpandableMenu = navigationItems.length > (MAX_VISIBLE_ITEMS - 1);

  const visibleItems = needsExpandableMenu
    ? navigationItems.slice(0, MAX_VISIBLE_ITEMS - 1)
    : navigationItems;

  const bottomBarItems = needsExpandableMenu
    ? visibleItems
    : [...visibleItems, ...(menuPageItem ? [menuPageItem] : [])];

  const expandedItems = [...navigationItems, ...(menuPageItem ? [menuPageItem] : [])];
  const bottomBarItemCount = needsExpandableMenu ? visibleItems.length + 1 : bottomBarItems.length;

  const isActiveInOverflow = needsExpandableMenu &&
    !visibleItems.some(item => item.id === activeSection) &&
    expandedItems.some(item => item.id === activeSection);

  // Check total rows for scroll decision
  const totalExpandedRows = filteredNavGroups.reduce(
    (sum, group) => sum + Math.ceil(group.items.length / GRID_COLUMNS), 0
  );
  const panelNeedsScroll = totalExpandedRows > 3;

  // ─── Animations ───
  useEffect(() => {
    let activeIndex: number;
    if (needsExpandableMenu && (isActiveInOverflow || activeSection === 'menu')) {
      activeIndex = visibleItems.length;
    } else {
      activeIndex = bottomBarItems.findIndex(item => item.id === activeSection);
    }
    if (activeIndex !== -1 && bottomBarItemCount > 1) {
      Animated.spring(glideAnim, {
        toValue: activeIndex,
        useNativeDriver: true,
        friction: 8,
        tension: 60
      }).start();
    }
  }, [activeSection, visibleItems, bottomBarItems, isActiveInOverflow, needsExpandableMenu]);

  const toggleMenu = () => isMenuExpanded ? closeMenu() : openMenu();

  const openMenu = () => {
    setIsMenuExpanded(true);
    const targetHeight = Math.min(measuredHeight + 69, 488);
    Animated.parallel([
      Animated.spring(expandAnim, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
        tension: 50
      }),
      Animated.spring(containerHeightAnim, {
        toValue: targetHeight,
        useNativeDriver: false,
        friction: 8,
        tension: 50
      })
    ]).start();
  };

  const closeMenu = () => {
    Animated.parallel([
      Animated.timing(expandAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(containerHeightAnim, {
        toValue: 68,
        duration: 250,
        useNativeDriver: false,
      })
    ]).start(() => setIsMenuExpanded(false));
  };

  const handleExpandedItemPress = (itemId: string) => {
    closeMenu();
    onSectionChange(itemId);
  };

  const primaryColor = colorPalette?.primary || '#7c3aed';

  // ─── Render a single nav item in the expanded grid ───
  const renderNavItem = (item: MenuItem) => {
    const isActive = activeSection === item.id;
    const IconComponent = item.icon;
    const itemWidth = (width - 136) / 3; // Exactly 1/3 of row minus two 36px gaps and padding

    return (
      <Pressable
        key={item.id}
        onPress={() => handleExpandedItemPress(item.id)}
        style={({ pressed }) => ({
          width: itemWidth,
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 10,
          borderRadius: 12,
          backgroundColor: isActive
            ? primaryColor + '15'
            : pressed ? '#ffffff' : 'transparent',
        })}
      >
        <View style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          backgroundColor: isActive ? primaryColor + '20' : '#ffffff',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 6,
          ...(isActive ? {} : {
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.05,
            shadowRadius: 2,
            elevation: 1,
          }),
        }}>
          <IconComponent size={22} color={isActive ? primaryColor : '#6b7280'} />
          <NavBadge count={badgeCounts[item.id as keyof NavBadgeCounts]} />
        </View>
        <Text
          style={{
            width: '100%',
            fontSize: 10,
            fontWeight: isActive ? '700' : '500',
            color: isActive ? primaryColor : '#6b7280',
            textAlign: 'center',
          }}
          numberOfLines={1}
        >
          {item.label}
        </Text>
      </Pressable>
    );
  };

  // ─── Render grouped grid with containers and separators ───
  const renderGroupedGrid = () => (
    <View style={{ flexDirection: 'column' }}>
      {filteredNavGroups.map((group, groupIndex) => {
        const rowCount = Math.ceil(group.items.length / GRID_COLUMNS);

        return (
          <View key={group.title}>
            {/* Separator between groups */}
            {groupIndex > 0 && (
              <View style={{
                height: 1,
                backgroundColor: '#e5e7eb',
                marginHorizontal: 8,
                marginVertical: 8,
              }} />
            )}

            {/* Group header */}
            <Text style={{
              fontSize: 11,
              fontWeight: '600',
              color: '#9ca3af',
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 6,
              marginTop: groupIndex === 0 ? 0 : 4,
              paddingHorizontal: 8,
            }}>
              {group.title}
            </Text>

            {/* Group container card */}
            <View style={{
              backgroundColor: 'transparent',
              borderRadius: 14,
              paddingVertical: 8,
              paddingHorizontal: 4,
            }}>
              {Array.from({ length: rowCount }).map((_, rowIndex) => {
                const rowItems = group.items.slice(rowIndex * GRID_COLUMNS, (rowIndex + 1) * GRID_COLUMNS);
                const itemWidth = (width - 136) / 3;

                return (
                  <View 
                    key={rowIndex} 
                    style={{ 
                      flexDirection: 'row', 
                      justifyContent: 'center', 
                      gap: 36,
                      marginBottom: rowIndex < rowCount - 1 ? 36 : 0 
                    }}
                  >
                    {rowItems.map(renderNavItem)}
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );

  return (
    <>
      {/* Hidden view to measure content height */}
      <View 
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', left: 16, right: 16, paddingTop: 16, paddingBottom: 12, paddingHorizontal: 12 }}
        onLayout={(e) => setMeasuredHeight(e.nativeEvent.layout.height)}
      >
        {renderGroupedGrid()}
      </View>

      {/* Backdrop overlay */}
      <Animated.View
        pointerEvents={isMenuExpanded ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 998,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          opacity: expandAnim,
        }}
      >
        <Pressable onPress={closeMenu} style={{ flex: 1 }} />
      </Animated.View>

      {/* Unified Expanding Container */}
      <Animated.View style={{
        position: 'absolute',
        bottom: 25,
        left: 16,
        right: 16,
        height: containerHeightAnim,
        backgroundColor: '#ffffff',
        borderRadius: 34,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 12,
        borderWidth: 1,
        borderColor: '#f1f5f9',
        zIndex: 1000,
        overflow: 'hidden',
        justifyContent: 'flex-end',
      }}>
        {/* Expanded Navigation Content */}
        <Animated.View 
          pointerEvents={isMenuExpanded ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            bottom: 68,
            left: 0, right: 0,
            transform: [{
              translateY: expandAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [measuredHeight + 50, 0]
              })
            }],
            opacity: expandAnim.interpolate({
              inputRange: [0, 0.2, 1],
              outputRange: [0, 1, 1]
            })
          }}
        >
          <View style={{
            maxHeight: panelNeedsScroll ? 420 : undefined,
            paddingTop: 16,
            paddingBottom: 12,
            paddingHorizontal: 12,
          }}>
            {panelNeedsScroll ? (
              <ScrollView
                showsVerticalScrollIndicator={true}
                style={{ maxHeight: 391 }}
                contentContainerStyle={{ paddingBottom: 8 }}
              >
                {renderGroupedGrid()}
              </ScrollView>
            ) : (
              renderGroupedGrid()
            )}
          </View>

          {/* Separation Line */}
          <View style={{
            alignSelf: 'center',
            width: '70%',
            height: 1,
            backgroundColor: '#e5e7eb',
            borderRadius: 1
          }} />
        </Animated.View>

        {/* Bottom Navigation Bar */}
        <View style={{
          height: 68,
          flexDirection: 'row',
          justifyContent: 'space-around',
          alignItems: 'center',
          paddingHorizontal: 12,
        }}>
          {/* Gliding Pill Indicator */}
          {bottomBarItemCount > 1 && (
            <Animated.View
              style={{
                position: 'absolute',
                height: 48,
                width: (width - 32 - 24) / bottomBarItemCount - 8,
                backgroundColor: primaryColor + '15',
                borderRadius: 24,
                transform: [{
                  translateX: glideAnim.interpolate({
                    inputRange: Array.from({ length: bottomBarItemCount }, (_, i) => i),
                    outputRange: Array.from({ length: bottomBarItemCount }, (_, i) => {
                      const itemWidth = (width - 32 - 24) / bottomBarItemCount;
                      return (i * itemWidth) + 12 + 4;
                    })
                  })
                }],
                left: 0,
              }}
            />
          )}

          {/* Visible nav items */}
          {(needsExpandableMenu ? visibleItems : bottomBarItems).map((item) => {
            const isActive = activeSection === item.id;
            const IconComponent = item.icon;
            return (
              <Pressable
                key={item.id}
                onPress={() => {
                  if (isMenuExpanded) closeMenu();
                  onSectionChange(item.id);
                }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  zIndex: 10,
                }}
              >
                {/* The icon and its badge share a wrapper so the badge anchors to the
                    icon rather than to the whole tab, which is wider than it. */}
                <View>
                  <IconComponent size={22} color={isActive ? primaryColor : '#4b5563'} />
                  <NavBadge count={badgeCounts[item.id as keyof NavBadgeCounts]} />
                </View>
                <Text style={{
                  width: '100%',
                  textAlign: 'center',
                  fontSize: 10,
                  marginTop: 4,
                  fontWeight: isActive ? '700' : '500',
                  color: isActive ? primaryColor : '#4b5563'
                }} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}

          {/* "More" Tab */}
          {needsExpandableMenu && (
            <Pressable
              onPress={toggleMenu}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                zIndex: 10,
              }}
            >
              <Animated.View style={{
                transform: [{
                  rotate: expandAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '180deg'],
                  })
                }]
              }}>
                {isMenuExpanded ? (
                  <X size={22} color={isActiveInOverflow || activeSection === 'menu' ? primaryColor : '#4b5563'} />
                ) : (
                  <ChevronUp size={22} color={isActiveInOverflow || activeSection === 'menu' ? primaryColor : '#4b5563'} />
                )}
              </Animated.View>
              <Text style={{
                width: '100%',
                textAlign: 'center',
                fontSize: 10,
                marginTop: 4,
                fontWeight: isActiveInOverflow || activeSection === 'menu' ? '700' : '500',
                color: isActiveInOverflow || activeSection === 'menu' ? primaryColor : '#4b5563'
              }} numberOfLines={1}>
                More
              </Text>
            </Pressable>
          )}
        </View>
      </Animated.View>
    </>
  );
};

export default Sidebar;
