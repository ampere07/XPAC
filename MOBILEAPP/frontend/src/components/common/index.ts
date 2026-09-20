/**
 * The app's standard page UI.
 *
 * One shell (StandardPage) and one row (RecordCard), both taken from
 * ApplicationManagement.tsx, so every list screen looks and behaves the same.
 * Rows are cards — there is no table view: a phone cannot show a twelve-column
 * table without hiding eleven columns off the side of the screen.
 *
 *   import { StandardPage, RecordCard } from '../components/common';
 *
 * See StandardPage.example.tsx for a complete, copy-pasteable page.
 */
export { default as StandardPage } from './StandardPage';
export type { StandardPageProps, FilterChip } from './StandardPage';

export { default as RecordCard } from './RecordCard';
export type { RecordCardProps } from './RecordCard';

export { default as FieldCard } from './FieldCard';
export type { FieldCardProps, FieldCardField } from './FieldCard';

export { getStatusColor, getStatusLabel, EMPTY_STATUS_LABEL } from './statusColors';

export { default as StatusText } from './StatusText';
export type { StatusTextProps } from './StatusText';
export { default as StatusFilterModal } from './StatusFilterModal';
export type { StatusOption } from './StatusFilterModal';
export { standardPageStyles, STANDARD_COLORS } from './standardPageStyles';
