import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, Download, ArrowLeft, Receipt, FileText, Loader2 } from 'lucide-react';
import {
  buildReceiptHtml,
  normalizeReceiptData,
  receiptFileName,
  ReceiptData,
  ReceiptFormat,
} from '../utils/receiptTemplates';

interface ReceiptPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Partial on purpose. A receipt for a transaction migrated from the old database can be
   * missing an OR number, a customer or a payment method, and the modal is expected to print
   * it anyway — normalizeReceiptData fills the gaps. See utils/receiptTemplates.
   */
  data: Partial<ReceiptData> | null;
  isDarkMode?: boolean;
  /** Format shown when the modal opens. */
  initialFormat?: ReceiptFormat;
}

/**
 * On-screen preview of a transaction receipt with format switching, printing and
 * PDF download.
 *
 * The preview is an <iframe srcDoc> rather than inlined JSX on purpose:
 *
 *   - The templates are self-contained documents with their own fonts and
 *     millimetre widths. Rendered inline they would inherit the app's Tailwind
 *     reset and no longer match the printed sheet.
 *   - Printing the iframe prints exactly what is on screen, so "what you see is
 *     what you get" is structural rather than something to keep in sync by hand.
 *
 * Rendered through a portal to document.body so no ancestor stacking context or
 * `overflow: hidden` can clip it — the same trap that hid the confirmation
 * dialog in TransactionFormModal on mobile.
 */
