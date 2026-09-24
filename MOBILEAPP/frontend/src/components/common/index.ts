/**
 * Global standard page UI — the reusable version of JobOrder.tsx's layout.
 *
 * Usage:
 *   import { StandardListPage, StatusText, StatusFilterModal } from '../components/common';
 *
 * See StandardListPage.example.tsx for a full, copy-pasteable reference page.
 */
export { default as StandardListPage } from './StandardListPage';
export type { StandardListPageProps } from './StandardListPage';
export { default as StatusText } from './StatusText';
export type { StatusTextProps } from './StatusText';
export { default as StatusFilterModal } from './StatusFilterModal';
export type { StatusOption } from './StatusFilterModal';
export { default as ContactActions, toDialable } from './ContactActions';

// Card-based page shell and row, used by the Agent module screens
// (Commission, AgentPayout, AgentInvoice, teamAgent).
export { default as StandardPage } from './StandardPage';
export type { StandardPageProps, FilterChip } from './StandardPage';
export { default as RecordCard } from './RecordCard';
export type { RecordCardProps } from './RecordCard';
export { getStatusColor, getStatusLabel, EMPTY_STATUS_LABEL } from './statusColors';
export { standardPageStyles, STANDARD_COLORS } from './standardPageStyles';
