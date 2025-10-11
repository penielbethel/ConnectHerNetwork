import React, { useState, useEffect } from 'react';
import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton, IonItem, IonLabel, IonList, IonCard, IonCardContent, IonCardHeader, IonCardTitle } from '@ionic/react';
import NotificationPlugin from '../plugins/notification';

const NotificationTest: React.FC = () => {
  const [permissionStatus, setPermissionStatus] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    try {
      const status = await NotificationPlugin.checkPermissions();
      setPermissionStatus(status);
    } catch (error) {
      console.error('Error checking permissions:', error);
      setMessage('Error checking permissions: ' + error);
    }
  };

  const requestPermissions = async () => {
    setLoading(true);
    try {
      const result = await NotificationPlugin.requestPermissions();
      setMessage(result.message);
      // Refresh permission status
      await checkPermissions();
    } catch (error) {
      console.error('Error requesting permissions:', error);
      setMessage('Error requesting permissions: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const createNotificationChannel = async () => {
    setLoading(true);
    try {
      const result = await NotificationPlugin.createNotificationChannel({
        channelId: 'high_priority_alerts',
        channelName: 'High Priority Alerts',
        channelDescription: 'Critical notifications that require immediate attention',
        isHighPriority: true
      });
      setMessage(result.message);
    } catch (error) {
      console.error('Error creating notification channel:', error);
      setMessage('Error creating notification channel: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const wakeUpScreen = async () => {
    setLoading(true);
    try {
      const result = await NotificationPlugin.wakeUpScreen();
      setMessage(result.message);
    } catch (error) {
      console.error('Error waking up screen:', error);
      setMessage('Error waking up screen: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const sendTestNotification = async () => {
    setLoading(true);
    try {
      const result = await NotificationPlugin.sendTestNotification();
      setMessage(result.message);
    } catch (error) {
      console.error('Error sending test notification:', error);
      setMessage('Error sending test notification: ' + error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Notification Test</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Permission Status</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {permissionStatus ? (
              <IonList>
                <IonItem>
                  <IonLabel>
                    <h3>Notification Permission</h3>
                    <p>{permissionStatus.hasNotificationPermission ? '✅ Granted' : '❌ Not Granted'}</p>
                  </IonLabel>
                </IonItem>
                <IonItem>
                  <IonLabel>
                    <h3>Overlay Permission</h3>
                    <p>{permissionStatus.hasOverlayPermission ? '✅ Granted' : '❌ Not Granted'}</p>
                  </IonLabel>
                </IonItem>
                <IonItem>
                  <IonLabel>
                    <h3>Battery Optimization</h3>
                    <p>{permissionStatus.isBatteryOptimized ? '⚠️ Optimized (Should be disabled)' : '✅ Not Optimized'}</p>
                  </IonLabel>
                </IonItem>
                <IonItem>
                  <IonLabel>
                    <h3>Exact Alarm Permission</h3>
                    <p>{permissionStatus.hasExactAlarmPermission ? '✅ Granted' : '❌ Not Granted'}</p>
                  </IonLabel>
                </IonItem>
              </IonList>
            ) : (
              <p>Loading permission status...</p>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Actions</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonButton 
              expand="block" 
              onClick={requestPermissions} 
              disabled={loading}
              style={{ marginBottom: '10px' }}
            >
              Request All Permissions
            </IonButton>
            
            <IonButton 
              expand="block" 
              onClick={createNotificationChannel} 
              disabled={loading}
              style={{ marginBottom: '10px' }}
            >
              Create Notification Channel
            </IonButton>
            
            <IonButton 
              expand="block" 
              onClick={wakeUpScreen} 
              disabled={loading}
              style={{ marginBottom: '10px' }}
            >
              Wake Up Screen
            </IonButton>
            
            <IonButton 
              expand="block" 
              onClick={sendTestNotification} 
              disabled={loading}
              color="success"
            >
              Send Test Notification
            </IonButton>
            
            <IonButton 
              expand="block" 
              onClick={checkPermissions} 
              disabled={loading}
              fill="outline"
              style={{ marginTop: '10px' }}
            >
              Refresh Status
            </IonButton>
          </IonCardContent>
        </IonCard>

        {message && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Result</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>{message}</p>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>
    </IonPage>
  );
};

export default NotificationTest;