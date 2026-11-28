import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { CAPTAIN_PHASE_LABELS, type CaptainPhase } from '@ridentrack/shared';
import { Icon } from '../ui';
import { useCaptainFlowStyles } from './captainFlowStyles';

/*
 * The bottom panel before and after a ride. Captains see the one step they are
 * on with one main action; riders see the briefing and whether they are
 * checked in. Replaces the bare "Start the ride" button.
 */

export interface CaptainStepCardProps {
  leader: boolean;
  rideStatus: string;
  phase: CaptainPhase;
  rollCallHeadline: string;
  briefingShared: boolean;
  briefingRead: boolean;
  myCheckIn: { status: string; by: string | null } | null;
  debriefSaved: boolean;
  onBriefing: () => void;
  onRollCall: () => void;
  onCheckInSelf: () => void;
  onDebrief: () => void;
}

export function CaptainStepCard(p: CaptainStepCardProps) {
  const { cs, theme } = useCaptainFlowStyles();

  if (p.leader) {
    const label = CAPTAIN_PHASE_LABELS[p.phase];
    const main = p.phase === 'briefing' ? p.onBriefing : p.phase === 'roll_call' ? p.onRollCall : p.onDebrief;
    const steps: CaptainPhase[] = ['briefing', 'roll_call', 'debrief'];
    const doneIndex = p.phase === 'briefing' ? 0 : p.phase === 'roll_call' ? 1 : p.phase === 'done' ? 3 : 2;
    return (
      <View style={[cs.card, { backgroundColor: theme.surface, marginTop: 4 }]}>
        <View style={cs.meter}>
          {steps.map((st, i) => (
            <View key={st} style={[cs.meterSeg, { backgroundColor: i < doneIndex ? theme.green : i === doneIndex ? theme.accent : theme.border }]} />
          ))}
        </View>
        <Text style={cs.step}>{label.step.toUpperCase()}</Text>
        <Text style={cs.cardTitle}>{p.phase === 'roll_call' ? p.rollCallHeadline : label.title}</Text>
        <Text style={cs.lede}>
          {p.phase === 'briefing' && 'Share the briefing so everyone knows the meetup, lead, sweep and regroups.'}
          {p.phase === 'roll_call' && 'Riders near the meetup check in by themselves. Confirm the rest, then start.'}
          {p.phase === 'debrief' && 'A summary of the ride is ready. Add a note or just save it.'}
          {p.phase === 'done' && 'Debrief saved. Location sharing is off.'}
        </Text>
        <TouchableOpacity style={cs.primary} onPress={main} accessibilityRole="button">
          <Text style={cs.primaryText}>{p.phase === 'roll_call' ? 'Open roll call' : label.action}</Text>
        </TouchableOpacity>
        {p.phase === 'roll_call' ? (
          <TouchableOpacity onPress={p.onBriefing}><Text style={cs.ghostText}>Edit briefing</Text></TouchableOpacity>
        ) : null}
        {p.phase === 'briefing' ? (
          <TouchableOpacity onPress={p.onRollCall}><Text style={cs.ghostText}>Skip to roll call</Text></TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (p.rideStatus === 'completed') {
    return (
      <View style={[cs.card, { backgroundColor: theme.surface, marginTop: 4 }]}>
        <Text style={cs.cardTitle}>Ride ended</Text>
        <Text style={cs.lede}>Location sharing is off. Thanks for riding safe.</Text>
      </View>
    );
  }

  const checkedIn = p.myCheckIn?.status === 'checked_in';
  return (
    <View style={[cs.card, { backgroundColor: theme.surface, marginTop: 4 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name={checkedIn ? 'checkmark-circle' : 'time-outline'} size="lg" color={checkedIn ? theme.green : theme.warning} />
        <View style={{ flex: 1 }}>
          <Text style={cs.cardTitle}>{checkedIn ? "You're checked in" : 'Waiting for the captain to start'}</Text>
          <Text style={cs.lede}>
            {checkedIn
              ? p.myCheckIn?.by === 'location' ? 'Checked in by location at the meetup.' : 'The captain can see you are here.'
              : 'You will be checked in automatically within 200 m of the meetup.'}
          </Text>
        </View>
      </View>
      {p.briefingShared ? (
        <TouchableOpacity style={p.briefingRead ? cs.secondary : cs.primary} onPress={p.onBriefing} accessibilityRole="button">
          <Text style={p.briefingRead ? cs.secondaryText : cs.primaryText}>{p.briefingRead ? 'Briefing' : 'Read the briefing'}</Text>
        </TouchableOpacity>
      ) : null}
      {!checkedIn && p.myCheckIn ? (
        <TouchableOpacity onPress={p.onCheckInSelf}><Text style={cs.ghostText}>I&apos;m at the meetup</Text></TouchableOpacity>
      ) : null}
    </View>
  );
}
