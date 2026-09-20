import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Animated,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Menu as MenuIcon, Filter, Download, RefreshCw, X } from 'lucide-react-native';
import GlobalSearch from '../../pages/globalfunctions/GlobalSearch';
import { ColorPalette } from '../../services/settingsColorPaletteService';

/**
 * The standard list page — the app's one page shell.
 *
 * This is ApplicationManagement.tsx's layout, made reusable: a toolbar (filter
 * drawer, search, funnel, export, refresh), the active-filter chip strip, the
 * loading / error / empty states, a card list, and the pagination bar with its
 * page-size picker. Rows are cards (see RecordCard); there is no table mode and
 * nothing scrolls horizontally, by design.
 *
 * Every section is optional — pass the handler and the control appears, omit it
 * and the control is not rendered. A page that needs none of them still gets
 * consistent padding, states and pagination for free.
 *
 * The caller owns the data pipeline (fetch, filter, sort) and the card; this
 * shell owns the chrome. Pagination is applied here: pass the FULL filtered set
 * as `data` and it slices the page itself. A page that pages on the server
 * passes one page of rows plus `totalItems`, and no slicing happens.
 */

export interface FilterChip {
  /** Identity passed back to onRemoveChip. */
  key: string;
  /** Field name, drawn dimmed. */
  label: string;
  /** The value being filtered on. */
  value: string;
}

export interface StandardPageProps<T> {
  // Data
  /** The full filtered/sorted set — or one page of it, with `totalItems` set. */
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactElement | null;

  // Search
  searchQuery?: string;
  onSearchChange?: (text: string) => void;
  searchPlaceholder?: string;

  // Filter drawer (left slide-in)
  /** Passing content turns on the drawer button. */
  drawerContent?: React.ReactNode;
  /** Highlights the drawer button when something in it is narrowing the list. */
  drawerActive?: boolean;

  // Funnel filter (column filters, opened as the page's own modal)
  onOpenFunnel?: () => void;
  /** Drawn as a red badge on the funnel button. */
  activeFilterCount?: number;

  // Chips
  chips?: FilterChip[];
  onRemoveChip?: (key: string) => void;
  onClearChips?: () => void;
  /** A single always-visible chip row above the filters, e.g. a date range. */
  rangeChip?: { label: string; value: string; onClear: () => void } | null;

  // Export / refresh
  onExport?: () => void;
  exportDisabled?: boolean;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  /** Swaps the refresh icon for a spinner. */
  isRefreshing?: boolean;
  /** Red dot on the refresh button: the server has records this view does not. */
  hasNewData?: boolean;

  /** Extra buttons appended to the toolbar, after refresh (e.g. Add). */
  toolbarActions?: React.ReactNode;

  // Progress / async states
  /** A quiet line under the toolbar, e.g. "Loading records... (250/4000)". */
  progressText?: string | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  loadingText?: string;
  emptyText?: string;

  // Pull to refresh
  onPullRefresh?: () => void;
  pullRefreshing?: boolean;

  // Pagination
  paginate?: boolean;
  /**
   * Set only for server-paginated pages: the total number of records on the
   * server. `data` is then taken to be the current page already and is not
   * sliced; leave it unset and the shell pages the full list itself.
   */
  totalItems?: number;
  /**
   * Page count, for a server-paged list whose page size is not a simple row
   * count — a list grouped into sections, say. Implies server paging, and the
   * info line falls back to a plain record count.
   */
  totalPages?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  itemsPerPage?: number;
  onItemsPerPageChange?: (n: number) => void;
  pageSizeOptions?: number[];

  // Detail
  /**
   * When set, the list is hidden but stays mounted and this is shown instead,
   * so scroll position and the current page survive the round trip.
   */
  detail?: React.ReactNode;

  // Misc
  colorPalette?: ColorPalette | null;
  isDarkMode?: boolean;
  /** Rendered below the toolbar, above the chips — tabs, summary cards, banners. */
  header?: React.ReactNode;
  /** Modals and overlays the page owns; rendered last so they stack on top. */
  children?: React.ReactNode;
  /** Bottom padding clearing the floating nav bar on phones. Default 110. */
  bottomInset?: number;
}

