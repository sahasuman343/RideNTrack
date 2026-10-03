'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { type Ride, type Profile } from '@ridentrack/shared';
import { supabase } from '@/lib/supabase';

export default function DashboardPage() {
  const [rides,setRides] = useState<Ride[]>([]);
  const [profile,setProfile] = useState<Profile | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const [retry,setRetry] = useState(0);
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const {data:{session},error:authError} = await supabase.auth.getSession();
        if(authError) throw authError;
        if(!session) {router.replace('/login');return;}
        const [profileResult,ridesResult] = await Promise.all([
          supabase.from('profiles').select('*').eq('id',session.user.id).single(),
          supabase.from('ride_participants').select('rides(*)').eq('user_id',session.user.id).eq('is_active',true).order('joined_at',{ascending:false}),
        ]);
        if(profileResult.error) throw profileResult.error;
        if(ridesResult.error) throw ridesResult.error;
        if(cancelled)return;
        setProfile(profileResult.data as Profile);
        setRides(ridesResult.data.map((p:{rides:unknown})=>p.rides).filter(Boolean) as Ride[]);
        setError(null);
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'Could not load your rides.');}
      finally{if(!cancelled)setLoading(false);}
    }
    void load();
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{if(!session)router.replace('/login');});
    return()=>{cancelled=true;subscription.unsubscribe();};
  },[router,retry]);
  async function signOut(){
    const {error}=await supabase.auth.signOut();
    if(error)setError(error.message);else router.replace('/login');
  }
  return <main className="min-h-screen bg-[#f7f8f3] text-[#203c43]">
    <header className="flex items-center justify-between gap-4 border-b border-[#e5e9e2] bg-white px-6 py-5"><Link href="/dashboard" className="text-2xl font-extrabold tracking-tight">ride<span className="text-[#d66029]">n</span>track.</Link><div className="flex items-center gap-5"><span className="text-sm text-[#718084]">{profile?.display_name}</span><button className="text-sm font-medium hover:text-[#d66029]" onClick={()=>void signOut()}>Sign out</button></div></header>
    <section className="mx-auto max-w-5xl px-6 py-12"><p className="text-xs tracking-[0.2em] text-[#718084]">THE NEXT ADVENTURE STARTS HERE</p><h1 className="mt-3 text-4xl font-semibold tracking-tight">My Rides</h1><p className="mt-3 text-sm text-[#718084]">Your group, your route, all in one place.</p>
      {error&&<div role="alert" className="mt-8 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm">{error}<button className="ml-4 underline" onClick={()=>{setLoading(true);setRetry(v=>v+1);}}>Try again</button></div>}
      {loading?<p role="status" className="mt-10 text-[#718084]">Loading your rides…</p>:rides.length===0?<div className="mt-10 rounded-2xl border border-dashed border-[#ccd8c8] bg-white p-12 text-center"><h2 className="text-xl font-semibold">Your first ride is waiting.</h2><p className="mt-3 text-sm text-[#718084]">Create a ride or join with an invitation code in the mobile app. It will appear here automatically when you reload.</p></div>:<div className="mt-10 grid gap-5 md:grid-cols-2">{rides.map(ride=><Link href={'/ride?id='+ride.id} key={ride.id} className="rounded-2xl border border-[#e0e7da] bg-white p-6 transition hover:border-[#df9b6d] hover:shadow-sm focus-visible:outline-2 focus-visible:outline-[#d66029]"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{ride.name}</h2><span className={'rounded-full px-3 py-1 text-[10px] uppercase tracking-wide '+(ride.status==='active'?'bg-green-50 text-green-700':'bg-stone-100 text-stone-500')}>{ride.status}</span></div><p className="mt-5 text-sm text-[#718084]">{ride.origin} → {ride.destination}</p><div className="mt-6 flex justify-between border-t border-[#edf1e9] pt-4"><span className="font-mono text-xs tracking-widest text-[#a2704a]">{ride.ride_code}</span><span className="text-xs font-semibold text-[#d66029]">Open ride map ↗</span></div></Link>)}</div>}
    </section>
  </main>;
}
