import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * When this value changes, the boundary automatically clears any captured
   * error and re-renders its children. Pass the active route/section so that
   * navigating away from a crashed page recovers it.
   */
  resetKey?: string | number;
  /** Optional label shown in the fallback (e.g. the page name). */
  sectionName?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render/runtime errors thrown by any descendant so a single broken
 * page shows a recovery screen instead of white-screening the whole app.
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep a breadcrumb in the JS logs / crash reporting pipeline.
    console.error('[ErrorBoundary] Caught render error:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Auto-recover when the caller navigates to a different section.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }

      return (
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            backgroundColor: '#f9fafb',
          }}
        >
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: '#fee2e2',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <MaterialCommunityIcons name="alert-circle-outline" size={40} color="#dc2626" />
          </View>

          <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' }}>
            Something went wrong
          </Text>
          <Text
            style={{
              fontSize: 14,
              color: '#6b7280',
              textAlign: 'center',
              marginTop: 8,
              maxWidth: 320,
              lineHeight: 20,
            }}
          >
            {this.props.sectionName
              ? `The "${this.props.sectionName}" screen ran into a problem.`
              : 'This screen ran into a problem.'}{' '}
            You can try again or switch to another screen.
          </Text>

          <Pressable
            onPress={this.reset}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              backgroundColor: '#dc2626',
              paddingHorizontal: 24,
              paddingVertical: 12,
              borderRadius: 10,
              marginTop: 24,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <MaterialCommunityIcons name="refresh" size={18} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>Try again</Text>
          </Pressable>

          {__DEV__ && (
            <ScrollView
              style={{
                marginTop: 20,
                maxHeight: 160,
                alignSelf: 'stretch',
                backgroundColor: '#111827',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <Text style={{ color: '#f87171', fontSize: 12, fontFamily: 'monospace' }}>
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </Text>
            </ScrollView>
          )}
        </View>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
