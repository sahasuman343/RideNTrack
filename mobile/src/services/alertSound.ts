import { Platform, Vibration } from 'react-native';

let audioPlayer: any = null;

/**
 * Plays an audible notification chime and triggers haptic vibration
 * whenever a touring group member broadcasts an alert (petrol, break, food, emergency, etc.)
 */
export async function playAlertSound(isEmergency: boolean = false): Promise<void> {
  // 1. Trigger haptic vibration pattern
  try {
    if (isEmergency) {
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);
    } else {
      Vibration.vibrate([0, 250, 150, 250]);
    }
  } catch {
    /* Ignore vibration failure on unsupported devices or environments */
  }

  // 2. Play Audio Chime
  try {
    // If Web platform, use Web Audio API synth as immediate reliable chime
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = isEmergency ? 'sawtooth' : 'sine';
        osc1.frequency.setValueAtTime(isEmergency ? 950 : 784, now);
        gain1.gain.setValueAtTime(0.3, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.15);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = isEmergency ? 'sawtooth' : 'sine';
        osc2.frequency.setValueAtTime(isEmergency ? 1200 : 1046.5, now + 0.16);
        gain2.gain.setValueAtTime(0.35, now + 0.16);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.38);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.16);
        osc2.stop(now + 0.38);
        return;
      }
    }

    // Native platform audio playback via expo-audio
    try {
      const { createAudioPlayer } = require('expo-audio');
      if (!audioPlayer) {
        const soundAsset = require('../../assets/sounds/alert_chime.wav');
        audioPlayer = createAudioPlayer(soundAsset);
      }
      if (audioPlayer) {
        if (typeof audioPlayer.seekTo === 'function') {
          audioPlayer.seekTo(0);
        }
        if (typeof audioPlayer.play === 'function') {
          audioPlayer.play();
        }
      }
    } catch {
      // Fallback if expo-audio native module is not linked in development environment
    }
  } catch {
    /* Ignore audio errors */
  }
}
