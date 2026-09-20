declare module 'react-native-safe-area-context' {
  import * as React from 'react';

  export interface SafeAreaInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
  }

  export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface SafeAreaProviderProps {
    children?: React.ReactNode;
    initialSafeAreaInsets?: SafeAreaInsets;
  }

  export interface SafeAreaViewProps {
    children?: React.ReactNode;
    style?: any;
    edges?: Array<'top' | 'right' | 'bottom' | 'left' | 'all'>;
  }

  export interface SafeAreaViewStatic {
    (props: SafeAreaViewProps): React.ReactElement;
  }

  export const SafeAreaProvider: React.FC<SafeAreaProviderProps>;
  export const SafeAreaView: SafeAreaViewStatic;
  export const useSafeAreaInsets: () => SafeAreaInsets;
  export const useSafeAreaFrame: () => Rect;
}
