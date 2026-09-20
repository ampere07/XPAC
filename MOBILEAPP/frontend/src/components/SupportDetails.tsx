import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Modal,
    Pressable,
    Dimensions,
    StyleSheet,
    Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    ChevronRight,
    ChevronLeft,
    X,
    Clock,
    User,
    MessageSquare,
    AlertCircle,
    FileText,
    Calendar,
    CheckCircle2,
    AlertTriangle,
    Info,
} from 'lucide-react-native';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface SupportRequest {
    id: string;
    date: string;
    requestId: string;
    issue: string;
    issueDetails: string;
    status: string;
    statusNote: string;
    assignedEmail: string;
    visitNote: string;
    visitInfo: {
        status: string;
    };
}

interface SupportDetailsProps {
    request: SupportRequest;

    onClose: () => void;
}

const SupportDetails: React.FC<SupportDetailsProps> = ({
    request,
    onClose,
}) => {
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const { width } = Dimensions.get('window');
    const isTablet = width >= 768;

    useEffect(() => {
        const fetchColorPalette = async () => {
            try {
                const activePalette = await settingsColorPaletteService.getActive();
                setColorPalette(activePalette);
            } catch (err) {
                console.error('Failed to fetch color palette:', err);
            }
        };
        fetchColorPalette();
    }, []);

    const isDarkMode = false;
    const primaryColor = colorPalette?.primary || '#ef4444';
    const iconColor = '#4b5563';
    const borderColor = '#e5e7eb';
    const cardBg = '#ffffff';
    const labelColor = '#4b5563';
    const valueColor = '#111827';
    const headerBg = '#f3f4f6';

    const DetailRow = ({
        label,
        value,
        iconPath: Icon,
        isFullWidth = false
    }: {
        label: string;
        value: string | number;
        iconPath?: any;
        isFullWidth?: boolean;
    }) => (
        <View
            style={{
                flexDirection: isFullWidth ? 'column' : 'row',
                alignItems: isFullWidth ? 'flex-start' : 'center',
                justifyContent: 'space-between',
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: borderColor,
                gap: isFullWidth ? 8 : 0
            }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {Icon && <Icon size={16} color={iconColor} />}
                <Text style={{ fontSize: 14, color: labelColor }}>{label}</Text>
            </View>
            <Text style={{
                fontWeight: '500',
                color: valueColor,
                fontSize: 14,
                textAlign: isFullWidth ? 'left' : 'right',
                flex: isFullWidth ? 0 : 1,
                marginLeft: isFullWidth ? 0 : 16
            }}>
                {String(value || 'None')}
            </Text>
        </View>
    );

    const StatusBadge = ({ status }: { status: string }) => {
        const getStatusColor = () => {
            switch (status.toLowerCase()) {
                case 'resolved':
                case 'done':
                case 'success':
                    return '#10b981';
                case 'pending':
                case 'in progress':
                    return '#f59e0b';
                case 'failed':
                case 'cancelled':
                    return '#ef4444';
                default:
                    return primaryColor;
            }
        };

        const statusColor = getStatusColor();

        return (
            <View style={{
                paddingHorizontal: 12,
                paddingVertical: 4,
                borderRadius: 9999,
                backgroundColor: statusColor + '15',
                borderWidth: 1,
                borderColor: statusColor + '30',
            }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: statusColor, textTransform: 'uppercase' }}>
                    {status}
                </Text>
            </View>
        );
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#ffffff' }}>
            {/* Header */}
            <View style={{
                height: 60,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 16,
                backgroundColor: '#ffffff',
                borderBottomWidth: 1,
                borderBottomColor: '#e2e8f0',
            }}>
                <Pressable onPress={onClose} style={{ padding: 8 }}>
                    <ChevronLeft size={24} color="#000000" />
                </Pressable>

                <Text style={{ fontSize: 18, fontWeight: '700', color: '#1e293b' }}>
                    Ticket #{request.requestId}
                </Text>

                <StatusBadge status={request.status} />
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                {/* Core Info Card */}
                <View style={{
                    marginBottom: 30, 
                    paddingBottom: 20, 
                    borderBottomWidth: 1, 
                    borderBottomColor: '#eee'
                }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20, borderBottomWidth: 1, borderBottomColor: borderColor, paddingBottom: 15 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: primaryColor + '15', justifyContent: 'center', alignItems: 'center' }}>
                            <FileText size={20} color={primaryColor} />
                        </View>
                        <View>
                            <Text style={{ fontSize: 16, fontWeight: '700', color: valueColor }}>{request.issue}</Text>
                            <Text style={{ fontSize: 12, color: labelColor }}>Submitted on {request.date}</Text>
                        </View>
                    </View>

                    <DetailRow label="Technician Email" value={request.assignedEmail} iconPath={User} />
                    <DetailRow label="Ticket Status" value={request.status} iconPath={CheckCircle2} />
                    <DetailRow label="Visit Status" value={request.visitInfo.status} iconPath={Calendar} />

                    <View style={{ marginTop: 20 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: labelColor, marginBottom: 12, flexDirection: 'row', alignItems: 'center' }}>
                            <MessageSquare size={14} color={labelColor} /> Issue Details
                        </Text>
                        <View style={{ paddingVertical: 10 }}>
                            <Text style={{ fontSize: 15, lineHeight: 22, color: valueColor }}>
                                {request.issueDetails || 'No additional details provided.'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Status Notes Card */}
                {(request.statusNote || request.visitNote) && (
                    <View style={{
                        marginBottom: 30, 
                        paddingBottom: 20, 
                        borderBottomWidth: 1, 
                        borderBottomColor: '#eee',
                        gap: 20
                    }}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: valueColor, marginBottom: 4 }}>Staff Feedback</Text>

                        {request.statusNote && (
                            <View>
                                <Text style={{ fontSize: 14, fontWeight: '600', color: labelColor, marginBottom: 8 }}>Status Note</Text>
                                <View style={{ paddingVertical: 10 }}>
                                    <Text style={{ fontSize: 14, color: valueColor }}>{request.statusNote}</Text>
                                </View>
                            </View>
                        )}

                        {request.visitNote && (
                            <View>
                                <Text style={{ fontSize: 14, fontWeight: '600', color: labelColor, marginBottom: 8 }}>Visit Note</Text>
                                <View style={{ paddingVertical: 10 }}>
                                    <Text style={{ fontSize: 14, color: valueColor }}>{request.visitNote}</Text>
                                </View>
                            </View>
                        )}
                    </View>
                )}

                {/* Helpful Info Section */}
                <View style={{ paddingVertical: 10, flexDirection: 'row', gap: 12 }}>
                    <Info size={20} color={primaryColor} />
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: primaryColor, marginBottom: 4 }}>Need more help?</Text>
                        <Text style={{ fontSize: 12, color: labelColor, lineHeight: 18 }}>
                            If your issue persists after being marked as resolved, please feel free to submit a new ticket or contact our support directly via Messenger.
                        </Text>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

export default SupportDetails;
