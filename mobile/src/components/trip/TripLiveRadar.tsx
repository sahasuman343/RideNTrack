import React from 'react';
import { Text, View } from 'react-native';
import { Card, LiveDot, RouteLine, StatusBadge } from '../ui';
import type { TripStyles } from './tripStyles';
import type { Trip } from './types';

export interface TripLiveRadarProps {
  styles: TripStyles;
  trip: Trip;
  isTripOngoing: boolean;
  activeRosterCount: number;
  rosterCount: number;
  distance: string;
  waypointCount: number;
  /** The Ride ready card and later pre-ride cards render under the radar. */
  children?: React.ReactNode;
}

/** The trip workspace's "Live" tab: where the pack stands before and during a ride. */
export function TripLiveRadar({ styles, trip, isTripOngoing, activeRosterCount, rosterCount, distance, waypointCount, children }: TripLiveRadarProps) {
  return (
    <View style={styles.liveRadarContainer}>
              <Card style={styles.liveRadarCard} variant="raised">
                <View style={styles.liveRadarHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <LiveDot pulse={isTripOngoing} />
                    <Text style={styles.liveRadarTitle}>
                      {isTripOngoing ? 'LIVE SATELLITE RADAR' : 'LIVE TRACKING PREPARATION'}
                    </Text>
                  </View>
                  <StatusBadge status={trip.status} />
                </View>
  
                <Text style={styles.liveRadarDescription}>
                  {isTripOngoing
                    ? 'Active group telemetry is syncing. Tap below to enter dedicated helmet & glove-operable Ride Mode.'
                    : 'Planned trip route locked. Start tracking when your motorcycle hits the highway.'}
                </Text>
  
                <RouteLine
                  origin={trip.origin}
                  destination={trip.destination}
                  stopsCount={waypointCount}
                  style={{ marginVertical: 14 }}
                />
  
                <View style={styles.liveRadarStatsRow}>
                  <View style={styles.liveRadarStat}>
                    <Text style={styles.liveRadarStatValue}>{activeRosterCount} / {rosterCount}</Text>
                    <Text style={styles.liveRadarStatLabel}>RIDERS ONLINE</Text>
                  </View>
                  <View style={styles.liveRadarStat}>
                    <Text style={styles.liveRadarStatValue}>{distance}</Text>
                    <Text style={styles.liveRadarStatLabel}>TOTAL EXPEDITION</Text>
                  </View>
                  <View style={styles.liveRadarStat}>
                    <Text style={styles.liveRadarStatValue}>{waypointCount}</Text>
                    <Text style={styles.liveRadarStatLabel}>WAYPOINTS</Text>
                  </View>
                </View>
              </Card>
            {children}
            </View>
  );
}
