import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import apiClient from '../config/api';

const DatabaseTest: React.FC = () => {
  const isDarkMode = false;
  const [testResult, setTestResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const { width } = Dimensions.get('window');
  const isTablet = width >= 768;

  const runTest = async () => {
    setLoading(true);
    try {
      console.log('Testing database connection...');
      const response = await apiClient.get('/debug/organizations');
      console.log('Test response:', response.data);
      setTestResult(response.data);
    } catch (error: any) {
      console.error('Test failed:', error);
      setTestResult({
        success: false,
        error: error.message,
        details: error.response?.data,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f9fafb' }}
      contentContainerStyle={{
        padding: 16,
        paddingTop: isTablet ? 16 : 60,
      }}
    >
      <View
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#e5e7eb',
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 20,
            fontWeight: '700',
            color: '#111827',
            marginBottom: 16,
          }}
        >
          Database Connection Test
        </Text>

        <TouchableOpacity
          onPress={runTest}
          disabled={loading}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 24,
            paddingVertical: 12,
            backgroundColor: loading ? '#93c5fd' : '#2563eb',
            borderRadius: 8,
            alignSelf: 'flex-start',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
          ) : null}
          <Text style={{ color: '#ffffff', fontWeight: '600', fontSize: 15 }}>
            {loading ? 'Testing...' : 'Run Database Test'}
          </Text>
        </TouchableOpacity>

        {testResult !== null && (
          <View style={{ marginTop: 24 }}>
            <Text
              style={{
                fontSize: 16,
                fontWeight: '600',
                color: '#111827',
                marginBottom: 8,
              }}
            >
              Test Results:
            </Text>
            <ScrollView
              horizontal
              style={{
                backgroundColor: '#1f2937',
                borderRadius: 8,
                maxHeight: 320,
              }}
              contentContainerStyle={{ padding: 16 }}
            >
              <Text
                style={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: '#f9fafb',
                }}
              >
                {JSON.stringify(testResult, null, 2)}
              </Text>
            </ScrollView>
          </View>
        )}
      </View>
    </ScrollView>
  );
};

export default DatabaseTest;
