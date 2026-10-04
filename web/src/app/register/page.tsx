'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { registerAccount, UsernameUnavailableError } from '@ridentrack/shared';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const usernameInput = useRef<HTMLInputElement>(null);
  const [usernameError, setUsernameError] = useState(false);
  const router = useRouter();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setSuccessMsg('');
    setUsernameError(false);
    try {
      const data = await registerAccount(supabase, { email, password, username, displayName });
      if (data.session) {
        router.replace('/dashboard');
      } else {
        setSuccessMsg('Check your email to confirm your account, then sign in.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Registration failed. Please try again.');
      if (cause instanceof UsernameUnavailableError) {
        setUsernameError(true);
        usernameInput.current?.focus();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-4xl font-bold text-[#FF6B00] text-center mb-2">RideNTrack</h1>
        <p className="text-gray-400 text-center mb-8">Join the Community</p>

        <form onSubmit={handleRegister} className="space-y-4">
          {error && (
            <div id="registration-error" role="alert" className="bg-red-500/10 border border-red-500 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
          {successMsg && (
            <div role="status" className="bg-emerald-500/10 border border-emerald-500 rounded-lg p-3 text-emerald-400 text-sm">
              {successMsg}
            </div>
          )}
          <input
            type="text"
            placeholder="Username"
            aria-label="Username"
            ref={usernameInput}
            aria-invalid={usernameError}
            aria-describedby={usernameError ? 'registration-error' : undefined}
            autoComplete="username"
            autoCapitalize="none"
            maxLength={64}
            value={username}
            onChange={(e) => { setUsername(e.target.value); if (usernameError) { setUsernameError(false); setError(''); } }}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <input
            type="text"
            placeholder="Display Name"
            aria-label="Display name"
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <input
            type="email"
            placeholder="Email"
            aria-label="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-[#16213e] border border-[#0f3460] rounded-xl p-4 text-white placeholder-gray-500 focus:outline-none focus:border-[#FF6B00]"
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            aria-label="Password"
            autoComplete="new-password"
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
          <Link href="/login" className="text-[#FF6B00] hover:underline">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
