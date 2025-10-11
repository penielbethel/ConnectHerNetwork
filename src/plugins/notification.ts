import { registerPlugin } from '@capacitor/core';

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

const NotificationPlugin = registerPlugin<NotificationPlugin>('NotificationPlugin');

export default NotificationPlugin;