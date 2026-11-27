import Link from 'next/link';
import { OPERATOR_NAME, POLICY_DATE, SUPPORT_EMAIL, formatPolicyDate } from '@/lib/site';

/**
 * Title block for the privacy policy and terms. Until the operator's legal
 * name, contact address and policy date are set, it says the text is a draft
 * rather than showing placeholders as if they were real.
 */
export default function LegalHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  const complete = OPERATOR_NAME && SUPPORT_EMAIL && POLICY_DATE;
  return (
    <header>
      <p className="eyebrow-label">{eyebrow}</p>
      <h1 className="display mt-4 text-5xl sm:text-6xl">{title}</h1>
      {POLICY_DATE && <p className="mt-4 font-mono text-xs text-muted">Last updated {formatPolicyDate(POLICY_DATE)}</p>}
      {!complete && (
        <p role="note" className="notice mt-6">
          This is a draft. The operator’s legal name, contact address and effective date are still being added, and the text may change before it takes effect.
        </p>
      )}
    </header>
  );
}

export function Operator() {
  return <>{OPERATOR_NAME ?? 'the operator of rideNtrack'}</>;
}

export function ContactLine() {
  return SUPPORT_EMAIL
    ? <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
    : <>the contact address on our <Link href="/support">support page</Link></>;
}
