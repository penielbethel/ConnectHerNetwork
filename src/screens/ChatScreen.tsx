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
      setFilteredChats(sortChatsByPresence(filtered));
    } else {
      setFilteredChats(sortChatsByPresence(chats));
    }
  }, [searchQuery, chats, currentUser, lastSeenByUser]);

  // Sort helper to arrange strictly by last seen (most recent on top)
  const sortChatsByPresence = (list: Chat[]) => {
    const getLs = (c: Chat) => {
      const other = c.participants.find(p => p.username !== currentUser?.username);
      return other?.username && lastSeenByUser[other.username]
        ? new Date(lastSeenByUser[other.username]).getTime()
        : 0;
    };
    return [...list].sort((a, b) => {
      const aLs = getLs(a);
      const bLs = getLs(b);
      if (aLs !== bLs) return bLs - aLs; // latest last seen first
      // tie-breakers: keep online users higher, then recent chat activity
      const aOnline = a.participants.find(p => p.username !== currentUser?.username)?.isOnline ? 1 : 0;
      const bOnline = b.participants.find(p => p.username !== currentUser?.username)?.isOnline ? 1 : 0;
      if (aOnline !== bOnline) return bOnline - aOnline;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  };

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

      // 0) Baseline from cache for instant render
      let cacheUsers: any[] = [];
      try {
        const cached = await AsyncStorage.getItem('friends:list');
        cacheUsers = cached ? JSON.parse(cached) : [];
      } catch (_) {}
      const baselineFriends = Array.isArray(cacheUsers) ? cacheUsers : [];
      const seenBaseline = new Set<string>();
      const uniqueBaseline = baselineFriends.filter((f: any) => {
        const key = String(f?.username || '').trim().toLowerCase();
        if (!key || seenBaseline.has(key)) return false;
        seenBaseline.add(key);
        return true;
      });
      const baselineChats: Chat[] = uniqueBaseline.map((friend: any) => {
        const other = {
          username: friend.username,
          name: friend.name || friend.username,
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
      setChats(baselineChats);
      setFilteredChats(sortChatsByPresence(baselineChats));
      setLoading(false);

      // Hydrate last message previews from cache for instant display
      try {
        const hydrated = await Promise.all(baselineChats.map(async (c) => {
          const raw = await AsyncStorage.getItem(`lastPreview:${c._id}`);
          const preview = raw ? JSON.parse(raw) : null;
          return preview ? ({ ...c, lastMessage: preview, updatedAt: (preview.timestamp || c.updatedAt) } as Chat) : c;
        }));
        setChats(hydrated);
        setFilteredChats(sortChatsByPresence(hydrated));
      } catch (_) {}

      // Fire-and-forget reconcile to avoid blocking UI
      try { apiService.request('/friends/reconcile', { method: 'POST' }).catch(() => {}); } catch (_) {}

      // 1) Background fetch of confirmed friends; patch state when ready
      (async () => {
        try {
          const resp = await apiService.getFriends();
          const friends = (resp?.users || resp?.friends || []).map((f: any) => ({
            username: f?.username || f?.user?.username,
            name: f?.name || f?.user?.name,
            avatar: f?.avatar || f?.user?.avatar,
          }));
          const seen = new Set<string>();
          const uniqueFriends = friends.filter((f: any) => {
            const key = String(f?.username || '').trim();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          const nextBaseChats: Chat[] = uniqueFriends.map((friend: any) => {
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
          // Hydrate last-message previews from cache to keep them visible
          const hydratedNext = await Promise.all(nextBaseChats.map(async (c) => {
            try {
              const raw = await AsyncStorage.getItem(`lastPreview:${c._id}`);
              const preview = raw ? JSON.parse(raw) : null;
              return preview ? ({ ...c, lastMessage: preview, updatedAt: (preview.timestamp || c.updatedAt) } as Chat) : c;
            } catch (_) { return c; }
          }));
          setChats(hydratedNext);
          setFilteredChats(sortChatsByPresence(hydratedNext));

          // Background presence hydration for offline users
          try {
            const onlineUsers = socketService.getOnlineUsers?.() || [];
            const onlineSet = new Set(Array.isArray(onlineUsers) ? onlineUsers : []);
            const offlineUsernames = nextBaseChats
              .map(c => c.participants.find(p => p.username !== me?.username)?.username)
              .filter(u => u && !onlineSet.has(String(u))) as string[];
            const uniqueOffline = Array.from(new Set(offlineUsernames));
            Promise.all(uniqueOffline.map(uname =>
              apiService.getLastSeen(uname)
                .then(res => {
                  const ts = (res as any)?.lastSeen;
                  if (ts) setLastSeenByUser(prev => ({ ...prev, [uname]: ts }));
                })
                .catch(() => {})
            )).catch(() => {});
          } catch (_) {}
        } catch (_) {}
      })();

      // 2) Background latest message previews and timestamps
      if (me?.username) {
        (async () => {
          try {
            const latest = await apiService.getLatestChats(me.username);
            const latestByFriend: Record<string, any> = {};
            (latest as any[]).forEach((entry: any) => {
              const friendKey = (entry?.friendUsername || entry?.friend || '').toLowerCase();
              const msg = entry?.lastMessage;
              const hiddenFrom: string[] = Array.isArray(msg?.hiddenFrom) ? msg.hiddenFrom.map((u: any) => String(u).toLowerCase()) : [];
              const meKey = String(me?.username || '').toLowerCase();
              if (hiddenFrom.includes(meKey)) return;
              latestByFriend[friendKey] = msg || null;
            });
            setChats(prev => {
              const updated = prev.map(c => {
                const other = c.participants.find(p => p.username !== me?.username);
                const key = other?.username ? other.username.toLowerCase() : undefined;
                const msg = key ? latestByFriend[key] : undefined;
                if (!msg) return c;
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
                return {
                  ...c,
                  lastMessage: {
                    content,
                    sender: msg.sender,
                    timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
                    type,
                  } as any,
                  updatedAt: msg.createdAt || msg.timestamp || c.updatedAt,
                } as Chat;
              });
              const sorted = sortChatsByPresence(updated);
              setFilteredChats(sorted);
              try {
                for (const ch of updated) {
                  if (ch.lastMessage) {
                    AsyncStorage.setItem(`lastPreview:${ch._id}`, JSON.stringify(ch.lastMessage)).catch(() => {});
                  }
                }
              } catch (_) {}
              return updated;
            });
          } catch (_) {}
        })();
      }

    } catch (error) {
      console.error('Error loading chats:', error);
      setLoading(false);
      // Avoid stale fallback; show empty and rely on realtime updates
      setChats([]);
      setFilteredChats([]);
      try {
        await AsyncStorage.setItem('friends:list', JSON.stringify([]));
      } catch (_) {}
    }
  };

  const setupSocketListeners = () => {
    const socket = socketService.getSocket();
    if (!socket) return;
  
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
      try {
        const sender = String(msg?.sender || '');
        const ts = msg?.createdAt || msg?.timestamp || new Date().toISOString();
        if (sender) {
          setLastSeenByUser(prev => ({ ...prev, [sender]: ts }));
        }
      } catch (_) {}
    });
  
    // Presence: hydrate on connect
    socket.on('connect', () => {
      const onlineUsers = socketService.getOnlineUsers?.() || [];
      setChats(prev => prev.map(chat => ({
        ...chat,
        participants: chat.participants.map(p => ({
          ...p,
          isOnline: Array.isArray(onlineUsers) ? onlineUsers.includes(p.username) : false,
        })),
      })));
    });
  
    // Set everyone offline on disconnect
    socket.on('disconnect', () => {
      setChats(prev => prev.map(chat => ({
        ...chat,
        participants: chat.participants.map(p => ({ ...p, isOnline: false })),
      })));
      // Clear all indicators when socket disconnects
      setTypingByUser({});
      setRecordingByUser({});
    });
  
    // Handle online users list from server
    socket.on('update-online-users', (usernames: string[]) => {
      const list = Array.isArray(usernames) ? usernames : [];
      setChats(prevChats =>
        prevChats.map(chat => ({
          ...chat,
          participants: chat.participants.map(p => ({
            ...p,
            isOnline: list.includes(p.username),
          })),
        }))
      );
      // For offline users, refresh last-seen from server
      try {
        const offlineTargets = new Set<string>();
        chats.forEach(chat => {
          const other = chat.participants.find(p => p.username !== currentUser?.username);
          if (other?.username && !list.includes(other.username)) offlineTargets.add(other.username);
        });
        for (const uname of Array.from(offlineTargets)) {
          apiService.getLastSeen(uname)
            .then(res => {
              const ts = (res as any)?.lastSeen;
              if (ts) setLastSeenByUser(prev => ({ ...prev, [uname]: ts }));
            })
            .catch(() => {});
        }
      } catch (_) {}
    });
  
    // Individual online user events
    socket.on('user-online', (username: string) => {
      setChats(prevChats =>
        prevChats.map(chat => ({
          ...chat,
          participants: chat.participants.map(p =>
            p.username === username ? { ...p, isOnline: true } : p
          ),
        }))
      );
      // Update last-seen to now for online to reorder immediately
      try { setLastSeenByUser(prev => ({ ...prev, [username]: new Date().toISOString() })); } catch (_) {}
    });
  
    socket.on('user-offline', (username: string) => {
      setChats(prevChats =>
        prevChats.map(chat => ({
          ...chat,
          participants: chat.participants.map(p =>
            p.username === username ? { ...p, isOnline: false } : p
          ),
        }))
      );
      // Update last-seen immediately when a user goes offline
      apiService.getLastSeen(username).then(res => {
        const ts = (res as any)?.lastSeen;
        if (ts) {
          setLastSeenByUser(prev => ({ ...prev, [username]: ts }));
        }
      }).catch(() => {});
      // Clear typing/recording indicators when offline
      setTypingByUser(prev => ({ ...prev, [username]: false }));
      setRecordingByUser(prev => ({ ...prev, [username]: false }));
    });
  
    // Typing/Recording indicators
    socket.off('typing');
    socket.off('stopTyping');
    socket.off('recording');
    socket.off('stopRecording');
  
    socket.on('typing', (data: { from?: string; username?: string; to?: string }) => {
      const from = (data?.from || data?.username || '').trim();
      const to = String(data?.to || '').trim();
      if (from && (!to || !currentUser?.username || to === currentUser.username)) {
        setTypingByUser(prev => ({ ...prev, [from]: true }));
      }
    });
    socket.on('stopTyping', (data: { from?: string; username?: string; to?: string }) => {
      const from = (data?.from || data?.username || '').trim();
      const to = String(data?.to || '').trim();
      if (from && (!to || !currentUser?.username || to === currentUser.username)) {
        setTypingByUser(prev => ({ ...prev, [from]: false }));
      }
    });
    socket.on('recording', (data: { from?: string; username?: string; to?: string }) => {
      const from = (data?.from || data?.username || '').trim();
      const to = String(data?.to || '').trim();
      if (from && (!to || !currentUser?.username || to === currentUser.username)) {
        setRecordingByUser(prev => ({ ...prev, [from]: true }));
      }
    });
    socket.on('stopRecording', (data: { from?: string; username?: string; to?: string }) => {
      const from = (data?.from || data?.username || '').trim();
      const to = String(data?.to || '').trim();
      if (from && (!to || !currentUser?.username || to === currentUser.username)) {
        setRecordingByUser(prev => ({ ...prev, [from]: false }));
      }
    });
  };

    const onRefresh = async () => {
      setRefreshing(true);
      await loadChats();
      setRefreshing(false);
    };

    // Track last-seen per friend to display accurate time-ago in the list
    const [lastSeenByUser, setLastSeenByUser] = useState<Record<string, string>>({});
    // Add per-user typing/recording indicators
    const [typingByUser, setTypingByUser] = useState<Record<string, boolean>>({});
    const [recordingByUser, setRecordingByUser] = useState<Record<string, boolean>>({});
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

    // Derived header-level indicators (recording has precedence)
    const anyRecording = Object.values(recordingByUser).some(Boolean);
    const anyTyping = !anyRecording && Object.values(typingByUser).some(Boolean);

    const getLastMessagePreview = (message: any) => {
      if (!message) return '';
      
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
      navigation.navigate('StartNewChat' as never);
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
            <View style={[styles.onlineIndicator, !otherParticipant.isOnline && { backgroundColor: colors.textMuted }]} />
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

            <View style={styles.lastLine}>
              <Text
                style={[styles.lastMessage, isUnread && styles.unreadText]}
                numberOfLines={1}>
                {`${lastMessageSender}${getLastMessagePreview(item.lastMessage)}`}
              </Text>
              {recordingByUser[otherParticipant.username] && (
                <View style={[styles.indicatorBadge, { backgroundColor: colors.error }]}>
                  <Text style={styles.indicatorText}>recording…</Text>
                </View>
              )}
              {!recordingByUser[otherParticipant.username] && typingByUser[otherParticipant.username] && (
                <View style={[styles.indicatorBadge, { backgroundColor: colors.primary }]}>
                  <Text style={styles.indicatorText}>typing…</Text>
                </View>
              )}
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
            {anyRecording && (
              <View style={[styles.headerBadge, { backgroundColor: colors.error }]}> 
                <Text style={styles.headerBadgeText}>recording…</Text>
              </View>
            )}
            {!anyRecording && anyTyping && (
              <View style={[styles.headerBadge, { backgroundColor: colors.primary }]}> 
                <Text style={styles.headerBadgeText}>typing…</Text>
              </View>
            )}
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
          showsHorizontalScrollIndicator={false}
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
    headerBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    headerBadgeText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '600',
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
    lastLine: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    indicatorBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
      marginLeft: 8,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10,
      elevation: 3,
    },
    indicatorText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '600',
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