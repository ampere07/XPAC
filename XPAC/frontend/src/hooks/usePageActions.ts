// What the signed-in user may do on one page.
//
// A list page asks for its own name and gets back the four answers it draws
// with:
//
//   const actions = usePageActions('plan-list');
//   {actions.canCreate && <button onClick={handleAddNew}>Add Plan</button>}
//
// The keys are `<page>.create`, `<page>.edit` and `<page>.delete` — the same
// strings App\Support\Permissions declares and ApiPermissionMap demands, so a
// control is drawn only when the request behind it would succeed. Nothing here
// grants anything: the server checks every call whatever this returns. It
// decides what to *draw*.
//
// A page with a button outside the standard three asks for it by name:
//
//   {actions.can('archive') && <button …>}
//
// which needs `<page>.archive` added to ACTIONS in config/permissions.ts and to
// Permissions::ACTIONS on the server, plus a rule in ApiPermissionMap. Those
// three edits are the whole cost of a new gated button — the Role modal renders
// whatever ACTIONS holds, so the checkbox appears on its own.

import { useMemo } from 'react';
import { usePermissions } from './usePermissions';

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
}

/**
 * The permissions for one page.
 *
 * Built on usePermissions, so a role edited while the user is signed in takes
 * effect on their next navigation rather than their next sign-in — the buttons
 * appear and disappear with it.
 */
export const usePageActions = (page: string): PageActions => {
  const { can } = usePermissions();

  return useMemo(
    () => ({
      canView: can(page),
      canCreate: can(`${page}.create`),
      canEdit: can(`${page}.edit`),
      canDelete: can(`${page}.delete`),
      can: (verb: string) => can(`${page}.${verb}`),
    }),
    [can, page]
  );
};

export default usePageActions;
