import React, { useState, useEffect, useMemo } from 'react';
import { Role, ApiResponse } from '../types/api';
import { roleService } from '../services/userService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';
import {
  ACTIONS,
  BASE_ROLE_OPTIONS,
  CURRENT_VERSION,
  WILDCARD,
  inheritedPermissions,
  knownKeysOnly,
  labelFor,
  permissionGroups,
  roleModalSeed,
  withImpliedPages,
} from '../config/permissions';

interface RoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (role: Role) => void;
  role?: Role | null;
}

/**
 * Pages and their sub actions come from config/permissions.ts.
 *
 * They used to be a list maintained here by hand, which meant a page added to
 * the app was invisible to Role Management until somebody remembered to add it
 * a second time — Reports, Monitoring, the Agent pages and Data Logs had all
 * been added and none could be granted to a custom role. Reading the catalog
 * means the modal can never fall behind it again.
 */
const PERMISSION_GROUPS = permissionGroups();

/**
 * Keys that cannot both be held: one opens the technician's Done form, the
 * other the administrator's.
 *
 * Ticking one clears the other. When a base role brings one of a pair in, the
 * other is not offered at all — a hybrid cannot un-inherit half its base.
 */
const EXCLUSIVE_PARTNER: Record<string, string> = {
  'job-order.tech-edit': 'job-order.admin-edit',
  'job-order.admin-edit': 'job-order.tech-edit',
  'service-order.tech-edit': 'service-order.admin-edit',
  'service-order.admin-edit': 'service-order.tech-edit',
};

/** No base role — the standalone custom role this modal used to only build. */
const NO_BASE = 0;

