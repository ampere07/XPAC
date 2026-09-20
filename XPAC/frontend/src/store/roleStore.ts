import { create } from 'zustand';
import { Role } from '../types/api';
import { roleService } from '../services/userService';

interface RoleState {
  roles: Role[];
  isLoading: boolean;
  error: string | null;
  fetchRoles: () => Promise<void>;
  addRole: (role: Role) => void;
  updateRoleInStore: (role: Role) => void;
  removeRoleFromStore: (roleId: number) => void;
}

export const useRoleStore = create<RoleState>((set) => ({
  roles: [],
  isLoading: false,
  error: null,

  fetchRoles: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await roleService.getAllRoles();
      if (response.success) {
        set({ roles: response.data || [], isLoading: false });
      } else {
        set({ error: response.message || 'Failed to fetch roles', isLoading: false });
      }
    } catch (err: any) {
      set({ error: err.message || 'An error occurred', isLoading: false });
    }
  },

  addRole: (role) => set((state) => ({ roles: [role, ...state.roles] })),

  updateRoleInStore: (updatedRole) =>
    set((state) => ({
      roles: state.roles.map((r) => (r.id === updatedRole.id ? updatedRole : r)),
    })),

  removeRoleFromStore: (roleId) =>
    set((state) => ({
      roles: state.roles.filter((r) => r.id !== roleId),
    })),
}));
