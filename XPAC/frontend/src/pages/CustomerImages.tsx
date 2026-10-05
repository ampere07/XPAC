import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, Image as ImageIcon, Search, RefreshCw, Loader2, X, ChevronLeft, ChevronRight,
  ExternalLink, ArrowLeft, ImageOff,
} from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import {
  customerImageService, CustomerImage, CustomerImageFolder,
} from '../services/customerImageService';

/**
 * Customer Images (Billing): every image stored against a customer — profile, application,
 * job order, service order, proof of payment, attachments, LCP/NAP — in one Drive-like view.
 * Left: a folder per customer (Account No. + name). Right: that customer's images, with where
 * each one came from. Click an image for the full-screen viewer.
 */

const PER_PAGE = 24;

const formatDate = (value: string | null): string => {
  if (!value) return '-';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
};

/** An <img> that walks a list of URLs until one loads, then shows a placeholder. */
const FallbackImage: React.FC<{ sources: (string | null | undefined)[]; alt: string; className?: string; iconSize?: number }> = ({
  sources, alt, className, iconSize = 28,
}) => {
  const candidates = useMemo(() => sources.filter((s): s is string => !!s), [sources]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidates]);

  if (index >= candidates.length) {
    return (
      <div className={`flex flex-col items-center justify-center text-gray-500 ${className ?? ''}`}>
        <ImageOff size={iconSize} />
        <span className="text-[10px] mt-1">Preview unavailable</span>
      </div>
    );
  }

  return (
    <img
      src={candidates[index]}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      className={className}
      onError={() => setIndex(i => i + 1)}
    />
  );
};

