import AudioRecorderPlayer, {
  AudioSet,
  AVEncoderAudioQualityIOSType,
  AVEncodingOption,
  OutputFormatAndroidType,
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
} from 'react-native-audio-recorder-player';
import {Platform} from 'react-native';
import RNFS from 'react-native-fs';

type RecordUpdateCallback = (time: string, currentPosition: number) => void;

class AudioRecorderService {
  private static instance: AudioRecorderService;
  private recorder: any = null;
  private isRecording = false;
  private updateCallback: RecordUpdateCallback | null = null;

  private constructor() {
    try {
      // Prefer class-based API (v3.x); fallback to instance export (v4.x)
      this.recorder = (typeof AudioRecorderPlayer === 'function')
        ? new AudioRecorderPlayer()
        : AudioRecorderPlayer;
      try { this.recorder?.setSubscriptionDuration?.(0.2); } catch {}
    } catch (e: any) {
      this.recorder = null;
      try { console.error('[AudioRecorderInitError]', e?.message || e, e?.stack); } catch {}
    }
  }

  static getInstance() {
    if (!AudioRecorderService.instance) {
      AudioRecorderService.instance = new AudioRecorderService();
    }
    return AudioRecorderService.instance;
  }

  onUpdate(cb: RecordUpdateCallback) {
    this.updateCallback = cb;
  }

  async startRecording(customFilePath?: string): Promise<string> {
    if (this.isRecording) return '';

    if (!this.recorder) {
      // Fallback in case constructor failed earlier
      try {
        this.recorder = (typeof AudioRecorderPlayer === 'function')
          ? new AudioRecorderPlayer()
          : AudioRecorderPlayer;
        try { this.recorder?.setSubscriptionDuration?.(0.2); } catch {}
      } catch (_e) {
        try { console.error('[AudioRecorderStartError]', 'Recorder instance unavailable'); } catch {}
        return '';
      }
    }

    const audioSet: AudioSet = (Platform.OS === 'android')
      ? {
          AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
          AudioSourceAndroid: AudioSourceAndroidType.MIC,
          OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
        }
      : {
          AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
          AVNumberOfChannelsKeyIOS: 2,
          AVFormatIDKeyIOS: AVEncodingOption.aac,
        };

    const defaultName = `voice-note-${Date.now()}.m4a`;
    const path = customFilePath
      ? customFilePath
      : Platform.OS === 'android'
        ? `${RNFS.DocumentDirectoryPath}/${defaultName}`
        : defaultName;

    try {
      const uri = await this.recorder.startRecorder(path, audioSet);
      this.isRecording = true;

      this.recorder.addRecordBackListener((e: any) => {
        if (this.updateCallback) {
          this.updateCallback(e.currentMetering || '', e.currentPosition);
        }
        return;
      });

      return uri || path;
    } catch (e: any) {
      try { console.error('[AudioRecorderStartError]', e?.message || e, e?.stack); } catch {}
      return '';
    }
  }

  async stopRecording(): Promise<string> {
    if (!this.isRecording) return '';
    try {
      const result = await this.recorder?.stopRecorder?.();
      try { this.recorder?.removeRecordBackListener?.(); } catch {}
      this.isRecording = false;
      return result || '';
    } catch (e: any) {
      try { console.error('[AudioRecorderStopError]', e?.message || e, e?.stack); } catch {}
      this.isRecording = false;
      try { this.recorder?.removeRecordBackListener?.(); } catch {}
      return '';
    }
  }

  async cancelRecording(): Promise<void> {
    if (!this.isRecording) return;
    try { await this.recorder?.stopRecorder?.(); } catch {}
    try { this.recorder?.removeRecordBackListener?.(); } catch {}
    this.isRecording = false;
  }
}

// Lazy proxy to avoid import-time native module construction
const audioRecorderService = {
  onUpdate: (cb: RecordUpdateCallback) => AudioRecorderService.getInstance().onUpdate(cb),
  startRecording: (customFilePath?: string) => AudioRecorderService.getInstance().startRecording(customFilePath),
  stopRecording: () => AudioRecorderService.getInstance().stopRecording(),
  cancelRecording: () => AudioRecorderService.getInstance().cancelRecording(),
};
export default audioRecorderService;