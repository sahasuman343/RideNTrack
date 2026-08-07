'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.push('/dashboard');
      } else {
        router.push('/login');
      }
    });
  }, [router]);

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-[#FF6B00]">RideNTrack</h1>
        <p className="text-gray-400 mt-4 text-lg">Motorcycle Group Ride Tracker for Indian Riders</p>
      </div>
    </div>
  );
}
