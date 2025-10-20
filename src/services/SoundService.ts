import AudioRecorderPlayer from 'react-native-audio-recorder-player'

export type PopEffectName = 'send' | 'react' | 'pop_bright' | 'pop_soft' | 'pop_subtle' | 'interface_click'

const SOUND_LIBRARY: Record<string, string> = {
  // Bright, friendly pop
  pop_bright: 'https://www.soundjay.com/button/sounds/button-16.mp3',
  // Softer pop
  pop_soft: 'https://www.soundjay.com/button/sounds/button-09.mp3',
  // Subtle UI pop
  pop_subtle: 'https://www.soundjay.com/button/sounds/button-1.mp3',
  // Click/confirm
  interface_click: 'https://www.soundjay.com/button/sounds/button-3.mp3',
  // Fallback to existing notify sound
  default: 'https://connecther.network/notify.mp3',
}

class SoundService {
  private static player: AudioRecorderPlayer | null = null
  private static stopTimer: any = null
  private static selection: { send?: keyof typeof SOUND_LIBRARY; react?: keyof typeof SOUND_LIBRARY } = {
    send: 'default',
    react: 'default',
  }

  static setEffect(kind: 'send' | 'react', name: keyof typeof SOUND_LIBRARY) {
    this.selection[kind] = name
  }

  private static getUrl(effect?: PopEffectName): string {
    if (!effect) return SOUND_LIBRARY[this.selection.send || 'default'] || SOUND_LIBRARY.default
    if (effect === 'send' || effect === 'react') {
      const key = this.selection[effect] || 'default'
      return SOUND_LIBRARY[key] || SOUND_LIBRARY.default
    }
    return SOUND_LIBRARY[effect] || SOUND_LIBRARY.default
  }

  static async playPop(effect?: PopEffectName) {
    try {
      if (!this.player) this.player = new AudioRecorderPlayer()
      const url = this.getUrl(effect)
      try { await this.player.stopPlayer() } catch {}
      try { this.player.removePlayBackListener() } catch {}
      await this.player.startPlayer(url)
      try { this.player.setVolume(1.0) } catch {}
      this.player.addPlayBackListener((e: any) => {
        const pos = e?.currentPosition || 0
        const dur = e?.duration || 0
        if (dur > 0 && pos >= dur) {
          try { this.player?.stopPlayer() } catch {}
          try { this.player?.removePlayBackListener() } catch {}
        }
      })
    } catch (_) {
      // noop: sound is non-critical UX
    }
  }
}

export default SoundService