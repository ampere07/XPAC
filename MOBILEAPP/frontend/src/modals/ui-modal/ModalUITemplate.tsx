import React, { useEffect, useState, createContext, useContext } from 'react';
import {
    View,
    Text,
    Modal,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { settingsColorPaletteService, ColorPalette } from '../../services/settingsColorPaletteService';

export const ModalThemeContext = createContext<{ isDarkMode: boolean; colorPalette: ColorPalette | null }>({
    isDarkMode: false,
    colorPalette: null,
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
    primaryAction,
    secondaryActionLabel = 'Cancel',
    alertModal,
    closeOnOutsideClick = true,
}) => {
    // App is forced light mode; default to false instead of the web default of true.
    const [isDarkMode, setIsDarkMode] = useState<boolean>(forceDarkMode ?? false);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(forcePalette ?? null);
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();

    useEffect(() => {
        if (forceDarkMode !== undefined) {
            setIsDarkMode(forceDarkMode);
        }
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

    const primaryColor = colorPalette?.primary || '#7c3aed';
    const panelBg = isDarkMode ? '#111827' : '#ffffff';
    const headerBg = isDarkMode ? '#1f2937' : '#f3f4f6';
    const borderColor = isDarkMode ? '#374151' : '#e5e7eb';
    const titleColor = isDarkMode ? '#ffffff' : '#000000';
    // Right-side drawer: full width on phones, capped on tablets.
    const panelWidth = width >= 768 ? Math.min(width, 640) : width;

    return (
        <ModalThemeContext.Provider value={{ isDarkMode, colorPalette }}>
            <Modal
                visible={isOpen}
                transparent
                animationType="slide"
                statusBarTranslucent
                onRequestClose={onClose}
            >
                <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', flexDirection: 'row', justifyContent: 'flex-end' }}>
                    {/* Backdrop tap area */}
                    <TouchableOpacity
                        activeOpacity={1}
                        style={{ flex: 1 }}
                        onPress={() => closeOnOutsideClick && onClose()}
                    />
                    <View style={{ width: panelWidth, height: '100%', backgroundColor: panelBg, flexDirection: 'column' }}>
                        {/* Header */}
                        <View style={{
                            paddingHorizontal: 24,
                            paddingTop: insets.top + 16,
                            paddingBottom: 16,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderBottomWidth: 1,
                            borderBottomColor: borderColor,
                            backgroundColor: headerBg,
                        }}>
                            <Text style={{ fontSize: 20, fontWeight: '600', color: titleColor, flex: 1 }} numberOfLines={1}>
                                {title}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                                <TouchableOpacity
                                    onPress={onClose}
                                    style={{
                                        paddingHorizontal: 16,
                                        paddingVertical: 8,
                                        borderRadius: 6,
                                        backgroundColor: isDarkMode ? '#374151' : '#e5e7eb',
                                    }}
                                >
                                    <Text style={{ fontSize: 14, color: titleColor }}>{secondaryActionLabel}</Text>
                                </TouchableOpacity>
                                {primaryAction && (
                                    <TouchableOpacity
                                        onPress={primaryAction.onClick}
                                        disabled={primaryAction.disabled || loading}
                                        style={{
                                            paddingHorizontal: 16,
                                            paddingVertical: 8,
                                            borderRadius: 6,
                                            backgroundColor: primaryColor,
                                            flexDirection: 'row',
                                            alignItems: 'center',
                                            opacity: (primaryAction.disabled || loading) ? 0.5 : 1,
                                        }}
                                    >
                                        {loading ? (
                                            <>
                                                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                                                <Text style={{ fontSize: 14, color: '#ffffff' }}>Saving...</Text>
                                            </>
                                        ) : (
                                            <Text style={{ fontSize: 14, color: '#ffffff' }}>{primaryAction.label}</Text>
                                        )}
                                    </TouchableOpacity>
                                )}
                            </View>
                        </View>

                        {/* Body */}
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }}>
                            {children}
                        </ScrollView>
                    </View>
                </View>

                {/* Spinner Overlay */}
                {loading && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                        <View style={{ borderRadius: 12, padding: 32, alignItems: 'center', minWidth: 320, backgroundColor: panelBg }}>
                            <ActivityIndicator size="large" color={primaryColor} />
                            {loadingPercentage !== undefined && (
                                <Text style={{ fontSize: 36, fontWeight: 'bold', marginTop: 16, color: titleColor }}>{loadingPercentage}%</Text>
                            )}
                        </View>
                    </View>
                )}

                {/* Alert/Confirmation Modal */}
                {alertModal?.isOpen && (
                    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
                        <View style={{ borderRadius: 12, padding: 32, maxWidth: 448, width: '100%', borderWidth: 1, borderColor, backgroundColor: panelBg }}>
                            {alertModal.type === 'loading' ? (
                                <View style={{ alignItems: 'center' }}>
                                    <ActivityIndicator size="large" color={primaryColor} style={{ marginBottom: 16 }} />
                                    <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 8, color: titleColor }}>{alertModal.title}</Text>
                                    <Text style={{ fontSize: 14, color: isDarkMode ? '#9ca3af' : '#4b5563', textAlign: 'center' }}>{alertModal.message}</Text>
                                </View>
                            ) : (
                                <>
                                    <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 16, color: titleColor }}>{alertModal.title}</Text>
                                    <Text style={{ marginBottom: 24, color: isDarkMode ? '#d1d5db' : '#1f2937' }}>{alertModal.message}</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
                                        {alertModal.type === 'confirm' && (
                                            <TouchableOpacity
                                                onPress={alertModal.onCancel}
                                                style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: isDarkMode ? '#374151' : '#e5e7eb' }}
                                            >
                                                <Text style={{ color: titleColor }}>Cancel</Text>
                                            </TouchableOpacity>
                                        )}
                                        <TouchableOpacity
                                            onPress={alertModal.onConfirm || (() => { })}
                                            style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6, backgroundColor: primaryColor }}
                                        >
                                            <Text style={{ color: '#ffffff' }}>{alertModal.type === 'confirm' ? 'Confirm' : 'OK'}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </>
                            )}
                        </View>
                    </View>
                )}
            </Modal>
        </ModalThemeContext.Provider>
    );
};

export default ModalUITemplate;
