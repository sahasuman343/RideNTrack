import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import type { AuthProblem, AuthProblemKind } from '@ridentrack/shared';
import { Dialog, DialogAction } from '../ui/Dialog';
import { useRideTheme, RidePalette } from '../../theme';

const ICONS: Record<AuthProblemKind, keyof typeof Ionicons.glyphMap> = {
  error: 'alert-circle-outline',
  info: 'mail-unread-outline',
  offline: 'cloud-offline-outline',
  wait: 'time-outline',
  setup: 'construct-outline',
};

function tone(kind: AuthProblemKind, c: RidePalette) {
  switch (kind) {
    case 'info': return { color: c.accent, bg: c.accentSoft };
    case 'offline': return { color: c.tertiary, bg: c.tertiarySoft };
    case 'wait':
    case 'setup': return { color: c.warning, bg: c.warningSoft };
    default: return { color: c.danger, bg: c.dangerSoft };
  }
}

interface Props {
  problem: AuthProblem | null;
  onClose: () => void;
  /** Shown for next === 'resend_confirmation'. */
  onResend?: () => void;
  resending?: boolean;
  /** Shown for next === 'go_sign_in'. */
  onGoSignIn?: () => void;
}

/** A styled dialog for a sign-in or sign-up problem, with the next step as its main button. */
export function AuthProblemDialog({ problem, onClose, onResend, resending, onGoSignIn }: Props) {
  const theme = useRideTheme();
  if (!problem) return null;
  const { color, bg } = tone(problem.kind, theme);

  const actions: DialogAction[] = [];
  if (problem.next === 'resend_confirmation' && onResend) {
    actions.push({ text: 'Send link again', onPress: onResend, variant: 'primary', loading: resending });
    actions.push({ text: 'Not now', onPress: onClose, variant: 'ghost' });
  } else if (problem.next === 'go_sign_in' && onGoSignIn) {
    actions.push({ text: 'Sign in instead', onPress: onGoSignIn, variant: 'primary' });
    actions.push({ text: 'Use another email', onPress: onClose, variant: 'ghost' });
  } else {
    actions.push({ text: problem.next === 'retry' ? 'Try again' : 'OK', onPress: onClose, variant: 'primary' });
  }

  return (
    <Dialog
      visible
      title={problem.title}
      message={problem.message}
      icon={ICONS[problem.kind]}
      iconColor={color}
      iconBackgroundColor={bg}
      actions={actions}
      onDismiss={onClose}
      testID="auth-problem-dialog"
    />
  );
}
