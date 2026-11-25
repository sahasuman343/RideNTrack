import React, { useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { MAX_FAMILY_CONTACTS, formatPhoneForDisplay, type FamilyContact } from '@ridentrack/shared';
import { Icon, SheetModal } from '../ui';
import { useCaptainFlowStyles } from '../ride/captainFlowStyles';

/*
 * F2: up to two people who get a plain text when you start, reach the night's
 * stay, or miss a check-in. Adding a contact is the consent; the copy says
 * exactly what they will receive.
 */

export interface FamilyContactsSheetProps {
  visible: boolean;
  onClose: () => void;
  bottomInset: number;
  contacts: FamilyContact[];
  onSave: (input: { id?: string | null; name: string; phone: string; relation?: string | null }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onPause: (paused: boolean) => Promise<void>;
}

export function FamilyContactsSheet(props: FamilyContactsSheetProps) {
  const { cs, theme } = useCaptainFlowStyles();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relation, setRelation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdd = props.contacts.length < MAX_FAMILY_CONTACTS;
  const paused = props.contacts.length > 0 && props.contacts.every(c => c.paused);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await props.onSave({ name, phone, relation });
      setName(''); setPhone(''); setRelation('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetModal visible={props.visible} onRequestClose={props.onClose}>
      <View style={[cs.sheet, { paddingBottom: Math.max(props.bottomInset, 24) }]}>
        <View style={cs.grabber} />
        <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
          <Text style={cs.step}>FAMILY UPDATES · FREE</Text>
          <Text style={cs.headline}>Who should know you&apos;re safe?</Text>
          <Text style={cs.lede}>
            They get a short text with a live link when the ride starts and when you reach the stay, and one if you
            miss a check-in. Nothing else, and never ads.
          </Text>

          {props.contacts.map(c => (
            <View key={c.id} style={cs.riderRow}>
              <Icon name="person-circle-outline" size="lg" color={c.paused ? theme.subtle : theme.accent} />
              <View style={{ flex: 1 }}>
                <Text style={cs.riderName}>{c.name}{c.relation ? ` · ${c.relation}` : ''}</Text>
                <Text style={cs.riderMeta}>{formatPhoneForDisplay(c.phone)}{c.paused ? ' · paused' : ''}</Text>
              </View>
              <TouchableOpacity
                style={[cs.pill, { borderColor: theme.borderStrong }]}
                onPress={() => void props.onRemove(c.id).catch(e => setError(e instanceof Error ? e.message : 'Could not remove.'))}
                accessibilityLabel={`Remove ${c.name}`}
              >
                <Text style={[cs.pillText, { color: theme.textMuted }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}

          {props.contacts.length > 0 ? (
            <View style={[cs.riderRow, { borderTopWidth: 0 }]}>
              <View style={{ flex: 1 }}>
                <Text style={cs.riderName}>Pause updates</Text>
                <Text style={cs.riderMeta}>For a solo detour or a ride they don&apos;t need to hear about.</Text>
              </View>
              <Switch value={paused} onValueChange={v => void props.onPause(v)} trackColor={{ false: theme.border, true: theme.warning }} />
            </View>
          ) : null}

          {canAdd ? (
            <View style={{ gap: 8 }}>
              <Text style={cs.sectionLabel}>{props.contacts.length ? 'ADD ONE MORE' : 'ADD A CONTACT'}</Text>
              <TextInput style={cs.input} value={name} onChangeText={setName} placeholder="Name, e.g. Amma" placeholderTextColor={theme.subtle} maxLength={40} />
              <TextInput style={cs.input} value={phone} onChangeText={setPhone} placeholder="Mobile, e.g. 98765 43210" placeholderTextColor={theme.subtle} keyboardType="phone-pad" maxLength={20} />
              <TextInput style={cs.input} value={relation} onChangeText={setRelation} placeholder="Relation (optional)" placeholderTextColor={theme.subtle} maxLength={30} />
              {error ? <Text style={cs.error}>{error}</Text> : null}
              <TouchableOpacity style={[cs.primary, (busy || !name.trim() || !phone.trim()) && { opacity: 0.5 }]} disabled={busy || !name.trim() || !phone.trim()} onPress={() => void add()}>
                <Text style={cs.primaryText}>{busy ? 'Saving…' : 'Add contact'}</Text>
              </TouchableOpacity>
              <Text style={[cs.riderMeta, { textAlign: 'center' }]}>By adding them you confirm they are happy to get these texts.</Text>
            </View>
          ) : error ? <Text style={cs.error}>{error}</Text> : null}
          <TouchableOpacity onPress={props.onClose}><Text style={cs.ghostText}>Done</Text></TouchableOpacity>
        </ScrollView>
      </View>
    </SheetModal>
  );
}
