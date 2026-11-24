import { useMemo } from 'react';
import { PanResponder } from 'react-native';
import { useRouter } from 'expo-router';

export type TabName = 'home' | 'trips' | 'profile';

export interface SwipeTabOptions {
  ignoreTopArea?: boolean;
  topBoundary?: number;
}

export function useSwipeTab(currentTab: TabName, options?: SwipeTabOptions) {
  const router = useRouter();

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          // If specified, do not capture touches in the top header/segmented control region
          if (options?.ignoreTopArea && evt.nativeEvent.pageY < (options.topBoundary ?? 180)) {
            return false;
          }
          const dx = Math.abs(gestureState.dx);
          const dy = Math.abs(gestureState.dy);
          // Only claim if horizontal movement is dominant and exceeds threshold
          return dx > 25 && dx > dy * 2.0;
        },
        onPanResponderRelease: (_, gestureState) => {
          const dx = gestureState.dx;
          const dy = Math.abs(gestureState.dy);
          // Require at least 40px horizontal travel and dominant over vertical
          if (Math.abs(dx) < 40 || Math.abs(dx) < dy * 1.5) return;

          if (currentTab === 'home') {
            // Swipe from Home -> navigate to Trips
            router.replace('/(tabs)/trips');
          } else if (currentTab === 'profile') {
            // Swipe from Profile -> navigate to Trips
            router.replace('/(tabs)/trips');
          } else if (currentTab === 'trips') {
            if (dx > 0) {
              // Swiping towards right -> Home
              router.replace('/(tabs)');
            } else {
              // Swiping towards left -> Profile
              router.replace('/(tabs)/profile');
            }
          }
        },
      }),
    [currentTab, router, options?.ignoreTopArea, options?.topBoundary]
  );

  return panResponder.panHandlers;
}
