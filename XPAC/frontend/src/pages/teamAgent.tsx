import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Loader2, RefreshCw, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Trash2, Edit, Users, Banknote } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { Agent } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import AgentModal from '../modals/AgentModal';
import CommissionPayoutModal from '../modals/CommissionPayoutModal';
import { useAgentStore } from '../store/agentStore';
import { agentService } from '../services/agentService';

const TeamAgent: React.FC = () => {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
    const [searchQuery, setSearchQuery] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const {
        agents,
        isLoading,
        error,
        fetchAgents,
        refreshAgents,
        addAgent,
        updateAgent,
        removeAgent
    } = useAgentStore();

    const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
    const [showModal, setShowModal] = useState(false);
    const [showPayoutModal, setShowPayoutModal] = useState(false);
    const [payoutAgent, setPayoutAgent] = useState<Agent | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(25);

    useEffect(() => {
        const fetchPalette = async () => {
            const palette = await settingsColorPaletteService.getActive();
            setColorPalette(palette);
        };
        fetchPalette();

        const observer = new MutationObserver(() => {
            setIsDarkMode(localStorage.getItem('theme') !== 'light');
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        setIsDarkMode(localStorage.getItem('theme') !== 'light');

        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        handleResize();
        window.addEventListener('resize', handleResize);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', handleResize);
        };
    }, []);

    useEffect(() => {
        fetchAgents();
    }, [fetchAgents]);

    const userOrgId = useMemo(() => {
        try {
            const authData = JSON.parse(localStorage.getItem('authData') || '{}');
            return authData.organization_id || authData.user?.organization_id || authData.organization?.id || authData.user?.organization?.id || null;
        } catch {
            return null;
        }
    }, []);

    const filteredAgents = useMemo(() => {
        return agents.filter(agent => {
            // Organization filter — mirrors applicationmanagement.tsx logic exactly
            if (userOrgId) {
                if (agent.organization_id !== userOrgId) return false;
            } else {
                if (agent.organization_id) return false;
            }

            const teamName = (agent.team_name || '').toLowerCase();
            const query = searchQuery.toLowerCase().trim();
            return teamName.includes(query);
        });
    }, [agents, searchQuery, userOrgId]);

    const totalPages = Math.ceil(filteredAgents.length / itemsPerPage);
    const paginatedAgents = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredAgents.slice(start, start + itemsPerPage);
    }, [filteredAgents, currentPage, itemsPerPage]);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
    };

    const handleSaveAgent = (savedAgent: Agent) => {
        const exists = agents.find(a => a.id === savedAgent.id);
        if (exists) {
            updateAgent(savedAgent);
        } else {
            addAgent(savedAgent);
        }
    };

    const handleDeleteAgent = async (id: number) => {
        if (window.confirm('Are you sure you want to delete this agent?')) {
            try {
                const res = await agentService.deleteAgent(id);
                if (res.success) {
                    removeAgent(id);
                } else {
                    alert(res.message || 'Failed to delete agent');
                }
            } catch (err: any) {
                alert(err.message || 'An error occurred');
            }
        }
    };

    const PaginationControls = () => {
        if (totalPages <= 1) return null;
        return (
            <div className={`border-t p-4 flex flex-col md:flex-row items-center md:justify-between gap-3 ${isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-400' : 'bg-white border-gray-200 text-gray-600'}`}>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs">
                    <div className="flex items-center gap-2">
                        <span>Show</span>
                        <select
                            value={itemsPerPage}
                            onChange={(e) => setItemsPerPage(Number(e.target.value))}
                            className={`px-2 py-1 rounded border focus:outline-none text-[10px] ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-300'}`}
                        >
                            {[10, 25, 50, 100].map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </div>
                    <span>{Math.min((currentPage - 1) * itemsPerPage + 1, filteredAgents.length)}-{Math.min(currentPage * itemsPerPage, filteredAgents.length)} of {filteredAgents.length}</span>
                </div>
                <div className="flex items-center flex-wrap justify-center gap-1 w-full md:w-auto">
                    <button onClick={() => handlePageChange(1)} disabled={currentPage === 1} className="p-1 disabled:opacity-30" title="First Page"><ChevronsLeft size={16} /></button>
                    <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="p-1 disabled:opacity-30" title="Previous Page"><ChevronLeft size={16} /></button>
                    <span className="text-xs px-2 whitespace-nowrap">Page {currentPage} of {totalPages}</span>
                    <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="p-1 disabled:opacity-30" title="Next Page"><ChevronRight size={16} /></button>
                    <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages} className="p-1 disabled:opacity-30" title="Last Page"><ChevronsRight size={16} /></button>
                </div>
            </div>
        );
    };

    return (
        <div className={`h-full flex flex-col overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
            {/* Header */}
            <div className={`p-6 border-b ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight">Team Agent Management</h1>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Manage system agents and teams</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => refreshAgents()}
                            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                        >
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            onClick={() => { setSelectedAgent(null); setShowModal(true); }}
                            className="p-2 rounded-lg text-white shadow-lg transition-transform active:scale-95"
                            style={{ backgroundColor: colorPalette?.primary || '#3b82f6' }}
                        >
                            <Plus size={20} />
                        </button>
                    </div>
                </div>

                <GlobalSearch 
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search team name..."
                />
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
                {isLoading && agents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 opacity-50">
                        <Loader2 className="animate-spin mb-4" size={32} />
                        <p className="text-sm">Loading agents...</p>
                    </div>
                ) : error ? (
                    <div className="p-10 text-center text-red-500 text-sm">{error}</div>
                ) : filteredAgents.length === 0 ? (
                    <div className="p-12 text-center opacity-40">
                        <Users size={48} className="mx-auto mb-4" />
                        <p className="text-sm">No agents found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className={`sticky top-0 z-10 ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                                <tr>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Team Name</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Created At</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Created By</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-100'}`}>
                                {paginatedAgents.map((agent) => (
                                    <tr key={agent.id} className={`${isDarkMode ? 'hover:bg-gray-900/50' : 'hover:bg-gray-50'} transition-colors`}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                                                    <Users size={14} />
                                                </div>
                                                <span className="text-sm font-medium">{agent.team_name}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {agent.created_at ? new Date(agent.created_at).toLocaleDateString() : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {agent.created_by || 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => { setPayoutAgent(agent); setShowPayoutModal(true); }}
                                                    className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-green-400' : 'hover:bg-gray-100 text-green-600'}`}
                                                    title="Record Payout"
                                                >
                                                    <Banknote size={16} />
                                                </button>
                                                <button
                                                    onClick={() => { setSelectedAgent(agent); setShowModal(true); }}
                                                    className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-blue-400' : 'hover:bg-gray-100 text-blue-600'}`}
                                                >
                                                    <Edit size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteAgent(agent.id)}
                                                    className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-red-400' : 'hover:bg-gray-100 text-red-600'}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {!isLoading && filteredAgents.length > 0 && <PaginationControls />}

            <AgentModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onSave={handleSaveAgent}
                agent={selectedAgent}
            />

            {payoutAgent && (
                <CommissionPayoutModal
                    isOpen={showPayoutModal}
                    onClose={() => { setShowPayoutModal(false); setPayoutAgent(null); }}
                    onSuccess={() => {
                        // Optional: show toast or success message
                        alert('Commission payout recorded successfully!');
                    }}
                    agentId={payoutAgent.id}
                    agentName={payoutAgent.team_name}
                />
            )}
        </div>
    );
};

export default TeamAgent;

