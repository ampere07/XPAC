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

interface AgentPayoutModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    agentId?: number;
    agentName?: string;
    /**
     * Approving an existing payout rather than raising a new one.
     *
     * A payout raised from an invoice is recorded without an amount, proof or
     * remarks, so approving collects them. With this set the form posts to the
     * record's own approve endpoint — posting to /commissions/history instead
     * would raise a SECOND payout beside the one being approved.
     */
    approveId?: number;
    /** The reference the record already carries; approving keeps it. */
    approveRefNumber?: string;
    /**
     * The type the record was raised with. Approving never re-types a record:
     * the approve call carries this type (or none), never the picker's value —
     * re-typing a record to "all" at approval drains every bucket.
     */
    approveType?: string | null;
    /** The amount the record already carries, prefilled when approving. */
    approveAmount?: number | string | null;
    /**
     * Raised from an agent invoice. The form then asks only for the agent:
     * the invoice number is the reference, and the amount is settled when
     * the payout is approved rather than when it is raised.
     */
    fromInvoice?: boolean;
    /** The invoice number, which becomes the payout's reference. */
    invoiceNumber?: string;
}

interface PayoutFormData {
    agent_id: number | string;
    ref_number: string;
    total_amount: string;
    remarks: string;
    proof_of_payment: string;
    payout_type: string;
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

const getAgentBalances = (agentObj: any) => {
    const balance = Number(agentObj?.agent_balance?.balance || 0);
    const incentives = Number(agentObj?.agent_balance?.incentives || 0);
    const bonus = Number(agentObj?.agent_balance?.Bonus || agentObj?.agent_balance?.bonus || 0);
    const total = balance + incentives + bonus;
    return { balance, incentives, bonus, total };
};

const AgentPayoutForm: React.FC<{
    agentId?: number;
    agentName?: string;
    onClose: () => void;
    onSuccess: () => void;
    isOpen: boolean;
    approveId?: number;
    approveRefNumber?: string;
    approveType?: string | null;
    approveAmount?: number | string | null;
    fromInvoice?: boolean;
    invoiceNumber?: string;
}> = ({ agentId, agentName, onClose, onSuccess, isOpen, approveId, approveRefNumber, approveType, approveAmount, fromInvoice = false, invoiceNumber }) => {
    const { isDarkMode } = useModalTheme();

    const [agents, setAgents] = useState<any[]>([]);
    const [teams, setTeams] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedAgentName, setSelectedAgentName] = useState<string>(agentName || '');
    const [selectedAgentId, setSelectedAgentId] = useState<number | string>(agentId || '');

    const [image, setImage] = useState<PickedImage | null>(null);

