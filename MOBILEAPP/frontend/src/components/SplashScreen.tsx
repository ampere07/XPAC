import React from 'react';
import { View, Image, Text, ActivityIndicator } from 'react-native';
import logo2 from '../assets/applogo.png';

const SplashScreen: React.FC = () => {
  return (
    <View style={{
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#ffffff',
    }}>
      <View style={{
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20
      }}>
        <Image
          source={logo2}
          style={{
            height: 80,
            width: 80, // Added width explicitly as it's often needed in RN
            marginBottom: 10,
            resizeMode: 'contain'
          }}
        />
        <ActivityIndicator size="large" color="#b12424ff" />
        <Text style={{
          color: '#1a1a1a',
          fontSize: 18,
          fontWeight: '600'
        }}>Loading...</Text>
      </View>
    </View>
  );
};

export default SplashScreen;
