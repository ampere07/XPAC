import * as FileSystem from 'expo-file-system';
import { Share } from 'react-native';

/**
 * RN replacement for the web Blob/anchor CSV download.
 * Writes the CSV to the cache dir and opens the native share sheet (also passes the
 * raw text as `message` so Android share targets that ignore file URLs still work).
 */
const escapeCsv = (str: any) => {
  if (str === null || str === undefined) return '""';
  const s = String(str).replace(/"/g, '""');
  return `"${s}"`;
};

const buildCsv = <T,>(
  columns: { key: string; label: string }[],
  data: T[],
  renderCell: (item: T, key: string) => any
): string => {
  const rows: string[] = [];
  rows.push(columns.map((col) => escapeCsv(col.label)).join(','));
  data.forEach((item) => {
    rows.push(columns.map((col) => escapeCsv(renderCell(item, col.key))).join(','));
  });
  return rows.join('\n');
};

export const exportToCSV = async <T,>(
  filename: string,
  columns: { key: string; label: string }[],
  data: T[],
  renderCell: (item: T, key: string) => any
): Promise<void> => {
  if (!data || data.length === 0) return;

  const csvContent = buildCsv(columns, data, renderCell);
  const name = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;

  try {
    const dir = (FileSystem as any).cacheDirectory || (FileSystem as any).documentDirectory || '';
    const fileUri = `${dir}${name}`;
    await (FileSystem as any).writeAsStringAsync(fileUri, csvContent);
    await Share.share({ url: fileUri, message: csvContent, title: name });
  } catch (e) {
    // Fallback: share the raw CSV text only.
    try {
      await Share.share({ message: csvContent, title: name });
    } catch (err) {
      console.error('CSV export/share failed:', err);
    }
  }
};

/**
 * The web version rendered an HTML table to PDF via html2pdf.js, which has no mobile
 * equivalent without a PDF engine (expo-print is not installed). To keep callers
 * working, this falls back to the CSV share. Swap in expo-print if true PDF is needed.
 */
export const exportToPDF = async <T,>(
  _title: string,
  filename: string,
  columns: { key: string; label: string }[],
  data: T[],
  renderCell: (item: T, key: string) => any
): Promise<void> => {
  return exportToCSV(filename, columns, data, renderCell);
};
