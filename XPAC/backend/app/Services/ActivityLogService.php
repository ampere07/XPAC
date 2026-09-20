<?php

namespace App\Services;

use App\Models\ActivityLog;
use Illuminate\Http\Request;
use Exception;

class ActivityLogService
{
    public static function log($level, $action, $message, $userId = null, $targetUserId = null, $resourceType = null, $resourceId = null, $additionalData = null)
    {
        try {
            $request = request();
            
            ActivityLog::create([
                'level' => $level,
                'action' => $action,
                'message' => $message,
                'user_id' => $userId,
                'target_user_id' => $targetUserId,
                'resource_type' => $resourceType,
                'resource_id' => $resourceId,
                'ip_address' => $request ? $request->ip() : null,
                'user_agent' => $request ? $request->userAgent() : null,
                'additional_data' => $additionalData,
            ]);
        } catch (Exception $e) {
            // Log to Laravel's default log if activity log fails
            \Log::error('Failed to create activity log: ' . $e->getMessage());
        }
    }

    // Convenience methods for different log levels
    public static function info($action, $message, $userId = null, $targetUserId = null, $resourceType = null, $resourceId = null, $additionalData = null)
    {
        self::log('info', $action, $message, $userId, $targetUserId, $resourceType, $resourceId, $additionalData);
    }

    public static function warning($action, $message, $userId = null, $targetUserId = null, $resourceType = null, $resourceId = null, $additionalData = null)
    {
        self::log('warning', $action, $message, $userId, $targetUserId, $resourceType, $resourceId, $additionalData);
    }

    public static function error($action, $message, $userId = null, $targetUserId = null, $resourceType = null, $resourceId = null, $additionalData = null)
    {
        self::log('error', $action, $message, $userId, $targetUserId, $resourceType, $resourceId, $additionalData);
    }

    public static function debug($action, $message, $userId = null, $targetUserId = null, $resourceType = null, $resourceId = null, $additionalData = null)
    {
        self::log('debug', $action, $message, $userId, $targetUserId, $resourceType, $resourceId, $additionalData);
    }

    // Predefined activity logging methods for common actions
    public static function userCreated($createdBy, $createdUser, $additionalData = null)
    {
        self::info(
            'create_user',
            "User '{$createdUser->username}' ({$createdUser->full_name}) was created",
            $createdBy,
            $createdUser->user_id,
            'user',
            $createdUser->user_id,
            $additionalData
        );
    }

    public static function userUpdated($updatedBy, $updatedUser, $changes = null)
    {
        $changesList = $changes ? implode(', ', array_keys($changes)) : 'profile data';
        
        self::info(
            'update_user',
            "User '{$updatedUser->username}' was updated (changed: {$changesList})",
            $updatedBy,
            $updatedUser->user_id,
            'user',
            $updatedUser->user_id,
            ['changes' => $changes]
        );
    }

    public static function userDeleted($deletedBy, $deletedUserId, $deletedUsername)
    {
        self::warning(
            'delete_user',
            "User '{$deletedUsername}' (ID: {$deletedUserId}) was deleted",
            $deletedBy,
            $deletedUserId,
            'user',
            $deletedUserId
        );
    }

    public static function userPasswordChanged($userId, $targetUserId = null)
    {
        $targetUserId = $targetUserId ?: $userId;
        $message = $userId == $targetUserId 
            ? "User changed their own password"
            : "Password was changed for another user";

        self::info(
            'change_password',
            $message,
            $userId,
            $targetUserId,
            'user',
            $targetUserId
        );
    }

    public static function roleAssigned($assignedBy, $userId, $roleId, $roleName)
    {
        self::info(
            'assign_role',
            "Role '{$roleName}' was assigned to user",
            $assignedBy,
            $userId,
            'user_role',
            $roleId,
            ['role_id' => $roleId, 'role_name' => $roleName]
        );
    }

    public static function roleRemoved($removedBy, $userId, $roleId, $roleName)
    {
        self::info(
            'remove_role',
            "Role '{$roleName}' was removed from user",
            $removedBy,
            $userId,
            'user_role',
            $roleId,
            ['role_id' => $roleId, 'role_name' => $roleName]
        );
    }