const ReceiptPreviewModal: React.FC<ReceiptPreviewModalProps> = ({
  isOpen,
  onClose,
  data,
  isDarkMode = false,
  initialFormat = 'pos80',
}) => {
  const [format, setFormat] = useState<ReceiptFormat>(initialFormat);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // Normalised once, here, rather than at each use. The toolbar reads receiptNo and
  // customerName directly, and a legacy transaction can arrive without either — rendering
  // "OR # undefined" above a slip that prints correctly would be worse than the gap itself.
  const receipt = useMemo(() => (data ? normalizeReceiptData(data) : null), [data]);

  const html = useMemo(
    () => (receipt ? buildReceiptHtml(receipt, format) : ''),
    [receipt, format]
  );

  // A new document invalidates the measured height; drop it so the placeholder
  // height is used until the fresh document reports its own.
  useEffect(() => {
    setFrameHeight(null);
  }, [html]);

  /**
   * Size the preview frame to its document.
   *
   * Re-measured after a short delay as well as on load: the logo finishes
   * decoding after the load event, and it adds height. Without the second pass
   * the slip is measured a few millimetres short and the last line clips.
   */
  const measureFrame = useCallback(() => {
    const read = () => {
      const doc = frameRef.current?.contentDocument;
      if (!doc) return;

      const height = Math.max(
        doc.documentElement?.scrollHeight ?? 0,
        doc.body?.scrollHeight ?? 0
      );

      if (height > 0) setFrameHeight(height);
    };

    read();
    const timers = [150, 600, 1500].map(ms => window.setTimeout(read, ms));
    return () => timers.forEach(window.clearTimeout);
  }, []);

  /**
   * Print in a standalone window, not from the iframe.
   *
   * Chromium ignores the template's @page size when printing an <iframe>, forcing
   * the sheet to Letter/A4 — which silently breaks the 80mm thermal format. A real
   * top-level window honours it. Falls back to printing the iframe when the popup
   * is blocked, which is better than not printing at all.
   */
  const handlePrint = useCallback(() => {
    if (!receipt) return;
    setError(null);

    const autoPrint =
      '<' + 'script>window.addEventListener("load",function(){' +
      'setTimeout(function(){window.focus();window.print();},300);});' +
      'window.addEventListener("afterprint",function(){window.close();});<' + '/script>';

    const win = window.open(
      '',
      '_blank',
      format === 'a4' ? 'width=900,height=1000' : 'width=420,height=640'
    );

    if (win) {
      win.document.open();
      win.document.write(html.replace('</body>', autoPrint + '</body>'));
      win.document.close();
      return;
    }

    const frame = frameRef.current;
    if (frame?.contentWindow) {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      return;
    }

    setError('Your browser blocked the print window. Please allow pop-ups for this site.');
  }, [receipt, format, html]);

  /** Render the current format to PDF and download it. */
  const handleDownloadPdf = useCallback(async () => {
    if (!receipt || isDownloading) return;

    setError(null);
    setIsDownloading(true);

    // Offscreen host: html2pdf measures real layout, so the node must be attached
    // and un-clipped. Positioned far off-canvas instead of display:none, which
    // would collapse it to zero height and yield a blank page.
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.left = '-10000px';
    host.style.top = '0';
    host.style.width = format === 'a4' ? '210mm' : '72mm';
    host.style.background = '#ffffff';

    try {
      const { default: html2pdf } = await import('html2pdf.js');

      // Only the <body> content — html2pdf renders a DOM node, not a document,
      // so the template's <style> block is carried over explicitly.
      const styles = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
      const body = /<body>([\s\S]*?)<\/body>/.exec(html)?.[1] ?? '';
      host.innerHTML = `<style>${styles}</style>${body}`;
      document.body.appendChild(host);

      // Wait for the logo, otherwise it can be missing from the capture.
      await Promise.all(
        Array.from(host.querySelectorAll('img')).map(
          img =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>(resolve => {
                  img.addEventListener('load', () => resolve(), { once: true });
                  img.addEventListener('error', () => resolve(), { once: true });
                  setTimeout(resolve, 3000);
                })
        )
      );

      await html2pdf()
        .set({
          margin: format === 'a4' ? 0 : 2,
          filename: `${receiptFileName(receipt, format)}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: {
            unit: 'mm',
            // A thermal slip is one continuous strip — a fixed page height would
            // chop it, so the page is sized to the rendered slip instead.
            format: format === 'a4' ? 'a4' : [80, Math.max(150, host.scrollHeight * 0.2646 + 10)],
            orientation: 'portrait',
          },
        })
        .from(host)
        .save();
    } catch (e) {
      console.error('[ReceiptPreviewModal] PDF export failed:', e);
      setError(e instanceof Error ? e.message : 'Could not generate the PDF. Please try again.');
    } finally {
      if (host.parentNode) host.parentNode.removeChild(host);
      setIsDownloading(false);
    }
  }, [receipt, format, html, isDownloading]);

  if (!isOpen || !receipt) return null;

  const surface = isDarkMode ? 'bg-gray-900' : 'bg-white';
  const barSurface = isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200';
  const titleText = isDarkMode ? 'text-white' : 'text-gray-900';
  const subText = isDarkMode ? 'text-gray-400' : 'text-gray-500';

  /** Segmented control for the two formats. */
  const FormatButton: React.FC<{
    value: ReceiptFormat;
    label: string;
    icon: React.ReactNode;
  }> = ({ value, label, icon }) => {
    const active = format === value;
    return (
      <button
        type="button"
        onClick={() => setFormat(value)}
        aria-pressed={active}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border transition-colors first:rounded-l-md last:rounded-r-md -ml-px first:ml-0 ${
          active
            ? 'bg-blue-600 border-blue-600 text-white'
            : isDarkMode
              ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700'
              : 'bg-white border-gray-300 text-blue-700 hover:bg-gray-50'
        }`}
      >
        {icon}
        <span className="whitespace-nowrap">{label}</span>
      </button>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[10060] flex flex-col bg-black bg-opacity-70">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className={`flex-shrink-0 border-b px-4 py-3 ${barSurface}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className={`text-lg font-bold leading-tight ${titleText}`}>Receipt</h2>
            <p className={`text-xs truncate ${subText}`}>
              OR # {receipt.receiptNo} — {receipt.customerName}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center">
              <FormatButton value="pos80" label="80mm POS" icon={<Receipt size={14} />} />
              <FormatButton value="a4" label="A4 Invoice" icon={<FileText size={14} />} />
            </div>

            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700 transition-colors"
            >
              <Printer size={14} />
              Print
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {isDownloading ? 'Preparing…' : 'Download PDF'}
            </button>

            <button
              type="button"
              onClick={onClose}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
                isDarkMode
                  ? 'bg-gray-800 border-gray-600 text-gray-200 hover:bg-gray-700'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <ArrowLeft size={14} />
              Back
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-2 text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <div className={`flex-1 min-h-0 overflow-auto p-4 sm:p-8 ${isDarkMode ? 'bg-gray-950' : 'bg-gray-100'}`}>
        <div
          className={`mx-auto shadow-2xl ${surface}`}
          style={{ width: format === 'a4' ? '210mm' : '80mm', maxWidth: '100%' }}
        >
          <iframe
            ref={frameRef}
            title={`Receipt ${receipt.receiptNo} preview`}
            srcDoc={html}
            // Same-origin so print() can be called on it as the popup fallback,
            // and so its content height can be measured for auto-sizing.
            onLoad={measureFrame}
            scrolling="no"
            className="block w-full border-0 bg-white"
            style={{
              // Grown to fit the document: a thermal slip is a continuous strip
              // of arbitrary length, so a fixed height would clip it and leave an
              // inner scrollbar instead of showing the whole receipt.
              height: frameHeight
                ? `${frameHeight}px`
                : (format === 'a4' ? '297mm' : '160mm'),
            }}
          />
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ReceiptPreviewModal;
