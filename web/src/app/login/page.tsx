'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push('/dashboard');
    });
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push('/dashboard');
    }
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-[#FF6B00] text-center mb-2">RideNTrack</h1>
        <p className="text-gray-400 text-center mb-8">Indian Riders Community</p>

        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
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
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#FF6B00] text-white rounded-xl p-4 font-semibold text-lg hover:bg-[#e55f00] disabled:opacity-50 transition"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center mt-6 text-gray-400">
          Don&apos;t have an account?{' '}
          <a href="/register" className="text-[#FF6B00] hover:underline">Register</a>
        </p>
      </div>
    </div>
  );
}
