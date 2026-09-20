import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Loader2, RefreshCw, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Building as OrganizationIcon, Trash2, Edit } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { Organization } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import OrganizationModal from '../modals/OrganizationModal';
import { useOrganizationStore } from '../store/organizationStore';
import { organizationService } from '../services/userService';
import { usePageActions } from '../hooks/usePageActions';

const Organizations: React.FC = () => {
    // Add, Edit and Delete are granted separately. The same keys the API
    // demands, so a control is only drawn when the request behind it would
    // succeed.
    const actions = usePageActions('organization');

    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const {
        organizations,
        isLoading,
        error,
        fetchOrganizations,
        refreshOrganizations,
        addOrganization,
        updateOrganization,
        removeOrganization
    } = useOrganizationStore();

    const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
    const [showModal, setShowModal] = useState(false);
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
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        fetchOrganizations();
    }, [fetchOrganizations]);

    const filteredOrgs = useMemo(() => {
        const authData = JSON.parse(localStorage.getItem('authData') || '{}');
        const userOrgId = authData.organization_id;

        return organizations.filter(org => {
            // Organization filter
            if (userOrgId && org.organization_id && org.organization_id !== userOrgId) {
                return false;
            }

            const orgName = (org.organization_name || '').toLowerCase();
            const query = searchQuery.toLowerCase().trim();
            return orgName.includes(query);
        });
    }, [organizations, searchQuery]);

    const totalPages = Math.ceil(filteredOrgs.length / itemsPerPage);
    const paginatedOrgs = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredOrgs.slice(start, start + itemsPerPage);
    }, [filteredOrgs, currentPage, itemsPerPage]);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
    };

    const handleSaveOrg = (savedOrg: Organization) => {
        const exists = organizations.find(o => o.id === savedOrg.id);
        if (exists) {
            updateOrganization(savedOrg);
        } else {
            addOrganization(savedOrg);
        }
    };

    const handleDeleteOrg = async (id: number) => {
        if (!actions.canDelete) return;
        if (window.confirm('Are you sure you want to delete this organization?')) {
            try {
                const res = await organizationService.deleteOrganization(id);
                if (res.success) {
                    removeOrganization(id);
                } else {
                    alert(res.message || 'Failed to delete organization');
                }
            } catch (err: any) {
                alert(err.message || 'An error occurred');
            }
        }
    };

    const PaginationControls = () => {
        if (totalPages <= 1) return null;
        return (
            <div className={`border-t p-4 flex items-center justify-between ${isDarkMode ? 'bg-gray-900 border-gray-800 text-gray-400' : 'bg-white border-gray-200 text-gray-600'}`}>
                <div className="flex items-center gap-4 text-xs">
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
                    <span>{Math.min((currentPage - 1) * itemsPerPage + 1, filteredOrgs.length)}-{Math.min(currentPage * itemsPerPage, filteredOrgs.length)} of {filteredOrgs.length}</span>
                </div>
                <div className="flex items-center space-x-1">
                    <button onClick={() => handlePageChange(1)} disabled={currentPage === 1} className="p-1 disabled:opacity-30" title="First Page"><ChevronsLeft size={16} /></button>
                    <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="p-1 disabled:opacity-30" title="Previous Page"><ChevronLeft size={16} /></button>
                    <span className="text-xs px-2">Page {currentPage} of {totalPages}</span>
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
                        <h1 className="text-xl font-bold tracking-tight">Organization Management</h1>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Manage system organizations</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => refreshOrganizations()}
                            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                        >
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        {actions.canCreate && (
                        <button
                            onClick={() => { setSelectedOrg(null); setShowModal(true); }}
                            className="p-2 rounded-lg text-white shadow-lg transition-transform active:scale-95"
                            style={{ backgroundColor: colorPalette?.primary || '#3b82f6' }}
                        >
                            <Plus size={20} />
                        </button>
                        )}
                    </div>
                </div>

                <GlobalSearch 
                    searchQuery={searchQuery}
                    setSearchQuery={setSearchQuery}
                    isDarkMode={isDarkMode}
                    colorPalette={colorPalette}
                    placeholder="Search organization name..."
                />
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
                {isLoading && organizations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 opacity-50">
                        <Loader2 className="animate-spin mb-4" size={32} />
                        <p className="text-sm">Loading organizations...</p>
                    </div>
                ) : error ? (
                    <div className="p-10 text-center text-red-500 text-sm">{error}</div>
                ) : filteredOrgs.length === 0 ? (
                    <div className="p-12 text-center opacity-40">
                        <OrganizationIcon size={48} className="mx-auto mb-4" />
                        <p className="text-sm">No organizations found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className={`sticky top-0 z-10 ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                                <tr>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Organization Name</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Contact Details</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Last Updated</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-100'}`}>
                                {paginatedOrgs.map((org) => (
                                    <tr key={org.id} className={`${isDarkMode ? 'hover:bg-gray-900/50' : 'hover:bg-gray-50'} transition-colors`}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                                                    <OrganizationIcon size={14} />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-medium">{org.organization_name}</span>
                                                    {org.address && <span className={`text-xs mt-0.5 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{org.address}</span>}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            <div className="flex flex-col gap-1">
                                                {org.email_address ? (
                                                    <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>{org.email_address}</span>
                                                ) : (
                                                    <span className={isDarkMode ? 'text-gray-600' : 'text-gray-400'}>No email</span>
                                                )}
                                                {org.contact_number && (
                                                    <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{org.contact_number}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {org.updated_at ? new Date(org.updated_at).toLocaleDateString() : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {actions.canEdit && (
                                                <button
                                                    onClick={() => { setSelectedOrg(org); setShowModal(true); }}
                                                    className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-blue-400' : 'hover:bg-gray-100 text-blue-600'}`}
                                                >
                                                    <Edit size={16} />
                                                </button>
                                                )}
                                                {actions.canDelete && (
                                                <button
                                                    onClick={() => handleDeleteOrg(org.id)}
                                                    className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-red-400' : 'hover:bg-gray-100 text-red-600'}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {!isLoading && filteredOrgs.length > 0 && <PaginationControls />}

            <OrganizationModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onSave={handleSaveOrg}
                organization={selectedOrg}
            />
        </div>
    );
};

export default Organizations;
