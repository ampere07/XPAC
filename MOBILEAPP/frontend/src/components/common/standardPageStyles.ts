import { StyleSheet } from 'react-native';

/**
 * Shared style sheet for the standard list-page UI.
 *
 * Extracted verbatim from JobOrder.tsx so every page that adopts
 * `StandardListPage` renders with the exact same look & spacing.
 */
export const standardPageStyles = StyleSheet.create({
  container: { height: '100%', overflow: 'hidden' },

  // Mobile filter overlay
  mobileOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  mobileBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)' },
  mobileSidebar: { position: 'absolute', top: 0, left: 0, bottom: 0, width: 256, flexDirection: 'column' },
  mobileSidebarHeader: { padding: 16, paddingTop: 60, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Tablet sidebar
  sidebar: { borderRightWidth: 1, flexShrink: 0, flexDirection: 'column', position: 'relative' },
  sidebarHeaderBox: { padding: 16, borderBottomWidth: 1, flexShrink: 0 },
  sidebarTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  sidebarTitle: { fontSize: 18, fontWeight: '600' },
  pad16: { padding: 16 },

  // Main content column
  mainContent: { overflow: 'hidden', flex: 1, flexDirection: 'column' },
  mainInner: { flexDirection: 'column', height: '100%' },

  // Toolbar
  toolbar: { padding: 16, borderBottomWidth: 1, flexShrink: 0 },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBtn: { padding: 8, borderRadius: 4 },
  menuBtn: { backgroundColor: '#374151', padding: 8, borderRadius: 4 },
  searchWrap: { position: 'relative', flex: 1 },
  searchInput: { width: '100%', borderRadius: 4, paddingLeft: 40, paddingRight: 16, paddingVertical: 8, borderWidth: 1 },
  searchIcon: { position: 'absolute', left: 12, top: 10 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4, flexDirection: 'row', alignItems: 'center' },

  // List area
  listArea: { flex: 1, overflow: 'hidden', flexDirection: 'column' },
  flex1: { flex: 1 },

  // Loading / error
  loadingWrap: { paddingHorizontal: 16, paddingVertical: 48, alignItems: 'center' },
  skeletonCol: { flexDirection: 'column', alignItems: 'center' },
  skeletonBar1: { height: 16, width: '33%', borderRadius: 4, marginBottom: 16 },
  skeletonBar2: { height: 16, width: '50%', borderRadius: 4 },
  loadingText: { marginTop: 16 },
  retryBtn: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4 },
  retryText: { color: 'white' },

  // Cards
  cardRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  cardInner: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardLeft: { flex: 1, minWidth: 0 },
  cardName: { fontWeight: '500', fontSize: 14, marginBottom: 4 },
  cardSub: { fontSize: 12 },
  cardRight: { flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 16, flexShrink: 0 },
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },

  // Pagination
  paginationBar: { borderTopWidth: 1, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  paginationInfo: { fontSize: 12 },
  bold500: { fontWeight: '500' },
  paginationBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pageBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  pageBtnText: { fontSize: 14 },
  pageIndicatorWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pageIndicator: { paddingHorizontal: 8, fontSize: 14 },

  // Detail panels
  mobileDetail: { flex: 1, flexDirection: 'column', overflow: 'hidden' },
  tabletDetail: { flexShrink: 0, overflow: 'hidden' },

  // Status filter modal
  statusModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  statusModalContent: { width: '80%', backgroundColor: 'white', borderRadius: 12, overflow: 'hidden' },
  statusModalHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', alignItems: 'center' },
  statusModalTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  statusItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#f3f4f6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusItemText: { fontSize: 14, color: '#374151' },
});

/** Shared palette constants used across the standard UI. */
export const STANDARD_COLORS = {
  primary: '#7c3aed',
  bg: '#f9fafb',
  surface: '#ffffff',
  border: '#e5e7eb',
  borderInput: '#d1d5db',
  inputBg: '#f3f4f6',
  text: '#111827',
  textMuted: '#4b5563',
  textFaint: '#6b7280',
  textDisabled: '#9ca3af',
  danger: '#dc2626',
};
