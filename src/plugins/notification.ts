// React Native-safe stub for NotificationPlugin to avoid Capacitor dependency
// Provides no-op implementations that keep the app bundling and running

export interface NotificationPlugin {
  /**
   * Request all necessary permissions for notifications
   */
  requestPermissions(): Promise<{ success: boolean; message: string }>;

  /**
   * Create a notification channel for Android 8+
   */
  createNotificationChannel(options: {
    channelId?: string;
    channelName?: string;
    channelDescription?: string;
    isHighPriority?: boolean;
  }): Promise<{ success: boolean; message: string }>;

  /**
   * Wake up the screen and show over lock screen
   */
  wakeUpScreen(): Promise<{ success: boolean; message: string }>;

  /**
   * Send a test notification
   */
  sendTestNotification(): Promise<{ success: boolean; message: string }>;

  /**
   * Check current permission status
   */
  checkPermissions(): Promise<{
    hasNotificationPermission: boolean;
    hasOverlayPermission: boolean;
    isBatteryOptimized: boolean;
    hasExactAlarmPermission: boolean;
  }>;
}

const NotificationPlugin: NotificationPlugin = {
  async requestPermissions() {
    return { success: true, message: 'RN stub: permissions assumed granted' };
  },
  async createNotificationChannel() {
    return { success: true, message: 'RN stub: channel handled by PushNotificationService' };
  },
  async wakeUpScreen() {
    // RN doesn’t expose a direct wake API; rely on high-priority local notifications
    return { success: true, message: 'RN stub: wake simulated by heads-up notification' };
  },
  async sendTestNotification() {
    return { success: true, message: 'RN stub: no-op test notification' };
  },
  async checkPermissions() {
    return {
      hasNotificationPermission: true,
      hasOverlayPermission: false,
      isBatteryOptimized: false,
      hasExactAlarmPermission: false,
    };
  },
};

export default NotificationPlugin;