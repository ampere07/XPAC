import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Loader2, RefreshCw, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Shield, Trash2, Edit } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { Role } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import RoleModal from '../modals/RoleModal';
import { useRoleStore } from '../store/roleStore';
import { roleService } from '../services/userService';
import { baseRoleLabel } from '../config/permissions';
import { usePageActions } from '../hooks/usePageActions';

const Roles: React.FC = () => {
    // Add, Edit and Delete are granted separately. The same keys the API
    // demands, so a control is only drawn when the request behind it would
    // succeed.
    const actions = usePageActions('roles');

    const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const {
        roles,
        isLoading,
        error,
        fetchRoles,
        addRole,
        updateRoleInStore,
        removeRoleFromStore
    } = useRoleStore();

    const [selectedRole, setSelectedRole] = useState<Role | null>(null);
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
        fetchRoles();
    }, [fetchRoles]);

    const filteredRoles = useMemo(() => {
        const authData = JSON.parse(localStorage.getItem('authData') || '{}');
        const userOrgId = authData.organization_id;

        return roles.filter(role => {
            // Organization filter: Allow system roles (ID <= 8) OR roles belonging to the user's organization
            if (userOrgId && role.id > 8 && role.organization_id && role.organization_id !== userOrgId) {
                return false;
            }

            const name = role.role_name.toLowerCase();
            const query = searchQuery.toLowerCase().trim();
            return name.includes(query);
        });
    }, [roles, searchQuery]);

    const totalPages = Math.ceil(filteredRoles.length / itemsPerPage);
    const paginatedRoles = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredRoles.slice(start, start + itemsPerPage);
    }, [filteredRoles, currentPage, itemsPerPage]);

    const handlePageChange = (newPage: number) => {
        if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
    };

    const handleSaveRole = (savedRole: Role) => {
        if (selectedRole) {
            updateRoleInStore(savedRole);
        } else {
            addRole(savedRole);
        }
    };

    const handleDeleteRole = async (id: number) => {
        if (!actions.canDelete) return;
        if (window.confirm('Are you sure you want to delete this role?')) {
            try {
                const res = await roleService.deleteRole(id);
                if (res.success) {
                    removeRoleFromStore(id);
                } else {
                    alert(res.message || 'Failed to delete role');
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
                    <span>{Math.min((currentPage - 1) * itemsPerPage + 1, filteredRoles.length)}-{Math.min(currentPage * itemsPerPage, filteredRoles.length)} of {filteredRoles.length}</span>
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
                        <h1 className="text-xl font-bold tracking-tight">Role Management</h1>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Manage user roles and permissions</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => fetchRoles()}
                            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                        >
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        {actions.canCreate && (
                        <button
                            onClick={() => { setSelectedRole(null); setShowModal(true); }}
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
                    placeholder="Search role name..."
                />
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto" ref={scrollRef}>
                {isLoading && roles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 opacity-50">
                        <Loader2 className="animate-spin mb-4" size={32} />
                        <p className="text-sm">Loading roles...</p>
                    </div>
                ) : error ? (
                    <div className="p-10 text-center text-red-500 text-sm">{error}</div>
                ) : filteredRoles.length === 0 ? (
                    <div className="p-12 text-center opacity-40">
                        <Shield size={48} className="mx-auto mb-4" />
                        <p className="text-sm">No roles found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className={`sticky top-0 z-10 ${isDarkMode ? 'bg-gray-900 text-gray-400' : 'bg-gray-50 text-gray-600'}`}>
                                <tr>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Role Name</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Description</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider">Last Updated</th>
                                    <th className="px-6 py-3 text-xs font-semibold uppercase tracking-wider text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-100'}`}>
                                {paginatedRoles.map((role) => (
                                    <tr key={role.id} className={`${isDarkMode ? 'hover:bg-gray-900/50' : 'hover:bg-gray-50'} transition-colors`}>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                                                    <Shield size={14} />
                                                </div>
                                                <span className="text-sm font-medium">{role.role_name}</span>
                                                {role.id <= 8 && (
                                                    <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded uppercase ${isDarkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                                                        System
                                                    </span>
                                                )}
                                                {/* A hybrid: it holds this seeded role's access plus its own
                                                    extras, so the base is worth reading at a glance. */}
                                                {role.id > 8 && baseRoleLabel(role.base_role_id) && (
                                                    <span
                                                        className={`ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded uppercase ${isDarkMode ? 'bg-purple-900/30 text-purple-400' : 'bg-purple-100 text-purple-600'}`}
                                                        title={`Inherits everything a ${baseRoleLabel(role.base_role_id)} holds, plus its own permissions`}
                                                    >
                                                        {baseRoleLabel(role.base_role_id)} +
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                                            {role.description || 'No description provided'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-500">
                                            {role.updated_at ? new Date(role.updated_at).toLocaleDateString() : 'N/A'}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {role.id > 8 ? (
                                                    <>
                                                        {actions.canEdit && (
                                                        <button
                                                            onClick={() => { setSelectedRole(role); setShowModal(true); }}
                                                            className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-blue-400' : 'hover:bg-gray-100 text-blue-600'}`}
                                                        >
                                                            <Edit size={16} />
                                                        </button>
                                                        )}
                                                        {actions.canDelete && (
                                                        <button
                                                            onClick={() => handleDeleteRole(role.id)}
                                                            className={`p-1.5 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-red-400' : 'hover:bg-gray-100 text-red-600'}`}
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${isDarkMode ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-400'}`}>
                                                        Locked
                                                    </span>
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

            {!isLoading && filteredRoles.length > 0 && <PaginationControls />}

            <RoleModal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onSave={handleSaveRole}
                role={selectedRole}
            />
        </div>
    );
};

export default Roles;
