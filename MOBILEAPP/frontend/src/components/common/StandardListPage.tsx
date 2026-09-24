import React, { useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Search, RefreshCw } from 'lucide-react-native';
import { ColorPalette } from '../../services/settingsColorPaletteService';
import { standardPageStyles as s, STANDARD_COLORS } from './standardPageStyles';

export interface StandardListPageProps<T> {
  /** Title shown in the tablet sidebar header. */
  title?: string;

  /** Full, already-filtered-and-sorted data. Pagination is handled internally. */
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T) => React.ReactElement | null;

  // ── Search ────────────────────────────────────────────────────────────────
  searchQuery: string;
  onSearchChange: (text: string) => void;
  searchPlaceholder?: string;
  showSearch?: boolean;

  // ── Toolbar ─────────────────────────────────────────────────────────────--
  /** Extra buttons rendered to the LEFT of the refresh button (e.g. a status filter). */
  toolbarActions?: React.ReactNode;
  showRefreshButton?: boolean;

  // ── Async states ────────────────────────────────────────────────────────--
  isLoading?: boolean;
  error?: string | null;
  loadingText?: string;
  emptyText?: string;
  onRetry?: () => void;

  // ── Pull-to-refresh ────────────────────────────────────────────────────---
  isRefreshing?: boolean;
  onRefresh?: () => void;

  // ── Pagination ─────────────────────────────────────────────────────────---
  paginate?: boolean;
  itemsPerPage?: number;
  currentPage: number;
  onPageChange: (page: number) => void;

  // ── Theming ─────────────────────────────────────────────────────────────--
  colorPalette?: ColorPalette | null;

  // ── Tablet sidebar (optional) ──────────────────────────────────────────---
  sidebarContent?: React.ReactNode;
  showSidebar?: boolean;

  // ── Master-detail (optional) ───────────────────────────────────────────---
  selectedItem?: T | null;
  renderDetail?: (item: T, isMobile: boolean) => React.ReactNode;
  onCloseDetail?: () => void;

  /** Top padding for the toolbar on phones (status-bar clearance). Default 60. */
  mobileTopPadding?: number;
  /** Extra bottom padding for the list on phones (bottom-nav clearance). Default 100. */
  mobileListBottomPadding?: number;
}

/**
 * Global standard list-page shell — the reusable version of JobOrder.tsx's UI.
 *
 * Handles: responsive tablet/phone layout, search toolbar, custom toolbar
 * actions, loading skeleton / error / empty states, a virtualized FlashList,
 * client-side pagination, pull-to-refresh, and an optional master-detail panel.
 *
 * The caller owns the data pipeline (fetch → filter → sort) and the card
 * component; this shell owns the chrome and pagination.
 */
