import React, { useState, useEffect, useRef } from 'react';
import ModalUITemplate from './ui-modal/ModalUITemplate';
import apiClient from '../config/api';
import { User, Camera, X, Loader2 } from 'lucide-react';
import SearchableField, { GroupedOption } from '../components/common/SearchableField';
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
     * Raised from an agent invoice rather than entered by hand.
     *
     * The operator is recording that this invoice was settled, so only the agent
     * and the invoice number are asked for — payout type, amount, proof and
     * remarks are hidden and sent empty. The API relaxes its own requirements
     * for the same reason when `from_invoice` is set.
     */
    fromInvoice?: boolean;
    /** The invoice number, used as the reference and shown read-only. */
    invoiceNumber?: string;
    /**
     * Approving a payout that already exists rather than raising a new one.
     *
     * Every field is shown and required — this is where the amount, type, proof
     * and remarks are actually entered for a payout raised from an invoice with
     * none of them. Saving approves the existing record instead of creating a
     * second one, so the id is what the details are written against.
     */
    approveId?: number;
    /** Reference of the record being approved, shown read-only. */
    approveRefNumber?: string;
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

const AgentPayoutForm: React.FC<{
    agentId?: number;
    agentName?: string;
    onClose: () => void;
    onSuccess: () => void;
    isOpen: boolean;
    fromInvoice?: boolean;
    invoiceNumber?: string;
    approveId?: number;
    approveRefNumber?: string;
}> = ({ agentId, agentName, onClose, onSuccess, isOpen, fromInvoice = false, invoiceNumber, approveId, approveRefNumber }) => {
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
        proof_of_payment: '',
        payout_type: 'all'
    });

    const getAgentBalances = (agentObj: any) => {
        const balance = Number(agentObj?.agent_balance?.balance || 0);
        // What the agent has earned in commission from approved job orders.
        // Read from commission_value, NOT from `commission` — that column is
        // the rate one referral pays, a setting rather than a balance.
        const commission = Number(agentObj?.agent_balance?.commission_value || 0);
        const incentives = Number(agentObj?.agent_balance?.incentives || 0);
        const bonus = Number(agentObj?.agent_balance?.bonus || agentObj?.agent_balance?.Bonus || 0);
        const achievement = Number(agentObj?.agent_balance?.achievement || 0);
        // Achievement is shown but deliberately NOT part of the total: the
        // payout buckets the server drains on "All Balance" are commission,
        // balance, incentives and bonus. Adding achievement here would offer to
        // pay out money no bucket holds.
        const total = commission + balance + incentives + bonus;
        return { balance, commission, incentives, bonus, achievement, total };
    };

    // Auto-fill when agentId changes or isOpen triggers
    useEffect(() => {
        if (isOpen) {
            // Which agent this opens on.
            //
            // The id is used when the caller has one. An agent invoice for a
            // SOLO agent carries it; a TEAM invoice does not — its `agent_id` is
            // null because the invoice is addressed to the team. In that case
            // the name is matched against the loaded agents instead, so the
            // dropdown still opens on the right person where the name identifies
            // one. A team name matches nobody, which is correct: a payout is
            // made to an agent, and the operator has to say which.
            const normalise = (value: string) =>
                value.toLowerCase().replace(/\s+/g, ' ').trim();

            let resolvedId: number | string = agentId || '';
            let resolvedName = agentName || '';

            if (!resolvedId && agentName && agents.length > 0) {
                const byName = agents.find(a => normalise(
                    `${a.first_name || ''} ${a.middle_initial || ''} ${a.last_name || ''}`
                ) === normalise(agentName)
                    // Middle initials are rarely written on an invoice, so first
                    // and last alone are tried as well.
                    || normalise(`${a.first_name || ''} ${a.last_name || ''}`) === normalise(agentName));

                if (byName) {
                    resolvedId = byName.id;
                    resolvedName = `${byName.first_name || ''} ${byName.middle_initial || ''} ${byName.last_name || ''}`
                        .replace(/\s+/g, ' ').trim();
                }
            }

            setSelectedAgentName(resolvedName);
            setSelectedAgentId(resolvedId);

            let initialAmount = '';
            if (resolvedId && agents.length > 0) {
                const selectedAgentObj = agents.find(a => Number(a.id) === Number(resolvedId));
                const { total } = getAgentBalances(selectedAgentObj);
                initialAmount = total > 0 ? String(total) : '';
            }

            setFormData({
                agent_id: resolvedId,
                // Raised from an invoice: the invoice number IS the reference,
                // which is what ties the payout back to the document it settles.
                // Approving keeps the reference the record already carries.
                ref_number: approveRefNumber
                    || (fromInvoice && invoiceNumber ? invoiceNumber : generateRefNumber()),
                total_amount: fromInvoice ? '' : initialAmount,
                remarks: '',
                proof_of_payment: '',
                payout_type: 'all'
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
    }, [isOpen, agentId, agentName, agents, fromInvoice, invoiceNumber, approveRefNumber]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        
        setFormData(prev => {
            const newData = { ...prev, [name]: value };
            
            // Auto-fill total amount based on payout type selection
            if (name === 'payout_type' || name === 'agent_id') {
                const currentAgentId = name === 'agent_id' ? value : prev.agent_id;
                const currentPayoutType = name === 'payout_type' ? value : prev.payout_type;
                
                if (currentAgentId && agents.length > 0) {
                    const selectedAgentObj = agents.find(a => Number(a.id) === Number(currentAgentId));
                    if (selectedAgentObj) {
                        const { balance, commission, incentives, bonus, total } = getAgentBalances(selectedAgentObj);
                        let autoAmount = 0;
                        if (currentPayoutType === 'commission') autoAmount = commission;
                        else if (currentPayoutType === 'balance') autoAmount = balance;
                        else if (currentPayoutType === 'incentives_payout') autoAmount = incentives;
                        else if (currentPayoutType === 'Bonus_payout') autoAmount = bonus;
                        else if (currentPayoutType === 'all') autoAmount = total;
                        
                        newData.total_amount = autoAmount > 0 ? String(autoAmount) : '';
                    }
                }
            }
            return newData;
        });
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
        // Approving asks for everything, so everything is checked. It does not
        // run the balance test below: the figure being entered is what the
        // approver is settling, and the balance has not moved yet.
        if (approveId) {
            if (!formData.total_amount || Number(formData.total_amount) <= 0 || !formData.remarks || !imageFile) {
                setError('Amount, proof, and remarks are required to approve.');
                return;
            }
            await submit();
            return;
        }

        // Only the agent and the reference are asked for when this came from an
        // invoice, so only those can be checked. The balance test below is
        // skipped for the same reason: there is no amount to test.
        if (fromInvoice) {
            if (!formData.agent_id || !formData.ref_number) {
                setError('Agent and reference number are required.');
                return;
            }
            await submit();
            return;
        }

        if (!formData.agent_id || !formData.ref_number || !formData.total_amount || !formData.remarks || !imageFile) {
            setError('Agent, reference number, amount, proof, and remarks are required.');
            return;
        }

        const selectedAgentObj = agents.find(a => Number(a.id) === Number(formData.agent_id));
        const { balance, commission, incentives, bonus, total } = getAgentBalances(selectedAgentObj);

        let maxAvailable = total;
        if (formData.payout_type === 'commission') maxAvailable = commission;
        else if (formData.payout_type === 'balance') maxAvailable = balance;
        else if (formData.payout_type === 'incentives_payout') maxAvailable = incentives;
        else if (formData.payout_type === 'Bonus_payout') maxAvailable = bonus;
        else if (formData.payout_type === 'all') maxAvailable = total;

        if (Number(formData.total_amount) > maxAvailable) {
            setError(`Payout amount cannot exceed available balance for the selected type (₱${Number(maxAvailable).toLocaleString(undefined, { minimumFractionDigits: 2 })}).`);
            return;
        }

        await submit();
    };

    /** The write itself, shared by both paths above. */
    const submit = async () => {
        setLoading(true);
        setError(null);

        try {
            let proofUrl = formData.proof_of_payment;

            if (imageFile) {
                const imageFormData = new FormData();
                imageFormData.append('folder_name', `agent-payout - ${selectedAgentName}`);
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
              // Send the payout type the user actually picked. The option values
              // (commission / incentives_payout / Bonus_payout / all) map 1:1 onto the
              // balance branches in CommissionController::storeHistory — a literal
              // 'agent_payout' matches none of them, so the incentives and bonus
              // buckets would be left untouched while the balance was debited.
              type: formData.payout_type,
              job_order_ids: [],
              ...(currentUser?.organization_id ? { organization_id: currentUser.organization_id } : {}),
              // Tells the API this came from an invoice, which is what relaxes
              // its requirement for the four fields the form did not ask for.
              ...(fromInvoice ? { from_invoice: true } : {}),
            };

            // Approving writes these details onto the record that already exists
            // and applies it. Posting to /commissions/history instead would raise
            // a SECOND payout beside the one being approved.
            const response = approveId
                ? await apiClient.post(`/commissions/history/${approveId}/approve`, {
                    total_amount: formData.total_amount,
                    type: formData.payout_type,
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

    // "All Balance" cashes out every bucket, so the amount is the agent's whole
    // balance and is not the operator's to change.
    // The only payout type there is now — but the field is still editable when
    // approving, so the lock is expressed as "locked" rather than "is all".
    const isAllBalance = formData.payout_type === 'all';
    const amountLocked = isAllBalance && !approveId;

    const inputClass = `w-full px-3 py-2.5 rounded-lg border text-sm transition-all duration-200 outline-none focus:ring-2 focus:ring-opacity-50 ${isDarkMode
        ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-500 focus:ring-gray-600 focus:border-gray-600'
        : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-gray-400 focus:border-gray-400'
        }`;

    const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`;

    const selectedAgentObj = agents.find(a => Number(a.id) === Number(selectedAgentId));
    const { balance: commBalance, incentives: incBalance, bonus: bonBalance, total: availableTotal } = getAgentBalances(selectedAgentObj);

    return (
        <ModalUITemplate
            isOpen={isOpen}
            onClose={onClose}
            title={selectedAgentName 
                ? `Agent Payout — ${selectedAgentName}` 
                : 'New Agent Payout'}
            loading={loading}
            maxWidth="max-w-lg"
            closeOnOutsideClick={false}
            isDarkMode={isDarkMode}
            primaryAction={{
                label: 'Save',
                onClick: handleSave,
                // On an invoice payout only the agent and the reference exist,
                // so the fields the form no longer shows cannot gate Save.
                // Approving needs every field but not the balance ceiling: the
                // amount being entered is what is being settled, and no money
                // has moved yet for it to exceed.
                disabled: loading || !formData.agent_id || (approveId
                    ? (!formData.total_amount || Number(formData.total_amount) <= 0 || !formData.remarks || !imageFile)
                    : fromInvoice
                        ? !formData.ref_number
                        : (!formData.total_amount || Number(formData.total_amount) <= 0 || Number(formData.total_amount) > availableTotal || !formData.remarks || !imageFile))
            }}
        >
            <div className="space-y-5">
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
                            
                            const selectedObj = agents.find(a => Number(a.id) === Number(newId));
                            const { total } = getAgentBalances(selectedObj);
                            
                            setFormData(prev => ({ 
                                ...prev, 
                                agent_id: newId, 
                                total_amount: total > 0 ? String(total) : '' 
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

                {/* Error Banner */}
                {error && (
                    <div className={`p-3 rounded-lg text-sm ${isDarkMode
                        ? 'bg-red-900/20 text-red-400 border border-red-800/50'
                        : 'bg-red-50 text-red-600 border border-red-200'
                        }`}>
                        {error}
                    </div>
                )}

                {/* Agent Balances Info */}
                {formData.agent_id && (
                    <div className={`col-span-full mb-2 grid grid-cols-4 gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                        {(() => {
                            const selectedAgentObj = agents.find(a => Number(a.id) === Number(formData.agent_id));
                            // Each tile reads its own column: commission_value,
                            // incentives, bonus, achievement. The Commission tile
                            // previously rendered `balance`, which is a different
                            // bucket entirely and is why it read 0.
                            const { commission, incentives, bonus, achievement } = getAgentBalances(selectedAgentObj);
                            const tile = (label: string, value: number) => (
                                <div className={`p-2 rounded border text-center ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                                    <div className="text-[10px] uppercase font-bold text-gray-500">{label}</div>
                                    <div className={`font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                                        ₱{value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </div>
                                </div>
                            );
                            return (
                                <>
                                    {tile('Commission', commission)}
                                    {tile('Incentives', incentives)}
                                    {tile('Bonus', bonus)}
                                    {tile('Achievement', achievement)}
                                </>
                            );
                        })()}
                    </div>
                )}

                {/* Payout Type — not asked for on an invoice payout. */}
                {!fromInvoice && (
                <div>
                    <label className={labelClass}>Payout Type <span className="text-red-500">*</span></label>
                    <select
                        name="payout_type"
                        value={formData.payout_type}
                        onChange={handleInputChange}
                        className={inputClass}
                    >
                        {/* One option only: a payout cashes out every bucket the
                            agent holds. The per-bucket choices are gone, so the
                            amount is always the whole balance and there is no
                            partial settlement to reconcile later. */}
                        <option value="all">All Balance</option>
                    </select>
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

                {/* Total Amount — not asked for on an invoice payout.
                    Locked on "All Balance": that option means every bucket is
                    being cashed out, so the figure is the agent's whole balance
                    and is filled in automatically. A typed-down amount would say
                    "all" while paying part, leaving a remainder no bucket
                    accounts for. Pick a specific payout type to enter a figure. */}
                {!fromInvoice && (
                <div>
                    <label className={labelClass}>Total Amount <span className="text-red-500">*</span></label>
                    <input
                        name="total_amount"
                        type="number"
                        step="0.01"
                        min="0"
                        value={formData.total_amount}
                        onChange={handleInputChange}
                        // Locked when raising a payout, since All Balance means
                        // the whole balance and the figure is filled in. NOT
                        // locked when approving: that is where the amount is
                        // actually decided, and an agent whose balance already
                        // reads zero could otherwise never be approved at all.
                        readOnly={amountLocked}
                        className={`${inputClass}${amountLocked ? ' cursor-not-allowed opacity-75' : ''}`}
                        placeholder="0.00"
                        title={amountLocked
                            ? 'A payout cashes out the agent\'s whole balance, so the amount is filled in automatically.'
                            : undefined}
                    />
                    {amountLocked && (
                        <p className={`text-[11px] mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Paying the agent's full balance — amount is set automatically.
                        </p>
                    )}
                </div>
                )}

                {/* Proof — not asked for on an invoice payout. */}
                {!fromInvoice && (
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
                )}

                {/* Remarks — not asked for on an invoice payout. */}
                {!fromInvoice && (
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
                )}
            </div>
        </ModalUITemplate>
    );
};

const AgentPayoutModal: React.FC<AgentPayoutModalProps> = (props) => {
    return <AgentPayoutForm {...props} />;
};

export default AgentPayoutModal;
