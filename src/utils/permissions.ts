import { Platform, PermissionsAndroid, Alert } from 'react-native';

export interface PermissionResult {
  granted: boolean;
  message?: string;
}

export class PermissionsManager {
  
  // Camera permissions
  static async requestCameraPermission(): Promise<PermissionResult> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'ConnectHer needs access to your camera to take photos and videos.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        return {
          granted: granted === PermissionsAndroid.RESULTS.GRANTED,
          message: granted === PermissionsAndroid.RESULTS.GRANTED 
            ? 'Camera permission granted' 
            : 'Camera permission denied'
        };
      } catch (err) {
        console.warn('Camera permission error:', err);
        return { granted: false, message: 'Error requesting camera permission' };
      }
    }
    return { granted: true }; // iOS handles permissions automatically
  }

  // Audio recording permissions
  static async requestAudioPermission(): Promise<PermissionResult> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'ConnectHer needs access to your microphone for voice messages and calls.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        return {
          granted: granted === PermissionsAndroid.RESULTS.GRANTED,
          message: granted === PermissionsAndroid.RESULTS.GRANTED 
            ? 'Microphone permission granted' 
            : 'Microphone permission denied'
        };
      } catch (err) {
        console.warn('Audio permission error:', err);
        return { granted: false, message: 'Error requesting microphone permission' };
      }
    }
    return { granted: true };
  }

  // Storage permissions
  static async requestStoragePermission(): Promise<PermissionResult> {
    if (Platform.OS === 'android') {
      try {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        ];

        // For Android 13+ (API 33+), use new media permissions
        if (Platform.Version >= 33) {
          permissions.push(
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
          );
        }

        const granted = await PermissionsAndroid.requestMultiple(permissions);
        
        const allGranted = Object.values(granted).every(
          permission => permission === PermissionsAndroid.RESULTS.GRANTED
        );
        
        return {
          granted: allGranted,
          message: allGranted 
            ? 'Storage permissions granted' 
            : 'Some storage permissions were denied'
        };
      } catch (err) {
        console.warn('Storage permission error:', err);
        return { granted: false, message: 'Error requesting storage permissions' };
      }
    }
    return { granted: true };
  }

  // Location permissions
  static async requestLocationPermission(): Promise<PermissionResult> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'ConnectHer needs access to your location for community features.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        return {
          granted: granted === PermissionsAndroid.RESULTS.GRANTED,
          message: granted === PermissionsAndroid.RESULTS.GRANTED 
            ? 'Location permission granted' 
            : 'Location permission denied'
        };
      } catch (err) {
        console.warn('Location permission error:', err);
        return { granted: false, message: 'Error requesting location permission' };
      }
    }
    return { granted: true };
  }

  // Phone permissions for calling
  static async requestPhonePermission(): Promise<PermissionResult> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CALL_PHONE,
          {
            title: 'Phone Permission',
            message: 'ConnectHer needs permission to make phone calls.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        return {
          granted: granted === PermissionsAndroid.RESULTS.GRANTED,
          message: granted === PermissionsAndroid.RESULTS.GRANTED 
            ? 'Phone permission granted' 
            : 'Phone permission denied'
        };
      } catch (err) {
        console.warn('Phone permission error:', err);
        return { granted: false, message: 'Error requesting phone permission' };
      }
    }
    return { granted: true };
  }

  // Request all essential permissions at once
  static async requestAllPermissions(): Promise<{ [key: string]: PermissionResult }> {
    const results = {
      camera: await this.requestCameraPermission(),
      audio: await this.requestAudioPermission(),
      storage: await this.requestStoragePermission(),
      location: await this.requestLocationPermission(),
      phone: await this.requestPhonePermission(),
    };

    return results;
  }

  // Check if permission is granted
  static async checkPermission(permission: string): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const result = await PermissionsAndroid.check(permission);
        return result;
      } catch (err) {
        console.warn('Permission check error:', err);
        return false;
      }
    }
    return true;
  }

  // Show permission rationale
  static showPermissionRationale(permissionType: string, onRetry: () => void) {
    Alert.alert(
      'Permission Required',
      `ConnectHer needs ${permissionType} permission to function properly. Please grant the permission to continue.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Retry',
          onPress: onRetry,
        },
      ]
    );
  }
}