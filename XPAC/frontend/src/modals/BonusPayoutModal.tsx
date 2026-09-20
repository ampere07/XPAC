import React, { useState, useEffect, useRef } from 'react';
import ModalUITemplate from './ui-modal/ModalUITemplate';
import apiClient from '../config/api';
import { User, Camera, X, Loader2, AlertTriangle } from 'lucide-react';
import SearchableField, { GroupedOption } from '../components/common/SearchableField';
import LoadingModalGlobal from '../components/common/LoadingModalGlobal';
import { transactionService } from '../services/transactionService';
import { userService } from '../services/userService';
import { agentService } from '../services/agentService';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

interface BonusPayoutModalProps {
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

const BonusPayoutForm: React.FC<{
    agentId?: number;
    agentName?: string;
    onClose: () => void;
    onSuccess: () => void;
    isOpen: boolean;
}> = ({ agentId, agentName, onClose, onSuccess, isOpen }) => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const [saveProgress, setSaveProgress] = useState<number>(0);

    useEffect(() => {
        const checkDarkMode = () => {
            const theme = localStorage.getItem('theme');
            setIsDarkMode(theme === 'dark' || theme === null);
        };
        checkDarkMode();
        const observer = new MutationObserver(checkDarkMode);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

        settingsColorPaletteService.getActive()
            .then(setColorPalette)
            .catch(() => setColorPalette(null));

        return () => observer.disconnect();
    }, []);

