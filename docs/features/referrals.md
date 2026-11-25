# Referral loop (F17)

Flag: `referrals` (on). With it off, no code is shown and nothing is credited.

- Every rider gets a 6-character code (`get_my_referral_code`), from an
  alphabet without 0/O/1/I/L so it can be read aloud.
- **Spectator page**: "Plan your own ride" at the foot of the panel links to
  `/register?ref=CODE&src=spectator` with the sharing rider's code
  (`get_referral_code_for_link`).
- **Recap**: a finished trip shows "Share the ride", which shares the ride name,
  distance and an invite link. The same card is on Profile.
- **Sign-up** (web and app) prefills the code from the link and also accepts a
  typed code. The code travels in the account metadata, so it is credited when
  the profile is created, even when email confirmation is on.
- Credited once per account, never to yourself, only within 14 days of sign-up
  (`credit_referral`). The referrer sees a count, never who joined.

## Needs Suman

- Android Play Install Referrer, so the code survives a Play Store install
  (needs `react-native-play-install-referrer` and a dev build). Until then the
  code is carried by opening the link after install, or typed.
- iOS: attribution needs the link opened after install or the code typed.
- Set `EXPO_PUBLIC_WEB_URL` if the site is not at https://ridentrack.app.
- Decide whether referrals earn anything (for example a free Expedition Pass);
  the data to do it is in `referral_attributions`.