    const [formData, setFormData] = useState<PayoutFormData>({
        agent_id: agentId || '',
        ref_number: '',
        total_amount: '',
        remarks: '',
        proof_of_payment: '',
        payout_type: 'commission',
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

    // Auto-fill when agentId changes or isOpen triggers
    useEffect(() => {
        if (isOpen) {
            setSelectedAgentName(agentName || '');
            setSelectedAgentId(agentId || '');

            let initialAmount = '';
            const carriedAmount = Number(approveAmount);
            if (approveId && Number.isFinite(carriedAmount) && carriedAmount > 0) {
                // Approving: the record's own amount, not the agent's balance.
                initialAmount = String(carriedAmount);
            } else if (agentId && agents.length > 0) {
                const selectedAgentObj = agents.find((a) => Number(a.id) === Number(agentId));
                const { total } = getAgentBalances(selectedAgentObj);
                initialAmount = total > 0 ? String(total) : '';
            }

            setFormData({
                agent_id: agentId || '',
                // Approving keeps the reference the record was raised with —
                // it is what ties the payout back to the invoice it settles.
                ref_number: approveRefNumber
                    || (fromInvoice && invoiceNumber ? invoiceNumber : generateRefNumber()),
                total_amount: initialAmount,
                remarks: '',
                proof_of_payment: '',
                // Approving keeps the record's own type; see approveType.
                payout_type: (approveId && approveType) ? approveType : 'commission',
            });
            setImage(null);
            setError(null);
        } else {
            setImage(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, agentId, agentName, agents]);

    // Recompute the auto-fill amount when agent or payout type changes.
    const applyAutoAmount = (currentAgentId: number | string, currentPayoutType: string): string => {
        if (currentAgentId && agents.length > 0) {
            const selectedAgentObj = agents.find((a) => Number(a.id) === Number(currentAgentId));
            if (selectedAgentObj) {
                const { balance, incentives, bonus, total } = getAgentBalances(selectedAgentObj);
                let autoAmount = 0;
                if (currentPayoutType === 'commission') autoAmount = balance;
                else if (currentPayoutType === 'incentives_payout') autoAmount = incentives;
                else if (currentPayoutType === 'Bonus_payout') autoAmount = bonus;
                else if (currentPayoutType === 'all') autoAmount = total;
                return autoAmount > 0 ? String(autoAmount) : '';
            }
        }
        return '';
    };

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
                setImage({
                    uri: asset.uri,
                    name,
                    type: asset.mimeType || 'image/jpeg',
                });
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
        // Raised from an invoice, only the agent and the reference are needed:
        // the API takes the amount from the invoice and the rest is collected
        // when the payout is approved. Asking for all five here refused a
        // payout the server would have accepted, under a message naming only two.
        const invoiceRaise = fromInvoice && !approveId;
        const missingRequired = invoiceRaise
            ? (!formData.agent_id || !formData.ref_number)
            : (!formData.agent_id || !formData.ref_number || !formData.total_amount || !formData.remarks || !image);

        if (missingRequired) {
            setError(approveId
                ? 'Amount, proof, and remarks are required to approve.'
                : fromInvoice
                    ? 'Agent and reference number are required.'
                    : 'Agent, reference number, amount, proof, and remarks are required.');
            return;
        }

        const selectedAgentObj = agents.find((a) => Number(a.id) === Number(formData.agent_id));
        const { balance, incentives, bonus, total } = getAgentBalances(selectedAgentObj);

        let maxAvailable = total;
        if (formData.payout_type === 'commission') maxAvailable = balance;
        else if (formData.payout_type === 'incentives_payout') maxAvailable = incentives;
        else if (formData.payout_type === 'Bonus_payout') maxAvailable = bonus;
        else if (formData.payout_type === 'all') maxAvailable = total;

        // A credit ("Add Incentives" / "Add Bonus") being approved adds money,
        // so no balance caps it.
        const isCreditType = formData.payout_type === 'incentives' || formData.payout_type === 'Bonus';

        if (!isCreditType && formData.total_amount && Number(formData.total_amount) > maxAvailable) {
            setError(`Payout amount cannot exceed available balance for the selected type (₱${Number(maxAvailable).toLocaleString(undefined, { minimumFractionDigits: 2 })}).`);
            return;
        }
        setLoading(true);
        setError(null);

        try {
            let proofUrl = formData.proof_of_payment;

            if (image) {
                const imageFormData = new FormData();
                imageFormData.append('folder_name', `agent-payout - ${selectedAgentName}`);
                imageFormData.append(
                    'payment_proof_image',
                    {
                        uri: image.uri,
                        name: image.name,
                        type: image.type,
                    } as any,
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
                // Send the payout type the user actually picked. The option values
                // (commission / incentives_payout / Bonus_payout / all) map 1:1 onto the
                // balance branches in CommissionController::storeHistory — a literal
                // 'agent_payout' matches none of them, so the incentives and bonus
                // buckets would be left untouched while the balance was debited.
                type: formData.payout_type,
                job_order_ids: [],
                ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
                // Tells the API this came from an invoice, which is what
                // relaxes its requirement for the fields the form did not ask for.
                ...(fromInvoice ? { from_invoice: true } : {}),
            };
            // Approving writes these details onto the record that already
            // exists and applies it; raising a payout creates a new one.
            // The approve call never carries the picker's type: the record keeps
            // the type it was raised with (sent back unchanged, or omitted).
            const response = approveId
                ? await apiClient.post(`/commissions/history/${approveId}/approve`, {
                    total_amount: formData.total_amount,
                    ...(approveType ? { type: approveType } : {}),
                    remarks: formData.remarks,
                    proof_of_payment: proofUrl,
                })
                : await apiClient.post('/commissions/history', payload);

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

    const selectedAgentObj = agents.find((a) => Number(a.id) === Number(selectedAgentId));
    const { total: availableTotal } = getAgentBalances(selectedAgentObj);

    const balances = getAgentBalances(agents.find((a) => Number(a.id) === Number(formData.agent_id)));

    return (
        <ModalUITemplate
            isOpen={isOpen}
            onClose={onClose}
            title={selectedAgentName ? `Agent Payout — ${selectedAgentName}` : 'New Agent Payout'}
            loading={loading}
            maxWidth="max-w-lg"
            closeOnOutsideClick={false}
            isDarkMode={isDarkMode}
            primaryAction={{
                label: 'Save',
                onClick: handleSave,
                // Raised from an invoice, only the agent and reference are needed
                // (see handleSave); everything else is collected at approval.
                disabled: (fromInvoice && !approveId)
                    ? (loading || !formData.agent_id || !formData.ref_number)
                    : (loading ||
                        !formData.agent_id ||
                        !formData.total_amount ||
                        Number(formData.total_amount) <= 0 ||
                        (!(formData.payout_type === 'incentives' || formData.payout_type === 'Bonus')
                            && Number(formData.total_amount) > availableTotal) ||
                        !formData.remarks ||
                        !image),
            }}
        >
            <View style={{ gap: 20 }}>
                {/* Agent Selector (Picker replaces web SearchableField) */}
                {!agentId ? (
                    <View>
                        <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                            Agent <Text style={{ color: '#ef4444' }}>*</Text>
                        </Text>
                        <View style={{ borderWidth: 1, borderColor: inputBorder, borderRadius: 8, backgroundColor: inputBg }}>
                            <Picker
                                selectedValue={String(selectedAgentId)}
                                onValueChange={(val) => {
                                    const chosen = flatAgents.find((a) => String(a.id) === String(val));
                                    const newId = chosen?.id ?? '';
                                    const newName = chosen?.name ?? '';
                                    setSelectedAgentName(newName);
                                    setSelectedAgentId(newId);
                                    setFormData((prev) => ({
                                        ...prev,
                                        agent_id: newId,
                                        total_amount: applyAutoAmount(newId, prev.payout_type),
                                    }));
                                }}
                                dropdownIconColor={inputText}
                                style={{ color: inputText }}
                            >
                                <Picker.Item
                                    label={flatAgents.length ? 'Search agent...' : 'No data of agents available'}
                                    value=""
                                    color={mutedColor}
                                />
                                {flatAgents.map((a) => (
                                    <Picker.Item key={String(a.id)} label={`${a.name} (${a.group})`} value={String(a.id)} />
                                ))}
                            </Picker>
                        </View>
                    </View>
                ) : null}

                {/* Error Banner */}
                {error ? (
                    <View
                        style={{
                            padding: 12,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: isDarkMode ? 'rgba(153,27,27,0.5)' : '#fecaca',
                            backgroundColor: isDarkMode ? 'rgba(127,29,29,0.2)' : '#fef2f2',
                        }}
                    >
                        <Text style={{ fontSize: 14, color: isDarkMode ? '#f87171' : '#dc2626' }}>{error}</Text>
                    </View>
                ) : null}

                {/* Agent Balances Info */}
                {formData.agent_id ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                        <View style={{ flex: 1, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: isDarkMode ? '#374151' : '#e5e7eb', backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb', alignItems: 'center' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#6b7280' }}>Commission</Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: isDarkMode ? '#f3f4f6' : '#111827' }}>
                                ₱{balances.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </Text>
                        </View>
                        <View style={{ flex: 1, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: isDarkMode ? '#374151' : '#e5e7eb', backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb', alignItems: 'center' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#6b7280' }}>Incentives</Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: isDarkMode ? '#f3f4f6' : '#111827' }}>
                                ₱{balances.incentives.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </Text>
                        </View>
                        <View style={{ flex: 1, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: isDarkMode ? '#374151' : '#e5e7eb', backgroundColor: isDarkMode ? '#1f2937' : '#f9fafb', alignItems: 'center' }}>
                            <Text style={{ fontSize: 10, fontWeight: '700', textTransform: 'uppercase', color: '#6b7280' }}>Bonus</Text>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: isDarkMode ? '#f3f4f6' : '#111827' }}>
                                ₱{balances.bonus.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </Text>
                        </View>
                    </View>
                ) : null}

                {/* Payout Type */}
                <View>
                    <Text style={{ fontSize: 14, fontWeight: '500', marginBottom: 6, color: labelColor }}>
                        Payout Type <Text style={{ color: '#ef4444' }}>*</Text>
                    </Text>
                    <View style={{ borderWidth: 1, borderColor: inputBorder, borderRadius: 8, backgroundColor: inputBg }}>
                        <Picker
                            selectedValue={formData.payout_type}
                            // Approving cannot re-type the record.
                            enabled={!approveId}
                            onValueChange={(val) => {
                                setFormData((prev) => ({
                                    ...prev,
                                    payout_type: String(val),
                                    total_amount: applyAutoAmount(prev.agent_id, String(val)),
                                }));
                            }}
                            dropdownIconColor={inputText}
                            style={{ color: inputText }}
                        >
                            <Picker.Item label="Commission (Balance)" value="commission" />
                            <Picker.Item label="Incentives" value="incentives_payout" />
                            <Picker.Item label="Bonus" value="Bonus_payout" />
                            <Picker.Item label="All Balance" value="all" />
                        </Picker>
                    </View>
                </View>

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
                                <View
                                    style={{
                                        position: 'absolute',
                                        bottom: 8,
                                        left: 8,
                                        backgroundColor: '#22c55e',
                                        paddingHorizontal: 8,
                                        paddingVertical: 4,
                                        borderRadius: 4,
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 4,
                                    }}
                                >
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

const AgentPayoutModal: React.FC<AgentPayoutModalProps> = (props) => {
    return <AgentPayoutForm {...props} />;
};

export default AgentPayoutModal;
