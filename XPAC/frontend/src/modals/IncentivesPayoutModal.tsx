import React, { useState, useEffect, useRef } from 'react';
import ModalUITemplate from './ui-modal/ModalUITemplate';
import apiClient from '../config/api';
import { User, Camera, X, Loader2, AlertTriangle } from 'lucide-react';
import SearchableField, { GroupedOption } from '../components/common/SearchableField';
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

const IncentivesPayoutForm: React.FC<{
    agentId?: number;
    agentName?: string;
    onClose: () => void;
    onSuccess: () => void;
    isOpen: boolean;
}> = ({ agentId, agentName, onClose, onSuccess, isOpen }) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

    useEffect(() => {
        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };
        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const [agents, setAgents] = useState<any[]>([]);
    const [teams, setTeams] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedAgentName, setSelectedAgentName] = useState<string>(agentName || '');
    const [selectedAgentId, setSelectedAgentId] = useState<number | string>(agentId || '');
    const [incentiveType, setIncentiveType] = useState<'incentives' | 'incentives_payout'>('incentives_payout');

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
                } catch (error) {
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
                } catch (error) {
                    setTeams([]);
                }
            }
        };

        fetchAgentsData();
        fetchTeamsData();
    }, [isOpen]);

    const getGroupedAgents = (): GroupedOption[] => {
        if (!agents.length) return [];

        const groups: Record<number, any[]> = {};
        const noTeam: any[] = [];

        agents.forEach(agent => {
            if (agent.agent_id) {
                if (!groups[agent.agent_id]) groups[agent.agent_id] = [];
                groups[agent.agent_id].push({
                    name: `${agent.first_name || ''} ${agent.middle_initial || ''} ${agent.last_name || ''}`.replace(/\s+/g, ' ').trim(),
                    ...agent
                });
            } else {
                noTeam.push({
                    name: `${agent.first_name || ''} ${agent.middle_initial || ''} ${agent.last_name || ''}`.replace(/\s+/g, ' ').trim(),
                    ...agent
                });
            }
        });

        const grouped: GroupedOption[] = [];

        teams.forEach(team => {
            const teamAgents = groups[team.id];
            if (teamAgents && teamAgents.length > 0) {
                grouped.push({
                    label: team.team_name || `Team ${team.id}`,
                    options: teamAgents
                });
            }
        });

        if (noTeam.length > 0) {
            grouped.push({
                label: 'No Team',
                options: noTeam
            });
        }

        return grouped;
    };

    const groupedAgents = getGroupedAgents();

    // Image upload state
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const generateRefNumber = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 10; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };

    const [formData, setFormData] = useState<PayoutFormData>({
        agent_id: agentId || '',
        ref_number: '',
        total_amount: '',
        remarks: '',
        proof_of_payment: ''
    });

    // Auto-fill incentives when agentId changes or isOpen triggers
    useEffect(() => {
        if (isOpen) {
            setSelectedAgentName(agentName || '');
            setSelectedAgentId(agentId || '');
            setIncentiveType('incentives_payout');

            let initialAmount = '';
            if (agentId && agents.length > 0) {
                const selectedAgentObj = agents.find(a => Number(a.id) === Number(agentId));
                const incentivesBalance = selectedAgentObj?.agent_balance?.incentives || 0;
                initialAmount = incentivesBalance > 0 ? String(incentivesBalance) : '';
            }

            setFormData({
                agent_id: agentId || '',
                ref_number: generateRefNumber(),
                total_amount: initialAmount,
                remarks: '',
                proof_of_payment: ''
            });
            setImageFile(null);
            setImagePreview(null);
            setError(null);
        } else {
            if (imagePreview && imagePreview.startsWith('blob:')) {
                URL.revokeObjectURL(imagePreview);
            }
            setImagePreview(null);
            setImageFile(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, agentId, agentName, agents]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (imagePreview && imagePreview.startsWith('blob:')) {
            URL.revokeObjectURL(imagePreview);
        }

        setImageFile(file);
        setImagePreview(URL.createObjectURL(file));
    };

    const handleRemoveImage = () => {
        if (imagePreview && imagePreview.startsWith('blob:')) {
            URL.revokeObjectURL(imagePreview);
        }
        setImageFile(null);
        setImagePreview(null);
        setFormData(prev => ({ ...prev, proof_of_payment: '' }));
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSave = async () => {
        if (!formData.agent_id || !formData.ref_number || !formData.total_amount || !formData.remarks || !imageFile) {
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

            if (imageFile) {
                const imageFormData = new FormData();
                const folderPrefix = incentiveType === 'incentives_payout' ? 'incentive-payout' : 'incentive-add';
                imageFormData.append('folder_name', `${folderPrefix} - ${selectedAgentName}`);
                imageFormData.append('payment_proof_image', imageFile, imageFile.name);

                const uploadResponse = await transactionService.uploadTransactionImage(imageFormData);
                if (uploadResponse.success && uploadResponse.data?.payment_proof_image_url) {
                    proofUrl = uploadResponse.data.payment_proof_image_url;
                } else {
                    setError('Failed to upload proof of payment image.');
                    setLoading(false);
                    return;
                }
            }

            const authData = localStorage.getItem('authData');
            const currentUser = authData ? JSON.parse(authData) : null;

            const payload = {
              ...formData,
              proof_of_payment: proofUrl,
              type: incentiveType,
              job_order_ids: [],
              ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
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

    const inputClass = `w-full px-3 py-2.5 rounded-lg border text-sm transition-all duration-200 outline-none focus:ring-2 focus:ring-opacity-50 ${isDarkMode
        ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:ring-gray-600 focus:border-gray-600'
        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-gray-400 focus:border-gray-400'
        }`;

    const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;

    const selectedAgentObj = agents.find(a => Number(a.id) === Number(selectedAgentId));
    const availableIncentives = selectedAgentObj?.agent_balance?.incentives || 0;

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
                disabled: loading || !formData.agent_id || !formData.total_amount || Number(formData.total_amount) <= 0 || (incentiveType === 'incentives_payout' && Number(formData.total_amount) > availableIncentives) || !formData.remarks || !imageFile
            }}
        >
            <div className="space-y-5">
                {/* Approval notice — matches the Transaction flow, where a record is
                    saved as Pending and only affects the balance once approved. */}
                <div className={`flex items-start gap-2 p-3 rounded-lg text-xs border ${isDarkMode
                    ? 'bg-amber-500/10 border-amber-800/50 text-amber-200'
                    : 'bg-amber-50 border-amber-200 text-amber-800'}`}
                >
                    <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>
                        <strong className="font-semibold">Requires approval.</strong>{' '}
                        This record is saved as Pending. The agent&apos;s incentives are only
                        updated once it is approved in the payout history.
                    </span>
                </div>

                {/* Agent Selector */}
                {!agentId && (
                    <SearchableField
                        label="Agent"
                        placeholder="Search agent..."
                        value={selectedAgentName}
                        onSelect={(val, option) => {
                            const newName = option?.name || val;
                            const newId = option?.id || '';
                            setSelectedAgentName(newName);
                            setSelectedAgentId(newId);
                            
                            const selectedAgentObj = agents.find(a => Number(a.id) === Number(newId));
                            const incentivesBalance = selectedAgentObj?.agent_balance?.incentives || 0;
                            
                            setFormData(prev => ({ 
                                ...prev, 
                                agent_id: newId, 
                                total_amount: incentiveType === 'incentives_payout' && incentivesBalance > 0 ? String(incentivesBalance) : '' 
                            }));
                        }}
                        groupedOptions={groupedAgents}
                        optionLabelKey="name"
                        isDarkMode={isDarkMode}
                        required
                        isHeaderSelectable={true}
                        emptyMessage="No data of agents available"
                        icon={<User size={16} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />}
                    />
                )}

                {/* Transaction Type Selector */}
                <div>
                    <label className={labelClass}>Transaction Type <span className="text-red-500">*</span></label>
                    <select
                        value={incentiveType}
                        onChange={(e) => {
                            const newType = e.target.value as 'incentives' | 'incentives_payout';
                            setIncentiveType(newType);
                            if (newType === 'incentives_payout') {
                                setFormData(prev => ({
                                    ...prev,
                                    total_amount: availableIncentives > 0 ? String(availableIncentives) : ''
                                }));
                            } else {
                                setFormData(prev => ({
                                    ...prev,
                                    total_amount: ''
                                }));
                            }
                        }}
                        className={inputClass}
                    >
                        <option value="incentives_payout">Payout</option>
                        <option value="incentives">Add Incentives</option>
                    </select>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className={`p-3 rounded-lg text-sm ${isDarkMode
                        ? 'bg-red-900/20 text-red-400 border border-red-800/50'
                        : 'bg-red-50 text-red-600 border border-red-200'
                        }`}>
                        {error}
                    </div>
                )}

                {/* Available Incentives */}
                {selectedAgentId && (
                    <div className={`p-3 rounded-lg text-sm flex items-center justify-between ${isDarkMode
                        ? 'bg-blue-900/20 text-blue-300 border border-blue-800/50'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                        <span>Available Incentives Balance:</span>
                        <span className="font-bold">₱{Number(availableIncentives).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                )}

                {/* Reference Number */}
                <div>
                    <label className={labelClass}>Reference Number <span className="text-red-500">*</span></label>
                    <input
                        name="ref_number"
                        value={formData.ref_number}
                        readOnly
                        className={`${inputClass} cursor-not-allowed opacity-75`}
                        title="Auto-generated reference number"
                    />
                </div>

                {/* Total Amount */}
                <div>
                    <label className={labelClass}>Total Amount <span className="text-red-500">*</span></label>
                    <input
                        name="total_amount"
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.total_amount}
                        onChange={handleInputChange}
                        className={inputClass}
                        placeholder="0.00"
                    />
                </div>

                {/* Proof — Image Upload */}
                <div>
                    <label className={labelClass}>Proof <span className="text-red-500">*</span></label>
                    <div
                        className={`relative w-full border-2 border-dashed rounded-lg overflow-hidden cursor-pointer transition-colors ${isDarkMode
                            ? 'border-gray-700 bg-gray-800 hover:border-gray-500'
                            : 'border-gray-300 bg-gray-50 hover:border-gray-400'
                            } ${imagePreview ? 'h-auto' : 'h-40'}`}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={handleImageSelect}
                            className="hidden"
                        />

                        {imagePreview ? (
                            <div className="relative w-full">
                                <img
                                    src={imagePreview}
                                    alt="Proof"
                                    className="w-full h-auto object-contain block"
                                />
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleRemoveImage(); }}
                                    className="absolute top-2 right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-md z-20 transition-colors"
                                    title="Remove image"
                                >
                                    <X size={14} />
                                </button>
                                <div className="absolute bottom-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-xs flex items-center gap-1 shadow-md pointer-events-none">
                                    <Camera size={12} /> Uploaded
                                </div>
                            </div>
                        ) : (
                            <div className={`w-full h-full flex flex-col items-center justify-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                <Camera size={28} />
                                <span className="text-sm font-medium">Click to upload proof</span>
                                <span className="text-xs opacity-60">PNG, JPG, JPEG accepted</span>
                            </div>
                        )}
                    </div>
                    <p className={`text-[11px] mt-1.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        Image will be saved to Google Drive automatically
                    </p>
                </div>

                {/* Remarks */}
                <div>
                    <label className={labelClass}>Remarks <span className="text-red-500">*</span></label>
                    <textarea
                        name="remarks"
                        value={formData.remarks}
                        onChange={handleInputChange}
                        className={`${inputClass} min-h-[90px] resize-none`}
                        placeholder="Any additional details..."
                    />
                </div>
            </div>
        </ModalUITemplate>
    );
};

const IncentivesPayoutModal: React.FC<IncentivesPayoutModalProps> = (props) => {
    return <IncentivesPayoutForm {...props} />;
};

export default IncentivesPayoutModal;
