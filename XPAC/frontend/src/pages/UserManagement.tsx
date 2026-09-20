import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Loader2, RefreshCw, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, User as UserIcon, X } from 'lucide-react';
import GlobalSearch from './globalfunctions/GlobalSearch';
import { User } from '../types/api';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';
import UserDetails from '../components/UserDetails';
import UserModal from '../modals/UserModal';

import { useUserStore } from '../store/userStore';
import { usePageActions } from '../hooks/usePageActions';

const UserManagement: React.FC<{ agentOnly?: boolean }> = ({ agentOnly = false }) => {
  // Add, Edit and Delete are granted separately on Users Management.
  //
  // Agent Management renders this same component with agentOnly, and lives in
  // the Agent group, which has no per-action keys yet — gating it against
  // user-management would hide its controls from the roles that run it, and
  // gating it against keys that do not exist would hide them from everyone. It
  // keeps the access it has until that group is given its own verbs.
  const userActions = usePageActions('user-management');
  const actions = agentOnly
    ? { canView: true, canCreate: true, canEdit: true, canDelete: true, can: () => true }
    : userActions;

  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(window.innerWidth < 768);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isFilterFocused, setIsFilterFocused] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Store
  const { 
    users, 
    isLoading, 
    error, 
    fetchUsers, 
    refreshUsers, 
    silentRefresh,
    addUser, 
    updateUser 
  } = useUserStore();

  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [mobileView, setMobileView] = useState<'users' | 'details'>('users');
  const [userTypeFilter, setUserTypeFilter] = useState<'All' | 'Operations' | 'Customer'>('All');

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth >= 768 && mobileView === 'details') {
        setMobileView('users');
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileView]);

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

  // Use the store to load users once
  useEffect(() => {
    fetchUsers(); // No force, so it caches
    silentRefresh(); // Optional: silent refresh if returning to tab
  }, [fetchUsers, silentRefresh]);

  const getFullName = (u: User): string => {
    const parts = [u.first_name, u.middle_initial, u.last_name].filter(Boolean);
    return parts.join(' ');
  };

  const filteredUsers = useMemo(() => {
    const authData = JSON.parse(localStorage.getItem('authData') || '{}');
    const userOrgId = authData.organization_id;
    const userRoleId = authData.role_id;
    const userRoleName = (authData.role || '').toLowerCase();
    
    // A Global Admin must be role 7 (SuperAdmin) AND have no organization_id
    const isGlobalAdmin = (userRoleName === 'superadmin' || String(userRoleId) === '7') && !userOrgId;

    return users.filter(user => {
      // Organization filter
      if (isGlobalAdmin) {
        if (user.organization_id && !(user.role?.role_name?.toLowerCase() === 'superadmin' || String(user.role_id) === '7' || String(user.role?.id) === '7')) {
          return false;
        }
      } else {
        if (userOrgId) {
          if (user.organization_id !== userOrgId) return false;
        } else {
          if (user.organization_id !== null && user.organization_id !== undefined) return false;
        }
      }

      // Agent-only mode: only show users with the 'agent' role (role_id 4)
      if (agentOnly) {
        const roleName = (user.role?.role_name || '').toLowerCase();
        const isAgent = roleName === 'agent' || user.role_id === 4 || String(user.role?.id) === '4';
        if (!isAgent) return false;
      }

      const fullName = getFullName(user).toLowerCase();
      const username = (user.username || '').toLowerCase();
      const email = (user.email_address || '').toLowerCase();
      const query = searchQuery.toLowerCase().trim();

      const matchesSearch = fullName.includes(query) || username.includes(query) || email.includes(query);

      // Role filter (role_id 3 is typically Customer) — skipped in agentOnly mode
      const isCustomer = user.role_id === 3 || user.role?.id === 3;
      let matchesRole = true;
      if (!agentOnly) {
        if (userTypeFilter === 'Operations') matchesRole = !isCustomer;
        else if (userTypeFilter === 'Customer') matchesRole = isCustomer;
      }

      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, userTypeFilter, agentOnly]);

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredUsers.slice(start, start + itemsPerPage);
  }, [filteredUsers, currentPage, itemsPerPage]);

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) setCurrentPage(newPage);
  };



  const handleSaveUser = (savedUser: User) => {
    const exists = users.find(u => u.id === savedUser.id);
    if (exists) {
      updateUser(savedUser);
    } else {
      addUser(savedUser);
    }
    setSelectedUser(savedUser);
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
          <span>{Math.min((currentPage - 1) * itemsPerPage + 1, filteredUsers.length)}-{Math.min(currentPage * itemsPerPage, filteredUsers.length)} of {filteredUsers.length}</span>
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
    <div className={`h-full flex flex-col md:flex-row overflow-hidden pb-16 md:pb-0 ${isDarkMode ? 'bg-gray-950 text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Users List Sidebar */}
      <div className={`flex-1 min-h-0 flex flex-col min-w-0 ${mobileView === 'details' ? 'hidden md:flex' : ''}`}>
        {/* Header */}
        <div className={`p-6 border-b ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight">{agentOnly ? 'Agent Management' : 'User Management'}</h1>
              <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{agentOnly ? 'Manage agent users' : 'Manage system users and permissions'}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => refreshUsers()}
                className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
              >
                <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
              </button>
              {actions.canCreate && (
              <button
                onClick={() => { setSelectedUser(null); setShowModal(true); }}
                className="p-2 rounded-lg text-white shadow-lg transition-transform active:scale-95"
                style={{ backgroundColor: colorPalette?.primary || '#3b82f6' }}
              >
                <Plus size={20} />
              </button>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <GlobalSearch 
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              isDarkMode={isDarkMode}
              colorPalette={colorPalette}
              placeholder="Search name, username, email..."
            />
            {!agentOnly && (
              <select
                value={userTypeFilter}
                onChange={(e) => setUserTypeFilter(e.target.value as any)}
                onFocus={() => setIsFilterFocused(true)}
                onBlur={() => setIsFilterFocused(false)}
                className={`px-3 py-2 text-sm rounded-lg border transition-all focus:outline-none ${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'}`}
                style={{
                  borderColor: isFilterFocused
                    ? (colorPalette?.primary || '#3b82f6')
                    : (isDarkMode ? '#374151' : '#d1d5db')
                }}
              >
                <option value="All">All Users</option>
                <option value="Operations">Operations</option>
                <option value="Customer">Customer</option>
              </select>
            )}
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 min-h-0 overflow-y-auto" ref={scrollRef}>
          {isLoading && users.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 opacity-50">
              <Loader2 className="animate-spin mb-4" size={32} />
              <p className="text-sm">Loading users...</p>
            </div>
          ) : error ? (
            <div className="p-10 text-center text-red-500 text-sm">{error}</div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-12 text-center opacity-40">
              <UserIcon size={48} className="mx-auto mb-4" />
              <p className="text-sm">No users found</p>
            </div>
          ) : (
            <div className={`divide-y ${isDarkMode ? 'divide-gray-800' : 'divide-gray-100'}`}>
              {paginatedUsers.map((user) => (
                <div
                  key={user.id}
                  onClick={() => { setSelectedUser(user); if (window.innerWidth < 768) setMobileView('details'); }}
                  className={`flex items-center p-4 cursor-pointer transition-all hover:pl-6 border-l-4 ${selectedUser?.id === user.id
                    ? (isDarkMode ? 'bg-gray-800/50' : 'bg-gray-50')
                    : (isDarkMode ? 'hover:bg-gray-900 border-transparent' : 'hover:bg-gray-50 border-transparent')
                    }`}
                  style={{
                    borderLeftColor: selectedUser?.id === user.id ? (colorPalette?.primary || '#3b82f6') : 'transparent'
                  }}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-4 flex-shrink-0 ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                    <UserIcon size={18} />
                  </div>
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center justify-between mb-0.5">
                      <h3 className={`text-sm font-semibold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {getFullName(user)}
                      </h3>
                      <span className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
                        {user.role?.role_name || 'GUEST'}
                      </span>
                    </div>
                    <p className={`text-xs truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                      {user.username} • {user.email_address}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!isLoading && filteredUsers.length > 0 && <PaginationControls />}
      </div>

      {/* User Details View (Right Side / Mobile Detail) */}
      {/* User Details View (Right Side / Mobile Detail) */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 md:relative md:inset-auto md:z-auto md:flex-shrink-0 md:overflow-hidden">
          <UserDetails
            user={selectedUser}
            onClose={() => { setSelectedUser(null); setMobileView('users'); }}
            onEdit={actions.canEdit ? (u) => { setSelectedUser(u); setShowModal(true); } : undefined}
            canDelete={actions.canDelete}
            isMobile={isMobile}
            isDarkMode={isDarkMode}
            colorPalette={colorPalette}
          />
        </div>
      )}

      {/* Add/Edit Modal */}
      <UserModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSaveUser}
        user={selectedUser}
        agentOnly={agentOnly}
      />
    </div>
  );
};

export default UserManagement;