const RoleForm: React.FC<{
  formData: any;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleBaseRoleChange: (baseRoleId: number) => void;
  handlePermissionChange: (pageId: string, checked: boolean) => void;
  errors: Record<string, string>;
  baseRoleId: number;
  selectedPermissions: string[];
  inherited: Set<string>;
  inheritsEverything: boolean;
}> = ({
  formData,
  handleInputChange,
  handleBaseRoleChange,
  handlePermissionChange,
  errors,
  baseRoleId,
  selectedPermissions,
  inherited,
  inheritsEverything,
}) => {
  const { isDarkMode } = useModalTheme();

  const inputClass = (error?: string) => `w-full px-4 py-2.5 rounded-lg border transition-all duration-200 outline-none focus:ring-2 focus:ring-opacity-50
    ${isDarkMode
      ? `bg-gray-800 text-white ${error ? 'border-red-500 focus:ring-red-500/20' : 'border-gray-700 focus:ring-blue-500/20'}`
      : `bg-white text-gray-900 ${error ? 'border-red-500 focus:ring-red-500/20' : 'border-gray-200 focus:ring-blue-500/20'}`
    }`;

  const labelClass = `block text-sm font-medium mb-1.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`;

  const baseLabel = BASE_ROLE_OPTIONS.find(option => option.id === baseRoleId)?.label ?? '';

  /** Held because the base role holds it, rather than because it was ticked here. */
  const isInherited = (key: string) => inheritsEverything || inherited.has(key);

  /**
   * A key is locked when the base already grants it, or when the base grants
   * the key it is mutually exclusive with.
   */
  const isLocked = (key: string) =>
    isInherited(key) || (!!EXCLUSIVE_PARTNER[key] && isInherited(EXCLUSIVE_PARTNER[key]));

  const isChecked = (key: string) => isInherited(key) || selectedPermissions.includes(key);

  const checkboxClass = (key: string) =>
    `w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600 ${
      isLocked(key) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
    }`;

  return (
    <div className="space-y-6">
      {errors.general && (
        <div className={`p-4 border rounded-xl text-sm font-medium ${isDarkMode ? 'bg-red-900/20 border-red-800/30 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
          {errors.general}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className={labelClass}>Role Name*</label>
          <input
            name="role_name"
            value={formData.role_name}
            onChange={handleInputChange}
            className={inputClass(errors.role_name)}
            placeholder="e.g. Administrator, Agent"
          />
          {errors.role_name && <p className="text-red-500 text-xs mt-1.5 font-medium ml-1">{errors.role_name}</p>}
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleInputChange}
            className={inputClass()}
            placeholder="Briefly describe the role's responsibilities"
            rows={2}
          />
        </div>

        {/* The hybrid picker. Choosing one of the eight starts the role from
            that role's access; the ticks below then only add to it. */}
        <div>
          <label className={labelClass}>Start From a System Role</label>
          <select
            value={baseRoleId}
            onChange={(e) => handleBaseRoleChange(Number(e.target.value))}
            className={inputClass()}
          >
            <option value={NO_BASE}>None — pick every page by hand</option>
            {BASE_ROLE_OPTIONS.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
          <p className={`text-xs mt-1.5 ml-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            {baseRoleId === NO_BASE
              ? 'This role holds exactly what you tick below.'
              : inheritsEverything
                ? `Inherits everything a ${baseLabel} holds, including pages added later. There is nothing left to add.`
                : `Inherits everything a ${baseLabel} holds — shown ticked and locked below — and follows that role as it changes. Tick anything extra this role should also see.`}
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <label className={labelClass.replace('mb-1.5', '')}>Permissions</label>
            {baseRoleId !== NO_BASE && (
              <span className={`text-[11px] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                Locked ticks come from <span className="font-semibold">{baseLabel}</span>
              </span>
            )}
          </div>
          <p className={`text-xs mb-2 ml-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            View opens the page. Each action beside it is a button on that page —
            leave one unticked and it is hidden for this role.
          </p>
          <div className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className={`grid grid-cols-[minmax(0,1.4fr)_72px_minmax(0,2.2fr)] px-4 py-2 text-xs font-bold uppercase tracking-wider border-b ${isDarkMode ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
              <div>Page Name</div>
              <div className="text-center">View</div>
              <div>Actions</div>
            </div>
            <div className="max-h-[360px] overflow-y-auto divide-y divide-gray-200 dark:divide-gray-700">
              {PERMISSION_GROUPS.map((group) => (
                <React.Fragment key={group.label}>
                  {/* Section header — the same grouping the sidebar uses, so a
                      role is ticked in the shape it will be navigated in. */}
                  <div className={`px-4 py-2 text-[11px] font-bold uppercase tracking-wider ${isDarkMode ? 'bg-gray-800/60 text-gray-500' : 'bg-gray-50 text-gray-400'}`}>
                    {group.label}
                  </div>

                  {group.pages.map((pageId) => (
                    <div key={pageId} className="grid grid-cols-[minmax(0,1.4fr)_72px_minmax(0,2.2fr)] px-4 py-3 items-center transition-colors">
                      <div className={`text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <span>{labelFor(pageId)}</span>
                        {isInherited(pageId) && (
                          <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wide ${isDarkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
                            Inherited
                          </span>
                        )}
                      </div>
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={isChecked(pageId)}
                          disabled={isLocked(pageId)}
                          title={isInherited(pageId) ? `Granted by ${baseLabel}` : undefined}
                          onChange={(e) => handlePermissionChange(pageId, e.target.checked)}
                          className={checkboxClass(pageId)}
                        />
                      </div>
                      {/* Wraps: most pages now declare Add, Edit and Delete,
                          and a job order declares six. A single row of them
                          overflowed the column rather than moving to a second
                          line. */}
                      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
                        {(ACTIONS[pageId] || []).map((actionId) => (
                          <div key={actionId} className="flex flex-col items-center gap-1.5">
                            <span className={`text-[10px] font-bold uppercase tracking-tight leading-none whitespace-nowrap ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                              {labelFor(actionId)}
                            </span>
                            <input
                              type="checkbox"
                              checked={isChecked(actionId)}
                              disabled={isLocked(actionId)}
                              title={
                                isInherited(actionId)
                                  ? `Granted by ${baseLabel}`
                                  : isLocked(actionId)
                                    ? `${baseLabel} holds ${labelFor(EXCLUSIVE_PARTNER[actionId])}, which this cannot be combined with`
                                    : undefined
                              }
                              onChange={(e) => handlePermissionChange(actionId, e.target.checked)}
                              className={checkboxClass(actionId)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const RoleModal: React.FC<RoleModalProps> = ({ isOpen, onClose, onSave, role }) => {
  const isEditMode = !!role;
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [formData, setFormData] = useState({
    role_name: '',
    description: '',
  });

  /** The seeded role this one builds on, or NO_BASE for a standalone role. */
  const [baseRoleId, setBaseRoleId] = useState<number>(NO_BASE);

  /**
   * Only the keys ticked against this role.
   *
   * A hybrid's inherited keys are deliberately kept out: storing them would
   * freeze a copy of the base role at the moment of saving, which is the thing
   * hybrids exist to avoid.
   */
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);

  const inheritedKeys = useMemo(() => inheritedPermissions(baseRoleId), [baseRoleId]);
  const inheritsEverything = inheritedKeys.includes(WILDCARD);
  const inherited = useMemo(() => new Set(inheritedKeys), [inheritedKeys]);

  useEffect(() => {
    if (isOpen) {
      if (role) {
        setFormData({
          role_name: role.role_name || '',
          description: role.description || '',
        });

        setBaseRoleId(Number(role.base_role_id) || NO_BASE);

        // What the role effectively holds, which for one saved before the
        // per-action keys existed includes the buttons its pages used to carry.
        // Seeding from the stored column instead would show Add, Edit and
        // Delete unticked for a role that has them, and the save below would
        // then revoke them from a screen that never showed them.
        //
        // The server's resolved list when it sends one; otherwise the column,
        // resolved here the same way (see roleModalSeed). Either way retired
        // keys are replaced by the keys that took their place and anything the
        // catalog does not offer is left out, so a save never sends back a key
        // the server would refuse.
        setSelectedPermissions(roleModalSeed(role));
      } else {
        setFormData({
          role_name: '',
          description: '',
        });
        setBaseRoleId(NO_BASE);
        setSelectedPermissions([]);
      }
      setErrors({});
    }
  }, [isOpen, role]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  /**
   * Switching base role rewrites the extras it makes redundant or impossible.
   *
   * Anything the new base already grants stops being an extra — leaving it
   * would store a duplicate that then stops tracking the base — and anything
   * mutually exclusive with what the base grants is dropped, since the base
   * half of that pair cannot be given up.
   */
  const handleBaseRoleChange = (nextBaseRoleId: number) => {
    setBaseRoleId(nextBaseRoleId);

    const nextInherited = inheritedPermissions(nextBaseRoleId);

    if (nextInherited.includes(WILDCARD)) {
      setSelectedPermissions([]);
      return;
    }

    const held = new Set(nextInherited);
    setSelectedPermissions(prev =>
      prev.filter(key => !held.has(key) && !(EXCLUSIVE_PARTNER[key] && held.has(EXCLUSIVE_PARTNER[key])))
    );
  };

  const handlePermissionChange = (pageId: string, checked: boolean) => {
    setSelectedPermissions(prev => {
      let newPermissions = [...prev];

      if (checked) {
        if (!newPermissions.includes(pageId)) {
          newPermissions.push(pageId);
        }

        // If it's a sub-permission, auto-check the parent — unless the base role
        // already grants it, in which case there is nothing to add.
        if (pageId.includes('.')) {
          const parentId = pageId.split('.')[0];
          if (!newPermissions.includes(parentId) && !inherited.has(parentId)) {
            newPermissions.push(parentId);
          }
        }

        // The tech-edit / admin-edit pairs are mutually exclusive. The partner
        // can only be cleared here when it is an extra; an inherited one is
        // never offered, so this cannot leave the pair both ticked.
        const partner = EXCLUSIVE_PARTNER[pageId];
        if (partner) {
          newPermissions = newPermissions.filter(id => id !== partner);
        }
      } else {
        newPermissions = newPermissions.filter(id => id !== pageId);

        // If it's a parent, auto-uncheck all sub-permissions
        if (!pageId.includes('.')) {
          newPermissions = newPermissions.filter(id => !id.startsWith(pageId + '.'));
        }
      }

      return newPermissions;
    });
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.role_name.trim()) newErrors.role_name = 'Required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);

    try {
      // Extras only. The server merges these with the base role's keys on
      // every read, so an inherited key sent back here would only go stale.
      // Catalog keys only: nothing else can be ticked, but a seed from an
      // older server could still carry one.
      const ownKeys = inheritsEverything
        ? []
        : knownKeysOnly(selectedPermissions.filter(key => !inherited.has(key)));

      const payload = {
        role_name: formData.role_name,
        description: formData.description,
        base_role_id: baseRoleId === NO_BASE ? null : baseRoleId,
        permissions: ownKeys,
      };

      const authData = localStorage.getItem('authData');
      const currentUser = authData ? JSON.parse(authData) : null;
      if (currentUser?.organization_id) {
        (payload as any).organization_id = currentUser.organization_id;
      }

      let response: ApiResponse<Role>;
      if (isEditMode && role) {
        response = await roleService.updateRole(role.id, payload as any);
      } else {
        response = await roleService.createRole(payload as any);
      }

      if (response.success && response.data) {
        // Saved from this modal, the ticks are now authoritative. A server
        // that does not echo the resolved list back would leave the row
        // looking unsaved-by-this-modal, and reopening it would seed from the
        // raw column as if it were a legacy row, so the list just saved (and
        // the version it was saved under) is filled in here.
        const saved: Role = {
          ...response.data,
          effective_permissions: Array.isArray(response.data.effective_permissions)
            ? response.data.effective_permissions
            : withImpliedPages(ownKeys).filter(key => !inherited.has(key)),
          permissions_version: response.data.permissions_version ?? CURRENT_VERSION,
        };
        onSave(saved);
        onClose();
      } else {
        setErrors({ general: response.message || 'Something went wrong' });
      }
    } catch (error: any) {
      // Prefer what the server said over axios's "Request failed with status
      // code 500", which names the status and nothing about the cause. A 422
      // body carries the per-field messages; a 500 carries the exception.
      const body = error?.response?.data;
      const fieldErrors: string[] = body?.errors
        ? Object.values(body.errors as Record<string, string[]>).flat()
        : [];
      const detail = [body?.message, ...fieldErrors, body?.error]
        .filter(Boolean)
        .join(' — ');

      setErrors({ general: detail || error.message || 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalUITemplate
      isOpen={isOpen}
      onClose={onClose}
      title={isEditMode ? 'Edit Role' : 'Add New Role'}
      loading={loading}
      maxWidth="max-w-4xl"
      primaryAction={{
        label: isEditMode ? 'Update' : 'Save',
        onClick: handleSave,
        disabled: loading
      }}
    >
      <RoleForm
        formData={formData}
        handleInputChange={handleInputChange}
        handleBaseRoleChange={handleBaseRoleChange}
        handlePermissionChange={handlePermissionChange}
        errors={errors}
        baseRoleId={baseRoleId}
        selectedPermissions={selectedPermissions}
        inherited={inherited}
        inheritsEverything={inheritsEverything}
      />
    </ModalUITemplate>
  );
};

export default RoleModal;