    public static function groupAssigned($assignedBy, $userId, $groupId, $groupName)
    {
        self::info(
            'assign_group',
            "Group '{$groupName}' was assigned to user",
            $assignedBy,
            $userId,
            'user_group',
            $groupId,
            ['group_id' => $groupId, 'group_name' => $groupName]
        );
    }

    public static function groupRemoved($removedBy, $userId, $groupId, $groupName)
    {
        self::info(
            'remove_group',
            "Group '{$groupName}' was removed from user",
            $removedBy,
            $userId,
            'user_group',
            $groupId,
            ['group_id' => $groupId, 'group_name' => $groupName]
        );
    }

    public static function organizationCreated($createdBy, $organization, $additionalData = null)
    {
        self::info(
            'create_organization',
            "Organization '{$organization->org_name}' ({$organization->org_type}) was created",
            $createdBy,
            null,
            'organization',
            $organization->org_id,
            $additionalData
        );
    }

    public static function organizationUpdated($updatedBy, $organization, $changes = null)
    {
        $changesList = $changes ? implode(', ', array_keys($changes)) : 'organization data';
        
        self::info(
            'update_organization',
            "Organization '{$organization->org_name}' was updated (changed: {$changesList})",
            $updatedBy,
            null,
            'organization',
            $organization->org_id,
            ['changes' => $changes]
        );
    }

    public static function organizationDeleted($deletedBy, $orgId, $orgName)
    {
        self::warning(
            'delete_organization',
            "Organization '{$orgName}' (ID: {$orgId}) was deleted",
            $deletedBy,
            null,
            'organization',
            $orgId
        );
    }

    public static function groupCreated($createdBy, $group, $additionalData = null)
    {
        self::info(
            'create_group',
            "Group '{$group->group_name}' was created",
            $createdBy,
            null,
            'group',
            $group->group_id,
            $additionalData
        );
    }

    public static function groupUpdated($updatedBy, $group, $changes = null)
    {
        $changesList = $changes ? implode(', ', array_keys($changes)) : 'group data';
        
        self::info(
            'update_group',
            "Group '{$group->group_name}' was updated (changed: {$changesList})",
            $updatedBy,
            null,
            'group',
            $group->group_id,
            ['changes' => $changes]
        );
    }

    public static function groupDeleted($deletedBy, $groupId, $groupName)
    {
        self::warning(
            'delete_group',
            "Group '{$groupName}' (ID: {$groupId}) was deleted",
            $deletedBy,
            null,
            'group',
            $groupId
        );
    }

    public static function roleCreated($createdBy, $role, $additionalData = null)
    {
        self::info(
            'create_role',
            "Role '{$role->role_name}' was created",
            $createdBy,
            null,
            'role',
            $role->role_id,
            $additionalData
        );
    }

    public static function roleUpdated($updatedBy, $role, $changes = null)
    {
        $changesList = $changes ? implode(', ', array_keys($changes)) : 'role data';
        
        self::info(
            'update_role',
            "Role '{$role->role_name}' was updated (changed: {$changesList})",
            $updatedBy,
            null,
            'role',
            $role->role_id,
            ['changes' => $changes]
        );
    }

    public static function roleDeleted($deletedBy, $roleId, $roleName)
    {
        self::warning(
            'delete_role',
            "Role '{$roleName}' (ID: {$roleId}) was deleted",
            $deletedBy,
            null,
            'role',
            $roleId
        );
    }

    public static function userLogin($userId, $username)
    {
        self::info(
            'user_login',
            "User '{$username}' logged in successfully",
            $userId,
            $userId,
            'user',
            $userId
        );
    }

    public static function userLogout($userId, $username)
    {
        self::info(
            'user_logout',
            "User '{$username}' logged out",
            $userId,
            $userId,
            'user',
            $userId
        );
    }

    public static function loginAttemptFailed($username, $ip = null)
    {
        self::warning(
            'login_failed',
            "Failed login attempt for username '{$username}'",
            null,
            null,
            'auth',
            null,
            ['attempted_username' => $username, 'ip_address' => $ip]
        );
    }

    public static function systemEvent($action, $message, $level = 'info', $additionalData = null)
    {
        self::log(
            $level,
            $action,
            $message,
            null,
            null,
            'system',
            null,
            $additionalData
        );
    }
}
