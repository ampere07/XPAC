import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Menu, X } from 'lucide-react';
import ToolStatusSidebar, { type SidebarSlice } from './ToolStatusSidebar';
import StatusSliceConfigModal from './StatusSliceConfigModal';
import ViewOptionsModal from './ViewOptionsModal';
import type { GroupNode } from '../../utils/groupTree';
import type { GroupableColumn, ViewOptions } from '../../services/viewOptionsService';
import type { SliceDefinition, StatusSlice } from '../../services/statusSliceService';
import type { ColorPalette } from '../../services/settingsColorPaletteService';

/**
 * The standard SYNC list-screen frame, applied to the reconciliation tools.
 *
 * Sidebar on the left, toolbar and grid on the right, one full-height flex row that
 * never scrolls the page body — identical to Service Orders, Job Orders, Applications
 * and Transactions. On mobile the two halves take turns rather than stacking, which is
 * what the rest of the app does and what makes "back to filters" mean something.
 *
 * The shell also owns the two things every tool had its own copy of: the notice strip
 * and the slice configuration dialog. Neither is worth four implementations.
 */

export type NoticeTone = 'success' | 'error' | 'info';

export interface ToolNotice {
  tone: NoticeTone;
  text: string;
}

interface ToolShellProps {
  title: string;
  isDarkMode: boolean;
  colorPalette: ColorPalette | null;
  isMobile: boolean;

  allLabel: string;
  allCount: number;
  slices: SidebarSlice[];
  selectedSliceId: string;
  onSelectSlice: (id: string) => void;

  /** Full configuration list, including hidden slices — what the modal edits. */
  configurableSlices: StatusSlice[];
  sliceDefinitions: SliceDefinition[];
  onSaveSlices: (next: StatusSlice[]) => Promise<boolean>;
  onResetSlices: () => Promise<void>;

  /**
   * Dynamic grouping, when the screen offers it.
   *
   * Supplying `groupableColumns` turns on the View Options editor and the group tree.
   * A screen that omits it keeps exactly the curated-slice sidebar it had, so this is
   * additive for any caller that has not adopted it.
   */
  groupableColumns?: GroupableColumn[];
  groupTree?: GroupNode[];
  viewOptions?: ViewOptions;
  onSaveViewOptions?: (next: ViewOptions) => Promise<boolean>;
  onResetViewOptions?: () => Promise<void>;
  distinctValues?: (columnKey: string) => string[];
  colorFor?: (column: string, value: string) => string;

  notice?: ToolNotice | null;
  onDismissNotice?: () => void;

  /** Extra rows inside the sidebar, above the slice list — a tab strip, for instance. */
  sidebarHeader?: React.ReactNode;
  /** Banners between the toolbar and the grid: rate-limit pauses, job progress. */
  banner?: React.ReactNode;
  /** The toolbar. Rendered first inside the content column, flush to the top. */
  toolbar: React.ReactNode;
  children: React.ReactNode;
}

