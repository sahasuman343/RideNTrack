import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Camera } from '@rnmapbox/maps';
import type { Ride, roadReportFeatures } from '@ridentrack/shared';
import type { RidePalette } from '../../theme';
import type { RideStyles } from './rideStyles';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';
let Mapbox: typeof import('@rnmapbox/maps').default | null = null;
if (MAPBOX_TOKEN) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Mapbox = require('@rnmapbox/maps').default;
    Mapbox?.setAccessToken(MAPBOX_TOKEN);
  } catch {
    /* Native maps are unavailable in Expo Go; the rider panel still works. */
  }
}

export const mapAvailable = Boolean(Mapbox && MAPBOX_TOKEN);

export type RiderFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: number[] };
    properties: { name: string; mine: boolean; stale: boolean; status: string; /** "4 min ago" / "In dead zone"; empty while live. */ age: string };
  }>;
};

type Coords = [number, number] | number[] | null | undefined;

const validPair = (c: Coords): c is [number, number] =>
  Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && Number.isFinite(c[0]) && Number.isFinite(c[1]);

/*
 * Each layer group is its own memoised component, so a GPS tick that only
 * moves rider dots does not rebuild the route, trail or endpoint layers.
 */
const RouteLayer = memo(function RouteLayer({ route }: { route: NonNullable<Ride['route_geometry']> }) {
  if (!Mapbox) return null;
  return (
    <Mapbox.ShapeSource id="route" shape={route}>
      <Mapbox.LineLayer id="route-edge" style={{ lineColor: '#000', lineWidth: 8, lineCap: 'round', lineJoin: 'round' }} />
      <Mapbox.LineLayer id="route-line" style={{ lineColor: '#de7136', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }} />
    </Mapbox.ShapeSource>
  );
});

const TrailLayer = memo(function TrailLayer({ trail }: { trail: GeoJSON.Feature | GeoJSON.FeatureCollection }) {
  if (!Mapbox) return null;
  return (
    <Mapbox.ShapeSource id="actual-trail" shape={trail}>
      <Mapbox.LineLayer id="actual-trail-edge" style={{ lineColor: '#003824', lineWidth: 6, lineCap: 'round', lineJoin: 'round', lineOpacity: 0.75 }} />
      <Mapbox.LineLayer id="actual-trail-line" style={{ lineColor: '#38bdf8', lineWidth: 3, lineCap: 'round', lineJoin: 'round' }} />
    </Mapbox.ShapeSource>
  );
});

const EndpointsLayer = memo(function EndpointsLayer({ origin, destination, surface }: { origin: Coords; destination: Coords; surface: string }) {
  const shape = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: [origin, destination]
      .map((c, i) => (validPair(c) ? { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: c }, properties: { label: i === 0 ? 'A' : 'B' } } : null))
      .filter((f): f is NonNullable<typeof f> => f !== null),
  }), [origin, destination]);
  if (!Mapbox) return null;
  return (
    <Mapbox.ShapeSource id="endpoints" shape={shape}>
      <Mapbox.CircleLayer id="endpoint-dot" style={{ circleColor: '#213e44', circleRadius: 13, circleStrokeWidth: 3, circleStrokeColor: surface }} />
      <Mapbox.SymbolLayer id="endpoint-label" style={{ textField: ['coalesce', ['to-string', ['get', 'label']], ''], textSize: 12, textColor: '#fff' }} />
    </Mapbox.ShapeSource>
  );
});

const RidersLayer = memo(function RidersLayer({ features, theme }: { features: RiderFeatureCollection; theme: RidePalette }) {
  if (!Mapbox) return null;
  return (
    <Mapbox.ShapeSource id="riders" shape={features}>
      <Mapbox.CircleLayer id="rider-halo" style={{ circleRadius: 18, circleColor: theme.accent, circleOpacity: 0.22 }} />
      <Mapbox.CircleLayer
        id="rider-dot"
        style={{
          circleRadius: 8,
          circleColor: [
            'case',
            ['==', ['get', 'mine'], true], theme.accent,
            ['==', ['get', 'status'], 'disconnected'], theme.subtle,
            ['==', ['get', 'status'], 'stopped'], '#EAB308',
            theme.green,
          ],
          // Riders not heard from recently fade instead of vanishing.
          circleOpacity: ['case', ['==', ['get', 'stale'], true], 0.55, 1],
          circleStrokeWidth: 3,
          circleStrokeColor: '#fff',
        }}
      />
      <Mapbox.SymbolLayer
        id="rider-label"
        style={{
          // Old positions say how old they are, right under the name.
          textField: [
            'case',
            ['>', ['length', ['coalesce', ['get', 'age'], '']], 0],
            ['concat', ['coalesce', ['to-string', ['get', 'name']], 'Rider'], '\n', ['get', 'age']],
            ['coalesce', ['to-string', ['get', 'name']], 'Rider'],
          ],
          textOffset: [0, 1.8],
          textSize: 12,
          textColor: theme.text,
          textHaloColor: theme.surface,
          textHaloWidth: 2,
        }}
      />
    </Mapbox.ShapeSource>
  );
});

