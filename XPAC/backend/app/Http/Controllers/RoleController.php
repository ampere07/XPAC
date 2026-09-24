<?php

namespace App\Http\Controllers;

use App\Models\Role;
use App\Support\Permissions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

class RoleController extends Controller
{
    public function index()
    {
        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $query = Role::withCount(['users']);

            if ($organizationId) {
                // Allow system roles (id <= 8) OR roles belonging to the user's organization
                $query->where(function($q) use ($organizationId) {
                    $q->where('id', '<=', 8)
                      ->orWhere('organization_id', $organizationId);
                });
            }

            $roles = $query->get()->map(fn (Role $role) => $this->withEffectivePermissions($role));

            return response()->json([
                'success' => true,
                'data' => $roles
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to fetch roles',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function store(Request $request)
    {
        // Each entry must be a key the system actually recognises. A role
        // carrying an unknown key would silently grant nothing, which reads as
        // "the permission system is broken" rather than as the typo it is.
        //
        // base_role_id must be one of the eight seeded roles. Anything else —
        // another custom role, a deleted id — would either inherit nothing or
        // start a chain of roles inheriting each other, and neither is what the
        // picker offers.
        $validator = Validator::make($request->all(), [
            'role_name' => 'required|string|max:255|unique:roles',
            'description' => 'nullable|string',
            'base_role_id' => 'nullable|integer|in:' . implode(',', Role::LOCKED_ROLE_IDS),
            'permissions' => 'nullable|array',
            'permissions.*' => 'string|in:' . implode(',', Permissions::all()),
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            // The signed-in user's organisation, not the payload's: `+` keeps
            // the left-hand value, so an organization_id in the request used to
            // win. A user with no organisation (a global SuperAdmin) may still
            // name one, as before.
            $payload = $organizationId
                ? $request->except(['permissions_version', 'organization_id'])
                : $request->except('permissions_version');

            if ($request->has('permissions')) {
                $payload['permissions'] = $this->savableKeys($request->input('permissions'), null);
            }

            $role = Role::create($this->onlyExistingColumns($payload + [
                'created_by_user_id' => $user->id ?? 1,
                'updated_by_user_id' => $user->id ?? 1,
                'organization_id' => $organizationId,
                // Saved with the per-action checkboxes on screen, so the list
                // below is exactly what was chosen and is read as written.
                'permissions_version' => Permissions::CURRENT_VERSION,
            ]));

            return response()->json([
                'success' => true,
                'message' => 'Role created successfully',
                'data' => $this->withEffectivePermissions($role)
            ], 201);
        } catch (\Exception $e) {
            // The response carries the message, but nothing reaches the log
            // otherwise — a create that 500s server-side left no trace to read
            // back afterwards, only a status code in the browser.
            Log::error('Role create failed', [
                'role_name' => $request->input('role_name'),
                'base_role_id' => $request->input('base_role_id'),
                'exception' => $e,
            ]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to create role',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * A role row plus the keys it effectively holds.
     *
     * `permissions` is the column as stored, which for a role saved before the
     * per-action keys existed lists only its pages. The Role modal seeds its
     * checkboxes from a role, and seeding from that column would show Add, Edit
     * and Delete unticked for a role that has them — so the first save would
     * revoke them, silently, from a screen that never showed them ticked.
     *
     * `effective_permissions` is what App\Support\Permissions actually grants,
     * grandfathering included, so the modal opens showing the truth. Its own
     * keys are what the save then writes, which is how a role stops being
     * grandfathered without anything changing underneath it.
     *
     * The inherited half of a hybrid is excluded: those keys are resolved live
     * from the base role and the modal shows them locked, from its own copy of
     * the table, rather than as ticks belonging to this role.
     */
    private function withEffectivePermissions(Role $role): Role
    {
        $role->setAttribute('effective_permissions', $this->ownEffectiveKeys($role));

        return $role;
    }

    /**
     * What the role effectively holds, minus the half inherited from its base,
     * restricted to keys the catalog offers.
     *
     * roleKeys() already turns a retired key into its replacements. Anything
     * else it passes through that the catalog does not list (an id a legacy
     * row still stores) grants nothing, and handing it to the modal would only
     * send it back on the next save, so it is left out. A SuperAdmin-based
     * hybrid resolves to the wildcard, which is inherited and so drops out too.
     */
    private function ownEffectiveKeys(Role $role): array
    {
        $inherited = Permissions::inheritedKeys($role->base_role_id ?? null);
        $catalog = Permissions::all();

        return array_values(array_filter(
            array_diff(Permissions::roleKeys($role), $inherited),
            fn ($key) => in_array($key, $catalog, true)
        ));
    }

    /**
     * The list to write: catalog keys kept, retired keys expanded to their
     * replacements, and keys the catalog no longer lists (accepted by the
     * validator only because the row already stored them) dropped.
     *
     * Holding both halves of an exclusive pair is not refused — a legacy row
     * may already hold both, and it must stay editable — but it is logged.
     */
    private function savableKeys($keys, ?Role $role): ?array
    {
        if ($keys === null) {
            return null;
        }

        $catalog = Permissions::all();
        $retired = array_flip(Permissions::retiredKeys());
        $result = [];

        foreach ((array) $keys as $key) {
            if (!is_string($key)) {
                continue;
            }

            if (isset($retired[$key])) {
                $result = array_merge($result, Permissions::replaceRetired([$key]));
                continue;
            }

            if (in_array($key, $catalog, true)) {
                $result[] = $key;
            }
        }

        $result = array_values(array_unique(array_filter(
            $result,
            fn ($key) => in_array($key, $catalog, true)
        )));

        foreach (Permissions::EXCLUSIVE_PAIRS as [$a, $b]) {
            if (in_array($a, $result, true) && in_array($b, $result, true)) {
                Log::warning('Role saved holding both halves of an exclusive pair', [
                    'role_id' => $role->id ?? null,
                    'pair' => [$a, $b],
                ]);
            }
        }

        return $result;
    }

    /**
     * Same organisation? Compared as integers: the two ids come from different
     * tables (and drivers), so one may arrive as "10" and the other as 10, and
     * a strict !== between them refused a user their own organisation's role.
     */
    private function sameOrganization($roleOrganizationId, $userOrganizationId): bool
    {
        return $roleOrganizationId !== null
            && (string) $roleOrganizationId !== ''
            && (int) $roleOrganizationId === (int) $userOrganizationId;
    }

    /**
     * Drop the columns added by the roles migrations when they have not been
     * applied yet.
     *
     * `base_role_id` and `permissions_version` arrive with this module's two
     * migrations. Until they run, writing either one fails the whole save, so
     * creating or editing a role would stop working the moment the code was
     * deployed. Without the columns a role simply cannot be a hybrid and stays
     * grandfathered, which is exactly how every role behaved before.
     */
    private function onlyExistingColumns(array $data): array
    {
        // Checked on every save rather than cached in a static: a long-lived
        // worker would otherwise keep dropping the columns after the
        // migrations had been run underneath it. A save is rare; the check is
        // one schema query.
        $missing = array_values(array_filter(
            ['base_role_id', 'permissions_version'],
            fn (string $column) => !Schema::hasColumn('roles', $column)
        ));

        if ($missing) {
            Log::warning('Roles migrations not applied; saving roles without ' . implode(', ', $missing));
        }

        return array_diff_key($data, array_flip($missing));
    }

    public function show($id)
    {
        try {
            $role = Role::with(['users'])->findOrFail($id);
            return response()->json([
                'success' => true,
                'data' => $this->withEffectivePermissions($role)
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Role not found',
                'error' => $e->getMessage()
            ], 404);
        }
    }

    public function update(Request $request, $id)
    {
        if ($id <= 8) {
            return response()->json([
                'success' => false,
                'message' => 'System roles cannot be edited'
            ], 403);
        }
        // Read up front so the rules below can be relaxed for what this row
        // already holds. A missing row is answered further down, as before.
        $existing = Role::find($id);

        // role_name: unique only when it actually changes. Rows saved before
        // this module may share a name, and re-sending a role's own unchanged
        // name alongside an edit to something else must not be refused.
        $nameRules = 'sometimes|string|max:255';
        if (!$existing || (string) $request->input('role_name') !== (string) $existing->role_name) {
            $nameRules .= '|unique:roles,role_name,' . $id;
        }

        // permissions.*: a catalog key, a retired key (still read), or a key
        // this row already stores. A legacy row can hold ids the catalog no
        // longer lists, and a client that hands them back must not make the
        // role impossible to edit; those are dropped silently before saving
        // (see savableKeys()). A NEW unknown key is still refused — that is
        // the typo protection.
        $acceptedKeys = array_values(array_unique(array_merge(
            Permissions::all(),
            Permissions::retiredKeys(),
            Permissions::storedKeys($existing)
        )));

        $validator = Validator::make($request->all(), [
            'role_name' => $nameRules,
            'description' => 'sometimes|nullable|string',
            // Null clears the base, turning a hybrid back into a standalone
            // custom role. Its own `permissions` are untouched, so it keeps
            // exactly the keys that were ticked against it rather than the
            // inherited ones it is losing.
            'base_role_id' => 'sometimes|nullable|integer|in:' . implode(',', Role::LOCKED_ROLE_IDS),
            'permissions' => 'sometimes|nullable|array',
            'permissions.*' => ['string', Rule::in($acceptedKeys)],
        ]);

        if ($validator->fails()) {
            return response()->json([
                'success' => false,
                'message' => 'Validation failed',
                'errors' => $validator->errors()
            ], 422);
        }

        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $role = Role::findOrFail($id);

            // Check if user belongs to an organization and if it matches the role's organization
            // System roles (ID <= 8) are already blocked from update above
            if ($organizationId && !$this->sameOrganization($role->organization_id, $organizationId)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only update roles within your organization.'
                ], 403);
            }

            // Don't allow organization_id to be changed via update, and don't
            // let a caller set its own permissions_version: it records that the
            // save went through the modal, which only this method can attest.
            $updateData = $request->except(['organization_id', 'permissions_version']);

            if ($request->has('permissions')) {
                $updateData['permissions'] = $this->savableKeys($request->input('permissions'), $role);
            } elseif (Permissions::isLegacyRole($role)) {
                // Every save stamps the current version (below), which makes
                // the stored list authoritative. A save that does not send the
                // list — a rename, a description edit, a base change from some
                // other client — would otherwise strip a grandfathered role of
                // the actions it only holds through the legacy rules. Write
                // what it effectively holds today as its own list instead, so
                // the stamp changes nothing it can do.
                $updateData['permissions'] = $this->ownEffectiveKeys($role);
            }

            $role->update($this->onlyExistingColumns($updateData + [
                'updated_by_user_id' => $user->id ?? 1,
                // Whatever generation this row was saved under before, it has
                // now been through the modal that shows every action, so the
                // stored list stops being grandfathered.
                'permissions_version' => Permissions::CURRENT_VERSION,
            ]));

            return response()->json([
                'success' => true,
                'message' => 'Role updated successfully',
                'data' => $this->withEffectivePermissions($role)
            ]);
        } catch (\Exception $e) {
            Log::error('Role update failed', ['role_id' => $id, 'exception' => $e]);

            return response()->json([
                'success' => false,
                'message' => 'Failed to update role',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    public function destroy($id)
    {
        if ($id <= 8) {
            return response()->json([
                'success' => false,
                'message' => 'System roles cannot be deleted'
            ], 403);
        }
        try {
            $user = auth()->user();
            $organizationId = $user ? $user->organization_id : null;

            $role = Role::findOrFail($id);

            // Check if user belongs to an organization and if it matches the role's organization
            // System roles (ID <= 8) are already blocked from delete above
            if ($organizationId && !$this->sameOrganization($role->organization_id, $organizationId)) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only delete roles within your organization.'
                ], 403);
            }
            
            // Check if role has users
            if ($role->users()->count() > 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot delete role that has assigned users'
                ], 400);
            }

            $role->delete();

            return response()->json([
                'success' => true,
                'message' => 'Role deleted successfully'
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Failed to delete role',
                'error' => $e->getMessage()
            ], 500);
        }
    }
}
