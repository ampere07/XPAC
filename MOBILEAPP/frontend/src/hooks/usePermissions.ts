// One way to ask "may this user do X?" anywhere in the mobile app.
//
// The web portal's equivalent (ATSS2_0/frontend/src/hooks/usePermissions.ts)
// reads localStorage synchronously. AsyncStorage is not synchronous, so this
// version loads once and reports `ready` while it is still loading — callers
// that draw destructive controls should wait for `ready` rather than treat a
// not-yet-loaded user as having no permissions and then flash the controls in.

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AuthLike,
  ROLE,
  homeSectionFor,
  permissionsAllow,
  permissionsFor,
  roleIdOf,
} from '../config/permissions';

export interface PermissionApi {
  /** Does the user hold this key (or any of these keys)? */
  can: (permission: string | string[]) => boolean;
  /** The user's effective keys. `['*']` for a SuperAdmin. */
  permissions: string[];
  roleId: number;
  roleName: string;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  isTechnician: boolean;
  isAgent: boolean;
  isCustomer: boolean;
  /** The section this user should land on. */
  home: string;
  /** False until authData has been read. */
  ready: boolean;
}

/** Read authData out of AsyncStorage, tolerating it being absent or corrupt. */
export const readStoredAuth = async (): Promise<AuthLike | null> => {
  try {
    const raw = await AsyncStorage.getItem('authData');
    return raw ? (JSON.parse(raw) as AuthLike) : null;
  } catch {
    return null;
  }
};

/**
 * Permissions for the signed-in user.
 *
 * `auth` may be passed in by a caller that has already loaded it — Dashboard
 * does — which avoids a second read and a second render.
 */
export const usePermissions = (auth?: AuthLike | null): PermissionApi => {
  const [loaded, setLoaded] = useState<AuthLike | null>(auth ?? null);
  const [ready, setReady] = useState<boolean>(auth !== undefined && auth !== null);

  useEffect(() => {
    if (auth !== undefined && auth !== null) {
      setLoaded(auth);
      setReady(true);
      return;
    }

    let cancelled = false;

    readStoredAuth().then(stored => {
      if (cancelled) return;
      setLoaded(stored);
      setReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [auth]);

  const permissions = useMemo(() => permissionsFor(loaded), [loaded]);
  const roleId = useMemo(() => roleIdOf(loaded), [loaded]);

  const can = useCallback(
    (permission: string | string[]) => permissionsAllow(permissions, permission),
    [permissions]
  );

  return useMemo(
    () => ({
      can,
      permissions,
      roleId,
      roleName: (loaded?.role || '').toLowerCase().trim(),
      isSuperAdmin: roleId === ROLE.SUPER_ADMIN,
      isAdministrator: roleId === ROLE.ADMINISTRATOR || roleId === ROLE.SUPER_ADMIN,
      isTechnician: roleId === ROLE.TECHNICIAN,
      isAgent: roleId === ROLE.AGENT,
      isCustomer: roleId === ROLE.CUSTOMER,
      home: homeSectionFor(loaded),
      ready,
    }),
    [can, permissions, roleId, loaded, ready]
  );
};

export default usePermissions;
