import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Image,
  Alert,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import {useRoute, useNavigation, RouteProp, useFocusEffect} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {launchImageLibrary} from 'react-native-image-picker';
import apiService from '../services/ApiService';
import PushNotificationService from '../services/pushNotifications';
import socketService from '../services/SocketService';
import {colors, globalStyles} from '../styles/globalStyles';
import {getFlagEmojiForLocation} from '../utils/flags';

interface UserProfile {
  username: string;
  name: string;
  email: string;
  avatar: string;
  bio: string;
  location: string;
  website: string;
  joinedDate: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isFollowing: boolean;
  isOwnProfile: boolean;
}

interface Post {
  _id: string;
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

type ProfileRouteParams = {
  username?: string;
};

const ProfileScreen = () => {
  const route = useRoute<RouteProp<{params: ProfileRouteParams}, 'params'>>();
  const navigation = useNavigation();
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [savedPosts, setSavedPosts] = useState<Post[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'posts' | 'saved'>('posts');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editProfile, setEditProfile] = useState({
    name: '',
    email: '',
    bio: '',
    location: '',
    website: '',
    workplace: '',
    education: '',
    dob: '',
  });
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [dobTempDate, setDobTempDate] = useState<Date | null>(null);
  const [friendRequestSent, setFriendRequestSent] = useState<boolean>(false);
  
  const refreshRelationshipState = useCallback(async () => {
    try {
      const target = route.params?.username;
      const viewer = currentUser?.username;
      if (!target || !viewer || target === viewer) return;
      const isFriends = await apiService.areFriends(target);
      setProfile(prev => prev ? { ...prev, isFollowing: !!isFriends } : prev);
      if (isFriends) setFriendRequestSent(false);
    } catch (e) {
      // ignore
    }
  }, [currentUser, route.params?.username]);

  const targetUsername = route.params?.username;

  useEffect(() => {
    loadCurrentUser();
  }, []);

  useEffect(() => {
    if (currentUser) {
      loadProfile();
      loadUserPosts();
      loadSavedPosts();
      refreshRelationshipState();
    }
  }, [currentUser, targetUsername, refreshRelationshipState]);

  useFocusEffect(
    useCallback(() => {
      if (currentUser) {
        loadProfile();
        loadUserPosts();
        // Ensure saved posts reflect latest changes (e.g., saves from Dashboard)
        loadSavedPosts();
      }
    }, [currentUser, targetUsername])
  );

  const getAvatarUri = (uri?: string) => {
    if (uri && uri.trim()) return uri;
    return 'https://cdn-icons-png.flaticon.com/512/1077/1077114.png';
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

  const loadProfile = async () => {
    try {
      const username = targetUsername || currentUser?.username;
      if (!username) return;

      const response = await apiService.getUserProfile(username);
      if (response.success) {
        // Ensure isOwnProfile is reliably set even if backend omits it
        const isOwner = !!currentUser?.username && response.profile?.username === currentUser?.username;
        const mergedProfile = {
          ...response.profile,
          isOwnProfile:
            typeof (response.profile as any)?.isOwnProfile === 'boolean'
              ? (response.profile as any).isOwnProfile
              : isOwner,
        } as any;

        setProfile(mergedProfile);
        setEditProfile({
          name: mergedProfile.name,
          email: (response.profile as any)?.email || '',
          bio: mergedProfile.bio,
          location: mergedProfile.location,
          website: mergedProfile.website,
          workplace: (response.profile as any)?.workplace || '',
          education: (response.profile as any)?.education || '',
          dob: (response.profile as any)?.dob || '',
        });
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUserPosts = async () => {
    try {
      const username = targetUsername || currentUser?.username;
      if (!username) return;

      const response = await apiService.getUserPosts(username);
      if (response.success) {
        setPosts(response.posts);
      }
    } catch (error) {
      console.error('Error loading user posts:', error);
    }
  };

  const loadSavedPosts = async () => {
    try {
      const username = targetUsername || currentUser?.username;
      if (!username) return;

      const list = await apiService.getSavedPosts(username);
      setSavedPosts(list);
    } catch (error) {
      console.error('Error loading saved posts:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadProfile(), loadUserPosts(), loadSavedPosts()]);
    setRefreshing(false);
  };

  const handleSendFriendRequest = async () => {
    if (!profile) return;
    try {
      const res = await apiService.sendFriendRequest(profile.username);
      if (res?.success) {
        setFriendRequestSent(true);
        Alert.alert('Request Sent', `Friend request sent to ${profile.name || '@' + profile.username}`);
        try {
          PushNotificationService.getInstance().showLocalNotification({
            title: 'Friend Request Sent',
            body: `You sent a friend request to @${profile.username}`,
            data: { type: 'profile', username: profile.username },
            channelId: 'connecther_notifications',
          });
        } catch (e) {
          console.log('Local notification failed:', e);
        }
        // Refresh relationship state so UI updates promptly
        refreshRelationshipState();
      } else {
        Alert.alert('Error', 'Could not send friend request');
      }
    } catch (error) {
      console.error('Error sending friend request:', error);
      Alert.alert('Error', 'Could not send friend request');
    }
  };

  const handleFollow = async () => {
    if (!profile) return;

    try {
      const response = profile.isFollowing
        ? await apiService.unfollowUser(profile.username)
        : await apiService.followUser(profile.username);

      if (response.success) {
        setProfile(prev => prev ? {
          ...prev,
          isFollowing: !prev.isFollowing,
          followersCount: prev.isFollowing 
            ? prev.followersCount - 1 
            : prev.followersCount + 1,
        } : null);
        // Keep friend request state consistent
        if (!profile.isFollowing) setFriendRequestSent(true);
        if (profile.isFollowing) setFriendRequestSent(false);
      }
    } catch (error) {
      console.error('Error following/unfollowing user:', error);
      Alert.alert('Error', 'Failed to update follow status');
    }
  };

  const handleUnfriend = async () => {
    if (!profile) return;
    try {
      const res = await apiService.unfriendUser(profile.username);
      if (res.success) {
        setProfile(prev => prev ? { ...prev, isFollowing: false } : prev);
        setFriendRequestSent(false);
        Alert.alert('Unfriended', `You have removed @${profile.username} from your friends.`);
      } else {
        Alert.alert('Error', 'Could not unfriend at this time');
      }
    } catch (error) {
      console.error('Error unfriending user:', error);
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const handleUpdateProfile = async () => {
    try {
      // Derive firstName/surname from name to keep backend fields consistent
      const [firstName, ...rest] = (editProfile.name || '').trim().split(' ');
      const surname = rest.join(' ');
      const payload = {
        ...editProfile,
        firstName: firstName || undefined,
        surname: surname || undefined,
      };
      const response = await apiService.updateProfile(payload);
      if (response.success) {
        setShowEditModal(false);
        loadProfile(); // Refresh profile
        
        // Update current user in AsyncStorage if it's own profile
        if (profile?.isOwnProfile) {
          const updatedUser = {...currentUser, name: editProfile.name};
          await AsyncStorage.setItem('currentUser', JSON.stringify(updatedUser));
          setCurrentUser(updatedUser);
        }
      } else {
        Alert.alert('Error', 'Failed to update profile');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Network error. Please try again.');
    }
  };

  const handleChangeAvatar = () => {
    launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      maxWidth: 400,
      maxHeight: 400,
    }, async (response) => {
      if (response.assets && response.assets[0]) {
        try {
          const formData = new FormData();
          formData.append('avatar', {
            uri: response.assets[0].uri,
            type: response.assets[0].type,
            name: response.assets[0].fileName || 'avatar.jpg',
          } as any);

          const uploadResponse = await apiService.updateAvatar(formData);
          if (uploadResponse.success) {
            // Persist avatar to user profile
            await apiService.updateProfile({ avatar: uploadResponse.avatarUrl });
            loadProfile(); // Refresh profile
            
            // Update current user in AsyncStorage
            if (profile?.isOwnProfile && currentUser) {
              const updatedUser = {...currentUser, avatar: uploadResponse.avatarUrl};
              await AsyncStorage.setItem('currentUser', JSON.stringify(updatedUser));
              setCurrentUser(updatedUser);
            }
          }
        } catch (error) {
          console.error('Error updating avatar:', error);
          Alert.alert('Error', 'Failed to update avatar');
        }
      }
    });
  };

  const openDobPicker = () => {
    const initial = editProfile.dob ? new Date(editProfile.dob) : new Date();
    setDobTempDate(initial);
    setShowDobPicker(true);
  };

  const onDobChange = (_event: any, selectedDate?: Date) => {
    if (selectedDate) {
      const iso = selectedDate.toISOString().slice(0, 10);
      setEditProfile(prev => ({ ...prev, dob: iso }));
    }
    if (Platform.OS === 'android') {
      setShowDobPicker(false);
    }
  };

  const handleLikePost = async (postId: string) => {
    try {
      await apiService.likePost(postId);
      // Update local state
      setPosts(prevPosts =>
        prevPosts.map(post => {
          if (post._id === postId) {
            const username = currentUser?.username || '';
            const currentLikedBy: string[] = Array.isArray((post as any).likedBy)
              ? (post as any).likedBy
              : Array.isArray(post.likes)
              ? (post.likes as any)
              : [];
            const isLiked = username ? currentLikedBy.includes(username) : false;
            const newLikedBy = isLiked
              ? currentLikedBy.filter(u => u !== username)
              : username
              ? [...currentLikedBy, username]
              : currentLikedBy;
            const likesCount = typeof (post as any).likes === 'number' ? (post as any).likes + (isLiked ? -1 : 1) : newLikedBy.length;
            return {
              ...post,
              likedBy: newLikedBy,
              likes: likesCount as any,
            };
          }
          return post;
        })
      );
    } catch (error) {
      console.error('Error liking post:', error);
    }
  };

  const handleStartChat = () => {
    if (!profile) return;
    
    navigation.navigate('Conversation' as never, {
      recipientUsername: profile.username,
      recipientName: profile.name,
      recipientAvatar: profile.avatar,
    } as never);
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.multiRemove(['authToken', 'currentUser']);
              socketService.disconnect();
              navigation.navigate('Login' as never);
            } catch (error) {
              console.error('Error logging out:', error);
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string) => {
    // Accept multiple possible backend fields for joined date
    const raw = (profile as any)?.joined || (profile as any)?.joinedDate || dateString;
    const date = new Date(raw);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
    });
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

  const renderPost = (post: Post) => (
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
          <View style={styles.avatarRingContainer}>
            <Image source={{ uri: getAvatarUri(post?.author?.avatar) }} style={styles.profileAvatar} />
            {(() => {
              const flag = getFlagEmojiForLocation((post as any)?.author?.location);
              return flag ? (
                <View style={styles.flagBadgeProfile}>
                  <Text style={styles.flagBadgeText}>{flag}</Text>
                </View>
              ) : null;
            })()}
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle}>{post?.author?.name || 'Unknown User'}</Text>
            <Text style={styles.headerSubtitle}>@{post?.author?.username || 'unknown'}</Text>
          </View>
        </TouchableOpacity>
        <Text style={globalStyles.textMuted}>{formatTime(post.createdAt)}</Text>
      </View>

      <Text style={styles.postContent}>{post.content}</Text>

      {post.files && post.files.length > 0 && (
        <ScrollView horizontal style={styles.mediaContainer}>
          {post.files.map((file, index) => {
            const typeStr = (file?.type || '').toLowerCase();
            const isVideo = typeStr.includes('video');
            const thumb = isVideo && file?.thumbnailUrl ? file.thumbnailUrl : null;
            const uri = thumb || file.url;
            return (
              <TouchableOpacity
                key={index}
                style={styles.mediaItem}
                onPress={() => navigation.navigate('PostDetail' as never, { postId: post._id } as never)}
              >
                <Image source={{uri: uri}} style={styles.mediaImage} resizeMode="cover" />
                {isVideo && (
                  <View style={styles.mediaPlayOverlay}>
                    <Icon name="play-circle-filled" size={32} color={colors.surface} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
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
            const count = typeof (post as any).likes === 'number' ? (post as any).likes : likedBy.length;
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

  const renderEditModal = () => (
    <Modal
      visible={showEditModal}
      animationType="slide"
      presentationStyle="pageSheet">
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => setShowEditModal(false)}>
            <Icon name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Edit Profile</Text>
          <TouchableOpacity onPress={handleUpdateProfile}>
            <Text style={styles.saveButton}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalContent}>
          <Text style={styles.sectionHeader}>Basic Info</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Name</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="Your name"
              placeholderTextColor={colors.textMuted}
              value={editProfile.name}
              onChangeText={text => setEditProfile(prev => ({...prev, name: text}))}
              maxLength={50}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Bio</Text>
            <TextInput
              style={[globalStyles.input, styles.textArea]}
              placeholder="Tell us about yourself"
              placeholderTextColor={colors.textMuted}
              value={editProfile.bio}
              onChangeText={text => setEditProfile(prev => ({...prev, bio: text}))}
              multiline
              maxLength={160}
            />
          </View>

          <Text style={styles.sectionHeader}>Contact</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Email</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="your@email.com"
              placeholderTextColor={colors.textMuted}
              value={editProfile.email}
              onChangeText={text => setEditProfile(prev => ({...prev, email: text}))}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Location</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="Where are you located?"
              placeholderTextColor={colors.textMuted}
              value={editProfile.location}
              onChangeText={text => setEditProfile(prev => ({...prev, location: text}))}
              maxLength={50}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Website</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="https://yourwebsite.com"
              placeholderTextColor={colors.textMuted}
              value={editProfile.website}
              onChangeText={text => setEditProfile(prev => ({...prev, website: text}))}
              maxLength={100}
              keyboardType="url"
            />
          </View>

          <Text style={styles.sectionHeader}>Background</Text>
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Workplace</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="Company or organization"
              placeholderTextColor={colors.textMuted}
              value={editProfile.workplace}
              onChangeText={text => setEditProfile(prev => ({...prev, workplace: text}))}
              maxLength={100}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Education</Text>
            <TextInput
              style={globalStyles.input}
              placeholder="School or qualification"
              placeholderTextColor={colors.textMuted}
              value={editProfile.education}
              onChangeText={text => setEditProfile(prev => ({...prev, education: text}))}
              maxLength={100}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Date of Birth</Text>
            <TouchableOpacity style={styles.dateInput} onPress={openDobPicker}>
              <Text style={styles.dateText}>
                {editProfile.dob ? editProfile.dob : 'Select date'}
              </Text>
            </TouchableOpacity>
            {showDobPicker && (
              <DateTimePicker
                value={dobTempDate || new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onDobChange}
                maximumDate={new Date()}
              />
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );

  if (!profile) {
    return (
      <View style={[globalStyles.container, globalStyles.centered]}>
        <Text style={globalStyles.text}>Loading...</Text>
      </View>
    );
  }

  const flagEmoji = profile.location ? getFlagEmojiForLocation(profile.location) : '';

  return (
    <View style={globalStyles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{profile.name}</Text>
          <Text style={styles.headerSubtitle}>{posts.length} posts</Text>
        </View>
        {profile.isOwnProfile && (
          <TouchableOpacity onPress={handleLogout}>
            <Icon name="logout" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        
        {/* Profile Info */}
        <View style={styles.profileSection}>
          <View style={styles.profileHeader}>
            <View style={styles.avatarRingContainer}>
              <TouchableOpacity onPress={profile.isOwnProfile ? handleChangeAvatar : undefined}>
                <Image source={{uri: getAvatarUri(profile.avatar)}} style={styles.profileAvatar} />
                {profile.isOwnProfile && (
                  <View style={styles.avatarOverlay}>
                    <Icon name="camera-alt" size={20} color={colors.text} />
                  </View>
                )}
              </TouchableOpacity>
              {!!flagEmoji && (
                <View style={styles.flagBadgeProfile}>
                  <Text style={styles.flagBadgeText}>{flagEmoji}</Text>
                </View>
              )}
            </View>

            <View style={styles.statsContainer}>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{posts.length}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{profile.followersCount}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{profile.followingCount}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </View>
            </View>
          </View>

          <View style={styles.profileDetails}>
            <Text style={styles.profileName}>{profile.name}</Text>
            <Text style={styles.profileUsername}>@{profile.username}</Text>
            
            {profile.bio && (
              <Text style={styles.profileBio}>{profile.bio}</Text>
            )}

            <View style={styles.profileMeta}>
              {profile.location && (
                <View style={styles.metaItem}>
                  <Icon name="location-on" size={16} color={colors.textMuted} />
                  <Text style={styles.metaText}>{profile.location}</Text>
                </View>
              )}
              
              {profile.website && (
                <View style={styles.metaItem}>
                  <Icon name="link" size={16} color={colors.textMuted} />
                  <Text style={styles.metaText}>{profile.website}</Text>
                </View>
              )}
              {(profile as any)?.workplace && (
                <View style={styles.metaItem}>
                  <Icon name="work" size={16} color={colors.textMuted} />
                  <Text style={styles.metaText}>{(profile as any).workplace}</Text>
                </View>
              )}
              {(profile as any)?.education && (
                <View style={styles.metaItem}>
                  <Icon name="school" size={16} color={colors.textMuted} />
                  <Text style={styles.metaText}>{(profile as any).education}</Text>
                </View>
              )}
              {(profile as any)?.dob && (
                <View style={styles.metaItem}>
                  <Icon name="cake" size={16} color={colors.textMuted} />
                  <Text style={styles.metaText}>{(profile as any).dob}</Text>
                </View>
              )}
              {(profile as any)?.email && (
                <View style={styles.metaItem}>
                  <Icon name="email" size={16} color={colors.textMuted} />
                  <Text style={styles.metaText}>{(profile as any).email}</Text>
                </View>
              )}
              
              <View style={styles.metaItem}>
                <Icon name="calendar-today" size={16} color={colors.textMuted} />
                <Text style={styles.metaText}>Joined {formatDate((profile as any)?.joinedDate || (profile as any)?.joined)}</Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            {profile.isOwnProfile ? (
              <TouchableOpacity
                style={[globalStyles.secondaryButton, styles.actionButton]}
                onPress={() => setShowEditModal(true)}>
                <Text style={globalStyles.secondaryButtonText}>Edit Profile</Text>
              </TouchableOpacity>
            ) : (
              <>
                {/* Show Follow only when not already friends; show Unfollow when friends */}
                {!profile.isFollowing && (
                  <TouchableOpacity
                    style={[globalStyles.button, styles.actionButton]}
                    onPress={handleFollow}>
                    <Text style={globalStyles.buttonText}>
                      Follow
                    </Text>
                  </TouchableOpacity>
                )}
                {profile.isFollowing && (
                  <TouchableOpacity
                    style={[globalStyles.secondaryButton, styles.actionButton]}
                    onPress={handleFollow}>
                    <Text style={globalStyles.secondaryButtonText}>Unfollow</Text>
                  </TouchableOpacity>
                )}

                {/* Hide Add Friend when already friends */}
                {!profile.isFollowing && (
                  <TouchableOpacity
                    style={[globalStyles.button, styles.actionButton]}
                    onPress={handleSendFriendRequest}
                    disabled={friendRequestSent}
                  >
                    <Text style={globalStyles.buttonText}>
                      {friendRequestSent ? 'Request Sent' : 'Add Friend'}
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Explicit Unfriend action when already friends */}
                {profile.isFollowing && (
                  <TouchableOpacity
                    style={[globalStyles.secondaryButton, styles.actionButton]}
                    onPress={handleUnfriend}>
                    <Text style={globalStyles.secondaryButtonText}>Unfriend</Text>
                  </TouchableOpacity>
                )}
                
                <TouchableOpacity
                  style={[globalStyles.secondaryButton, styles.actionButton]}
                  onPress={handleStartChat}>
                  <Text style={globalStyles.secondaryButtonText}>Message</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {profile.isOwnProfile && (
            <View style={styles.logoutContainer}>
              <TouchableOpacity
                style={[globalStyles.button, styles.logoutButton]}
                onPress={handleLogout}
              >
                <Text style={globalStyles.buttonText}>Logout</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Posts / Saved tabs */}
        <View style={styles.postsSection}>
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tabButton, selectedTab === 'posts' && styles.tabButtonActive]}
              onPress={() => setSelectedTab('posts')}
            >
              <Text style={[styles.tabLabel, selectedTab === 'posts' && styles.tabLabelActive]}>Posts</Text>
            </TouchableOpacity>

            {profile?.isOwnProfile && (
              <TouchableOpacity
                style={[styles.tabButton, selectedTab === 'saved' && styles.tabButtonActive]}
                onPress={() => setSelectedTab('saved')}
              >
                <Text style={[styles.tabLabel, selectedTab === 'saved' && styles.tabLabelActive]}>Saved</Text>
              </TouchableOpacity>
            )}
          </View>

          {selectedTab === 'posts' ? (
            posts.length > 0 ? (
              posts.map(renderPost)
            ) : (
              <View style={styles.emptyState}>
                <Icon name="post-add" size={64} color={colors.textMuted} />
                <Text style={styles.emptyStateText}>No posts yet</Text>
              </View>
            )
          ) : (
            profile?.isOwnProfile ? (
              savedPosts.length > 0 ? (
                savedPosts.map(renderPost)
              ) : (
                <View style={styles.emptyState}>
                  <Icon name="bookmark" size={64} color={colors.textMuted} />
                  <Text style={styles.emptyStateText}>No saved posts yet</Text>
                </View>
              )
            ) : null
          )}
        </View>
      </ScrollView>

      {renderEditModal()}
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
  headerInfo: {
    flex: 1,
    marginLeft: 15,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
  },
  content: {
    flex: 1,
  },
  profileSection: {
    backgroundColor: colors.surface,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profileHeader: {
    ...globalStyles.flexRowBetween,
    marginBottom: 15,
  },
  logoutContainer: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  logoutButton: {
    alignSelf: 'stretch',
  },
  avatarRingContainer: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarRing: {
    padding: 3,
    borderRadius: 46,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  avatarGlow: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 105, 180, 0.15)',
  },
  avatarOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsContainer: {
    ...globalStyles.flexRow,
  },
  statItem: {
    alignItems: 'center',
    marginLeft: 30,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  profileDetails: {
    marginBottom: 20,
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 2,
  },
  profileUsername: {
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: 10,
  },
  profileBio: {
    fontSize: 16,
    color: colors.text,
    lineHeight: 22,
    marginBottom: 10,
  },
  profileMeta: {
    marginTop: 10,
  },
  metaItem: {
    ...globalStyles.flexRow,
    alignItems: 'center',
    marginBottom: 5,
  },
  metaText: {
    fontSize: 14,
    color: colors.textMuted,
    marginLeft: 5,
  },
  actionButtons: {
    ...globalStyles.flexRow,
  },
  actionButton: {
    flex: 1,
    marginHorizontal: 5,
  },
  postsSection: {
    padding: 10,
  },
  tabsContainer: {
    ...globalStyles.flexRow,
    marginBottom: 12,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  tabLabel: {
    color: colors.textMuted,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 15,
  },
  postCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  postHeader: {
    marginBottom: 10,
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
  mediaItem: {
    position: 'relative',
    marginRight: 10,
  },
  mediaImage: {
    width: 200,
    height: 150,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  mediaPlayOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagBadgeProfile: {
    position: 'absolute',
    bottom: -2,
    left: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  flagBadgeText: {
    fontSize: 12,
  },
  postActions: {
    ...globalStyles.flexRow,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionButton: {
    ...globalStyles.flexRow,
    marginRight: 20,
    alignItems: 'center',
  },
  actionText: {
    color: colors.textMuted,
    marginLeft: 5,
    fontSize: 14,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 16,
    color: colors.textMuted,
    marginTop: 15,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    backgroundColor: colors.secondary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  saveButton: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  sectionHeader: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 8,
    marginTop: 8,
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
    height: 80,
    textAlignVertical: 'top',
  },
  dateInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  dateText: {
    color: colors.text,
    fontSize: 16,
  },
});

export default ProfileScreen;