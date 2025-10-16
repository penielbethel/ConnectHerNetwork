import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';

type Availability = { available: boolean; type?: BiometryTypes | null };

class BiometricService {
  private static instance: BiometricService;
  private rnBiometrics: ReactNativeBiometrics;

  private constructor() {
    this.rnBiometrics = new ReactNativeBiometrics();
  }

  public static getInstance(): BiometricService {
    if (!BiometricService.instance) {
      BiometricService.instance = new BiometricService();
    }
    return BiometricService.instance;
  }

  async isSensorAvailable(): Promise<Availability> {
    try {
      const { available, biometryType } = await this.rnBiometrics.isSensorAvailable();
      return { available: !!available, type: biometryType ?? null };
    } catch (_) {
      return { available: false, type: null };
    }
  }

  async promptUnlock(reason?: string): Promise<boolean> {
    try {
      const { success } = await this.rnBiometrics.simplePrompt({ promptMessage: reason || 'Authenticate' });
      return !!success;
    } catch (_) {
      return false;
    }
  }
}

export default BiometricService;