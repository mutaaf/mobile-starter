import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

/**
 * Staggered entrance, skipped entirely when the OS asks for reduced motion.
 *
 * This is not just politeness. Leaving `entering` attached under reduced motion
 * left screens hidden after a tab change — the app looked like navigation was
 * broken for anyone with "remove animations" enabled, and it broke E2E runs on
 * devices configured that way. Passing `undefined` renders the view normally.
 */
export function Reveal({
  children,
  delay = 0,
  duration = 380,
  style,
  testID,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <Animated.View
      entering={reduced ? undefined : FadeInDown.delay(delay).duration(duration)}
      style={style}
      testID={testID}>
      {children}
    </Animated.View>
  );
}
