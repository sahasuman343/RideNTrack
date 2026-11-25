import { useCallback, useEffect, useState } from 'react';
import { normaliseFamilyPhone, type FamilyContact } from '@ridentrack/shared';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

/** F2: the rider's family contacts (up to two) and the pause switch. */
export function useFamilyContacts() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<FamilyContact[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from('family_contacts').select('id,name,phone,relation,paused,language').order('created_at');
    if (!error && Array.isArray(data)) setContacts(data as FamilyContact[]);
    setLoaded(true);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (input: { id?: string | null; name: string; phone: string; relation?: string | null }) => {
    const phone = normaliseFamilyPhone(input.phone);
    if (!phone) throw new Error('Enter a mobile number, e.g. 98765 43210 or +44 7700 900123.');
    if (!input.name.trim()) throw new Error('Add a name so the text says who it is from.');
    const { error } = await supabase.rpc('save_family_contact', {
      p_id: input.id ?? null, p_name: input.name.trim(), p_phone: phone, p_relation: input.relation ?? null,
    });
    if (error) throw new Error(error.message);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    const { error } = await supabase.rpc('delete_family_contact', { p_id: id });
    if (error) throw new Error(error.message);
    await refresh();
  }, [refresh]);

  const setPaused = useCallback(async (paused: boolean) => {
    setContacts(list => list.map(c => ({ ...c, paused })));
    const { error } = await supabase.rpc('set_family_updates_paused', { p_paused: paused });
    if (error) { await refresh(); throw new Error(error.message); }
  }, [refresh]);

  const setLanguage = useCallback(async (id: string, language: 'en' | 'hi') => {
    setContacts(list => list.map(c => (c.id === id ? { ...c, language } : c)));
    const { error } = await supabase.rpc('set_family_contact_language', { p_id: id, p_language: language });
    if (error) { await refresh(); throw new Error(error.message); }
  }, [refresh]);

  return { contacts, loaded, refresh, save, remove, setPaused, setLanguage };
}
