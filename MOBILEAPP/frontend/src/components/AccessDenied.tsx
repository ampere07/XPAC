import React from 'react';
import { View, Text, Pressable } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

/**
 * What a user sees when they reach a section their role does not hold.
 *
 * Reaching this is not a normal outcome — the tab bar does not list what the
 * role cannot open — so it is worded as a wrong turn rather than as an error,
 * and it offers the way back to the screen the role does land on.
 */
interface AccessDeniedProps {
  /** The section that was refused, shown so a support call has something to quote. */
  section?: string;
  /** Send the user to the landing screen their role does have. */
  onGoHome?: () => void;
}

const AccessDenied: React.FC<AccessDeniedProps> = ({ section, onGoHome }) => (
  <View className="flex-1 items-center justify-center px-8 bg-gray-50">
    <View className="w-16 h-16 rounded-full items-center justify-center mb-5 bg-amber-50">
      <MaterialCommunityIcons name="shield-alert-outline" size={30} color="#f59e0b" />
    </View>

    <Text className="text-base font-semibold text-gray-800 mb-2 text-center">
      You do not have access to this page
    </Text>

    <Text className="text-sm text-gray-500 text-center">
      Your role does not include {section ? section : 'this section'}. If you think it
      should, ask an administrator to update your role.
    </Text>

    {onGoHome && (
      <Pressable
        onPress={onGoHome}
        className="mt-6 px-4 py-2 rounded-lg bg-white border border-gray-200"
      >
        <Text className="text-sm font-medium text-gray-700">Back to my dashboard</Text>
      </Pressable>
    )}
  </View>
);

export default AccessDenied;
