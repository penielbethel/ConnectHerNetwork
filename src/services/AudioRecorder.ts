import AudioRecorderPlayer, {
  AudioSet,
  AVEncoderAudioQualityIOSType,
  AVEncodingOption,
  OutputFormatAndroidType,
} from 'react-native-audio-recorder-player';
import {Platform} from 'react-native';

type RecordUpdateCallback = (time: string, currentPosition: number) => void;

class AudioRecorderService {
  private static instance: AudioRecorderService;
  private recorder: AudioRecorderPlayer | null = null;
  private isRecording = false;
  private updateCallback: RecordUpdateCallback | null = null;

  private constructor() {
    try {
      this.recorder = new AudioRecorderPlayer();
      this.recorder.setSubscriptionDuration(0.2); // ~200ms updates
    } catch (e) {
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
      try {
        this.recorder = new AudioRecorderPlayer();
        this.recorder.setSubscriptionDuration(0.2);
      } catch (e) {
        try { console.error('[AudioRecorderStartError]', e?.message || e, e?.stack); } catch {}
        return '';
      }
    }

    const audioSet: AudioSet = {
      AudioEncoderAndroid: 'aac',
      AudioSourceAndroid: 'mic',
      AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
      AVNumberOfChannelsKeyIOS: 2,
      AVFormatIDKeyIOS: AVEncodingOption.aac,
      OutputFormatAndroid: OutputFormatAndroidType.mpeg_4,
    };

    const defaultName = `voice-note-${Date.now()}.m4a`;
    const path = customFilePath || (Platform.OS === 'android' ? defaultName : defaultName);

    const uri = await this.recorder.startRecorder(path, audioSet);
    this.isRecording = true;

    this.recorder.addRecordBackListener((e: any) => {
      if (this.updateCallback) {
        this.updateCallback(e.currentMetering || '', e.currentPosition);
      }
      return;
    });

    return uri || path;
  }

  async stopRecording(): Promise<string> {
    if (!this.isRecording) return '';
    const result = await this.recorder?.stopRecorder();
    this.recorder?.removeRecordBackListener();
    this.isRecording = false;
    return result || '';
  }

  async cancelRecording(): Promise<void> {
    if (!this.isRecording) return;
    await this.recorder?.stopRecorder();
    this.recorder?.removeRecordBackListener();
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