const NOTICE_STYLES: Record<NoticeTone, { classes: string; Icon: React.ElementType }> = {
  success: { classes: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500', Icon: CheckCircle2 },
  error: { classes: 'bg-red-500/10 border-red-500/30 text-red-500', Icon: AlertTriangle },
  info: { classes: 'bg-blue-500/10 border-blue-500/30 text-blue-400', Icon: Info },
};

const ToolShell: React.FC<ToolShellProps> = ({
  title,
  isDarkMode,
  colorPalette,
  isMobile,
  allLabel,
  allCount,
  slices,
  selectedSliceId,
  onSelectSlice,
  configurableSlices,
  sliceDefinitions,
  onSaveSlices,
  onResetSlices,
  groupableColumns,
  groupTree,
  viewOptions,
  onSaveViewOptions,
  onResetViewOptions,
  distinctValues,
  colorFor,
  notice,
  onDismissNotice,
  sidebarHeader,
  banner,
  toolbar,
  children,
}) => {
  const [mobileView, setMobileView] = useState<'sidebar' | 'list'>('list');
  const [configOpen, setConfigOpen] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);

  // View Options needs somewhere to read columns from and somewhere to write back to;
  // a screen supplying only half of that gets the curated sidebar it had before.
  const supportsGrouping =
    Array.isArray(groupableColumns) &&
    groupableColumns.length > 0 &&
    !!viewOptions &&
    !!onSaveViewOptions &&
    !!onResetViewOptions &&
    !!distinctValues &&
    !!colorFor;

  const noticeStyle = notice ? NOTICE_STYLES[notice.tone] : null;

  return (
    <div className={`${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'} h-full flex flex-col md:flex-row overflow-hidden`}>
      <ToolStatusSidebar
        title={title}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        allLabel={allLabel}
        allCount={allCount}
        slices={slices}
        selectedId={selectedSliceId}
        onSelect={onSelectSlice}
        onConfigure={() => setConfigOpen(true)}
        isMobile={isMobile}
        onViewRecords={() => setMobileView('list')}
        hidden={isMobile && mobileView !== 'sidebar'}
        header={sidebarHeader}
        groupTree={groupTree}
        onOpenViewOptions={supportsGrouping ? () => setViewOptionsOpen(true) : undefined}
        groupLevelCount={viewOptions?.groupBy.length ?? 0}
      />

      <div
        className={`${
          !isMobile || mobileView === 'list' ? 'flex-1 flex flex-col' : 'hidden'
        } overflow-hidden min-w-0 ${isDarkMode ? 'bg-gray-900' : 'bg-white'}`}
      >
        {/* Mobile only. The sidebar and the grid take turns on a phone, so there has to
            be a way back to the slice list; on desktop both are on screen and this is
            never rendered. */}
        {isMobile && (
          <button
            onClick={() => setMobileView('sidebar')}
            className={`md:hidden flex items-center gap-2 px-4 py-2.5 border-b text-sm font-medium ${
              isDarkMode
                ? 'bg-gray-900 border-gray-700 text-gray-300'
                : 'bg-white border-gray-200 text-gray-700'
            }`}
          >
            <Menu className="h-4 w-4" />
            {title} — filters
          </button>
        )}

        {toolbar}

        {notice && noticeStyle && (
          <div className={`mx-4 mt-3 px-4 py-3 rounded-lg border text-sm flex items-start gap-3 ${noticeStyle.classes}`}>
            <noticeStyle.Icon className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="flex-1">{notice.text}</span>
            {onDismissNotice && (
              <button onClick={onDismissNotice} className="shrink-0 opacity-70 hover:opacity-100" title="Dismiss">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Banners, summaries and per-tab action rows.
            Capped and scrollable so a screen with a lot to say - SmartOLT can stack a
            metrics strip, a match summary and three advisories - can never squeeze the
            table it is describing off the bottom of the viewport. */}
        {banner && <div className="flex-shrink-0 max-h-[45vh] overflow-y-auto">{banner}</div>}

        <div className="flex-1 flex flex-col min-h-0">{children}</div>
      </div>

      {supportsGrouping && (
        <ViewOptionsModal
          isOpen={viewOptionsOpen}
          onClose={() => setViewOptionsOpen(false)}
          isDarkMode={isDarkMode}
          colorPalette={colorPalette}
          title={title}
          columns={groupableColumns!}
          options={viewOptions!}
          distinctValues={distinctValues!}
          colorFor={colorFor!}
          onSave={onSaveViewOptions!}
          onReset={onResetViewOptions!}
        />
      )}

      <StatusSliceConfigModal
        isOpen={configOpen}
        onClose={() => setConfigOpen(false)}
        isDarkMode={isDarkMode}
        colorPalette={colorPalette}
        title={title}
        slices={configurableSlices}
        definitions={sliceDefinitions}
        onSave={onSaveSlices}
        onReset={onResetSlices}
      />
    </div>
  );
};

export default ToolShell;
