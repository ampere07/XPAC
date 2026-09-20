<?php

namespace App\Http\Controllers;

use App\Models\Role;
use App\Support\Permissions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

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

            $role = Role::create($request->except('permissions_version') + [
                'created_by_user_id' => $user->id ?? 1,
                'updated_by_user_id' => $user->id ?? 1,
                'organization_id' => $organizationId,
                // Saved with the per-action checkboxes on screen, so the list
                // below is exactly what was chosen and is read as written.
                'permissions_version' => Permissions::CURRENT_VERSION,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Role created successfully',
                'data' => $role
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
        $inherited = Permissions::inheritedKeys($role->base_role_id ?? null);

        $role->setAttribute('effective_permissions', array_values(array_diff(
            Permissions::roleKeys($role),
            $inherited
        )));

        return $role;
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
        $validator = Validator::make($request->all(), [
            'role_name' => 'sometimes|string|max:255|unique:roles,role_name,' . $id,
            'description' => 'sometimes|nullable|string',
            // Null clears the base, turning a hybrid back into a standalone
            // custom role. Its own `permissions` are untouched, so it keeps
            // exactly the keys that were ticked against it rather than the
            // inherited ones it is losing.
            'base_role_id' => 'sometimes|nullable|integer|in:' . implode(',', Role::LOCKED_ROLE_IDS),
            'permissions' => 'sometimes|nullable|array',
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

            $role = Role::findOrFail($id);

            // Check if user belongs to an organization and if it matches the role's organization
            // System roles (ID <= 8) are already blocked from update above
            if ($organizationId && $role->organization_id !== $organizationId) {
                return response()->json([
                    'success' => false,
                    'message' => 'Unauthorized. You can only update roles within your organization.'
                ], 403);
            }

            // Don't allow organization_id to be changed via update, and don't
            // let a caller set its own permissions_version: it records that the
            // save went through the modal, which only this method can attest.
            $updateData = $request->except(['organization_id', 'permissions_version']);

            $role->update($updateData + [
                'updated_by_user_id' => $user->id ?? 1,
                // Whatever generation this row was saved under before, it has
                // now been through the modal that shows every action, so the
                // stored list stops being grandfathered.
                'permissions_version' => Permissions::CURRENT_VERSION,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Role updated successfully',
                'data' => $role
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
            if ($organizationId && $role->organization_id !== $organizationId) {
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
