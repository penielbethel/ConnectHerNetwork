import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  Alert,
  RefreshControl,
} from 'react-native';
import {useNavigation, useFocusEffect} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import apiService from '../services/ApiService';
import socketService from '../services/SocketService';
import {colors, globalStyles} from '../styles/globalStyles';
import PushNotificationService from '../services/pushNotifications';

interface Chat {
  _id: string;
  participants: {
    username: string;
    name: string;
    avatar: string;
    isOnline: boolean;
  }[];
  lastMessage: {
    content: string;
    sender: string;
    timestamp: string;
    type: string;
  };
  unreadCount: number;
  updatedAt: string;
}

interface User {
  username: string;
  name: string;
  avatar: string;
}

const ChatScreen = () => {
  const getAvatarUri = (uri?: string) => {
    if (uri && uri.trim()) return uri;
    return 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png';
  };

  const getInitial = (name?: string, username?: string) => {
    const base = (name || username || 'U').trim();
    return base ? base.charAt(0).toUpperCase() : 'U';
  };

  const navigation = useNavigation();
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredChats, setFilteredChats] = useState<Chat[]>([]);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    loadCurrentUser();
    loadChats();
    setupSocketListeners();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadChats();
    }, [])
  );

  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = chats.filter(chat => {
        const otherParticipant = chat.participants.find(
          p => p.username !== currentUser?.username
        );
        return (
          otherParticipant?.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          otherParticipant?.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
          chat.lastMessage?.content.toLowerCase().includes(searchQuery.toLowerCase())
        );
      });
      setFilteredChats(filtered);
    } else {
      setFilteredChats(chats);
    }
  }, [searchQuery, chats, currentUser]);

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

  const loadChats = async () => {
    try {
      const userData = await AsyncStorage.getItem('currentUser');
      const me: any = userData ? JSON.parse(userData) : null;

      // 1) Load confirmed friends
      const resp = await apiService.getFriends();
      const friends = (resp?.users || resp?.friends || []).map((f: any) => ({
        username: f?.username || f?.user?.username,
        name: f?.name || f?.user?.name,
        avatar: f?.avatar || f?.user?.avatar,
      }));

      // Base chat list with friends
      const baseChats: Chat[] = friends.map((friend: any) => {
        const other = {
          username: friend.username,
          name: friend.name,
          avatar: friend.avatar ? getAvatarUri(friend.avatar) : getAvatarUri(),
          isOnline: false,
        };
        const mePart = me ? {
          username: me.username,
          name: me.name,
          avatar: me.avatar ? getAvatarUri(me.avatar) : getAvatarUri(),
          isOnline: true,
        } : undefined;

        return {
          _id: me && friend.username ? [me.username, friend.username].sort().join('_') : friend.username,
          participants: mePart ? [mePart, other] : [other],
          lastMessage: undefined as any,
          unreadCount: 0,
          updatedAt: new Date().toISOString(),
        } as Chat;
      });

      // 2) Enrich with latest message previews and timestamps
      const latest = me?.username ? await apiService.getLatestChats(me.username) : [];
      const latestByFriend: Record<string, any> = {};
      latest.forEach((entry: any) => {
        const friendKey = (entry?.friendUsername || entry?.friend || '').toLowerCase();
        const msg = entry?.lastMessage;
        // Respect soft-hidden messages
        const hiddenFrom: string[] = Array.isArray(msg?.hiddenFrom) ? msg.hiddenFrom.map((u: any) => String(u).toLowerCase()) : [];
        const meKey = String(me?.username || '').toLowerCase();
        if (hiddenFrom.includes(meKey)) return;
        latestByFriend[friendKey] = msg || null;
      });

      const enriched = baseChats
        .map(c => {
          const other = c.participants.find(p => p.username !== me?.username);
          const key = other?.username ? other.username.toLowerCase() : undefined;
          const msg = key ? latestByFriend[key] : undefined;

          let lastMessage: any = c.lastMessage;
          let updatedAt = c.updatedAt;

          if (msg) {
            const text = (msg.text || '').trim();
            const hasMedia = Array.isArray(msg.media) && msg.media.length > 0;
            const hasAudio = !!msg.audio && String(msg.audio).trim().length > 0;
            const content = text
              ? text
              : hasMedia
              ? '📷 Media'
              : hasAudio
              ? '🎙️ Voice Note'
              : '';
            const type = text ? 'text' : hasMedia ? 'image' : hasAudio ? 'audio' : 'text';
            if (content) {
              lastMessage = {
                content,
                sender: msg.sender,
                timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
                type,
              } as any;
            }
            updatedAt = msg.createdAt || msg.timestamp || updatedAt;
          }

          return { ...c, lastMessage, updatedAt } as Chat;
        })
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

      // Hydrate missing previews from cache to keep list stable
      const withCache = await Promise.all(
        enriched.map(async ch => {
          if (ch.lastMessage) return ch;
          try {
            const cached = await AsyncStorage.getItem(`lastPreview:${ch._id}`);
            if (cached) {
              return { ...ch, lastMessage: JSON.parse(cached) } as Chat;
            }
          } catch (_) {}
          return ch;
        })
      );

      setChats(withCache);
      // Persist last message previews for stability across reloads
      try {
        for (const ch of withCache) {
          if (ch.lastMessage) {
            await AsyncStorage.setItem(`lastPreview:${ch._id}`, JSON.stringify(ch.lastMessage));
          }
        }
      } catch (_) {}

      // 3) Fetch last-seen for friends to show effective online time
      try {
        const usernames = withCache
          .map(ch => ch.participants.find(p => p.username !== me?.username)?.username)
          .filter(Boolean) as string[];
        const uniqueUsernames = Array.from(new Set(usernames));
        const results = await Promise.all(
          uniqueUsernames.map(async (u) => {
            try {
              const res = await apiService.getLastSeen(u);
              const ts = (res && (res as any).lastSeen) || null;
              return { u, ts } as { u: string; ts: string | null };
            } catch {
              return { u, ts: null } as { u: string; ts: string | null };
            }
          })
        );
        const map: Record<string, string> = {};
        results.forEach(r => { if (r.ts) map[r.u] = r.ts; });
        setLastSeenByUser(map);
      } catch (_) {
        // ignore last-seen failures
      }
    } catch (error) {
      console.error('Error loading chats:', error);
      try {
        await loadChatsFromFriendsFallback();
      } catch (fallbackErr) {
        console.error('Error loading chats from friends fallback:', fallbackErr);
      }
    } finally {
      setLoading(false);
    }
  };

  const loadChatsFromFriendsFallback = async () => {
    try {
      const userData = await AsyncStorage.getItem('currentUser');
      const me: any = userData ? JSON.parse(userData) : null;
      const resp = await apiService.getFriends();
      const friends = (resp?.users || resp?.friends || []).map((f: any) => ({
        username: f?.username || f?.user?.username,
        name: f?.name || f?.user?.name,
        avatar: f?.avatar || f?.user?.avatar,
      }));

      const fallbackChats = [] as Chat[];
      for (const friend of friends) {
        const other = {
          username: friend.username,
          name: friend.name,
          avatar: friend.avatar ? getAvatarUri(friend.avatar) : getAvatarUri(),
          isOnline: false,
        };
        const mePart = me ? {
          username: me.username,
          name: me.name,
          avatar: me.avatar ? getAvatarUri(me.avatar) : getAvatarUri(),
          isOnline: true,
        } : undefined;

        const chatId = me && friend.username ? [me.username, friend.username].sort().join('_') : friend.username;
        let lastMessage: any = undefined;
        try {
          const cached = await AsyncStorage.getItem(`lastPreview:${chatId}`);
          lastMessage = cached ? JSON.parse(cached) : undefined;
        } catch (_) {}

        fallbackChats.push({
          _id: chatId,
          participants: mePart ? [mePart, other] : [other],
          lastMessage: lastMessage as any,
          unreadCount: 0,
          updatedAt: new Date().toISOString(),
        } as Chat);
      }

      setChats(fallbackChats);
      setFilteredChats(fallbackChats);
    } catch (err) {
      console.error('Friends fallback failed:', err);
    }
  };

  const setupSocketListeners = () => {
    const socket = socketService.getSocket();
    if (socket) {
      // Backend emits 'newMessage' with the saved message document
      socket.on('newMessage', (msg: any) => {
        const notifier = PushNotificationService.getInstance();
        setChats(prevChats => {
          const updated = prevChats.map(chat => {
            const usernames = chat.participants.map(p => p.username.toLowerCase());
            const sender = String(msg?.sender || '').toLowerCase();
            const recipient = String(msg?.recipient || '').toLowerCase();
            const involvesChat = usernames.includes(sender) && usernames.includes(recipient);
            if (!involvesChat) return chat;

            const isIncoming = msg?.sender && msg.sender !== currentUser?.username;
            const text = (msg?.text || '').trim();
            const hasMedia = Array.isArray(msg?.media) && msg.media.length > 0;
            const hasAudio = !!msg?.audio && String(msg.audio).trim().length > 0;
            const content = text
              ? text
              : hasMedia
              ? '📷 Media'
              : hasAudio
              ? '🎙️ Voice Note'
              : 'Message';
            const type = text ? 'text' : hasMedia ? 'image' : hasAudio ? 'audio' : 'text';

            // Local notification for incoming messages
            if (isIncoming) {
              try {
                notifier.showLocalNotification({
                  title: `New message from ${msg.sender}`,
                  body: content,
                  channelId: 'connecther_messages',
                  priority: 'high',
                  vibrate: true,
                });
              } catch (e) {
                // ignore notification errors
              }
            }

            return {
              ...chat,
              lastMessage: {
                content,
                sender: msg.sender,
                timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
                type,
              } as any,
              unreadCount: isIncoming ? chat.unreadCount + 1 : chat.unreadCount,
              updatedAt: msg.createdAt || msg.timestamp || chat.updatedAt,
            } as Chat;
          });
          // Persist the latest preview for the affected chat(s)
          try {
            for (const ch of updated) {
              if (ch.lastMessage) {
                AsyncStorage.setItem(`lastPreview:${ch._id}`, JSON.stringify(ch.lastMessage)).catch(() => {});
              }
            }
          } catch (_) {}
          return updated.sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        });
      });

      socket.on('user-online', (username: string) => {
        setChats(prevChats =>
          prevChats.map(chat => ({
            ...chat,
            participants: chat.participants.map(p =>
              p.username === username ? {...p, isOnline: true} : p
            ),
          }))
        );
      });

      socket.on('user-offline', (username: string) => {
        setChats(prevChats =>
          prevChats.map(chat => ({
            ...chat,
            participants: chat.participants.map(p =>
              p.username === username ? {...p, isOnline: false} : p
            ),
          }))
        );
      });

      // Refresh chats/friends list when a friendship is accepted
      socket.on('friendship-accepted', () => {
        loadChats();
      });
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadChats();
    setRefreshing(false);
  };

  // Track last-seen per friend to display accurate time-ago in the list
  const [lastSeenByUser, setLastSeenByUser] = useState<Record<string, string>>({});

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return date.toLocaleDateString();
  };

  const getLastMessagePreview = (message: any) => {
    if (!message) return 'No messages yet';
    
    switch (message.type) {
      case 'image':
        return '📷 Media';
      case 'video':
        return '🎥 Media';
      case 'audio':
        return '🎵 Audio';
      case 'file':
        return '📎 File';
      default:
        return message.content || 'Message';
    }
  };

  const handleChatPress = (chat: Chat) => {
    const otherParticipant = chat.participants.find(
      p => p.username !== currentUser?.username
    );
    
    if (otherParticipant) {
      // Reset unread count when opening the conversation
      setChats(prev => prev.map(c => (c._id === chat._id ? { ...c, unreadCount: 0 } : c)));
      navigation.navigate('Conversation' as never, {
        chatId: chat._id,
        recipientUsername: otherParticipant.username,
        recipientName: otherParticipant.name,
        recipientAvatar: otherParticipant.avatar,
      } as never);
    }
  };

  const handleNewChat = () => {
    // Navigate to user search/selection screen
    Alert.alert('New Chat', 'Feature coming soon!');
  };

  const renderChatItem = ({item}: {item: Chat}) => {
    const otherParticipant = item.participants.find(
      p => p.username !== currentUser?.username
    );

    if (!otherParticipant) return null;

    const isUnread = item.unreadCount > 0;
    const lastMessageSender = item.lastMessage?.sender === currentUser?.username ? 'You: ' : '';

    return (
      <TouchableOpacity
        style={[styles.chatItem, isUnread && styles.unreadChat]}
        onPress={() => handleChatPress(item)}>
        <View style={styles.avatarContainer}>
          <Image source={{uri: getAvatarUri(otherParticipant?.avatar)}} style={styles.avatarSm} />
          {otherParticipant.isOnline && <View style={styles.onlineIndicator} />}
        </View>

        <View style={styles.chatInfo}>
          <View style={globalStyles.flexRowBetween}>
            <Text style={[styles.chatName, isUnread && styles.unreadText]}>
              {otherParticipant?.name || otherParticipant?.username || 'User'}
            </Text>
            <Text style={styles.timeText}>
              {lastSeenByUser[otherParticipant.username]
                ? formatTime(lastSeenByUser[otherParticipant.username])
                : formatTime(item.updatedAt)}
            </Text>
          </View>

          <View style={globalStyles.flexRowBetween}>
            <Text
              style={[styles.lastMessage, isUnread && styles.unreadText]}
              numberOfLines={1}>
              {lastMessageSender}{getLastMessagePreview(item.lastMessage)}
            </Text>
            {isUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadCount}>
                  {item.unreadCount > 99 ? '99+' : item.unreadCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Icon name="chat-bubble-outline" size={64} color={colors.textMuted} />
      <Text style={styles.emptyStateText}>No conversations yet</Text>
      <Text style={styles.emptyStateSubtext}>
        Start a new conversation to connect with others
      </Text>
      <TouchableOpacity style={globalStyles.button} onPress={handleNewChat}>
        <Text style={globalStyles.buttonText}>Start New Chat</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerAvatarCircle}>
            {currentUser?.avatar ? (
              <Image source={{ uri: getAvatarUri(currentUser.avatar) }} style={styles.headerAvatar} />
            ) : (
              <Text style={styles.headerAvatarInitial}>{getInitial(currentUser?.name, currentUser?.username)}</Text>
            )}
          </View>
          <View>
            <Text style={styles.headerTitle}>Messages</Text>
            <Text style={styles.headerSubtitle}>End-to-end encrypted</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerButton} onPress={() => setShowSearch(!showSearch)}>
            <Icon name="search" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton} onPress={handleNewChat}>
            <Icon name="chat" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerButton}>
            <Icon name="more-vert" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      {showSearch && (
        <View style={styles.searchContainer}>
          <Icon name="search" size={20} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search conversations..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="clear" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Chat List */}
      <FlatList
        data={filteredChats}
        keyExtractor={item => item._id}
        renderItem={renderChatItem}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={!loading ? renderEmptyState : null}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    ...globalStyles.flexRow,
    alignItems: 'center',
  },
  headerAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  headerAvatarInitial: {
    color: colors.text,
    fontWeight: 'bold',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  headerActions: {
    ...globalStyles.flexRow,
    alignItems: 'center',
  },
  headerButton: {
    marginLeft: 12,
  },
  searchContainer: {
    ...globalStyles.flexRow,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    marginHorizontal: 10,
    color: colors.text,
    fontSize: 16,
  },
  chatItem: {
    ...globalStyles.flexRow,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  unreadChat: {
    backgroundColor: colors.background,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 15,
  },
  avatarSm: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.secondary,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  chatInfo: {
    flex: 1,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  unreadText: {
    fontWeight: 'bold',
  },
  timeText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  lastMessage: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
    flex: 1,
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
  unreadCount: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 'bold',
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
    marginBottom: 30,
  },
});

export default ChatScreen;