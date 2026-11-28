import { useState } from 'react';
import { authProblem, type AuthProblem } from '@ridentrack/shared';
import { supabase } from '../../lib/supabase';

/** Sends the sign-up confirmation link again. Returns the problem to show next, if any. */
export function useResendConfirmation() {
  const [resending, setResending] = useState(false);
  async function resend(email: string): Promise<AuthProblem> {
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (error) return authProblem(error, 'sign_in');
      return {
        title: 'Link sent',
        message: `We sent a new confirmation link to ${email.trim()}. Open it, then sign in here.`,
        kind: 'info',
      };
    } finally {
      setResending(false);
    }
  }
  return { resend, resending };
}