function StandardListPage<T>({
  title,
  data,
  keyExtractor,
  renderItem,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search...',
  showSearch = true,
  toolbarActions,
  showRefreshButton = true,
  isLoading = false,
  error = null,
  loadingText = 'Loading...',
  emptyText = 'No records found',
  onRetry,
  isRefreshing = false,
  onRefresh,
  paginate = true,
  itemsPerPage = 15,
  currentPage,
  onPageChange,
  colorPalette,
  sidebarContent,
  showSidebar = false,
  selectedItem = null,
  renderDetail,
  onCloseDetail,
  mobileTopPadding = 60,
  mobileListBottomPadding = 100,
}: StandardListPageProps<T>) {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const primary = colorPalette?.primary || STANDARD_COLORS.primary;

  // On a phone, a selected item takes over the screen. On a tablet it sits beside the list.
  const showDetailFull = !!selectedItem && !!renderDetail && !isTablet;
  const showDetailSide = !!selectedItem && !!renderDetail && isTablet;

  const totalPages = useMemo(() => {
    if (!paginate) return 1;
    return Math.max(1, Math.ceil(data.length / itemsPerPage));
  }, [data.length, itemsPerPage, paginate]);

  const pagedData = useMemo(() => {
    if (!paginate) return data;
    const start = (currentPage - 1) * itemsPerPage;
    return data.slice(start, start + itemsPerPage);
  }, [data, currentPage, itemsPerPage, paginate]);

  const refreshControl = onRefresh ? (
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      tintColor={primary}
      colors={[primary]}
    />
  ) : undefined;

  return (
    <View style={[s.container, { flexDirection: isTablet ? 'row' : 'column', backgroundColor: STANDARD_COLORS.bg }]}>
      {/* Tablet sidebar */}
      {showSidebar && isTablet && (
        <View style={[s.sidebar, { width: 256, backgroundColor: STANDARD_COLORS.surface, borderColor: STANDARD_COLORS.border }]}>
          <View style={[s.sidebarHeaderBox, { borderColor: STANDARD_COLORS.border }]}>
            <View style={s.sidebarTitleRow}>
              <Text style={[s.sidebarTitle, { color: STANDARD_COLORS.text }]}>{title}</Text>
            </View>
          </View>
          <View style={s.pad16}>
            {sidebarContent ?? <Text style={{ color: STANDARD_COLORS.textFaint }}>No filters available</Text>}
          </View>
        </View>
      )}

      {/* Main list column (hidden on phone while a detail is open) */}
      <View
        style={[s.mainContent, {
          backgroundColor: STANDARD_COLORS.surface,
          display: showDetailFull ? 'none' : 'flex',
        }]}
      >
        <View style={s.mainInner}>
          {/* Toolbar */}
          <View style={[s.toolbar, {
            paddingTop: isTablet ? 16 : mobileTopPadding,
            backgroundColor: STANDARD_COLORS.surface,
            borderColor: STANDARD_COLORS.border,
          }]}>
            <View style={s.toolbarRow}>
              {showSearch && (
                <View style={s.searchWrap}>
                  <TextInput
                    placeholder={searchPlaceholder}
                    placeholderTextColor={STANDARD_COLORS.textFaint}
                    value={searchQuery}
                    onChangeText={onSearchChange}
                    style={[s.searchInput, {
                      backgroundColor: STANDARD_COLORS.inputBg,
                      color: STANDARD_COLORS.text,
                      borderColor: STANDARD_COLORS.borderInput,
                    }]}
                  />
                  <View style={s.searchIcon}>
                    <Search size={16} color={STANDARD_COLORS.textFaint} />
                  </View>
                </View>
              )}
              <View style={s.actionsRow}>
                {toolbarActions}
                {showRefreshButton && onRefresh && (
                  <Pressable
                    onPress={onRefresh}
                    disabled={isRefreshing}
                    style={[s.actionBtn, { backgroundColor: isRefreshing ? STANDARD_COLORS.textMuted : primary }]}
                  >
                    <RefreshCw size={20} color="white" />
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          {/* List / states */}
          <View style={s.listArea}>
            {isLoading ? (
              <ScrollView style={s.flex1} refreshControl={refreshControl}>
                <View style={s.loadingWrap}>
                  <View style={s.skeletonCol}>
                    <View style={[s.skeletonBar1, { backgroundColor: STANDARD_COLORS.borderInput }]} />
                    <View style={[s.skeletonBar2, { backgroundColor: STANDARD_COLORS.borderInput }]} />
                  </View>
                  <Text style={[s.loadingText, { color: STANDARD_COLORS.textMuted }]}>{loadingText}</Text>
                </View>
              </ScrollView>
            ) : error ? (
              <ScrollView style={s.flex1} refreshControl={refreshControl}>
                <View style={s.loadingWrap}>
                  <Text style={{ color: STANDARD_COLORS.danger }}>{error}</Text>
                  {onRetry && (
                    <Pressable onPress={onRetry} style={[s.retryBtn, { backgroundColor: STANDARD_COLORS.textDisabled }]}>
                      <Text style={s.retryText}>Retry</Text>
                    </Pressable>
                  )}
                </View>
              </ScrollView>
            ) : (
              <View style={s.flex1}>
                <FlashList
                  data={pagedData}
                  keyExtractor={keyExtractor}
                  refreshControl={refreshControl}
                  ListEmptyComponent={
                    <View style={s.emptyWrap}>
                      <Text style={{ color: STANDARD_COLORS.textMuted }}>{emptyText}</Text>
                    </View>
                  }
                  contentContainerStyle={{ paddingBottom: !isTablet ? mobileListBottomPadding : 0 }}
                  renderItem={({ item }) => renderItem(item)}
                />
              </View>
            )}
          </View>

          {/* Pagination */}
          {!isLoading && !error && paginate && data.length > 0 && (
            <View style={[s.paginationBar, {
              flexDirection: isTablet ? 'row' : 'column',
              justifyContent: isTablet ? 'space-between' : 'center',
              gap: isTablet ? 0 : 12,
              backgroundColor: STANDARD_COLORS.surface,
              borderColor: STANDARD_COLORS.border,
              paddingBottom: !isTablet ? 110 : 16,
            }]}>
              <View>
                <Text style={[s.paginationInfo, { color: STANDARD_COLORS.textMuted }]}>
                  Showing <Text style={s.bold500}>{(currentPage - 1) * itemsPerPage + 1}</Text> to{' '}
                  <Text style={s.bold500}>{Math.min(currentPage * itemsPerPage, data.length)}</Text> of{' '}
                  <Text style={s.bold500}>{data.length}</Text> results
                </Text>
              </View>
              <View style={s.paginationBtns}>
                <Pressable
                  onPress={() => onPageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={[s.pageBtn, {
                    backgroundColor: currentPage === 1 ? STANDARD_COLORS.inputBg : STANDARD_COLORS.surface,
                    borderWidth: currentPage === 1 ? 0 : 1,
                    borderColor: STANDARD_COLORS.borderInput,
                  }]}
                >
                  <Text style={[s.pageBtnText, { color: currentPage === 1 ? STANDARD_COLORS.textDisabled : '#374151', fontSize: 18, fontWeight: 'bold' }]}>{'<'}</Text>
                </Pressable>

                <View style={s.pageIndicatorWrap}>
                  <Text style={[s.pageIndicator, { color: STANDARD_COLORS.text }]}>
                    Page {currentPage} of {totalPages}
                  </Text>
                </View>

                <Pressable
                  onPress={() => onPageChange(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  style={[s.pageBtn, {
                    backgroundColor: currentPage >= totalPages ? STANDARD_COLORS.inputBg : STANDARD_COLORS.surface,
                    borderWidth: currentPage >= totalPages ? 0 : 1,
                    borderColor: STANDARD_COLORS.borderInput,
                  }]}
                >
                  <Text style={[s.pageBtnText, { color: currentPage >= totalPages ? STANDARD_COLORS.textDisabled : '#374151', fontSize: 18, fontWeight: 'bold' }]}>{'>'}</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Detail — phone full screen */}
      {showDetailFull && selectedItem && (
        <View style={[s.mobileDetail, { backgroundColor: STANDARD_COLORS.bg }]}>
          {renderDetail!(selectedItem, true)}
        </View>
      )}

      {/* Detail — tablet side panel */}
      {showDetailSide && selectedItem && (
        <View style={[s.tabletDetail, { display: 'flex' }]}>
          {renderDetail!(selectedItem, false)}
        </View>
      )}
    </View>
  );
}

export default StandardListPage;