const CustomerImages: React.FC = () => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(localStorage.getItem('theme') !== 'light');
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const primary = colorPalette?.primary || '#7c3aed';

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [withImagesOnly, setWithImagesOnly] = useState(true);
  const [page, setPage] = useState(1);

  const [folders, setFolders] = useState<CustomerImageFolder[]>([]);
  const [total, setTotal] = useState(0);
  const [lastPage, setLastPage] = useState(1);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);

  const [selected, setSelected] = useState<CustomerImageFolder | null>(null);
  const [images, setImages] = useState<CustomerImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>('all');

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const observer = new MutationObserver(() => setIsDarkMode(localStorage.getItem('theme') !== 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    settingsColorPaletteService.getActive().then(setColorPalette).catch(() => {});
    return () => observer.disconnect();
  }, []);

  // Search waits for a pause in typing, so each keystroke is not a request.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadFolders = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoadingFolders(true);
    setFolderError(null);
    try {
      const result = await customerImageService.list({ search, page, perPage: PER_PAGE, withImages: withImagesOnly });
      if (requestId !== requestRef.current) return;
      setFolders(result.data);
      setTotal(result.total);
      setLastPage(result.last_page);
    } catch (err: any) {
      if (requestId !== requestRef.current) return;
      setFolderError(err?.response?.data?.message || err?.message || 'Failed to load customers.');
    } finally {
      if (requestId === requestRef.current) setLoadingFolders(false);
    }
  }, [search, page, withImagesOnly]);

  useEffect(() => { loadFolders(); }, [loadFolders]);

  const openFolder = async (folder: CustomerImageFolder) => {
    setSelected(folder);
    setSourceFilter('all');
    setImages([]);
    setImageError(null);
    setLoadingImages(true);
    try {
      const result = await customerImageService.forCustomer(folder.account_no);
      setImages(result.images);
    } catch (err: any) {
      setImageError(err?.response?.data?.message || err?.message || 'Failed to load images.');
    } finally {
      setLoadingImages(false);
    }
  };

  const visibleImages = useMemo(
    () => (sourceFilter === 'all' ? images : images.filter(i => i.source_key === sourceFilter)),
    [images, sourceFilter]
  );

  // Sources this customer actually has, with counts, for the filter chips.
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    images.forEach(i => {
      const entry = counts.get(i.source_key) || { label: i.source, count: 0 };
      entry.count += 1;
      counts.set(i.source_key, entry);
    });
    return Array.from(counts.entries());
  }, [images]);

  // Viewer keyboard: Esc closes, arrows move.
  useEffect(() => {
    if (viewerIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewerIndex(null);
      if (e.key === 'ArrowRight') setViewerIndex(i => (i === null ? i : Math.min(visibleImages.length - 1, i + 1)));
      if (e.key === 'ArrowLeft') setViewerIndex(i => (i === null ? i : Math.max(0, i - 1)));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerIndex, visibleImages.length]);

  const viewing = viewerIndex !== null ? visibleImages[viewerIndex] : null;

  const panel = isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200';
  const muted = isDarkMode ? 'text-gray-400' : 'text-gray-500';
  const strong = isDarkMode ? 'text-white' : 'text-gray-900';

  return (
    <div className={`h-full flex flex-col ${isDarkMode ? 'bg-gray-950' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex flex-wrap items-center gap-3 ${panel}`}>
        <div className="flex items-center gap-2 mr-auto">
          <ImageIcon size={20} style={{ color: primary }} />
          <h1 className={`text-lg font-semibold ${strong}`}>Customer Images</h1>
          <span className={`text-xs ${muted}`}>{total.toLocaleString()} customer{total === 1 ? '' : 's'}</span>
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={16} className={`absolute left-3 top-2.5 ${muted}`} />
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search Account No. or Customer Name"
            className={`w-full pl-9 pr-3 py-2 rounded border text-sm focus:outline-none ${isDarkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
          />
        </div>
        <label className={`flex items-center gap-2 text-sm cursor-pointer ${muted}`}>
          <input
            type="checkbox"
            checked={withImagesOnly}
            onChange={e => { setWithImagesOnly(e.target.checked); setPage(1); }}
            style={{ accentColor: primary }}
          />
          With images only
        </label>
        <button
          onClick={() => { loadFolders(); if (selected) openFolder(selected); }}
          className="p-2 rounded text-white"
          style={{ backgroundColor: primary }}
          title="Refresh"
        >
          <RefreshCw size={16} className={loadingFolders ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Customer folders */}
        <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 border-r flex-shrink-0 ${panel}`}>
          <div className="flex-1 overflow-y-auto">
            {loadingFolders && folders.length === 0 ? (
              <div className={`flex items-center justify-center p-8 ${muted}`}><Loader2 className="animate-spin mr-2" size={18} /> Loading…</div>
            ) : folderError ? (
              <div className="p-6 text-sm text-red-500">{folderError}</div>
            ) : folders.length === 0 ? (
              <div className={`p-8 text-center text-sm ${muted}`}>No customers found.</div>
            ) : (
              folders.map(folder => {
                const active = selected?.account_no === folder.account_no;
                return (
                  <button
                    key={folder.account_no}
                    onClick={() => openFolder(folder)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b transition-colors ${isDarkMode ? 'border-gray-800 hover:bg-gray-800' : 'border-gray-100 hover:bg-gray-100'}`}
                    style={active ? { backgroundColor: `${primary}26` } : {}}
                  >
                    <div className="w-12 h-12 rounded overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: `${primary}1f` }}>
                      {folder.cover
                        ? <FallbackImage sources={[folder.cover]} alt="" className="w-full h-full object-cover" iconSize={18} />
                        : <Folder size={22} style={{ color: primary }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm font-medium truncate ${strong}`}>{folder.full_name || '(No name)'}</div>
                      <div className={`text-xs ${muted}`}>{folder.account_no}</div>
                      {folder.sources.length > 0 && (
                        <div className={`text-[10px] truncate ${muted}`}>{folder.sources.join(' · ')}</div>
                      )}
                    </div>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full text-white flex-shrink-0" style={{ backgroundColor: primary }}>
                      {folder.image_count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {lastPage > 1 && (
            <div className={`flex items-center justify-between px-4 py-2 border-t text-sm ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} ${muted}`}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1 disabled:opacity-40"><ChevronLeft size={18} /></button>
              <span>Page {page} of {lastPage}</span>
              <button disabled={page >= lastPage} onClick={() => setPage(p => p + 1)} className="p-1 disabled:opacity-40"><ChevronRight size={18} /></button>
            </div>
          )}
        </div>

        {/* Selected customer's images */}
        <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden`}>
          {!selected ? (
            <div className={`flex-1 flex flex-col items-center justify-center ${muted}`}>
              <Folder size={48} />
              <p className="mt-3 text-sm">Select a customer to see their images.</p>
            </div>
          ) : (
            <>
              <div className={`px-4 py-3 border-b flex items-center gap-3 ${panel}`}>
                <button onClick={() => setSelected(null)} className={`md:hidden p-1 ${muted}`} aria-label="Back"><ArrowLeft size={20} /></button>
                <div className="min-w-0">
                  <div className={`font-semibold truncate ${strong}`}>{selected.full_name || '(No name)'}</div>
                  <div className={`text-xs ${muted}`}>Account No. {selected.account_no} · {images.length} image{images.length === 1 ? '' : 's'}</div>
                </div>
              </div>

              {sourceCounts.length > 1 && (
                <div className={`px-4 py-2 border-b flex flex-wrap gap-2 ${panel}`}>
                  {[['all', { label: 'All', count: images.length }] as const, ...sourceCounts].map(([key, info]) => (
                    <button
                      key={key}
                      onClick={() => setSourceFilter(key)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border ${sourceFilter === key ? 'text-white border-transparent' : isDarkMode ? 'border-gray-700 text-gray-300' : 'border-gray-300 text-gray-700'}`}
                      style={sourceFilter === key ? { backgroundColor: primary } : {}}
                    >
                      {info.label} ({info.count})
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4">
                {loadingImages ? (
                  <div className={`flex items-center justify-center p-8 ${muted}`}><Loader2 className="animate-spin mr-2" size={18} /> Loading images…</div>
                ) : imageError ? (
                  <div className="text-sm text-red-500">{imageError}</div>
                ) : visibleImages.length === 0 ? (
                  <div className={`text-center text-sm p-8 ${muted}`}>No images for this customer.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {visibleImages.map((image, index) => (
                      <button
                        key={image.id}
                        onClick={() => setViewerIndex(index)}
                        className={`group text-left rounded-lg border overflow-hidden transition-shadow hover:shadow-lg ${panel}`}
                        title={`${image.source} — ${image.field_label}`}
                      >
                        <div className={`aspect-square overflow-hidden ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                          <FallbackImage
                            sources={[image.thumbnail_url, image.fallback_url]}
                            alt={image.field_label}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        </div>
                        <div className="p-2">
                          <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded text-white mb-1" style={{ backgroundColor: primary }}>
                            {image.source}
                          </span>
                          <div className={`text-xs font-medium truncate ${strong}`}>{image.field_label}</div>
                          <div className={`text-[10px] truncate ${muted}`}>#{image.record_id} · {formatDate(image.date)}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Full-screen viewer */}
      {viewing && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col" onClick={() => setViewerIndex(null)}>
          <div className="flex items-start justify-between gap-3 p-4 text-white" onClick={e => e.stopPropagation()}>
            <div className="min-w-0 text-sm">
              <div className="font-semibold">{viewing.source} — {viewing.field_label}</div>
              <div className="text-gray-300 text-xs mt-0.5">
                {selected?.full_name || '(No name)'} · Account No. {selected?.account_no}
              </div>
              <div className="text-gray-400 text-xs mt-0.5">
                Table: {viewing.table} · Record #{viewing.record_id} · Field: {viewing.field} · Date: {formatDate(viewing.date)}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-gray-400">{(viewerIndex ?? 0) + 1} / {visibleImages.length}</span>
              <a href={viewing.open_url} target="_blank" rel="noopener noreferrer" className="p-2 rounded hover:bg-white/10" title="Open original">
                <ExternalLink size={20} />
              </a>
              <button onClick={() => setViewerIndex(null)} className="p-2 rounded hover:bg-white/10" aria-label="Close">
                <X size={24} />
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center relative px-12 pb-6 min-h-0">
            {viewerIndex! > 0 && (
              <button
                onClick={e => { e.stopPropagation(); setViewerIndex(i => (i ?? 1) - 1); }}
                className="absolute left-2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                aria-label="Previous"
              >
                <ChevronLeft size={28} />
              </button>
            )}
            <div onClick={e => e.stopPropagation()} className="max-w-full max-h-full flex items-center justify-center">
              <FallbackImage
                key={viewing.id}
                sources={[viewing.full_url, viewing.fallback_url, viewing.thumbnail_url]}
                alt={viewing.field_label}
                className="max-w-full max-h-[80vh] object-contain"
                iconSize={48}
              />
            </div>
            {viewerIndex! < visibleImages.length - 1 && (
              <button
                onClick={e => { e.stopPropagation(); setViewerIndex(i => (i ?? 0) + 1); }}
                className="absolute right-2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
                aria-label="Next"
              >
                <ChevronRight size={28} />
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default CustomerImages;
