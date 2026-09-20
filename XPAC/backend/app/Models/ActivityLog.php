<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ActivityLog extends Model
{
    use HasFactory;

    protected $primaryKey = 'log_id';
    protected $table = 'activity_logs';

    protected $fillable = [
        'level',
        'action',
        'message',
        'user_id',
        'target_user_id',
        'resource_type',
        'resource_id',
        'ip_address',
        'user_agent',
        'additional_data',
        'organization_id',
    ];

    protected $casts = [
        'additional_data' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
        'organization_id' => 'integer',
    ];

    // Relationship with user who performed the action
    public function user()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }

    // Relationship with target user (for user management actions)
    public function targetUser()
    {
        return $this->belongsTo(User::class, 'target_user_id', 'id');
    }

    // Scopes for filtering
    public function scopeByLevel($query, $level)
    {
        return $query->where('level', $level);
    }

    public function scopeByAction($query, $action)
    {
        return $query->where('action', $action);
    }

    public function scopeByUser($query, $userId)
    {
        return $query->where('user_id', $userId);
    }

    public function scopeByResourceType($query, $resourceType)
    {
        return $query->where('resource_type', $resourceType);
    }

    public function scopeRecent($query, $days = 30)
    {
        return $query->where('created_at', '>=', now()->subDays($days));
    }

    /**
     * Helper method to create a log entry from anywhere in the application
     */
    public static function log($action, $message, $level = 'info', $params = [])
    {
        try {
            $userId = $params['user_id'] ?? null;
            
            // If no user_id, try to find by email if provided
            if (!$userId && isset($params['user_email'])) {
                $user = User::where('email_address', $params['user_email'])
                            ->orWhere('username', $params['user_email'])
                            ->first();
                if ($user) $userId = $user->id;
            }
            
            $userRecord = null;
            if ($userId) {
                $userRecord = User::find($userId);
            }
            
            // Fallback to authenticated user
            if (!$userId) {
                $userRecord = auth()->user();
                $userId = $userRecord?->id;
            }

            $organizationId = $params['organization_id'] ?? $userRecord?->organization_id;

            $targetUserId = $params['target_user_id'] ?? null;
            if (!$targetUserId && isset($params['target_user_email'])) {
                $tUser = User::where('email_address', $params['target_user_email'])
                             ->orWhere('username', $params['target_user_email'])
                             ->first();
                if ($tUser) $targetUserId = $tUser->id;
            }

            return self::create([
                'level' => $level,
                'action' => $action,
                'message' => $message,
                'user_id' => $userId,
                'target_user_id' => $targetUserId,
                'resource_type' => $params['resource_type'] ?? null,
                'resource_id' => $params['resource_id'] ?? null,
                'ip_address' => request()->ip(),
                'user_agent' => request()->userAgent(),
                'additional_data' => $params['additional_data'] ?? null,
                'organization_id' => $organizationId,
            ]);
        } catch (\Exception $e) {
            \Log::error('ActivityLog failed: ' . $e->getMessage());
            return null;
        }
    }
}
