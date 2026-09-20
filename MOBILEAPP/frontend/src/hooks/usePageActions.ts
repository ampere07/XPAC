// What the signed-in user may do on one page.
//
// A list page asks for its own name and gets back the answers it draws with:
//
//   const actions = usePageActions('vlan-config');
//   {actions.canCreate && <TouchableOpacity onPress={handleAddNew}>…}
//
// The keys are `<page>.create`, `<page>.edit` and `<page>.delete` — the same
// strings App\Support\Permissions declares and ApiPermissionMap demands, so a
// control is drawn only when the request behind it would succeed. Nothing here
// grants anything: the server checks every call whatever this returns. It
// decides what to *draw*.
//
// The web portal's equivalent (ATSS2_0/frontend/src/hooks/usePageActions.ts)
// reads its permissions synchronously from localStorage. AsyncStorage is not
// synchronous, so this version carries `ready` through from usePermissions —
// and every answer is false until it flips.
//
// That default matters here more than it does on the web. These flags draw Add,
// Edit and Delete, and a page that treated "not loaded yet" as "allowed" would
// paint a Delete button for a role that does not have it and then take it away
// a frame later. Callers that want to avoid the opposite flicker — controls
// appearing a moment after the list — should wait on `ready` rather than
// second-guess the flags.

import { useMemo } from 'react';
import { usePermissions } from './usePermissions';
import { AuthLike } from '../config/permissions';

export interface PageActions {
  /** May the page be opened at all? */
  canView: boolean;
  /** May a new record be added — the Add button. */
  canCreate: boolean;
  /** May an existing record be changed — the Edit action. */
  canEdit: boolean;
  /** May a record be removed — the Delete action. */
  canDelete: boolean;
  /**
   * Any other verb this page declares, e.g. `can('approve')`.
   *
   * Takes the bare verb rather than the full key so a page names itself once.
   */
  can: (verb: string) => boolean;
  /** False until authData has been read. Every flag above is false until then. */
  ready: boolean;
}

/**
 * The permissions for one page.
 *
 * `auth` may be passed by a caller that has already loaded it, the same way
 * usePermissions accepts one, so a screen that already holds the account does
 * not read storage a second time.
 */
export const usePageActions = (page: string, auth?: AuthLike | null): PageActions => {
  const { can, ready } = usePermissions(auth);

  return useMemo(
    () => ({
      canView: ready && can(page),
      canCreate: ready && can(`${page}.create`),
      canEdit: ready && can(`${page}.edit`),
      canDelete: ready && can(`${page}.delete`),
      can: (verb: string) => ready && can(`${page}.${verb}`),
      ready,
    }),
    [can, page, ready]
  );
};

export default usePageActions;
