<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Location extends Model
{
    use HasFactory;

    protected $table = 'locations';
    protected $primaryKey = 'id';

    protected $fillable = [
        'name',
        'type',
        'parent_id',
        'description',
        'is_active'
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'created_at' => 'datetime',
        'updated_at' => 'datetime'
    ];

    protected $appends = ['parent_name'];

    public function parent()
    {
        return $this->belongsTo(Location::class, 'parent_id');
    }

    public function children()
    {
        return $this->hasMany(Location::class, 'parent_id');
    }

    public function getParentNameAttribute()
    {
        return $this->parent ? $this->parent->name : null;
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    public function scopeByType($query, $type)
    {
        return $query->where('type', $type);
    }

    public function scopeByParent($query, $parentId)
    {
        return $query->where('parent_id', $parentId);
    }

    public function getFullPathAttribute()
    {
        $path = [$this->name];
        $parent = $this->parent;
        
        while ($parent) {
            array_unshift($path, $parent->name);
            $parent = $parent->parent;
        }
        
        return implode(' > ', $path);
    }

    public function getHierarchyLevelAttribute()
    {
        $levels = [
            'region' => 1,
            'city' => 2,
            'borough' => 3,
            'village' => 4
        ];

        return $levels[$this->type] ?? 5;
    }

    public function getAllDescendants()
    {
        $descendants = collect();
        
        foreach ($this->children as $child) {
            $descendants->push($child);
            $descendants = $descendants->merge($child->getAllDescendants());
        }
        
        return $descendants;
    }

    public function getAncestors()
    {
        $ancestors = collect();
        $parent = $this->parent;
        
        while ($parent) {
            $ancestors->push($parent);
            $parent = $parent->parent;
        }
        
        return $ancestors->reverse();
    }

    public function isDescendantOf($location)
    {
        $parent = $this->parent;
        
        while ($parent) {
            if ($parent->id == $location->id) {
                return true;
            }
            $parent = $parent->parent;
        }
        
        return false;
    }

    public function isAncestorOf($location)
    {
        return $location->isDescendantOf($this);
    }

    public static function getHierarchy()
    {
        $locations = self::with('parent')->get();
        
        return [
            'regions' => $locations->where('type', 'region'),
            'cities' => $locations->where('type', 'city'),
            'boroughs' => $locations->where('type', 'borough'),
            'villages' => $locations->where('type', 'village')
        ];
    }

    public static function buildTree($parentId = null)
    {
        $locations = self::where('parent_id', $parentId)
            ->where('is_active', true)
            ->orderBy('name')
            ->get();

        foreach ($locations as $location) {
            $location->children = self::buildTree($location->id);
        }

        return $locations;
    }
}
