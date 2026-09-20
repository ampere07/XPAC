import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, X } from 'lucide-react-native';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';
import apiClient from '../config/api';
import { transactionService } from '../services/transactionService';
import { userService } from '../services/userService';
import { agentService } from '../services/agentService';

interface IncentivesPayoutModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    agentId?: number;
    agentName?: string;
}

interface PayoutFormData {
    agent_id: number | string;
    ref_number: string;
    total_amount: string;
    remarks: string;
    proof_of_payment: string;
    [key: string]: string | number;
}

interface PickedImage {
    uri: string;
    name: string;
    type: string;
}

const generateRefNumber = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const IncentivesPayoutForm: React.FC<{
    agentId?: number;
    agentName?: string;
    onClose: () => void;
    onSuccess: () => void;
    isOpen: boolean;
}> = ({ agentId, agentName, onClose, onSuccess, isOpen }) => {
    const { isDarkMode } = useModalTheme();

    const [agents, setAgents] = useState<any[]>([]);
    const [teams, setTeams] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedAgentName, setSelectedAgentName] = useState<string>(agentName || '');
    const [selectedAgentId, setSelectedAgentId] = useState<number | string>(agentId || '');
    const [incentiveType, setIncentiveType] = useState<'incentives' | 'incentives_payout'>('incentives_payout');

    const [image, setImage] = useState<PickedImage | null>(null);

    const [formData, setFormData] = useState<PayoutFormData>({
        agent_id: agentId || '',
        ref_number: '',
        total_amount: '',
        remarks: '',
        proof_of_payment: '',
    });

    useEffect(() => {
        const fetchAgentsData = async () => {
            if (isOpen) {
                try {
                    const response = await userService.getUsersByRole('agent');
                    if (response.success && response.data && response.data.length > 0) {
                        setAgents(response.data);
                    } else {
                        const responseById = await userService.getUsersByRoleId(4);
                        if (responseById.success && responseById.data) {
                            setAgents(responseById.data);
                        }
                    }
                } catch {
                    setAgents([]);
                }
            }
        };

        const fetchTeamsData = async () => {
            if (isOpen) {
                try {
                    const response = await agentService.getAllAgents();
                    if (response.success && response.data) {
                        setTeams(response.data);
                    }
                } catch {
                    setTeams([]);
                }
            }
        };

        fetchAgentsData();
        fetchTeamsData();
    }, [isOpen]);

    // Flat, team-grouped agent list for the Picker (replaces the web SearchableField).
    const getFlatAgents = (): { id: any; name: string; group: string }[] => {
        if (!agents.length) return [];
        const groups: Record<number, any[]> = {};
        const noTeam: any[] = [];

        agents.forEach((agent) => {
            const entry = {
                ...agent,
                name: `${agent.first_name || ''} ${agent.middle_initial || ''} ${agent.last_name || ''}`.replace(/\s+/g, ' ').trim(),
            };
            if (agent.agent_id) {
                if (!groups[agent.agent_id]) groups[agent.agent_id] = [];
                groups[agent.agent_id].push(entry);
            } else {
                noTeam.push(entry);
            }
        });

        const flat: { id: any; name: string; group: string }[] = [];
        teams.forEach((team) => {
            const teamAgents = groups[team.id];
            if (teamAgents && teamAgents.length > 0) {
                const groupLabel = team.team_name || `Team ${team.id}`;
                teamAgents.forEach((a) => flat.push({ id: a.id, name: a.name, group: groupLabel }));
            }
        });
        noTeam.forEach((a) => flat.push({ id: a.id, name: a.name, group: 'No Team' }));
        return flat;
    };

    const flatAgents = getFlatAgents();

    const selectedAgentObj = agents.find((a) => Number(a.id) === Number(selectedAgentId));
    const availableIncentives = (selectedAgentObj as any)?.agent_balance?.incentives || 0;

    // Auto-fill incentives when agentId changes or isOpen triggers
    useEffect(() => {
        if (isOpen) {
            setSelectedAgentName(agentName || '');
            setSelectedAgentId(agentId || '');
            setIncentiveType('incentives_payout');

            let initialAmount = '';
            if (agentId && agents.length > 0) {
                const obj = agents.find((a) => Number(a.id) === Number(agentId));
                const incentivesBalance = (obj as any)?.agent_balance?.incentives || 0;
                initialAmount = incentivesBalance > 0 ? String(incentivesBalance) : '';
            }

            setFormData({
                agent_id: agentId || '',
                ref_number: generateRefNumber(),
                total_amount: initialAmount,
                remarks: '',
                proof_of_payment: '',
            });
            setImage(null);
            setError(null);
        } else {
            setImage(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, agentId, agentName, agents]);

    const handlePickImage = async () => {
        try {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                setError('Permission to access photos is required.');
                return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ImagePicker.MediaTypeOptions.Images,
                quality: 0.8,
            });
            if (!result.canceled && result.assets && result.assets.length > 0) {
                const asset = result.assets[0];
                const name = asset.fileName || asset.uri.split('/').pop() || `proof_${Date.now()}.jpg`;
                setImage({ uri: asset.uri, name, type: asset.mimeType || 'image/jpeg' });
            }
        } catch (e: any) {
            setError(e.message || 'Failed to pick image');
        }
    };

    const handleRemoveImage = () => {
        setImage(null);
        setFormData((prev) => ({ ...prev, proof_of_payment: '' }));
    };

    const handleSave = async () => {
        if (!formData.agent_id || !formData.ref_number || !formData.total_amount || !formData.remarks || !image) {
            setError('Agent, reference number, amount, proof, and remarks are required.');
            return;
        }
        if (incentiveType === 'incentives_payout' && Number(formData.total_amount) > availableIncentives) {
            setError(`Payout amount cannot exceed available incentives balance (₱${Number(availableIncentives).toLocaleString(undefined, { minimumFractionDigits: 2 })}).`);
            return;
        }
        setLoading(true);
        setError(null);

        try {
            let proofUrl = formData.proof_of_payment;

            if (image) {
                const imageFormData = new FormData();
                const folderPrefix = incentiveType === 'incentives_payout' ? 'incentive-payout' : 'incentive-add';
                imageFormData.append('folder_name', `${folderPrefix} - ${selectedAgentName}`);
                imageFormData.append(
                    'payment_proof_image',
                    { uri: image.uri, name: image.name, type: image.type } as any,
                    image.name,
                );

                const uploadResponse = await transactionService.uploadTransactionImage(imageFormData);
                if (uploadResponse.success && uploadResponse.data?.payment_proof_image_url) {
                    proofUrl = uploadResponse.data.payment_proof_image_url;
                } else {
                    setError('Failed to upload proof of payment image.');
                    setLoading(false);
                    return;
                }
            }

            const authRaw = await AsyncStorage.getItem('authData');
            const currentUser = authRaw ? JSON.parse(authRaw) : null;

            const payload = {
                ...formData,
                proof_of_payment: proofUrl,
                type: incentiveType,
                job_order_ids: [],
                ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
            };
            const response = await apiClient.post('/commissions/history', payload);

            if ((response.data as any).success) {
                onSuccess();
                onClose();
            } else {
                const msg = (response.data as any).message || 'Failed to record payment';
                const backendErr = (response.data as any).error ? ` (${(response.data as any).error})` : '';
                setError(msg + backendErr);
            }
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message || 'An error occurred';
            const backendErr = err.response?.data?.error ? ` (${err.response.data.error})` : '';
            setError(msg + backendErr);
        } finally {
            setLoading(false);
        }
    };

    const labelColor = isDarkMode ? '#d1d5db' : '#374151';
    const mutedColor = isDarkMode ? '#6b7280' : '#9ca3af';
    const inputBg = isDarkMode ? '#1f2937' : '#ffffff';
    const inputBorder = isDarkMode ? '#374151' : '#d1d5db';
    const inputText = isDarkMode ? '#ffffff' : '#111827';

    const inputStyle = {
        width: '100%' as const,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: inputBorder,
        backgroundColor: inputBg,
        color: inputText,
        fontSize: 14,
    };

    const pickerContainerStyle = {
        width: '100%' as const,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: inputBorder,
        backgroundColor: inputBg,
        overflow: 'hidden' as const,
    };

    return (
        <ModalUITemplate
            isOpen={isOpen}
            onClose={onClose}
            title={selectedAgentName
                ? (incentiveType === 'incentives_payout' ? `Record Incentive Payout — ${selectedAgentName}` : `Add Incentives — ${selectedAgentName}`)
                : (incentiveType === 'incentives_payout' ? 'New Incentive Payout' : 'Add Incentives')}
            loading={loading}
            maxWidth="max-w-lg"
            closeOnOutsideClick={false}
            isDarkMode={isDarkMode}
            primaryAction={{
                label: 'Save',
                onClick: handleSave,
                disabled: loading || !formData.agent_id || !formData.total_amount || Number(formData.total_amount) <= 0 || (incentiveType === 'incentives_payout' && Number(formData.total_amount) > availableIncentives) || !formData.remarks || !image,
            }}
        >
            <View style={{ gap: 20 }}>
                {/* Agent Selector */}
                {!agentId ? (
                    <View>
                        <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                            Agent <Text style={{ color: '#ef4444' }}>*</Text>
                        </Text>
                        <View style={pickerContainerStyle}>
                            <Picker
                                selectedValue={String(selectedAgentId)}
                                onValueChange={(val) => {
                                    const chosen = flatAgents.find((a) => String(a.id) === String(val));
                                    const newId = chosen?.id ?? '';
                                    const newName = chosen?.name ?? '';
                                    setSelectedAgentName(newName);
                                    setSelectedAgentId(newId);
                                    const obj = agents.find((a) => Number(a.id) === Number(newId));
                                    const incentivesBalance = (obj as any)?.agent_balance?.incentives || 0;
                                    setFormData((prev) => ({
                                        ...prev,
                                        agent_id: newId,
                                        total_amount: incentiveType === 'incentives_payout' && incentivesBalance > 0 ? String(incentivesBalance) : '',
                                    }));
                                }}
                                dropdownIconColor={inputText}
                                style={{ color: inputText }}
                            >
                                <Picker.Item label={flatAgents.length ? 'Search agent...' : 'No data of agents available'} value="" color={mutedColor} />
                                {flatAgents.map((a) => (
                                    <Picker.Item key={String(a.id)} label={`${a.name} (${a.group})`} value={String(a.id)} />
                                ))}
                            </Picker>
                        </View>
                    </View>
                ) : null}

                {/* Transaction Type Selector */}
                <View>
                    <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                        Transaction Type <Text style={{ color: '#ef4444' }}>*</Text>
                    </Text>
                    <View style={pickerContainerStyle}>
                        <Picker
                            selectedValue={incentiveType}
                            onValueChange={(val) => {
                                const newType = val as 'incentives' | 'incentives_payout';
                                setIncentiveType(newType);
                                if (newType === 'incentives_payout') {
                                    setFormData((prev) => ({ ...prev, total_amount: availableIncentives > 0 ? String(availableIncentives) : '' }));
                                } else {
                                    setFormData((prev) => ({ ...prev, total_amount: '' }));
                                }
                            }}
                            dropdownIconColor={inputText}
                            style={{ color: inputText }}
                        >
                            <Picker.Item label="Payout" value="incentives_payout" />
                            <Picker.Item label="Add Incentives" value="incentives" />
                        </Picker>
                    </View>
                </View>

                {/* Error Banner */}
                {error ? (
                    <View style={{
                        padding: 12,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: isDarkMode ? 'rgba(153,27,27,0.5)' : '#fecaca',
                        backgroundColor: isDarkMode ? 'rgba(127,29,29,0.2)' : '#fef2f2',
                    }}>
                        <Text style={{ fontSize: 14, color: isDarkMode ? '#f87171' : '#dc2626' }}>{error}</Text>
                    </View>
                ) : null}

                {/* Available Incentives */}
                {selectedAgentId ? (
                    <View style={{
                        padding: 12,
                        borderRadius: 8,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderWidth: 1,
                        borderColor: isDarkMode ? 'rgba(30,64,175,0.5)' : '#bfdbfe',
                        backgroundColor: isDarkMode ? 'rgba(30,58,138,0.2)' : '#eff6ff',
                    }}>
                        <Text style={{ fontSize: 14, color: isDarkMode ? '#93c5fd' : '#1d4ed8' }}>Available Incentives Balance:</Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: isDarkMode ? '#93c5fd' : '#1d4ed8' }}>
                            ₱{Number(availableIncentives).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </Text>
                    </View>
                ) : null}

                {/* Reference Number */}
                <View>
                    <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                        Reference Number <Text style={{ color: '#ef4444' }}>*</Text>
                    </Text>
                    <TextInput value={formData.ref_number} editable={false} style={{ ...inputStyle, opacity: 0.75 }} />
                </View>

                {/* Total Amount */}
                <View>
                    <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                        Total Amount <Text style={{ color: '#ef4444' }}>*</Text>
                    </Text>
                    <TextInput
                        value={formData.total_amount}
                        onChangeText={(text) => setFormData((prev) => ({ ...prev, total_amount: text }))}
                        keyboardType="numeric"
                        placeholder="0.00"
                        placeholderTextColor={mutedColor}
                        style={inputStyle}
                    />
                </View>

                {/* Proof — Image Upload */}
                <View>
                    <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                        Proof <Text style={{ color: '#ef4444' }}>*</Text>
                    </Text>
                    <TouchableOpacity
                        onPress={handlePickImage}
                        activeOpacity={0.8}
                        style={{
                            width: '100%',
                            borderWidth: 2,
                            borderStyle: 'dashed',
                            borderRadius: 8,
                            borderColor: isDarkMode ? '#374151' : '#d1d5db',
                            backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb',
                            overflow: 'hidden',
                            minHeight: image ? undefined : 160,
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {image ? (
                            <View style={{ width: '100%' }}>
                                <Image source={{ uri: image.uri }} style={{ width: '100%', height: 200, resizeMode: 'contain' }} />
                                <TouchableOpacity
                                    onPress={handleRemoveImage}
                                    style={{ position: 'absolute', top: 8, right: 8, backgroundColor: '#ef4444', borderRadius: 999, padding: 4 }}
                                >
                                    <X size={14} color="#ffffff" />
                                </TouchableOpacity>
                                <View style={{ position: 'absolute', bottom: 8, left: 8, backgroundColor: '#22c55e', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                    <Camera size={12} color="#ffffff" />
                                    <Text style={{ color: '#ffffff', fontSize: 12 }}>Uploaded</Text>
                                </View>
                            </View>
                        ) : (
                            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 24 }}>
                                <Camera size={28} color={mutedColor} />
                                <Text style={{ fontSize: 14, fontWeight: '500', color: mutedColor }}>Tap to upload proof</Text>
                                <Text style={{ fontSize: 12, color: mutedColor, opacity: 0.6 }}>PNG, JPG, JPEG accepted</Text>
                            </View>
                        )}
                    </TouchableOpacity>
                    <Text style={{ fontSize: 11, marginTop: 6, color: mutedColor }}>
                        Image will be saved to Google Drive automatically
                    </Text>
                </View>

                {/* Remarks */}
                <View>
                    <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                        Remarks <Text style={{ color: '#ef4444' }}>*</Text>
                    </Text>
                    <TextInput
                        value={formData.remarks}
                        onChangeText={(text) => setFormData((prev) => ({ ...prev, remarks: text }))}
                        multiline
                        placeholder="Any additional details..."
                        placeholderTextColor={mutedColor}
                        style={{ ...inputStyle, minHeight: 90, textAlignVertical: 'top' }}
                    />
                </View>
            </View>
        </ModalUITemplate>
    );
};

const IncentivesPayoutModal: React.FC<IncentivesPayoutModalProps> = (props) => {
    return <IncentivesPayoutForm {...props} />;
};

export default IncentivesPayoutModal;
