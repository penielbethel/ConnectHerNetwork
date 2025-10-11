import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  Alert,
} from 'react-native';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import apiService from '../services/ApiService';
import PushNotificationService from '../services/pushNotifications';
import socketService from '../services/SocketService';
import {colors, globalStyles} from '../styles/globalStyles';

interface Notification {
  _id: string;
  type: 'like' | 'comment' | 'follow' | 'message' | 'community' | 'friend_request';
  title: string;
  message: string;
  sender: {
    username: string;
    name: string;
    avatar: string;
  };
  data: any;
  isRead: boolean;
  createdAt: string;
}

interface User {
  username: string;
  name: string;
  avatar: string;
}

type NotificationTab = 'friends' | 'call' | 'activity' | 'sponsors';

const NotificationScreen = () => {
  const navigation = useNavigation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [callLogs, setCallLogs] = useState<any[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<NotificationTab>('activity');

  // Local helper used across other screens to safely render avatar URIs
  const getAvatarUri = (uri?: string) => {
    if (!uri) return undefined as unknown as string;
    if (/^https?:\/\//i.test(uri)) return uri;
    return `${(apiService as any).rootUrl || 'https://connecther.network'}/${String(uri).replace(/^\/+/, '')}`;
  };

  useEffect(() => {
    loadCurrentUser();
    // Ensure push is prepared when user visits Notifications
    const push = PushNotificationService.getInstance();
    push.initialize();
    // Register a dedicated Sponsors Alert channel
    try {
      push.createChannel({
        channelId: 'sponsors_alerts',
        channelName: 'Sponsors Alerts',
        channelDescription: 'Notifications about sponsor posts and opportunities',
      });
    } catch (_e) {}

    // Foreground handler to surface sponsor alerts instantly
    push.onMessage((msg: any) => {
      const type = msg?.data?.type || msg?.type;
      if (type === 'sponsor_alert') {
        try {
          push.showLocalNotification({
            title: msg?.notification?.title || msg?.title || 'Sponsor Alert',
            body: msg?.notification?.body || msg?.body || 'New opportunity from a sponsor',
            data: msg?.data || { type: 'sponsor_alert' },
            channelId: 'sponsors_alerts',
          });
        } catch (e) {
          console.log('Local sponsor alert failed:', e);
        }
        // Prepend into sponsors tab
        const n: Notification = {
          _id: String(Date.now()),
          type: 'community',
          title: msg?.notification?.title || msg?.title || 'Sponsor Alert',
          message: msg?.notification?.body || msg?.body || '',
          sender: {
            username: msg?.data?.sponsorUsername || 'sponsor',
            name: msg?.data?.sponsorName || 'Sponsor',
            avatar: msg?.data?.sponsorAvatar || '',
          },
          data: msg?.data || {},
          isRead: false,
          createdAt: new Date().toISOString(),
        } as any;
        setNotifications(prev => [n, ...prev]);
      }
    });

    // Background notifications are handled by the service; ensure it is active
    push.enableBackgroundHandling();

    loadNotifications();
    setupSocketListeners();
  }, []);

  // Reload when tab changes or after current user is resolved
  useEffect(() => {
    loadNotifications();
  }, [selectedTab, currentUser]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [])
  );

  const loadCurrentUser = async () => {
    try {
      const userData = await AsyncStorage.getItem('currentUser');
      if (userData) {
        setCurrentUser(JSON.parse(userData));
      }
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const loadNotifications = async () => {
    try {
      // Fetch based on tab selection
      let response: any;
      if (selectedTab === 'activity') {
        const username = currentUser?.username;
        response = await apiService.getNotifications(username);
      } else if (selectedTab === 'sponsors') {
        response = await apiService.getNotifications();
      } else if (selectedTab === 'call') {
        const username = currentUser?.username;
        if (username) {
          const logs = await apiService.getCallLogs(username);
          setCallLogs(Array.isArray(logs) ? logs : []);
        } else {
          setCallLogs([]);
        }
      } else {
        // Placeholder for future tabs: friends/follow requests and calls
        response = { success: true, notifications: [] };
      }

      if (response?.success) {
        let items: Notification[] = response.notifications || [];
        // Filter per tab
        if (selectedTab === 'activity') {
          items = items.filter(n => ['like', 'comment', 'reply', 'share'].includes(n.type));
        }
        if (selectedTab === 'sponsors') {
          // Allow any sponsor-related server notifications; keep as-is
        }
        setNotifications(items);
      }
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const setupSocketListeners = () => {
    const socket = socketService.getSocket();
    if (socket) {
      socket.on('new-notification', (notification: Notification) => {
        setNotifications(prev => [notification, ...prev]);
      });

      // Keep notifications in sync with friend request actions
      socket.on('friendship-accepted', () => {
        loadNotifications();
      });
      socket.on('friendship-declined', () => {
        loadNotifications();
      });
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (selectedTab === 'call') {
      try {
        const username = currentUser?.username;
        if (username) {
          const logs = await apiService.getCallLogs(username);
          setCallLogs(Array.isArray(logs) ? logs : []);
        } else {
          setCallLogs([]);
        }
      } catch (e) {
        console.error('Refresh call logs error:', e);
      }
    } else {
      await loadNotifications();
    }
    setRefreshing(false);
  };

  const handleNotificationPress = async (notification: Notification) => {
    // Mark as read if not already read
    if (!notification.isRead) {
      try {
        await apiService.markNotificationAsRead(notification._id);
        setNotifications(prev =>
          prev.map(n =>
            n._id === notification._id ? {...n, isRead: true} : n
          )
        );
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }

    // Navigate based on notification type
    switch (notification.type) {
      case 'like':
      case 'comment':
        // Navigate to post detail or user profile
        navigation.navigate('Profile' as never, {
          username: notification.sender.username
        } as never);
        break;
      
      case 'follow':
        navigation.navigate('Profile' as never, {
          username: notification.sender.username
        } as never);
        break;
      
      case 'message':
        navigation.navigate('Conversation' as never, {
          recipientUsername: notification.sender.username,
          recipientName: notification.sender.name,
          recipientAvatar: notification.sender.avatar,
        } as never);
        break;
      
      case 'friend_request':
        navigation.navigate('Profile' as never, {
          username: notification.sender.username
        } as never);
        break;
      
      case 'community':
        // Navigate to community screen
        navigation.navigate('Community' as never);
        break;
      
      default:
        break;
    }
  };

  const handleAcceptFriendRequest = async (notification: Notification) => {
    try {
      const resp = await apiService.acceptFriendRequest(notification.sender.username);
      if (resp?.success !== false) {
        setNotifications(prev => prev.filter(n => n._id !== notification._id));
        try {
          PushNotificationService.getInstance().showLocalNotification({
            title: 'Friend Request Accepted',
            body: `You are now friends with @${notification.sender.username}`,
            data: { type: 'profile', username: notification.sender.username },
            channelId: 'connecther_notifications',
          });
        } catch (e) {
          console.log('Local notification failed:', e);
        }
        // Optionally open conversation
        navigation.navigate('Conversation' as never, {
          recipientUsername: notification.sender.username,
          recipientName: notification.sender.name,
          recipientAvatar: notification.sender.avatar,
        } as never);
      } else {
        Alert.alert('Error', 'Could not accept friend request');
      }
    } catch (error) {
      console.error('Accept friend request error:', error);
      Alert.alert('Error', 'Could not accept friend request');
    }
  };

  const handleDeclineFriendRequest = async (notification: Notification) => {
    try {
      const resp = await apiService.declineFriendRequest(notification.sender.username);
      if (resp?.success !== false) {
        setNotifications(prev => prev.filter(n => n._id !== notification._id));
      } else {
        Alert.alert('Error', 'Could not decline friend request');
      }
    } catch (error) {
      console.error('Decline friend request error:', error);
      Alert.alert('Error', 'Could not decline friend request');
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const response = await apiService.markAllNotificationsAsRead();
      if (response.success) {
        setNotifications(prev =>
          prev.map(n => ({...n, isRead: true}))
        );
      }
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      Alert.alert('Error', 'Failed to mark notifications as read');
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      selectedTab === 'call' ? 'Clear All Calls' : 'Clear All Notifications',
      selectedTab === 'call'
        ? 'Are you sure you want to clear all call logs? This action cannot be undone.'
        : 'Are you sure you want to clear all notifications? This action cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              if (selectedTab === 'call') {
                const ids = callLogs.map((c: any) => c._id).filter(Boolean);
                if (ids.length > 0) {
                  await apiService.bulkDeleteCallLogs(ids);
                }
                setCallLogs([]);
              } else {
                const response = await apiService.clearAllNotifications();
                if (response.success) {
                  setNotifications([]);
                }
              }
            } catch (error) {
              console.error('Error clearing', error);
              Alert.alert('Error', selectedTab === 'call' ? 'Failed to clear call logs' : 'Failed to clear notifications');
            }
          },
        },
      ]
    );
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'like':
        return 'favorite';
      case 'comment':
        return 'comment';
      case 'reply':
        return 'reply';
      case 'share':
        return 'share';
      case 'follow':
        return 'person-add';
      case 'message':
        return 'message';
      case 'community':
        return 'group';
      case 'friend_request':
        return 'person-add-alt';
      default:
        return 'notifications';
    }
  };

  const getNotificationIconColor = (type: string) => {
    switch (type) {
      case 'like':
        return colors.error;
      case 'comment':
        return colors.info;
      case 'reply':
        return colors.info;
      case 'share':
        return colors.primary;
      case 'follow':
        return colors.success;
      case 'message':
        return colors.primary;
      case 'community':
        return colors.warning;
      case 'friend_request':
        return colors.success;
      default:
        return colors.textMuted;
    }
  };

  const renderNotification = ({item}: {item: Notification}) => (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        !item.isRead && styles.unreadNotification
      ]}
      onPress={() => handleNotificationPress(item)}>
      
      <View style={styles.notificationContent}>
        <View style={styles.notificationHeader}>
          <Image source={{uri: getAvatarUri(item?.sender?.avatar)}} style={styles.senderAvatar} />
          
          <View style={styles.iconContainer}>
            <Icon
              name={getNotificationIcon(item.type)}
              size={16}
              color={getNotificationIconColor(item.type)}
            />
          </View>
        </View>

        <View style={styles.notificationBody}>
          <Text style={[styles.notificationTitle, !item.isRead && styles.unreadText]}>
            {item.title}
          </Text>
          <Text style={styles.notificationMessage} numberOfLines={2}>
            {item.message}
          </Text>
          {item.type === 'friend_request' && (
            <View style={styles.requestActionsRow}>
              <TouchableOpacity style={styles.requestActionButtonAccept} onPress={() => handleAcceptFriendRequest(item)}>
                <Text style={styles.requestActionText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.requestActionButtonDecline} onPress={() => handleDeclineFriendRequest(item)}>
                <Text style={styles.requestActionText}>Decline</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={styles.notificationTime}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>

      {!item.isRead && <View style={styles.unreadIndicator} />}
    </TouchableOpacity>
  );

  const CallLogItem = ({ log }: { log: any }) => {
    const [otherUser, setOtherUser] = useState<{ username: string; name?: string; avatar?: string } | null>(null);
    useEffect(() => {
      const other = currentUser?.username === log.caller ? log.receiver : log.caller;
      (async () => {
        try {
          const profile = await apiService.getUserByUsername(other);
          setOtherUser(profile as any);
        } catch (_) {
          setOtherUser({ username: other });
        }
      })();
    }, [log]);

    const time = log.timestamp || log.createdAt || new Date().toISOString();
    const isIncoming = currentUser?.username === log.receiver;
    const title = `${isIncoming ? 'Incoming' : 'Outgoing'} ${log.type === 'video' ? 'Video' : 'Voice'} Call`;
    const subtitle = isIncoming ? `from @${otherUser?.name || otherUser?.username}` : `to @${otherUser?.name || otherUser?.username}`;

    const handleDelete = async () => {
      try {
        await apiService.deleteCallLog(log._id);
        setCallLogs(prev => prev.filter(c => c._id !== log._id));
      } catch (e) {
        Alert.alert('Error', 'Failed to delete call log');
      }
    };

    return (
      <View style={styles.notificationItem}>
        <View style={styles.notificationContent}>
          <View style={styles.notificationHeader}>
            <Image source={{ uri: getAvatarUri(otherUser?.avatar) }} style={styles.senderAvatar} />
            <View style={styles.iconContainer}>
              <Icon name={isIncoming ? 'call' : 'call-made'} size={16} color={isIncoming ? colors.success : colors.primary} />
            </View>
          </View>
          <View style={styles.notificationBody}>
            <Text style={styles.notificationTitle}>{title}</Text>
            <Text style={styles.notificationMessage} numberOfLines={2}>{subtitle} • {String(log.status).toUpperCase()}</Text>
            <Text style={styles.notificationTime}>{formatTime(time)}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleDelete} style={{ padding: 6 }}>
          <Icon name="delete" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Icon name="notifications-none" size={64} color={colors.textMuted} />
      <Text style={styles.emptyStateText}>No notifications yet</Text>
      <Text style={styles.emptyStateSubtext}>
        You'll see notifications for likes, comments, follows, and messages here
      </Text>
    </View>
  );

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={globalStyles.flexRow}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Icon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </View>
        
        <View style={globalStyles.flexRow}>
          {unreadCount > 0 && (
            <TouchableOpacity
              style={styles.headerButton}
              onPress={handleMarkAllAsRead}>
              <Icon name="done-all" size={24} color={colors.text} />
            </TouchableOpacity>
          )}
          
          <TouchableOpacity
            style={styles.headerButton}
            onPress={handleClearAll}>
            <Icon name="clear-all" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        {(
          [
            { key: 'friends', label: 'Friend/Follow Request' },
            { key: 'call', label: 'Call' },
            { key: 'activity', label: 'Likes, Comments, Reply, Share' },
            { key: 'sponsors', label: 'Sponsors Alert' },
          ] as { key: NotificationTab; label: string }[]
        ).map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabItem, selectedTab === tab.key && styles.tabItemActive]}
            onPress={() => {
              setSelectedTab(tab.key);
              setLoading(true);
              // Reload notifications for selected tab
              loadNotifications();
            }}>
            <Text style={[styles.tabLabel, selectedTab === tab.key && styles.tabLabelActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {selectedTab === 'call' ? (
        <FlatList
          data={callLogs}
          keyExtractor={item => item._id}
          renderItem={({ item }) => <CallLogItem log={item} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={!loading ? renderEmptyState : null}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={callLogs.length === 0 ? styles.emptyContainer : undefined}
        />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item._id}
          renderItem={renderNotification}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={!loading ? renderEmptyState : null}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : undefined}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    backgroundColor: colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#e91e63',
    marginLeft: 15,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  unreadBadgeText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  headerButton: {
    marginLeft: 15,
  },
  tabsContainer: {
    ...globalStyles.flexRowBetween,
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tabItem: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: colors.surface,
  },
  tabItemActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabLabel: {
    fontSize: 12,
    color: colors.text,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: colors.text,
  },
  notificationItem: {
    backgroundColor: colors.surface,
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  unreadNotification: {
    backgroundColor: colors.background,
  },
  notificationContent: {
    flex: 1,
    flexDirection: 'row',
  },
  notificationHeader: {
    position: 'relative',
    marginRight: 12,
  },
  senderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  iconContainer: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  notificationBody: {
    flex: 1,
    justifyContent: 'center',
  },
  notificationTitle: {
    fontSize: 16,
    color: colors.text,
    marginBottom: 2,
  },
  unreadText: {
    fontWeight: 'bold',
  },
  notificationMessage: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 4,
    lineHeight: 18,
  },
  notificationTime: {
    fontSize: 12,
    color: colors.textMuted,
  },
  requestActionsRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  requestActionButtonAccept: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    marginRight: 10,
  },
  requestActionButtonDecline: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: colors.secondary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  requestActionText: {
    color: colors.text,
    fontWeight: '600',
  },
  unreadIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginLeft: 10,
  },
  emptyContainer: {
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginTop: 20,
    marginBottom: 10,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default NotificationScreen;