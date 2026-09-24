import React from 'react';
import { View, Text, Pressable } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

/**
 * What a user sees when they reach a section their role does not hold.
 *
 * The tab bar does not list what the role cannot open, so reaching this is a
 * wrong turn rather than an error, and it offers the way back to the screen the
 * role does land on.
 */
interface AccessDeniedProps {
  /** The section that was refused, shown so a support call has something to quote. */
  section?: string;
  /** Send the user to the landing screen their role does have. */
  onGoHome?: () => void;
}

const AccessDenied: React.FC<AccessDeniedProps> = ({ section, onGoHome }) => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: '#f9fafb' }}>
    <View style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 20, backgroundColor: '#fffbeb' }}>
      <MaterialCommunityIcons name="shield-alert-outline" size={30} color="#f59e0b" />
    </View>

    <Text style={{ fontSize: 16, fontWeight: '600', color: '#1f2937', marginBottom: 8, textAlign: 'center' }}>
      You do not have access to this page
    </Text>

    <Text style={{ fontSize: 14, color: '#6b7280', textAlign: 'center' }}>
      Your role does not include {section ? section : 'this section'}. If you think it
      should, ask an administrator to update your role.
    </Text>

    {onGoHome && (
      <Pressable
        onPress={onGoHome}
        style={{ marginTop: 24, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb' }}
      >
        <Text style={{ fontSize: 14, fontWeight: '500', color: '#374151' }}>Back to my dashboard</Text>
      </Pressable>
    )}
  </View>
);

export default AccessDenied;
