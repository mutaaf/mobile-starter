import { ArchivoBlack_400Regular } from '@expo-google-fonts/archivo-black';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_700Bold,
} from '@expo-google-fonts/ibm-plex-mono';
import { useFonts } from 'expo-font';
import { Tabs } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ConsoleTabBar } from '@/components/console-tab-bar';
import { Starfield } from '@/components/starfield';
import { Palette } from '@/constants/theme';
import { DevTools } from '@/devtools/dev-tools';
import { CacheProvider } from '@/lib/cache/provider';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    ArchivoBlack_400Regular,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_700Bold,
  });

  useEffect(() => {
    // Hide on error too, otherwise a font failure leaves the splash up forever.
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: Palette.void }}>
      <CacheProvider>
        <StatusBar style="light" />
        {/* Behind the navigator, so it persists across tab changes rather than
            remounting and restarting every star's timeline. */}
        <Starfield />
        <Tabs
          tabBar={(props) => <ConsoleTabBar {...props} />}
          screenOptions={{
            headerShown: false,
            // Transparent so the starfield shows through the screens.
            sceneStyle: { backgroundColor: 'transparent' },
          }}>
          <Tabs.Screen name="index" options={{ title: 'Orbit' }} />
          <Tabs.Screen name="seismic" options={{ title: 'Seismic' }} />
          <Tabs.Screen name="aurora" options={{ title: 'Aurora' }} />
          <Tabs.Screen name="launch" options={{ title: 'Launch' }} />
          <Tabs.Screen name="motion" options={{ title: 'Motion' }} />
          <Tabs.Screen name="brief" options={{ title: 'Brief' }} />
          {/* Full-screen AR view, reached from Orbit and Aurora. href:null keeps
              it out of the tab bar without giving up expo-router's file route. */}
          <Tabs.Screen name="sky" options={{ href: null }} />
        </Tabs>
        <DevTools />
      </CacheProvider>
    </GestureHandlerRootView>
  );
}
