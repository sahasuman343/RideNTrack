import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useRideTheme, RidePalette } from '../../src/theme';

export default function JoinRideScreen() {
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const theme = useRideTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  async function handleJoinCode() {
    if (!code || code.trim().length !== 6) {
      Alert.alert('Invalid code', 'Enter the 6-character ride code.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('join_ride_by_code', { p_code: code.toUpperCase().trim() });
      if (error) throw error;
      Alert.alert('Joined ride', 'You joined using the ride code.', [{ text: 'Open ride', onPress: () => router.push(`/ride/${data}`) }]);
      setCode('');
    } catch (error: any) { Alert.alert('Could not join', error.message || 'Check the ride code and try again.'); }
    finally { setLoading(false); }
  }

  async function handleAcceptInvitation() {
    const clean = token.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)) {
      Alert.alert('Invalid invitation', 'Paste the invitation token shared by the trip leader.');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('accept_trip_invitation', { p_token: clean });
      if (error) throw error;
      if (!data) throw new Error('This invitation has expired.');
      setToken('');
      Alert.alert('Invitation accepted', 'You are now a member of this group ride.', [{ text: 'Open trip', onPress: () => router.push(`/ride/${data}`) }]);
    } catch (error: any) { Alert.alert('Could not accept invitation', error.message || 'The invitation may be expired or intended for another email.'); }
    finally { setLoading(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>RIDE WITH YOUR PEOPLE</Text><Text style={styles.title}>Find your crew.</Text>
      <Text style={styles.subtitle}>Meet on the road. Share the route. Keep everyone in sight.</Text>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Join with ride code</Text>
        <TextInput style={styles.codeInput} placeholder="XXXXXX" placeholderTextColor="#77809a" value={code}
          onChangeText={t => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g,''))} maxLength={6} autoCapitalize="characters" />
        <TouchableOpacity style={styles.button} onPress={() => void handleJoinCode()} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Please wait…' : 'Join with code'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Accept trip invitation</Text>
        <Text style={styles.hint}>Paste the private invitation token shared by the leader. Invitations can expire.</Text>
        <TextInput style={styles.tokenInput} placeholder="Invitation token (UUID)" placeholderTextColor="#77809a"
          value={token} onChangeText={setToken} autoCapitalize="none" autoCorrect={false} />
        <TouchableOpacity style={styles.button} onPress={() => void handleAcceptInvitation()} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Please wait…' : 'Accept invitation'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
const makeStyles = (c: RidePalette) => StyleSheet.create({
  container:{flexGrow:1,backgroundColor:c.background,padding:22,justifyContent:'center'},
  kicker:{color:c.green,fontSize:10,fontWeight:'900',letterSpacing:2.4},title:{color:c.text,fontSize:32,fontWeight:'900',letterSpacing:-1,marginTop:10},
  subtitle:{color:c.muted,fontSize:14,marginTop:8,marginBottom:28,lineHeight:21},
  section:{backgroundColor:c.surface,borderWidth:1,borderColor:c.border,borderRadius:9,padding:18,marginTop:14},
  sectionTitle:{color:c.text,fontSize:16,fontWeight:'700',marginBottom:8},
  hint:{color:c.muted,fontSize:12,lineHeight:18,marginBottom:8},
  codeInput:{backgroundColor:c.input,borderRadius:10,padding:16,fontSize:24,color:c.accent,borderWidth:1,borderColor:c.border,textAlign:'center',letterSpacing:6,fontFamily:'monospace',fontWeight:'bold'},
  tokenInput:{backgroundColor:'#101827',borderRadius:10,padding:13,fontSize:13,color:c.text,borderWidth:1,borderColor:'#34445c'},
  button:{backgroundColor:c.accent,borderRadius:7,padding:14,alignItems:'center',marginTop:12},
  buttonText:{color:'#fff',fontSize:14,fontWeight:'700'},
});
