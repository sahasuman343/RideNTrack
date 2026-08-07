'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

interface Ride {
  id: string;
  name: string;
  ride_code: string;
  origin: string;
  destination: string;
  status: string;
}

export default function DashboardPage() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/login');
      return;
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();
    setProfile(profileData);

    const { data } = await supabase
      .from('ride_participants')
      .select('ride_id, rides(id, name, ride_code, origin, destination, status)')
      .eq('user_id', session.user.id)
      .order('joined_at', { ascending: false });

    if (data) {
      setRides(data.map((p: any) => p.rides).filter(Boolean));
    }
    setLoading(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  function getStatusColor(status: string) {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'planned': return 'bg-yellow-500';
      case 'completed': return 'bg-gray-500';
      default: return 'bg-gray-500';
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <div className="text-[#FF6B00] text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e]">
      <header className="border-b border-[#0f3460] px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[#FF6B00]">RideNTrack</h1>
        <div className="flex items-center gap-4">
          <span className="text-gray-300">{profile?.display_name}</span>
          <button onClick={handleSignOut} className="text-gray-400 hover:text-red-400 transition">
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <h2 className="text-xl font-semibold text-white mb-6">My Rides</h2>

        {rides.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">No rides yet</p>
            <p className="text-gray-500 mt-2">Create a ride from the mobile app to get started</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {rides.map((ride) => (
              <a
                key={ride.id}
                href={`/ride?id=${ride.id}`}
                className="bg-[#16213e] border border-[#0f3460] rounded-xl p-5 hover:border-[#FF6B00] transition block"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-white text-lg font-semibold">{ride.name}</h3>
                    <p className="text-gray-400 mt-1">{ride.origin} → {ride.destination}</p>
                    <p className="text-[#FF6B00] text-sm mt-1 font-mono">Code: {ride.ride_code}</p>
                  </div>
                  <span className={`${getStatusColor(ride.status)} text-white text-xs px-2 py-1 rounded-lg font-bold uppercase`}>
                    {ride.status}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
