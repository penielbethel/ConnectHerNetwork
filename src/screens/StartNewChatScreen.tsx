import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import apiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';

interface User {
  _id: string;
  username: string;
  name: string;
  avatar: string;
  bio?: string;
  location?: string;
}

const StartNewChatScreen: React.FC = () => {
  const navigation = useNavigation();
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (searchQuery.length > 1) {
      searchUsers();
    } else {
      setUsers([]);
    }
  }, [searchQuery]);

  const searchUsers = async () => {
    try {
      setLoading(true);
      setError('');
      
      // Use the searchUsers method from apiService directly
      const response = await apiService.searchUsers(searchQuery);
      
      if (response && Array.isArray(response)) {
        setUsers(response);
      } else if (response && response.users && Array.isArray(response.users)) {
        setUsers(response.users);
      } else {
        setUsers([]);
        if (searchQuery.length > 2) {
          setError('No users found');
        }
      }
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to search users');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  const handleUserPress = (user: User) => {
    navigation.navigate('Conversation' as never, {
      recipientUsername: user.username,
      recipientName: user.name,
      recipientAvatar: user.avatar,
    } as never);
  };

  const getAvatarUri = (avatar: string) => {
    if (!avatar) return 'https://connecther.network/default-avatar.png';
    if (avatar.startsWith('http')) return avatar;
    return `https://connecther.network/uploads/avatars/${avatar}`;
  };

  const renderUserItem = ({ item }: { item: User }) => (
    <TouchableOpacity
      style={styles.userItem}
      onPress={() => handleUserPress(item)}
    >
      <Image 
        source={{ uri: getAvatarUri(item.avatar) }} 
        style={styles.avatar} 
      />
      <View style={styles.userInfo}>
        <Text style={styles.userName}>{item.name || item.username}</Text>
        <Text style={styles.userUsername}>@{item.username}</Text>
        {item.bio && (
          <Text style={styles.userBio} numberOfLines={1}>
            {item.bio}
          </Text>
        )}
      </View>
      <Icon name="chevron-right" size={24} color={colors.textMuted} />
    </TouchableOpacity>
  );

  return (
    <View style={globalStyles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Start New Chat</Text>
      </View>

      <View style={styles.searchContainer}>
        <Icon name="search" size={20} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search for users..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoFocus
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Icon name="clear" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : error ? (
        <View style={styles.emptyState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : users.length === 0 && searchQuery.length > 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>No users found</Text>
          <Text style={styles.emptyStateSubtext}>
            Try a different search term
          </Text>
        </View>
      ) : searchQuery.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="search" size={64} color={colors.textMuted} />
          <Text style={styles.emptyStateText}>Search for users</Text>
          <Text style={styles.emptyStateSubtext}>
            Find people to start a conversation with
          </Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(item) => item._id || item.username}
          renderItem={renderUserItem}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingHorizontal: 12,
    margin: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 44,
    color: colors.text,
    fontSize: 16,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.card,
  },
  userInfo: {
    flex: 1,
    marginLeft: 12,
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  userUsername: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 2,
  },
  userBio: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 4,
  },
  loader: {
    marginTop: 40,
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
  },
  errorText: {
    fontSize: 16,
    color: '#ff6b6b',
    textAlign: 'center',
  },
});

export default StartNewChatScreen;