export type RoadReportFeatureCollection = ReturnType<typeof roadReportFeatures>;

/** F11: rider road reports. Severe ones (landslide, closure) are red, others amber; pending ones are hollow. */
const RoadReportsLayer = memo(function RoadReportsLayer({ features, theme, onPress }: { features: RoadReportFeatureCollection; theme: RidePalette; onPress?: (id: string) => void }) {
  if (!Mapbox || !features.features.length) return null;
  return (
    <Mapbox.ShapeSource
      id="road-reports"
      shape={features}
      onPress={e => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id && onPress) onPress(id);
      }}
    >
      <Mapbox.CircleLayer
        id="road-report-dot"
        style={{
          circleRadius: 9,
          circleColor: ['case', ['==', ['get', 'severe'], true], theme.danger, theme.warning],
          circleOpacity: ['case', ['==', ['get', 'pending'], true], 0.25, 0.95],
          circleStrokeWidth: 2.5,
          circleStrokeColor: ['case', ['==', ['get', 'pending'], true], ['case', ['==', ['get', 'severe'], true], theme.danger, theme.warning], '#fff'],
        }}
      />
      <Mapbox.SymbolLayer
        id="road-report-label"
        minZoomLevel={11}
        style={{
          textField: ['get', 'label'],
          textOffset: [0, 1.5],
          textSize: 11,
          textColor: theme.text,
          textHaloColor: theme.surface,
          textHaloWidth: 2,
        }}
      />
    </Mapbox.ShapeSource>
  );
});

export interface RideMapProps {
  /** F11: road reports along the ride. */
  roadReports?: RoadReportFeatureCollection;
  onRoadReportPress?: (id: string) => void;
  /** F5: offline packs are saved in outdoors-v12, so use it with no signal. */
  offline?: boolean;
  s: RideStyles;
  theme: RidePalette;
  mapRetry: number;
  sheetHeight: number;
  cameraRef: React.RefObject<React.ComponentRef<typeof Camera> | null>;
  origin: Coords;
  destination: Coords;
  route: Ride['route_geometry'] | undefined;
  trail: GeoJSON.Feature | GeoJSON.FeatureCollection | null | undefined;
  riders: RiderFeatureCollection;
  onReady: () => void;
  onError: () => void;
  onUserGesture: () => void;
}

export const RideMap = memo(function RideMap(props: RideMapProps) {
  const { s, theme, mapRetry, sheetHeight, cameraRef, origin, destination, route, trail, riders } = props;
  const defaultCenter = useMemo(() => (validPair(origin) ? origin : [77.5946, 12.9716]), [origin]);
  if (!Mapbox || !MAPBOX_TOKEN) {
    return (
      <View style={s.fallback}>
        <Text style={s.heading}>Ride mode on</Text>
        <Text style={s.muted}>The native map is unavailable. GPS status and ride controls are shown below.</Text>
      </View>
    );
  }
  const hasRoute = route && route.geometry && Array.isArray(route.geometry.coordinates) && route.geometry.coordinates.length >= 2;
  return (
    <Mapbox.MapView
      key={mapRetry}
      style={StyleSheet.absoluteFill}
      styleURL={theme.scheme === 'dark' && !props.offline ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/outdoors-v12'}
      onDidFinishLoadingMap={props.onReady}
      onMapLoadingError={props.onError}
      onCameraChanged={state => {
        if (state?.gestures?.isGestureActive) props.onUserGesture();
      }}
      logoPosition={{ bottom: Math.min(sheetHeight + 8, 200), left: 10 }}
      attributionPosition={{ bottom: Math.min(sheetHeight + 8, 200), right: 10 }}
      compassEnabled
    >
      <Mapbox.Camera ref={cameraRef} defaultSettings={{ centerCoordinate: defaultCenter, zoomLevel: 14 }} />
      {hasRoute && <RouteLayer route={route} />}
      {trail && <TrailLayer trail={trail} />}
      <EndpointsLayer origin={origin} destination={destination} surface={theme.surface} />
      {props.roadReports && <RoadReportsLayer features={props.roadReports} theme={theme} onPress={props.onRoadReportPress} />}
      <RidersLayer features={riders} theme={theme} />
    </Mapbox.MapView>
  );
});
