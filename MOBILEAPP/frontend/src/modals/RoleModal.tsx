import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, ScrollView, Switch } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Role, ApiResponse } from '../types/api';
import { roleService } from '../services/userService';
import ModalUITemplate, { useModalTheme } from './ui-modal/ModalUITemplate';
import {
  ACTIONS,
  ALL_PERMISSIONS,
  BASE_ROLE_OPTIONS,
  EXCLUSIVE_PAIRS,
  WILDCARD,
  inheritedPermissions,
  labelFor,
  parsePermissions,
  permissionGroups,
} from '../config/permissions';

interface RoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (role: Role) => void;
  role?: Role | null;
}

/**
 * Pages and their sub actions come from config/permissions.ts, so a page added
 * to the catalog is grantable here without a second edit.
 */
const PERMISSION_GROUPS = permissionGroups();

/**
 * Keys that cannot both be held: one opens the technician's Done form, the
 * other the administrator's. Ticking one clears the other; when a base role
 * brings one in, the other is not offered at all.
 */
/**
 * Keys the server accepts (RoleController validates `permissions.*` against
 * the catalog). A legacy row can still hold keys that are no longer offered;
 * they grant nothing here, but sending them back would fail the whole save
 * with a 422, so an old role could not even be renamed.
 */
const KNOWN_KEYS = new Set<string>(ALL_PERMISSIONS);

/**
 * Retired keys and what replaced them (Permissions::RETIRED_ACTIONS). The
 * server already expands them in `effective_permissions`; this covers the
 * fallback to the raw column, so a retired key becomes its CRUD triple rather
 * than being dropped as unknown.
 */
const RETIRED_KEYS: Record<string, string[]> = {
  'ports.manage': ['ports.create', 'ports.edit', 'ports.delete'],
  'router-models.manage': ['router-models.create', 'router-models.edit', 'router-models.delete'],
  'status-remarks-list.manage': ['status-remarks-list.create', 'status-remarks-list.edit', 'status-remarks-list.delete'],
};

const expandRetired = (keys: string[]): string[] =>
  Array.from(new Set(keys.flatMap(key => RETIRED_KEYS[key] ?? [key])));

const EXCLUSIVE_PARTNER: Record<string, string> = EXCLUSIVE_PAIRS.reduce<Record<string, string>>(
  (map, [a, b]) => ({ ...map, [a]: b, [b]: a }),
  {}
);

/** No base role: a standalone custom role. */
const NO_BASE = 0;