function StandardPage<T>({
  data,
  keyExtractor,
  renderItem,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  drawerContent,
  drawerActive = false,
  onOpenFunnel,
  activeFilterCount = 0,
  chips,
  onRemoveChip,
  onClearChips,
  rangeChip = null,
  onExport,
  exportDisabled = false,
  onRefresh,
  refreshDisabled = false,
  isRefreshing = false,
  hasNewData = false,
  toolbarActions,
  progressText = null,
  isLoading = false,
  error = null,
  onRetry,
  loadingText = 'Loading...',
  emptyText = 'No records found',
  onPullRefresh,
  pullRefreshing = false,
  paginate = true,
  totalItems,
  totalPages: totalPagesProp,
  currentPage = 1,
  onPageChange,
  itemsPerPage = 25,
  onItemsPerPageChange,
  pageSizeOptions = [10, 25, 50, 100],
  detail,
  colorPalette,
  isDarkMode = false,
  header,
  children,
  bottomInset = 110,
}: StandardPageProps<T>) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const primary = colorPalette?.primary || '#7c3aed';

  const listRef = useRef<FlatList<T>>(null);

  // Drawer. `rendered` trails `visible` so the Modal stays mounted long enough
  // for the panel to slide back out instead of vanishing.
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerRendered, setDrawerRendered] = useState(false);
  const slideX = useRef(new Animated.Value(-width)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (drawerVisible) {
      setDrawerRendered(true);
      Animated.parallel([
        Animated.timing(slideX, { toValue: 0, duration: 260, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0.4, duration: 260, useNativeDriver: true }),
      ]).start();
    } else if (drawerRendered) {
      Animated.parallel([
        Animated.timing(slideX, { toValue: -width, duration: 220, useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(() => setDrawerRendered(false));
    }
  }, [drawerVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  // A server-paginated page hands us one page of rows plus either the true
  // total or, when its pages are not a plain row count, the page count itself.
  const isServerPaged = totalItems != null || totalPagesProp != null;
  const totalCount = totalItems != null ? totalItems : data.length;
  const knowsPageSize = totalPagesProp == null;

  const totalPages = useMemo(() => {
    if (!paginate) return 1;
    if (totalPagesProp != null) return Math.max(1, totalPagesProp);
    return Math.max(1, Math.ceil(totalCount / itemsPerPage));
  }, [totalCount, itemsPerPage, paginate, totalPagesProp]);

  // A filter that shrinks the list can strand the viewer on a page that no
  // longer exists; clamping shows the last page instead of a blank one.
  const page = Math.min(Math.max(1, currentPage), totalPages);

  const pagedData = useMemo(() => {
    if (!paginate || isServerPaged) return data;
    const start = (page - 1) * itemsPerPage;
    return data.slice(start, start + itemsPerPage);
  }, [data, page, itemsPerPage, paginate, isServerPaged]);

  const goToPage = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    onPageChange?.(clamped);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const showSearch = !!onSearchChange;
  const hasToolbar =
    showSearch || !!drawerContent || !!onOpenFunnel || !!onExport || !!onRefresh || !!toolbarActions;

  const iconButton = (active: boolean, activeColor: string) => [
    styles.iconBtn,
    { borderColor: active ? activeColor : '#e5e7eb', backgroundColor: active ? activeColor + '12' : '#fff' },
  ];

  return (
    <View style={styles.root}>
      {/* The list is hidden, not unmounted, while a detail is open — remounting
          would reset scroll position and the current page. */}
      <View style={[styles.flex1, { display: detail ? 'none' : 'flex' }]}>
        {hasToolbar && (
          <View style={[styles.toolbar, { paddingTop: isTablet ? 16 : 60 }]}>
            {!!drawerContent && (
              <TouchableOpacity onPress={() => setDrawerVisible(true)} style={iconButton(drawerActive, primary)}>
                <MenuIcon size={18} color={drawerActive ? primary : '#374151'} />
              </TouchableOpacity>
            )}

            {showSearch && (
              <View style={styles.flex1}>
                <GlobalSearch
                  searchQuery={searchQuery ?? ''}
                  setSearchQuery={onSearchChange!}
                  isDarkMode={isDarkMode}
                  colorPalette={colorPalette ?? null}
                  placeholder={searchPlaceholder}
                />
              </View>
            )}

            {!!onOpenFunnel && (
              <TouchableOpacity onPress={onOpenFunnel} style={iconButton(activeFilterCount > 0, '#ef4444')}>
                <Filter size={18} color={activeFilterCount > 0 ? '#ef4444' : '#374151'} />
                {activeFilterCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{activeFilterCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {!!onExport && (
              <TouchableOpacity
                onPress={onExport}
                disabled={exportDisabled}
                style={[styles.iconBtn, styles.outlineBtn, { borderColor: primary, opacity: exportDisabled ? 0.4 : 1 }]}
              >
                <Download size={18} color={primary} />
              </TouchableOpacity>
            )}

            {!!onRefresh && (
              <TouchableOpacity
                onPress={onRefresh}
                disabled={refreshDisabled || isRefreshing}
                style={[
                  styles.iconBtn,
                  styles.outlineBtn,
                  { borderColor: primary, opacity: refreshDisabled || isRefreshing ? 0.4 : 1 },
                ]}
              >
                {isRefreshing ? (
                  <ActivityIndicator size="small" color={primary} />
                ) : (
                  <RefreshCw size={18} color={primary} />
                )}
                {hasNewData && <View style={styles.newDataDot} />}
              </TouchableOpacity>
            )}

            {toolbarActions}
          </View>
        )}

        {!!progressText && (
          <View style={styles.progressRow}>
            <Text style={styles.progressText}>{progressText}</Text>
          </View>
        )}

        {header}

        {!!rangeChip && (
          <View style={styles.rangeRow}>
            <Text style={styles.chipsLabel}>{rangeChip.label.toUpperCase()}:</Text>
            <Text style={[styles.rangeValue, { color: primary }]}>{rangeChip.value}</Text>
            <TouchableOpacity onPress={rangeChip.onClear} hitSlop={HIT_SLOP}>
              <X size={12} color={primary} />
            </TouchableOpacity>
          </View>
        )}

        {!!chips?.length && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipsRow}
            contentContainerStyle={styles.chipsContent}
          >
            <Text style={styles.chipsLabel}>FILTERS:</Text>
            {chips.map((chip) => (
              <View key={chip.key} style={[styles.chip, { backgroundColor: primary + '15', borderColor: primary + '30' }]}>
                <Text style={[styles.chipText, { color: primary }]} numberOfLines={1}>
                  <Text style={styles.chipLabel}>{chip.label}: </Text>
                  {chip.value}
                </Text>
                {!!onRemoveChip && (
                  <TouchableOpacity onPress={() => onRemoveChip(chip.key)} hitSlop={HIT_SLOP}>
                    <X size={12} color={primary} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {!!onClearChips && (
              <TouchableOpacity onPress={onClearChips} style={styles.clearAllBtn}>
                <Text style={[styles.clearAllText, { color: primary }]}>Clear all</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {isLoading && data.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={primary} />
            <Text style={styles.centeredText}>{loadingText}</Text>
          </View>
        ) : error && data.length === 0 ? (
          <View style={[styles.centered, styles.centeredPad]}>
            <Text style={styles.errorText}>{error}</Text>
            {!!onRetry && (
              <TouchableOpacity onPress={onRetry} style={[styles.retryBtn, { backgroundColor: primary }]}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <FlatList
              ref={listRef}
              style={styles.flex1}
              data={pagedData}
              keyExtractor={keyExtractor}
              renderItem={({ item, index }) => renderItem(item, index)}
              contentContainerStyle={styles.listContent}
              refreshControl={
                onPullRefresh ? (
                  <RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} tintColor={primary} />
                ) : undefined
              }
              ListEmptyComponent={
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>{emptyText}</Text>
                </View>
              }
            />

            {paginate && (totalCount > 0 || data.length > 0) && (
              <View style={[styles.paginationBar, { paddingBottom: isTablet ? 12 : bottomInset }]}>
                <View style={styles.paginationTop}>
                  {!!onItemsPerPageChange && (
                    <View style={styles.perPageRow}>
                      <Text style={styles.paginationText}>Show</Text>
                      <View style={styles.perPagePicker}>
                        <Picker
                          selectedValue={itemsPerPage}
                          onValueChange={(v) => onItemsPerPageChange(Number(v))}
                          style={styles.pickerText}
                          dropdownIconColor="#6b7280"
                        >
                          {pageSizeOptions.map((v) => (
                            <Picker.Item key={v} label={String(v)} value={v} />
                          ))}
                        </Picker>
                      </View>
                      <Text style={styles.paginationText}>entries</Text>
                    </View>
                  )}

                  {knowsPageSize ? (
                    <Text style={styles.paginationText}>
                      Showing <Text style={styles.bold}>{(page - 1) * itemsPerPage + 1}</Text> to{' '}
                      <Text style={styles.bold}>
                        {isServerPaged
                          ? (page - 1) * itemsPerPage + pagedData.length
                          : Math.min(page * itemsPerPage, totalCount)}
                      </Text>{' '}
                      of <Text style={styles.bold}>{totalCount}</Text> results
                    </Text>
                  ) : (
                    <Text style={styles.paginationText}>
                      <Text style={styles.bold}>{totalCount}</Text> results
                    </Text>
                  )}
                </View>

                <View style={styles.pagerRow}>
                  <PagerButton label="«" disabled={page === 1} onPress={() => goToPage(1)} />
                  <PagerButton label="‹" disabled={page === 1} onPress={() => goToPage(page - 1)} />

                  <Text style={styles.pageIndicator}>
                    Page {page} of {totalPages}
                  </Text>

                  <PagerButton label="›" disabled={page === totalPages} onPress={() => goToPage(page + 1)} />
                  <PagerButton label="»" disabled={page === totalPages} onPress={() => goToPage(totalPages)} />
                </View>
              </View>
            )}
          </>
        )}
      </View>

      {/* Detail — a full-screen inline view, not a modal, so the page's own
          header and the back gesture behave the way they do elsewhere. */}
      {!!detail && <View style={styles.flex1}>{detail}</View>}

      {!!drawerContent && (
        <Modal visible={drawerRendered} animationType="none" transparent onRequestClose={() => setDrawerVisible(false)}>
          <View style={styles.drawerWrap}>
            <Animated.View pointerEvents="none" style={[styles.drawerBackdrop, { opacity: backdrop }]} />
            <Animated.View style={[styles.drawerPanel, { transform: [{ translateX: slideX }] }]}>
              {drawerContent}
            </Animated.View>
            <TouchableOpacity style={styles.flex1} activeOpacity={1} onPress={() => setDrawerVisible(false)} />
          </View>
        </Modal>
      )}

      {children}
    </View>
  );
}

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const PagerButton = ({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={[styles.pagerBtn, { backgroundColor: disabled ? '#f3f4f6' : '#fff', borderWidth: disabled ? 0 : 1 }]}
  >
    <Text style={[styles.pagerBtnText, { color: disabled ? '#9ca3af' : '#374151' }]}>{label}</Text>
  </TouchableOpacity>
);

export default StandardPage;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f9fafb' },
  flex1: { flex: 1 },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  outlineBtn: { backgroundColor: '#fff' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 9, color: '#fff', fontWeight: '700' },
  newDataDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#fff',
  },

  progressRow: { paddingHorizontal: 16, paddingVertical: 4, backgroundColor: '#fff' },
  progressText: { fontSize: 10, color: '#9ca3af' },

  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  rangeValue: { fontSize: 11 },

  chipsRow: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb', flexGrow: 0 },
  chipsContent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  chipsLabel: { fontSize: 10, fontWeight: '700', color: '#9ca3af', letterSpacing: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 99,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 4,
    borderWidth: 1,
    gap: 4,
  },
  chipText: { fontSize: 11 },
  chipLabel: { opacity: 0.7 },
  clearAllBtn: { paddingHorizontal: 8 },
  clearAllText: { fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centeredPad: { padding: 24 },
  centeredText: { marginTop: 12, color: '#6b7280', fontSize: 14 },
  errorText: { color: '#dc2626', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryText: { color: '#fff', fontWeight: '600' },

  listContent: { flexGrow: 1 },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyText: { color: '#6b7280', fontSize: 14 },

  paginationBar: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  paginationTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  perPageRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  perPagePicker: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    overflow: 'hidden',
    width: 92,
    height: 36,
    justifyContent: 'center',
  },
  pickerText: { color: '#111827' },
  paginationText: { fontSize: 12, color: '#4b5563' },
  bold: { fontWeight: '500' },

  pagerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  pagerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: '#d1d5db',
  },
  pagerBtnText: { fontSize: 18, fontWeight: 'bold' },
  pageIndicator: { paddingHorizontal: 8, fontSize: 14, color: '#111827' },

  drawerWrap: { flex: 1, flexDirection: 'row' },
  drawerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
  drawerPanel: { width: '85%', maxWidth: 520, height: '100%', backgroundColor: '#fff' },
});
