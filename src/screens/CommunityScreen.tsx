import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import {useNavigation, useFocusEffect, useRoute} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import apiService from '../services/ApiService';
import socketService from '../services/SocketService';
import {colors, globalStyles} from '../styles/globalStyles';
import LinkedText from '../components/LinkedText';
import { getFlagEmojiForLocation } from '../utils/flags';
import CommunityUnreadService from '../services/CommunityUnreadService';

interface Community {
  _id: string;
  name: string;
  description: string;
  avatar: string;
  memberCount: number;
  isJoined: boolean;
  isPrivate: boolean;
  category: string;
  createdBy: string;
  createdAt: string;
}

interface CommunityPost {
  _id: string;
  community: string;
  author: {
    username: string;
    name: string;
    avatar: string;
  };
  content: string;
  files: any[];
  likes: string[];
  comments: any[];
  createdAt: string;
}

interface User {
  username: string;
  name: string;
  avatar: string;
}

const CommunityScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'discover' | 'joined' | 'my'>('discover');
  const [searchQuery, setSearchQuery] = useState('');
  const [ownedCommunities, setOwnedCommunities] = useState<Community[]>([]);
  const [joinedCommunities, setJoinedCommunities] = useState<Community[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [userLoadError, setUserLoadError] = useState<string | undefined>(undefined);
  const [postsError, setPostsError] = useState<string | undefined>(undefined);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCommunity, setNewCommunity] = useState({
    name: '',
    description: '',
    category: '',
    isPrivate: false,
  });
  const [focusedCommunityId, setFocusedCommunityId] = useState<string | null>(null);
  const [focusedCommunity, setFocusedCommunity] = useState<Community | null>(null);
  const [focusedMembers, setFocusedMembers] = useState<Array<{username: string; name: string; avatar: string; isAdmin: boolean; isCreator: boolean}>>([]);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Subscribe to unread counts for per-community badges
  useEffect(() => {
    let unsub: undefined | (() => void);
    (async () => {
      try { await CommunityUnreadService.init(); } catch (_) {}
      unsub = CommunityUnreadService.subscribe((counts, _total) => {
        setUnreadCounts(counts);
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  const getAvatarUri = (uri?: string) => {
    if (uri && uri.trim()) return uri;
    return 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png';
  };

  useEffect(() => {
    loadCurrentUser();
    loadCommunities();
    loadUserCommunities();
    loadCommunityPosts();
    setupSocketListeners();

    // Handle deep link via route params to focus on a specific community
    const paramId = (route as any)?.params?.communityId as string | undefined;
    if (paramId) {
      setFocusedCommunityId(paramId);
      setActiveTab('joined');
      AsyncStorage.setItem('currentCommunityId', paramId).catch(() => {});
      loadFocusedCommunity(paramId);
      loadFocusedMembers(paramId);
    } else {
      // Rehydrate focus from storage when opening without route params
      AsyncStorage.getItem('currentCommunityId')
        .then(storedId => {
          if (storedId) {
            setFocusedCommunityId(storedId);
            setActiveTab('joined');
            loadFocusedCommunity(storedId);
            loadFocusedMembers(storedId);
          }
        })
        .catch(() => {});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCommunities();
      loadCommunityPosts();
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

  const clearFocusedCommunity = async () => {
    try {
      await AsyncStorage.removeItem('currentCommunityId');
    } catch {}
    setFocusedCommunityId(null);
    setFocusedCommunity(null);
    setFocusedMembers([]);
    setActiveTab('discover');
  };

  const loadCommunities = async () => {
    try {
      const response = await apiService.getCommunities();
      if (response.success) {
        setCommunities(response.communities);
        setLoading(false);
        setLoadError(undefined);
      }
    } catch (error) {
      console.error('Error loading communities:', error);
      setLoadError('Failed to load communities from server. Pull to refresh to retry.');
      setLoading(false);
    } finally {
      // no-op
    }
  };

  const loadUserCommunities = async () => {
    try {
      const response = await apiService.getUserCommunities();
      if (response.success) {
        setOwnedCommunities(response.owned || []);
        setJoinedCommunities(response.joined || []);
        setUserLoadError(undefined);
      }
    } catch (error) {
      console.error('Error loading user communities:', error);
      setUserLoadError('Failed to load your communities. Please check connection and try again.');
    }
  };

  const loadCommunityPosts = async () => {
    try {
      const response = await apiService.getCommunityPosts();
      if (response.success) {
        setPosts(response.posts);
        setPostsError(undefined);
      }
    } catch (error) {
      console.error('Error loading community posts:', error);
      setPostsError('Failed to load community posts from server.');
    }
  };

  const setupSocketListeners = () => {
    const socket = socketService.getSocket();
    if (socket) {
      socket.on('new-community-post', (post: CommunityPost) => {
        setPosts(prevPosts => [post, ...prevPosts]);
      });

      socket.on('community-joined', (data: {communityId: string; memberCount: number}) => {
        setCommunities(prevCommunities =>
          prevCommunities.map(community =>
            community._id === data.communityId
              ? {...community, isJoined: true, memberCount: data.memberCount}
              : community
          )
        );
      });

      socket.on('community-left', (data: {communityId: string; memberCount: number}) => {
        setCommunities(prevCommunities =>
          prevCommunities.map(community =>
            community._id === data.communityId
              ? {...community, isJoined: false, memberCount: data.memberCount}
              : community
          )
        );
      });
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadCommunities(), loadUserCommunities(), loadCommunityPosts()]);
    setRefreshing(false);
  };

  const handleJoinCommunity = async (communityId: string) => {
    try {
      const response = await apiService.joinCommunity(communityId);
      if (response.success) {
        loadCommunities(); // Refresh communities
        if (focusedCommunity && focusedCommunity._id === communityId) {
          setFocusedCommunity({...focusedCommunity, isJoined: true, memberCount: (focusedCommunity.memberCount || 0) + 1});
          loadFocusedMembers(communityId);
        }
      } else {
        Alert.alert('Error', 'Failed to join community');
      }
    } catch (error) {
      console.error('Error joining community:', error);
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const handleLeaveCommunity = async (communityId: string) => {
    Alert.alert(
      'Leave Community',
      'Are you sure you want to leave this community?',
      [
        {text: 'Cancel', style: 'cancel'},
              {
                text: 'Leave',
                style: 'destructive',
                onPress: async () => {
                  try {
                    const response = await apiService.leaveCommunity(communityId);
                    if (response.success) {
                      loadCommunities(); // Refresh communities
                      if (focusedCommunity && focusedCommunity._id === communityId) {
                        setFocusedCommunity({...focusedCommunity, isJoined: false, memberCount: Math.max(0, (focusedCommunity.memberCount || 0) - 1)});
                        loadFocusedMembers(communityId);
                      }
                    } else {
                      Alert.alert('Error', 'Failed to leave community');
                    }
                  } catch (error) {
                    console.error('Error leaving community:', error);
                    Alert.alert('Error', 'Network error. Please try again.');
                  }
                },
              },
            ]
          );
  };

  const loadFocusedCommunity = async (communityId: string) => {
    try {
      const data = await apiService.getCommunity(communityId);
      const c = (data as any)?.community || data;
      if (!c) return;
      const memberCount = Array.isArray(c?.members) ? c.members.length : 0;
      const username = currentUser?.username;
      const isJoined = username ? Array.isArray(c?.members) && c.members.includes(username) : false;
      const normalized: Community = {
        _id: c._id,
        name: c.name || 'Community',
        description: c.description || '',
        avatar: getAvatarUri(c.avatar),
        memberCount,
        isJoined,
        isPrivate: !!c.isPrivate,
        category: c.category || '',
        createdBy: c.createdBy || c.creator || '',
        createdAt: c.createdAt || new Date().toISOString(),
      };
      setFocusedCommunity(normalized);
    } catch (error) {
      console.error('Error loading focused community:', error);
    }
  };

  const loadFocusedMembers = async (communityId: string) => {
    try {
      const response = await apiService.getCommunityMembers(communityId);
      if (response.success) {
        setFocusedMembers(response.members || []);
      }
    } catch (error) {
      console.error('Error loading focused members:', error);
    }
  };

  const handlePromoteMember = async (username: string) => {
    if (!focusedCommunityId) return;
    try {
      const res = await apiService.promoteCommunityMember(focusedCommunityId, username);
      if (res?.success) {
        setFocusedMembers(prev => prev.map(m => m.username === username ? { ...m, isAdmin: true } : m));
        Alert.alert('Success', `${username} is now an admin.`);
      } else {
        Alert.alert('Error', res?.message || 'Failed to promote member');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const handleDemoteMember = async (username: string) => {
    if (!focusedCommunityId) return;
    try {
      const res = await apiService.demoteCommunityMember(focusedCommunityId, username);
      if (res?.success) {
        setFocusedMembers(prev => prev.map(m => m.username === username ? { ...m, isAdmin: false } : m));
        Alert.alert('Success', `${username} has been demoted.`);
      } else {
        Alert.alert('Error', res?.message || 'Failed to demote member');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const handleRemoveMember = (username: string) => {
    if (!focusedCommunityId) return;
    Alert.alert(
      'Remove Member',
      `Are you sure you want to remove ${username}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await apiService.removeCommunityMember(focusedCommunityId!, username);
              if (res?.success) {
                setFocusedMembers(prev => prev.filter(m => m.username !== username));
                setFocusedCommunity(fc => fc ? { ...fc, memberCount: Math.max(0, (fc.memberCount || 1) - 1) } : fc);
                Alert.alert('Removed', `${username} has been removed.`);
              } else {
                Alert.alert('Error', res?.message || 'Failed to remove member');
              }
            } catch (e) {
              Alert.alert('Error', 'Network error. Please try again.');
            }
          }
        }
      ]
    );
  };

  const handleCreateCommunity = async () => {
    if (!newCommunity.name.trim() || !newCommunity.description.trim()) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    try {
      const response = await apiService.createCommunity(newCommunity);
      if (response.success) {
        setShowCreateModal(false);
        setNewCommunity({name: '', description: '', category: '', isPrivate: false});
        loadCommunities(); // Refresh communities
      } else {
        Alert.alert('Error', 'Failed to create community');
      }
    } catch (error) {
      console.error('Error creating community:', error);
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const handleLikePost = async (postId: string) => {
    try {
      await apiService.likePost(postId);
    } catch (error) {
      console.error('Error liking post:', error);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const filteredCommunities = communities.filter(community => {
    // This block is no longer used; kept for reference. See new filtered list below.
    return true;
  });

  const filterList = (list: Community[]) =>
    list.filter(c =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

  const renderCommunity = (community: Community) => (
    <View key={community._id} style={styles.communityCard}>
      <View style={styles.communityHeader}>
        <Image source={{uri: community.avatar}} style={styles.communityAvatar} />
        <View style={styles.communityInfo}>
          <Text style={styles.communityName}>{community.name}</Text>
          <Text style={styles.communityDescription} numberOfLines={2}>
            {community.description}
          </Text>
          <View style={globalStyles.flexRow}>
            <Text style={styles.memberCount}>
              {community.memberCount} members
            </Text>
            {community.isPrivate && (
              <Icon name="lock" size={16} color={colors.textMuted} style={{marginLeft: 10}} />
            )}
          </View>
        </View>
      </View>

      <View style={styles.communityActions}>
        {community.isJoined ? (
          <TouchableOpacity
            style={[globalStyles.secondaryButton, styles.actionButton]}
            onPress={() => handleLeaveCommunity(community._id)}>
            <Text style={globalStyles.secondaryButtonText}>Leave</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[globalStyles.button, styles.actionButton]}
            onPress={() => handleJoinCommunity(community._id)}>
            <Text style={globalStyles.buttonText}>Join</Text>
          </TouchableOpacity>
        )}
        
        <TouchableOpacity
          style={styles.viewButton}
          onPress={async () => {
            try {
              await AsyncStorage.setItem('currentCommunityId', community._id);
            } catch (e) {
              console.warn('Failed to set currentCommunityId:', e);
            }
            navigation.navigate('CommunityChat' as never, { communityId: community._id, communityName: community.name } as never);
          }}>
          <View style={globalStyles.flexRow}>
            <Text style={styles.viewButtonText}>Chat</Text>
            {(unreadCounts[community._id] || 0) > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadBadgeText}>{unreadCounts[community._id]}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );

  // New filtered list based on active tab using server-sourced lists
  const filteredList = (() => {
    let base: Community[] = [];
    if (activeTab === 'discover') {
      base = communities.filter(c => !c.isJoined);
    } else if (activeTab === 'joined') {
      base = joinedCommunities;
    } else {
      base = ownedCommunities;
    }
    if (focusedCommunityId && activeTab !== 'joined') {
    base = base.filter(c => c._id === focusedCommunityId);
  }
    const q = searchQuery.toLowerCase();
    return base.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.description || '').toLowerCase().includes(q)
    );
  })();

  const renderOwnedJoined = () => (
    <ScrollView
      style={{flex: 1}}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.sectionTitle}>My Communities</Text>
      {filterList(ownedCommunities).length === 0 ? (
        <Text style={styles.emptyText}>You don’t own any communities yet.</Text>
      ) : (
        filterList(ownedCommunities).map(c => renderCommunity(c))
      )}
    </ScrollView>
  );

  const renderPost = (post: CommunityPost) => (
    <View key={post._id} style={styles.postCard}>
      <View style={styles.postHeader}>
        <TouchableOpacity
          style={globalStyles.flexRow}
          onPress={() => {
            const username = post?.author?.username;
            if (username) {
              navigation.navigate('Profile' as never, { username } as never);
            }
          }}
        >
          <View style={styles.avatarContainer}>
            <Image source={{ uri: getAvatarUri(post?.author?.avatar) }} style={[globalStyles.avatar, styles.avatarRing]} />
            {(() => {
              const flag = getFlagEmojiForLocation((post as any)?.author?.location);
              return flag ? (
                <View style={styles.flagBadgeSmall}>
                  <Text style={styles.flagBadgeText}>{flag}</Text>
                </View>
              ) : null;
            })()}
          </View>
          <View style={styles.authorInfo}>
            <Text style={styles.authorName}>{post?.author?.name || 'Unknown User'}</Text>
            <Text style={globalStyles.textMuted}>@{post?.author?.username || 'unknown'}</Text>
          </View>
        </TouchableOpacity>
        <Text style={globalStyles.textMuted}>{formatTime(post.createdAt)}</Text>
      </View>

      <LinkedText
        text={post.content}
        style={styles.postContent}
        onUserPress={(username: string) => navigation.navigate('Profile' as never, { username } as never)}
      />

      {post.files && post.files.length > 0 && (
        <ScrollView horizontal style={styles.mediaContainer}>
          {post.files.map((file, index) => (
            <Image
              key={index}
              source={{uri: file.url}}
              style={styles.mediaImage}
              resizeMode="cover"
            />
          ))}
        </ScrollView>
      )}

      <View style={styles.postActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => handleLikePost(post._id)}>
          {(() => {
            const likedBy: string[] = Array.isArray((post as any).likedBy)
              ? (post as any).likedBy
              : Array.isArray(post.likes)
              ? (post.likes as any)
              : [];
            const isLiked = likedBy.includes(currentUser?.username || '');
            const count = typeof post.likes === 'number' ? post.likes : likedBy.length;
            return (
              <>
                <Icon
                  name={isLiked ? 'favorite' : 'favorite-border'}
                  size={20}
                  color={isLiked ? colors.primary : colors.textMuted}
                />
                <Text style={styles.actionText}>{count}</Text>
              </>
            );
          })()}
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton}>
          <Icon name="comment" size={20} color={colors.textMuted} />
          <Text style={styles.actionText}>{post.comments.length}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton}>
          <Icon name="share" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderCreateModal = () => (
    <Modal
      visible={showCreateModal}
      animationType="slide"
      presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowCreateModal(false)}>
            <Icon name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Create Community</Text>
          <TouchableOpacity onPress={handleCreateCommunity}>
            <Text style={styles.createButton}>Create</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Community Name *</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="Enter community name"
              placeholderTextColor={colors.textMuted}
              value={newCommunity.name}
              onChangeText={text => setNewCommunity(prev => ({...prev, name: text}))}
              maxLength={50}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Description *</Text>
            <TextInput
              style={[globalStyles.input, styles.textArea]}
              placeholder="Describe your community"
              placeholderTextColor={colors.textMuted}
              value={newCommunity.description}
              onChangeText={text => setNewCommunity(prev => ({...prev, description: text}))}
              multiline
              maxLength={200}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Category</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="e.g., Technology, Art, Sports"
              placeholderTextColor={colors.textMuted}
              value={newCommunity.category}
              onChangeText={text => setNewCommunity(prev => ({...prev, category: text}))}
              maxLength={30}
            />
          </View>

          <TouchableOpacity
            style={styles.checkboxContainer}
            onPress={() => setNewCommunity(prev => ({...prev, isPrivate: !prev.isPrivate}))}>
            <Icon
              name={newCommunity.isPrivate ? 'check-box' : 'check-box-outline-blank'}
              size={24}
              color={colors.primary}
            />
            <Text style={styles.checkboxLabel}>Private Community</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Communities</Text>
        <TouchableOpacity onPress={() => setShowCreateModal(true)}>
          <Icon name="add" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>


      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Icon name="search" size={20} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search communities..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'discover' && styles.activeTab]}
          onPress={() => setActiveTab('discover')}>
          <Text style={[styles.tabText, activeTab === 'discover' && styles.activeTabText]}>
            Discover
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'joined' && styles.activeTab]}
          onPress={() => setActiveTab('joined')}>
          <Text style={[styles.tabText, activeTab === 'joined' && styles.activeTabText]}>
            Joined
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'my' && styles.activeTab]}
          onPress={() => setActiveTab('my')}>
          <Text style={[styles.tabText, activeTab === 'my' && styles.activeTabText]}>
            My Communities
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'my' ? (
        renderOwnedJoined()
      ) : (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          
          {/* Communities Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {activeTab === 'discover' ? 'Discover Communities' : 'Communities You Belong To'}
            </Text>
            {activeTab === 'discover' && loadError && (
              <Text style={[globalStyles.textMuted, { color: '#ff6fa8', marginBottom: 8 }]}>{loadError}</Text>
            )}
            {activeTab === 'joined' && userLoadError && (
              <Text style={[globalStyles.textMuted, { color: '#ff6fa8', marginBottom: 8 }]}>{userLoadError}</Text>
            )}
            {filteredList.map(renderCommunity)}
          </View>

          {/* Recent Posts Section */}
          {activeTab === 'joined' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Posts</Text>
              {postsError && (
                <Text style={[globalStyles.textMuted, { color: '#ff6fa8', marginBottom: 8 }]}>{postsError}</Text>
              )}
            {posts
              .filter(p => !focusedCommunityId || p.community === focusedCommunityId)
              .map(renderPost)}
            </View>
          )}
        </ScrollView>
      )}

      {renderCreateModal()}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 18,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 6,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.text,
  },
  searchContainer: {
    ...globalStyles.flexRow,
    ...globalStyles.paddingHorizontal,
    alignItems: 'center',
    paddingVertical: 12,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 4,
  },
  tabContainer: {
    ...globalStyles.flexRow,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: 16,
    color: colors.textMuted,
  },
  activeTabText: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  section: {
    marginHorizontal: 16,
    marginVertical: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  communityCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  communityHeader: {
    ...globalStyles.flexRow,
    marginBottom: 12,
    alignItems: 'center',
  },
  communityAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginRight: 15,
  },
  communityInfo: {
    flex: 1,
  },
  communityName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  communityDescription: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 6,
    lineHeight: 20,
  },
  memberCount: {
    fontSize: 12,
    color: colors.textMuted,
  },
  communityActions: {
    ...globalStyles.flexRowBetween,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  viewButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  viewButtonText: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  unreadBadge: {
    marginLeft: 8,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 20,
    alignItems: 'center',
  },
  unreadBadgeText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  postCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
  },
  postHeader: {
    ...globalStyles.flexRowBetween,
    marginBottom: 12,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarRing: {
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: 20,
  },
  flagBadgeSmall: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  flagBadgeText: {
    fontSize: 11,
  },
  authorInfo: {
    marginLeft: 10,
  },
  authorName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  postContent: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 10,
  },
  mediaContainer: {
    marginVertical: 10,
  },
  mediaImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    marginRight: 10,
  },
  postActions: {
    ...globalStyles.flexRow,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionText: {
    color: colors.textMuted,
    marginLeft: 5,
    fontSize: 14,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  createButton: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  checkboxContainer: {
    ...globalStyles.flexRow,
    alignItems: 'center',
    marginTop: 10,
  },
  checkboxLabel: {
    fontSize: 16,
    color: colors.text,
    marginLeft: 10,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});

export default CommunityScreen;