const RoleForm: React.FC<{
  formData: { role_name: string; description: string };
  handleFieldChange: (name: string, value: string) => void;
  handleBaseRoleChange: (baseRoleId: number) => void;
  handlePermissionChange: (key: string, checked: boolean) => void;
  errors: Record<string, string>;
  baseRoleId: number;
  selectedPermissions: string[];
  inherited: Set<string>;
  inheritsEverything: boolean;
  primaryColor: string;
}> = ({
  formData,
  handleFieldChange,
  handleBaseRoleChange,
  handlePermissionChange,
  errors,
  baseRoleId,
  selectedPermissions,
  inherited,
  inheritsEverything,
  primaryColor,
}) => {
  const labelStyle = { fontSize: 13, fontWeight: '500' as const, marginBottom: 6, color: '#6b7280' };
  const helpStyle = { fontSize: 12, color: '#9ca3af', marginTop: 6 };
  const inputStyle = (error?: string) => ({
    width: '100%' as const,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: error ? '#ef4444' : '#e5e7eb',
    backgroundColor: '#ffffff',
    color: '#111827',
    fontSize: 14,
  });

  const baseLabel = BASE_ROLE_OPTIONS.find(option => option.id === baseRoleId)?.label ?? '';

  /** Held because the base role holds it, rather than because it was ticked here. */
  const isInherited = (key: string) => inheritsEverything || inherited.has(key);

  /** Locked when the base grants it, or grants the key it is exclusive with. */
  const isLocked = (key: string) =>
    isInherited(key) || (!!EXCLUSIVE_PARTNER[key] && isInherited(EXCLUSIVE_PARTNER[key]));

  const isChecked = (key: string) => isInherited(key) || selectedPermissions.includes(key);

  const InheritedBadge = () => (
    <View style={{ marginLeft: 6, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: '#ede9fe' }}>
      <Text style={{ fontSize: 10, fontWeight: '600', color: '#7c3aed' }}>Inherited</Text>
    </View>
  );

  const renderSwitch = (key: string) => (
    <Switch
      value={isChecked(key)}
      disabled={isLocked(key)}
      onValueChange={(val) => handlePermissionChange(key, val)}
      trackColor={{ true: primaryColor, false: '#d1d5db' }}
      thumbColor="#ffffff"
      style={isLocked(key) ? { opacity: 0.6 } : undefined}
    />
  );

  return (
    <View style={{ gap: 20 }}>
      {errors.general ? (
        <View style={{ padding: 14, borderWidth: 1, borderRadius: 12, backgroundColor: '#fef2f2', borderColor: '#fecaca' }}>
          <Text style={{ fontSize: 14, fontWeight: '500', color: '#dc2626' }}>{errors.general}</Text>
        </View>
      ) : null}

      <View>
        <Text style={labelStyle}>Role Name*</Text>
        <TextInput
          value={formData.role_name}
          onChangeText={(v) => handleFieldChange('role_name', v)}
          style={inputStyle(errors.role_name)}
          placeholder="e.g. Administrator, Agent"
          placeholderTextColor="#9ca3af"
        />
        {errors.role_name ? (
          <Text style={{ color: '#ef4444', fontSize: 12, marginTop: 6, marginLeft: 4, fontWeight: '500' }}>
            {errors.role_name}
          </Text>
        ) : null}
      </View>

      <View>
        <Text style={labelStyle}>Description</Text>
        <TextInput
          value={formData.description}
          onChangeText={(v) => handleFieldChange('description', v)}
          style={[inputStyle(), { minHeight: 64, textAlignVertical: 'top' }]}
          placeholder="Briefly describe the role's responsibilities"
          placeholderTextColor="#9ca3af"
          multiline
        />
      </View>

      {/* The hybrid picker. Choosing one of the eight starts the role from that
          role's access; the switches below then only add to it. */}
      <View>
        <Text style={labelStyle}>Start From a System Role</Text>
        <View style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, overflow: 'hidden', backgroundColor: '#ffffff' }}>
          <Picker
            selectedValue={baseRoleId}
            onValueChange={(v) => handleBaseRoleChange(Number(v))}
            style={{ color: '#111827' }}
            dropdownIconColor="#6b7280"
          >
            <Picker.Item label="None — pick every page by hand" value={NO_BASE} />
            {BASE_ROLE_OPTIONS.map(option => (
              <Picker.Item key={option.id} label={option.label} value={option.id} />
            ))}
          </Picker>
        </View>
        <Text style={helpStyle}>
          {baseRoleId === NO_BASE
            ? 'This role holds exactly what you switch on below.'
            : inheritsEverything
              ? `Inherits everything a ${baseLabel} holds, including pages added later. There is nothing left to add.`
              : `Inherits everything a ${baseLabel} holds (shown on and locked below) and follows that role as it changes. Switch on anything extra this role should also see.`}
        </Text>
      </View>

      <View>
        <Text style={labelStyle}>Permissions</Text>
        <Text style={[helpStyle, { marginTop: 0, marginBottom: 8 }]}>
          View opens the page. Each action under it is a button on that page; leave one off and it is hidden for this role.
        </Text>
        <View style={{ borderWidth: 1, borderRadius: 8, borderColor: '#e5e7eb', overflow: 'hidden' }}>
          <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
            {PERMISSION_GROUPS.map((group) => (
              <View key={group.label}>
                {/* The same grouping the navigation uses. */}
                <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#f3f4f6' }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {group.label}
                  </Text>
                </View>
                {group.pages.map((pageId) => {
                  const actions = ACTIONS[pageId] || [];
                  return (
                    <View key={pageId} style={{ borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingHorizontal: 14, paddingVertical: 10 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: 14, color: '#374151' }}>{labelFor(pageId)}</Text>
                          {isInherited(pageId) && <InheritedBadge />}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontSize: 11, color: '#9ca3af', marginRight: 4 }}>View</Text>
                          {renderSwitch(pageId)}
                        </View>
                      </View>
                      {actions.length > 0 ? (
                        <View style={{ marginTop: 8, paddingLeft: 12, gap: 6 }}>
                          {actions.map((actionId) => (
                            <View key={actionId} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                <Text style={{ fontSize: 12, color: '#6b7280' }}>{labelFor(actionId)}</Text>
                                {isInherited(actionId) && <InheritedBadge />}
                                {!isInherited(actionId) && isLocked(actionId) ? (
                                  <Text style={{ fontSize: 10, color: '#9ca3af', marginLeft: 6 }} numberOfLines={1}>
                                    {`${baseLabel} holds ${labelFor(EXCLUSIVE_PARTNER[actionId])}`}
                                  </Text>
                                ) : null}
                              </View>
                              {renderSwitch(actionId)}
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </View>
  );
};

const RoleModal: React.FC<RoleModalProps> = ({ isOpen, onClose, onSave, role }) => {
  const { colorPalette } = useModalTheme();
  const primaryColor = colorPalette?.primary || '#7c3aed';
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
   * Only the keys switched on against this role. A hybrid's inherited keys are
   * kept out: storing them would freeze a copy of the base role.
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

        // What the role effectively holds. For a role saved before per-action
        // keys existed that includes the buttons its pages used to carry;
        // seeding from the stored column instead would show them off, and the
        // save would then revoke them. Falls back to the column when the
        // server did not send the resolved list.
        setSelectedPermissions(expandRetired(
          Array.isArray(role.effective_permissions)
            ? role.effective_permissions
            : parsePermissions(role.permissions)
        ));
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

  const handleFieldChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  /**
   * Switching base role drops the extras it makes redundant (the new base
   * already grants them) or impossible (exclusive with what the base grants).
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

  const handlePermissionChange = (key: string, checked: boolean) => {
    setSelectedPermissions((prev) => {
      let next = [...prev];

      if (checked) {
        if (!next.includes(key)) {
          next.push(key);
        }

        // An action switches its page on too, unless the base already grants it.
        if (key.includes('.')) {
          const parentId = key.split('.')[0];
          if (!next.includes(parentId) && !inherited.has(parentId)) {
            next.push(parentId);
          }
        }

        // The tech-edit / admin-edit pairs are mutually exclusive.
        const partner = EXCLUSIVE_PARTNER[key];
        if (partner) {
          next = next.filter((id) => id !== partner);
        }
      } else {
        next = next.filter((id) => id !== key);

        // Switching a page off switches its actions off.
        if (!key.includes('.')) {
          next = next.filter((id) => !id.startsWith(key + '.'));
        }
      }

      return next;
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
      const payload: any = {
        role_name: formData.role_name,
        description: formData.description,
        base_role_id: baseRoleId === NO_BASE ? null : baseRoleId,
        // Extras only. The server merges these with the base role's keys on
        // every read.
        permissions: inheritsEverything
          ? []
          : selectedPermissions.filter((key) => !inherited.has(key) && KNOWN_KEYS.has(key)),
      };

      try {
        const authData = await AsyncStorage.getItem('authData');
        const currentUser = authData ? JSON.parse(authData) : null;
        if (currentUser?.organization_id) {
          payload.organization_id = currentUser.organization_id;
        }
      } catch (e) {
        // ignore auth parse errors
      }

      let response: ApiResponse<Role>;
      if (isEditMode && role) {
        response = await roleService.updateRole(role.id, payload);
      } else {
        response = await roleService.createRole(payload);
      }

      if (response.success && response.data) {
        onSave(response.data);
        onClose();
      } else {
        setErrors({ general: response.message || 'Something went wrong' });
      }
    } catch (error: any) {
      // Prefer what the server said: a 422 body carries per-field messages.
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
        disabled: loading,
      }}
    >
      <RoleForm
        formData={formData}
        handleFieldChange={handleFieldChange}
        handleBaseRoleChange={handleBaseRoleChange}
        handlePermissionChange={handlePermissionChange}
        errors={errors}
        baseRoleId={baseRoleId}
        selectedPermissions={selectedPermissions}
        inherited={inherited}
        inheritsEverything={inheritsEverything}
        primaryColor={primaryColor}
      />
    </ModalUITemplate>
  );
};

export default RoleModal;
