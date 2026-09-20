import React, { useEffect, useState, createContext, useContext } from 'react';
import { Loader2 } from 'lucide-react';
import { settingsColorPaletteService, ColorPalette } from '../../services/settingsColorPaletteService';

export const ModalThemeContext = createContext<{ isDarkMode: boolean; colorPalette: ColorPalette | null }>({
    isDarkMode: true,
    colorPalette: null
});

export const useModalTheme = () => useContext(ModalThemeContext);

interface ModalUITemplateProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    isDarkMode?: boolean;
    colorPalette?: ColorPalette | null;
    loading?: boolean;
    loadingPercentage?: number;
    maxWidth?: string;
    primaryAction?: {
        label: string;
        onClick: () => void;
        disabled?: boolean;
    };
    secondaryActionLabel?: string;
    // Shared Alert Modal Props (Optional)
    alertModal?: {
        isOpen: boolean;
        type: 'success' | 'error' | 'warning' | 'confirm' | 'loading';
        title: string;
        message: string;
        onConfirm?: () => void;
        onCancel?: () => void;
    };
    closeOnOutsideClick?: boolean;
}

const ModalUITemplate: React.FC<ModalUITemplateProps> = ({
    isOpen,
    onClose,
    title,
    children,
    isDarkMode: forceDarkMode,
    colorPalette: forcePalette,
    loading = false,
    loadingPercentage,
    maxWidth = 'max-w-2xl',
    primaryAction,
    secondaryActionLabel = 'Cancel',
    alertModal,
    closeOnOutsideClick = true
}) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);

    useEffect(() => {
        if (forceDarkMode !== undefined) {
            setIsDarkMode(forceDarkMode);
            return;
        }

        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };

        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, [forceDarkMode]);

    useEffect(() => {
        if (forcePalette !== undefined) {
            setColorPalette(forcePalette);
            return;
        }

        const fetchPalette = async () => {
            try {
                const active = await settingsColorPaletteService.getActive();
                setColorPalette(active);
            } catch (err) {
                console.error('Failed to fetch palette:', err);
            }
        };
        fetchPalette();
    }, [forcePalette]);

    if (!isOpen) return null;

    return (
        <ModalThemeContext.Provider value={{ isDarkMode, colorPalette }}>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-end z-50" onClick={() => closeOnOutsideClick && onClose()}>
                <div
                    className={`h-full w-full ${maxWidth} shadow-2xl transform transition-transform duration-300 ease-in-out translate-x-0 overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-black'}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className={`px-6 py-4 flex items-center justify-between border-b ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-100 border-gray-200'}`}>
                        <h2 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-black'}`}>{title}</h2>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={onClose}
                                className={`px-4 py-2 rounded text-sm transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-black'}`}
                            >
                                {secondaryActionLabel}
                            </button>
                            {primaryAction && (
                                <button
                                    onClick={primaryAction.onClick}
                                    disabled={primaryAction.disabled || loading}
                                    className="px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm flex items-center transition-colors"
                                    style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                    onMouseEnter={(e) => {
                                        if (colorPalette?.accent && !loading) e.currentTarget.style.backgroundColor = colorPalette.accent;
                                    }}
                                    onMouseLeave={(e) => {
                                        if (colorPalette?.primary) e.currentTarget.style.backgroundColor = colorPalette.primary;
                                    }}
                                >
                                    {loading ? (
                                        <>
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                                            Saving...
                                        </>
                                    ) : (
                                        primaryAction.label
                                    )}
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-6">
                        {children}
                    </div>
                </div>
            </div>

            {/* Spinner Overlay */}
            {loading && (
                <div className="fixed inset-0 bg-black bg-opacity-70 z-[10000] flex items-center justify-center">
                    <div className={`rounded-lg p-8 flex flex-col items-center space-y-6 min-w-[320px] ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                        <Loader2 className="w-20 h-20 animate-spin" style={{ color: colorPalette?.primary || '#7c3aed' }} />
                        {loadingPercentage !== undefined && (
                            <div className="text-center">
                                <p className={`text-4xl font-bold ${isDarkMode ? 'text-white' : 'text-black'}`}>{loadingPercentage}%</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Alert/Confirmation Modal */}
            {alertModal?.isOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[10001]">
                    <div className={`border rounded-lg p-8 max-w-md w-full mx-4 ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                        {alertModal.type === 'loading' ? (
                            <div className="text-center">
                                <div className="flex justify-center mb-4">
                                    <div className="animate-spin rounded-full h-16 w-16 border-b-4" style={{ borderColor: colorPalette?.primary || '#7c3aed' }}></div>
                                </div>
                                <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-black'}`}>{alertModal.title}</h3>
                                <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>{alertModal.message}</p>
                            </div>
                        ) : (
                            <>
                                <h3 className={`text-lg font-semibold mb-4 ${isDarkMode ? 'text-white' : 'text-black'}`}>{alertModal.title}</h3>
                                <p className={`mb-6 whitespace-pre-line ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}>{alertModal.message}</p>
                                <div className="flex items-center justify-end gap-3">
                                    {alertModal.type === 'confirm' ? (
                                        <>
                                            <button
                                                onClick={alertModal.onCancel}
                                                className={`px-4 py-2 rounded transition-colors ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-200 hover:bg-gray-300 text-black'}`}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                onClick={alertModal.onConfirm}
                                                className="px-4 py-2 text-white rounded transition-colors"
                                                style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                                onMouseEnter={(e) => { if (colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed'; }}
                                            >
                                                Confirm
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            onClick={alertModal.onConfirm || (() => { })}
                                            className="px-4 py-2 text-white rounded transition-colors"
                                            style={{ backgroundColor: colorPalette?.primary || '#7c3aed' }}
                                            onMouseEnter={(e) => { if (colorPalette?.accent) e.currentTarget.style.backgroundColor = colorPalette.accent; }}
                                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = colorPalette?.primary || '#7c3aed'; }}
                                        >
                                            OK
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </ModalThemeContext.Provider>
    );
};

export default ModalUITemplate;
