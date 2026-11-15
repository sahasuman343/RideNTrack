import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';

export default function JoinRideScreen() {
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
      <Text style={styles.title}>Join a Group Ride</Text>
      <Text style={styles.subtitle}>Join with a ride code or accept a private invitation from the trip leader.</Text>
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
const styles = StyleSheet.create({
  container:{flexGrow:1,backgroundColor:'#1a1a2e',padding:24,justifyContent:'center'},
  title:{color:'#fff',fontSize:24,fontWeight:'bold',textAlign:'center'},
  subtitle:{color:'#999',fontSize:14,marginTop:8,marginBottom:22,textAlign:'center',lineHeight:20},
  section:{backgroundColor:'#16213e',borderWidth:1,borderColor:'#0f3460',borderRadius:14,padding:16,marginTop:14},
  sectionTitle:{color:'#fff',fontSize:16,fontWeight:'700',marginBottom:8},
  hint:{color:'#9aa8bd',fontSize:12,lineHeight:18,marginBottom:8},
  codeInput:{backgroundColor:'#101827',borderRadius:10,padding:16,fontSize:24,color:'#ff8a32',borderWidth:1,borderColor:'#34445c',textAlign:'center',letterSpacing:6,fontFamily:'monospace',fontWeight:'bold'},
  tokenInput:{backgroundColor:'#101827',borderRadius:10,padding:13,fontSize:13,color:'#fff',borderWidth:1,borderColor:'#34445c'},
  button:{backgroundColor:'#ed7625',borderRadius:10,padding:14,alignItems:'center',marginTop:12},
  buttonText:{color:'#fff',fontSize:14,fontWeight:'700'},
});
