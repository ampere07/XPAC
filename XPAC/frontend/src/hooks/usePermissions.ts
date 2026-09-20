// One way to ask "may this user do X?" anywhere in the app.
//
// Before this, roughly a dozen pages and detail panes each carried their own
// copy of:
//
//   const hasPermission = (p) => isAdmin ? true : userPermissions.includes(p)
//
// along with its own localStorage read and its own three-way parse of the
// permissions field. They disagreed in one important way: a seeded role has no
// stored permissions array, so every one of those copies returned false for a
// technician — which is why the technician's Done button did nothing. Resolving
// through config/permissions.ts instead answers from the role table for seeded
// roles and from the stored list for custom ones.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AuthLike,
  ROLE,
  homeSectionFor,
  permissionsAllow,
  permissionsFor,
  roleIdOf,
} from '../config/permissions';

/** Read authData, tolerating it being absent or corrupt. */
const readAuth = (): AuthLike | null => {
  try {
    const raw = localStorage.getItem('authData');
    return raw ? (JSON.parse(raw) as AuthLike) : null;
  } catch {
    return null;
  }
};

export interface PermissionApi {
  /** Does the user hold this key (or any of these keys)? */
  can: (permission: string | string[]) => boolean;
  /** Does the user hold every one of these keys? */
  canAll: (permissions: string[]) => boolean;
  /** The user's effective keys. `['*']` for a SuperAdmin. */
  permissions: string[];
  roleId: number;
  /** Lowercased role name as the API reported it, e.g. "technician". */
  roleName: string;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  isTechnician: boolean;
  isAgent: boolean;
  isCustomer: boolean;
  /** The section this user should land on. */
  home: string;
}

/**
 * Permissions for the signed-in user.
 *
 * Re-reads authData when another tab writes it and when the app announces a
 * change itself (config/api.ts fires `auth-changed` after refreshing the stored
 * permissions), so a role edited while the user is signed in takes effect on
 * their next navigation rather than their next sign-in.
 */
export const usePermissions = (): PermissionApi => {
  const [auth, setAuth] = useState<AuthLike | null>(readAuth);

  useEffect(() => {
    const refresh = () => setAuth(readAuth());

    window.addEventListener('storage', refresh);
    window.addEventListener('auth-changed', refresh);

    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('auth-changed', refresh);
    };
  }, []);

  const permissions = useMemo(() => permissionsFor(auth), [auth]);
  const roleId = useMemo(() => roleIdOf(auth), [auth]);

  const can = useCallback(
    (permission: string | string[]) => permissionsAllow(permissions, permission),
    [permissions]
  );

  const canAll = useCallback(
    (wanted: string[]) => wanted.every(key => permissionsAllow(permissions, key)),
    [permissions]
  );

  return useMemo(
    () => ({
      can,
      canAll,
      permissions,
      roleId,
      roleName: (auth?.role || '').toLowerCase().trim(),
      isSuperAdmin: roleId === ROLE.SUPER_ADMIN,
      isAdministrator: roleId === ROLE.ADMINISTRATOR || roleId === ROLE.SUPER_ADMIN,
      isTechnician: roleId === ROLE.TECHNICIAN,
      isAgent: roleId === ROLE.AGENT,
      isCustomer: roleId === ROLE.CUSTOMER,
      home: homeSectionFor(auth),
    }),
    [can, canAll, permissions, roleId, auth]
  );
};

/**
 * The same answer outside a component — event handlers, service modules, and
 * the odd class component.
 *
 * Reads localStorage on every call rather than caching, so it cannot go stale.
 */
export const currentUserCan = (permission: string | string[]): boolean =>
  permissionsAllow(permissionsFor(readAuth()), permission);

export default usePermissions;
