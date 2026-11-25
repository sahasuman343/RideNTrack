# Languages (F13 Hindi)

Status: built, behind the `languages` flag (off by default until a native
speaker has reviewed the Hindi).

## How it works

- Strings live in `shared/locales/en.ts` and `shared/locales/hi.ts`. Plain
  objects, no runtime library, so the same text works in the app, in shared
  builders and in tests. `tests/unit/i18n.test.cjs` fails if a key is missing
  from `hi.ts` or its `{placeholders}` differ.
- `shared/i18n.ts`: `translator(locale)`, `pickLocale(phoneTags)`,
  `lineHeightFor(locale, size)` (Devanagari gets 1.5x line height).
- Shared builders take an optional translator and default to English:
  `sosSteps`, `sosPrimaryLabel`, `crashCountdownAttention`,
  `chatQueueSummary`, `chatDeliveryText`.
- Mobile: `LocaleProvider` / `useT()` / `useLocale()` in
  `mobile/src/hooks/useLocale.tsx`. The rider's choice (Profile → Language)
  wins, otherwise the first supported phone language. With the flag off,
  everyone sees English.
- Translated so far: tab bar, SOS sheet and steps, crash countdown (including
  the spoken prompt, in `hi-IN`), attention bar, trip chat, hold-to-talk,
  road reports. Other screens are still English (F13-b).

## Family texts

Family texts follow the contact's language, not the rider's. Each family
contact has a language (`family_contacts.language`, switched with the pill on
the family sheet). It reaches the outbound payload as `lang`, and the sender
uses `HINDI_TEMPLATES` in `supabase/functions/_shared/outbound.ts` once the
Hindi DLT template id is set; until then the contact gets the English text.

## Needs Suman

- Native-speaker review of `shared/locales/hi.ts` and the four Hindi SMS
  texts, then turn on `languages`.
- Register the Hindi DLT templates and set
  `DLT_TEMPLATE_FAMILY_RIDE_STARTED_HI`, `DLT_TEMPLATE_FAMILY_REACHED_STAY_HI`,
  `DLT_TEMPLATE_FAMILY_CHECK_IN_MISSED_HI`, `DLT_TEMPLATE_FAMILY_CRASH_HI`.
  Hindi SMS are Unicode, so each part holds 70 characters instead of 160.
- Screenshots of the core screens in Hindi on a small Android phone.
