'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const router = useRouter();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccessMsg('');

    // 1. Sign up with user metadata so the database trigger creates the profile
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          display_name: displayName,
        },
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // 2. If a session is active immediately (email confirmation disabled), upsert profile
    if (data?.session && data?.user) {
      try {
        await supabase.from('profiles').upsert({
          id: data.user.id,
          username,
          display_name: displayName,
        });
      } catch (err) {
        console.warn('Profile upsert fallback note:', err);
      }
    }

    if (data?.user && !data?.session) {
      setSuccessMsg('Account registered! If confirmation is required, please check your email, then log in.');
      setLoading(false);
      setTimeout(() => router.push('/login'), 2500);
      return;
    }

    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-[#FF6B00] text-center mb-2">RideNTrack</h1>
        <p className="text-gray-400 text-center mb-8">Join the Community</p>

        <form onSubmit={handleRegister} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="bg-emerald-500/10 border border-emerald-500 rounded-lg p-3 text-emerald-400 text-sm">
              {successMsg}
            </div>
          )}
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <input
            type="text"
            placeholder="Display Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FF6B00] text-white rounded-xl p-4 font-semibold text-lg hover:bg-[#e55f00] disabled:opacity-50 transition"
          >
            {loading ? 'Creating Account...' : 'Register'}
          </button>
        </form>

        <p className="text-center mt-6 text-gray-400">
          Already have an account?{' '}
          <a href="/login" className="text-[#FF6B00] hover:underline">Sign In</a>
        </p>
      </div>
    </div>
  );
}
