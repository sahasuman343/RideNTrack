# Headset auto-start (F20)

Android only. When the rider's helmet communicator connects over Bluetooth on a
ride day, the phone posts a notification: "Riding Sunday dawn today?". Tapping
it opens the ride screen. **Sharing never starts on its own**: a headset also
connects on the commute to work.

Behind the `headset_autostart` flag (off). The profile card is hidden until the
flag is on and the build carries the native module.

## Rules (shared/headset.ts)

`headsetPromptFor` stays quiet unless all of these hold:

1. The rider is not already sharing on some ride.
2. No prompt in the last 3 hours.
3. The device is one the rider picked, or, with none picked, its name looks
   like a helmet communicator (Cardo, Sena, LIVALL, Fodsports...).
4. There is an active ride, or a planned ride with today's local date.

## App side

- `mobile/src/services/headsetAutostart.ts` listens to the native module while
  the app runs, stores settings and the last prompt time in AsyncStorage, and
  posts a local notification with `data.rideId`. The existing notification
  handler opens `/ride/{rideId}`.
- `mobile/src/components/profile/HeadsetCard.tsx`: on/off switch and a list of
  bonded audio devices, helmet communicators first.
- Events: `headset_prompt_shown`, `headset_autostart_changed`.

## Native contract (to build: `modules/headset-monitor`)

Expo module named `HeadsetMonitor`, Android only:

| Member | Behaviour |
| --- | --- |
| `start()` | Registers a receiver for `BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED` and `BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED`. |
| `stop()` | Unregisters it. |
| `bondedAudioDevices(): Promise<string[]>` | Names of bonded devices whose class is audio/video. |
| event `onHeadsetConnected { name }` | Sent when state becomes `STATE_CONNECTED`. |

- Needs `BLUETOOTH_CONNECT` (Android 12+), asked when the rider turns the
  switch on, with a one-line reason.
- Phase 1 works while the app process is alive (foreground or recent). For the
  cold case, add a manifest receiver that starts a headless JS task calling
  `handleHeadsetConnected(name, userId)` with the saved user id.
- iOS: not supported. iOS gives apps no Bluetooth audio connect event; the card
  never shows there.

## To do by Suman

- Build the native module and test with a real Cardo or Sena unit.
- Play policy: the BLUETOOTH_CONNECT permission declaration.
