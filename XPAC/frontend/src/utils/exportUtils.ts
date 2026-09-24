import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formUIService } from '../services/formUIService';

export const exportToCSV = <T,>(
  filename: string,
  columns: { key: string; label: string }[],
  data: T[],
  renderCell: (item: T, key: string) => any
) => {
  if (!data || data.length === 0) return;

  const headers = columns.map(col => col.label);

  const escapeCsv = (str: any) => {
    if (str === null || str === undefined) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  };

  const csvRows = [];
  csvRows.push(headers.map(escapeCsv).join(','));

  data.forEach(item => {
    const row = columns.map(col => renderCell(item, col.key));
    csvRows.push(row.map(escapeCsv).join(','));
  });

  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Converts a hex color string (#RRGGBB or #RGB) to an RGB tuple.
 */
function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Lightens an RGB color by mixing it with white at the given ratio (0–1).
 */
function lightenColor(rgb: [number, number, number], ratio: number): [number, number, number] {
  return [
    Math.round(rgb[0] + (255 - rgb[0]) * ratio),
    Math.round(rgb[1] + (255 - rgb[1]) * ratio),
    Math.round(rgb[2] + (255 - rgb[2]) * ratio),
  ];
}

/**
 * Loads an image from a URL and returns it as a base64 data URL.
 * Returns null if loading fails.
 */
async function loadImageAsBase64(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export interface PDFColorPalette {
  primary?: string;
  secondary?: string;
  accent?: string;
}

export const exportToPDF = async <T,>(
  title: string,
  filename: string,
  columns: { key: string; label: string }[],
  data: T[],
  renderCell: (item: T, key: string) => any,
  colorPalette?: PDFColorPalette | null
) => {
  if (!data || data.length === 0) return;

  // ── Resolve colors ──────────────────────────────────────────────
  const primaryHex = colorPalette?.primary || '#1e3a5f';
  const primaryRgb = hexToRgb(primaryHex);
  const headerBgRgb = primaryRgb;
  const headerTextRgb: [number, number, number] = [255, 255, 255];
  const accentLightRgb = lightenColor(primaryRgb, 0.92);
  const borderRgb = lightenColor(primaryRgb, 0.7);

  // ── Fetch logo and brand config ─────────────────────────────────
  let brandName = 'SYNC';
  let logoBase64: string | null = null;
  try {
    const config = await formUIService.getConfig();
    if (config) {
      if (config.brand_name) brandName = config.brand_name;
      if (config.logo_url) {
        const apiUrl = process.env.REACT_APP_API_BASE_URL || '';
        const proxyUrl = `${apiUrl}/proxy/image?url=${encodeURIComponent(config.logo_url)}`;
        logoBase64 = await loadImageAsBase64(proxyUrl);
      }
    }
  } catch (err) {
    console.error('Failed to get logo or brand config for PDF:', err);
  }

  // ── Create PDF (portrait A4) ────────────────────────────────────
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginLeft = 14;
  const marginRight = 14;
  const marginTop = 14;
  const contentWidth = pageWidth - marginLeft - marginRight;

  // ── Header ──────────────────────────────────────────────────────
  let headerY = marginTop;

  // Header accent bar
  doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.rect(marginLeft, headerY, contentWidth, 1.5, 'F');
  headerY += 5;

  // Logo
  if (logoBase64) {
    try {
      const logoHeight = 14;
      const logoWidth = 14;
      doc.addImage(logoBase64, 'PNG', marginLeft, headerY - 1, logoWidth, logoHeight);
      // Brand name next to logo
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.text(brandName.toUpperCase(), marginLeft + logoWidth + 4, headerY + 5);

      // Title below brand name
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(title, marginLeft + logoWidth + 4, headerY + 11);

      headerY += logoHeight + 3;
    } catch {
      // Fallback if logo fails to embed
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.text(brandName.toUpperCase(), marginLeft, headerY + 5);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(title, marginLeft, headerY + 11);
      headerY += 15;
    }
  } else {
    // No logo – brand name and title only
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
    doc.text(brandName.toUpperCase(), marginLeft, headerY + 5);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text(title, marginLeft, headerY + 11);
    headerY += 15;
  }

  // Right-aligned meta info
  const metaX = pageWidth - marginRight;
  const metaTopY = marginTop + 6;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`Date: ${new Date().toLocaleDateString()}`, metaX, metaTopY, { align: 'right' });
  doc.text(`Records: ${data.length}`, metaX, metaTopY + 4, { align: 'right' });

  // Separator line
  headerY += 2;
  doc.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
  doc.setLineWidth(0.4);
  doc.line(marginLeft, headerY, pageWidth - marginRight, headerY);
  headerY += 4;

  // ── Table ───────────────────────────────────────────────────────
  const tableHeaders = columns.map(col => col.label);
  const tableBody = data.map(item =>
    columns.map(col => {
      const val = renderCell(item, col.key);
      return val !== null && val !== undefined ? String(val) : '';
    })
  );

  // Determine column alignments (right-align monetary columns)
  const columnStyles: Record<number, { halign: 'left' | 'right' | 'center' }> = {};
  columns.forEach((col, idx) => {
    if (col.key === 'amount' || col.key === 'total_amount') {
      columnStyles[idx] = { halign: 'right' };
    }
  });

  autoTable(doc, {
    startY: headerY,
    head: [tableHeaders],
    body: tableBody,
    margin: { left: marginLeft, right: marginRight, top: marginTop + 28, bottom: 20 },
    styles: {
      fontSize: 8.5,
      cellPadding: 3,
      lineColor: [borderRgb[0], borderRgb[1], borderRgb[2]],
      lineWidth: 0.2,
      textColor: [50, 50, 50],
      font: 'helvetica',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [headerBgRgb[0], headerBgRgb[1], headerBgRgb[2]],
      textColor: [headerTextRgb[0], headerTextRgb[1], headerTextRgb[2]],
      fontStyle: 'bold',
      fontSize: 8.5,
      cellPadding: 3.5,
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [accentLightRgb[0], accentLightRgb[1], accentLightRgb[2]],
    },
    columnStyles,
    showHead: 'everyPage',
    didDrawPage: (pageData: any) => {
      const pageCount = (doc as any).internal.getNumberOfPages();
      const currentPage = (doc as any).internal.getCurrentPageInfo().pageNumber;
      const pageHeight = doc.internal.pageSize.getHeight();

      // ── Footer ──────────────────────────────────────────────
      // Thin accent line above footer
      doc.setDrawColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
      doc.setLineWidth(0.3);
      doc.line(marginLeft, pageHeight - 12, pageWidth - marginRight, pageHeight - 12);

      // Left: brand name
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(140, 140, 140);
      doc.text(`${brandName} — ${title}`, marginLeft, pageHeight - 8);

      // Right: page number
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      doc.text(`Page ${currentPage} of ${pageCount}`, pageWidth - marginRight, pageHeight - 8, { align: 'right' });

      // ── Repeat header accent bar on subsequent pages ────────
      if (currentPage > 1) {
        doc.setFillColor(primaryRgb[0], primaryRgb[1], primaryRgb[2]);
        doc.rect(marginLeft, marginTop, contentWidth, 1, 'F');
      }
    },
  });

  // ── Fix page count (jsPDF doesn't know total until the end) ─────
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();

    // Overwrite the page number text with the correct total
    doc.setFillColor(255, 255, 255);
    doc.rect(pageWidth - marginRight - 30, pageHeight - 11, 30, 5, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginRight, pageHeight - 8, { align: 'right' });
  }

  // ── Save ────────────────────────────────────────────────────────
  doc.save(`${filename}_${new Date().toISOString().split('T')[0]}.pdf`);
};