    const [agents, setAgents] = useState<any[]>([]);
    const [teams, setTeams] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ open: boolean; type: 'loading' | 'success' | 'error'; title: string; message: string }>({
        open: false,
        type: 'loading',
        title: '',
        message: ''
    });
    const [selectedAgentName, setSelectedAgentName] = useState<string>(agentName || '');
    const [selectedAgentId, setSelectedAgentId] = useState<number | string>(agentId || '');
    const [BonusType, setBonusType] = useState<'Bonus' | 'Bonus_payout'>('Bonus_payout');

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

    // Auto-fill Bonus when agentId changes or isOpen triggers
    useEffect(() => {
        if (isOpen) {
            setSelectedAgentName(agentName || '');
            setSelectedAgentId(agentId || '');
            setBonusType('Bonus_payout');

            let initialAmount = '';
            if (agentId && agents.length > 0) {
                const selectedAgentObj = agents.find(a => Number(a.id) === Number(agentId));
                const BonusBalance = selectedAgentObj?.agent_balance?.bonus || 0;
                initialAmount = BonusBalance > 0 ? String(BonusBalance) : '';
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
            setStatus({ open: false, type: 'loading', title: '', message: '' });
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
            setStatus({ open: true, type: 'error', title: 'Missing Information', message: 'Agent, reference number, amount, proof, and remarks are required.' });
            return;
        }
        if (BonusType === 'Bonus_payout' && Number(formData.total_amount) > availableBonus) {
            setStatus({ open: true, type: 'error', title: 'Invalid Amount', message: `Payout amount cannot exceed available Bonus balance (₱${Number(availableBonus).toLocaleString(undefined, { minimumFractionDigits: 2 })}).` });
            return;
        }
        setLoading(true);
        setSaveProgress(15);
        setStatus({ open: true, type: 'loading', title: 'Saving Payout', message: 'Saving payout, please wait...' });

        try {
            let proofUrl = formData.proof_of_payment;

            if (imageFile) {
                const imageFormData = new FormData();
                const folderPrefix = BonusType === 'Bonus_payout' ? 'Bonus-payout' : 'Bonus-add';
                imageFormData.append('folder_name', `${folderPrefix} - ${selectedAgentName}`);
                imageFormData.append('payment_proof_image', imageFile, imageFile.name);

                const uploadResponse = await transactionService.uploadTransactionImage(imageFormData);
                if (uploadResponse.success && uploadResponse.data?.payment_proof_image_url) {
                    proofUrl = uploadResponse.data.payment_proof_image_url;
                } else {
                    setLoading(false);
                    setSaveProgress(0);
                    setStatus({ open: true, type: 'error', title: 'Upload Failed', message: 'Failed to upload proof of payment image.' });
                    return;
                }
            }

            setSaveProgress(70);

            const authData = localStorage.getItem('authData');
            const currentUser = authData ? JSON.parse(authData) : null;

            const payload = {
              ...formData,
              proof_of_payment: proofUrl,
              type: BonusType,
              ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {})
            };
            const response = await apiClient.post('/commissions/bonus-history', payload);

            if ((response.data as any).success) {
                setSaveProgress(100);
                setLoading(false);
                setStatus({ open: true, type: 'success', title: 'Success', message: (response.data as any).message || 'Bonus transaction recorded successfully' });
            } else {
                const msg = (response.data as any).message || 'Failed to record payment';
                const backendErr = (response.data as any).error ? ` (${(response.data as any).error})` : '';
                setLoading(false);
                setSaveProgress(0);
                setStatus({ open: true, type: 'error', title: 'Error', message: msg + backendErr });
            }
        } catch (err: any) {
            const msg = err.response?.data?.message || err.message || 'An error occurred';
            const backendErr = err.response?.data?.error ? ` (${err.response.data.error})` : '';
            setLoading(false);
            setSaveProgress(0);
            setStatus({ open: true, type: 'error', title: 'Error', message: msg + backendErr });
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
    const availableBonus = selectedAgentObj?.agent_balance?.bonus || 0;

    return (
        <>
        <LoadingModalGlobal
            isOpen={status.open}
            type={status.type}
            title={status.title}
            message={status.message}
            loadingPercentage={saveProgress}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
            onConfirm={() => {
                const wasSuccess = status.type === 'success';
                setStatus(prev => ({ ...prev, open: false }));
                if (wasSuccess) {
                    onSuccess();
                    onClose();
                }
            }}
        />
        <ModalUITemplate
            isOpen={isOpen}
            onClose={onClose}
            title={selectedAgentName
                ? (BonusType === 'Bonus_payout' ? `Record Bonus Payout — ${selectedAgentName}` : `Add Bonus — ${selectedAgentName}`)
                : (BonusType === 'Bonus_payout' ? 'New Bonus Payout' : 'Add Bonus')}
            loading={false}
            maxWidth="max-w-lg"
            closeOnOutsideClick={false}
            isDarkMode={isDarkMode}
            primaryAction={{
                label: 'Save',
                onClick: handleSave,
                disabled: loading || !formData.agent_id || !formData.total_amount || Number(formData.total_amount) <= 0 || (BonusType === 'Bonus_payout' && Number(formData.total_amount) > availableBonus) || !formData.remarks || !imageFile
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
                        This record is saved as Pending. The agent&apos;s bonus is only
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
                            const BonusBalance = selectedAgentObj?.agent_balance?.bonus || 0;
                            
                            setFormData(prev => ({ 
                                ...prev, 
                                agent_id: newId, 
                                total_amount: BonusType === 'Bonus_payout' && BonusBalance > 0 ? String(BonusBalance) : '' 
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
                        value={BonusType}
                        onChange={(e) => {
                            const newType = e.target.value as 'Bonus' | 'Bonus_payout';
                            setBonusType(newType);
                            if (newType === 'Bonus_payout') {
                                setFormData(prev => ({
                                    ...prev,
                                    total_amount: availableBonus > 0 ? String(availableBonus) : ''
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
                        <option value="Bonus_payout">Payout</option>
                        <option value="Bonus">Add Bonus</option>
                    </select>
                </div>

                {/* Available Bonus */}
                {selectedAgentId && (
                    <div className={`p-3 rounded-lg text-sm flex items-center justify-between ${isDarkMode
                        ? 'bg-blue-900/20 text-blue-300 border border-blue-800/50'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                        }`}>
                        <span>Available Bonus Balance:</span>
                        <span className="font-bold">₱{Number(availableBonus).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
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
        </>
    );
};

const BonusPayoutModal: React.FC<BonusPayoutModalProps> = (props) => {
    return <BonusPayoutForm {...props} />;
};

export default BonusPayoutModal;
