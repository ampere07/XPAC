import React, { useEffect, useState } from 'react';
import { View, Image, Text, ActivityIndicator, DeviceEventEmitter } from 'react-native';
import logo2 from '../assets/applogo.png';
import { settingsColorPaletteService, ColorPalette } from '../services/settingsColorPaletteService';

/**
 * Brand green, shown until the active palette resolves. The splash renders during app boot, so
 * on a cold start this fallback is what the user actually sees first — it deliberately differs
 * from the '#ef4444' fallback the logged-in screens use, which is what made the spinner red.
 */
const FALLBACK_PRIMARY = '#77c254';

/**
 * applogo.png is a 2048x2048 opaque white square whose artwork only fills the middle
 * ~65% x 44% of the canvas. With resizeMode 'contain' the box is sized off the square, not the
 * artwork, so the mark renders at roughly 65% x 44% of these numbers. The white padding is
 * invisible against the white background, so a generous box is safe.
 */
const LOGO_BOX = 240;

const SplashScreen: React.FC = () => {
  // Seeded synchronously from the in-memory cache so a warm start never flashes the fallback.
  const [colorPalette, setColorPalette] = useState<ColorPalette | null>(
    () => settingsColorPaletteService.getActiveSync()
  );

  useEffect(() => {
    let active = true;

    // Cold start: getActive() hydrates from AsyncStorage before hitting the API, so an offline
    // launch still picks up the last known palette. Failures are swallowed — the splash must
    // never block on this, it just keeps the fallback.
    settingsColorPaletteService
      .getActive()
      .then((palette) => {
        if (active && palette) setColorPalette(palette);
      })
      .catch(() => undefined);

    const subscription = DeviceEventEmitter.addListener('colorPaletteChanged', (newPalette) => {
      if (active) setColorPalette(newPalette);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const primaryColor = colorPalette?.primary || FALLBACK_PRIMARY;

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
            height: LOGO_BOX,
            width: LOGO_BOX, // Added width explicitly as it's often needed in RN
            marginBottom: 10,
            resizeMode: 'contain'
          }}
        />
        <ActivityIndicator size="large" color={primaryColor} />
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
