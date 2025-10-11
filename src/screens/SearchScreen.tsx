import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { debounce } from 'lodash';
import apiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';

interface SearchResult {
  id: string;
  type: 'user' | 'community' | 'post';
  title: string;
  subtitle?: string;
  image?: string;
  verified?: boolean;
  memberCount?: number;
  lastActive?: string;
}

interface RecentSearch {
  id: string;
  query: string;
  timestamp: number;
}

const SearchScreen: React.FC = () => {
  const navigation = useNavigation();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'users' | 'communities' | 'posts'>('all');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    loadRecentSearches();
    loadSuggestions();
  }, []);

  const loadRecentSearches = async () => {
    try {
      const saved = await AsyncStorage.getItem('recentSearches');
      if (saved) {
        setRecentSearches(JSON.parse(saved));
      }
    } catch (error) {
      console.error('Error loading recent searches:', error);
    }
  };

  const loadSuggestions = async () => {
    try {
      // Load popular search terms or trending topics
      const response = await apiService.get('/search/suggestions');
      if (response.success) {
        setSuggestions(response.data);
      }
    } catch (error) {
      console.error('Error loading suggestions:', error);
      // Fallback suggestions
      setSuggestions([
        'Women in Tech',
        'Career Development',
        'Networking Events',
        'Entrepreneurship',
        'Work-Life Balance',
        'Leadership',
        'Mentorship',
        'Professional Growth',
      ]);
    }
  };

  const saveRecentSearch = async (query: string) => {
    try {
      const newSearch: RecentSearch = {
        id: Date.now().toString(),
        query,
        timestamp: Date.now(),
      };

      const updatedSearches = [
        newSearch,
        ...recentSearches.filter(s => s.query !== query),
      ].slice(0, 10); // Keep only last 10 searches

      setRecentSearches(updatedSearches);
      await AsyncStorage.setItem('recentSearches', JSON.stringify(updatedSearches));
    } catch (error) {
      console.error('Error saving recent search:', error);
    }
  };

  const performSearch = async (query: string, type: string = 'all') => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await apiService.get('/search', {
        params: {
          q: query,
          type: type !== 'all' ? type : undefined,
          limit: 20,
        },
      });

      if (response.success) {
        setSearchResults(response.data);
        await saveRecentSearch(query);
      }
    } catch (error) {
      console.error('Search error:', error);
      // Mock search results for demo
      const mockResults: SearchResult[] = [
        {
          id: '1',
          type: 'user',
          title: 'Sarah Johnson',
          subtitle: 'Software Engineer at Google',
          image: 'https://via.placeholder.com/50',
          verified: true,
          lastActive: '2 hours ago',
        },
        {
          id: '2',
          type: 'community',
          title: 'Women in Tech',
          subtitle: 'A community for women in technology',
          image: 'https://via.placeholder.com/50',
          memberCount: 1250,
        },
        {
          id: '3',
          type: 'post',
          title: 'Breaking barriers in STEM',
          subtitle: 'How to overcome challenges in male-dominated fields',
        },
      ].filter(result => 
        type === 'all' || result.type === type
      );
      setSearchResults(mockResults);
    } finally {
      setIsLoading(false);
    }
  };

  const debouncedSearch = useCallback(
    debounce((query: string, type: string) => {
      performSearch(query, type);
    }, 300),
    []
  );

  useEffect(() => {
    if (searchQuery) {
      debouncedSearch(searchQuery, activeTab);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, activeTab, debouncedSearch]);

  const handleSearchSubmit = () => {
    if (searchQuery.trim()) {
      performSearch(searchQuery, activeTab);
    }
  };

  const handleRecentSearchPress = (query: string) => {
    setSearchQuery(query);
    performSearch(query, activeTab);
  };

  const clearRecentSearches = async () => {
    try {
      setRecentSearches([]);
      await AsyncStorage.removeItem('recentSearches');
    } catch (error) {
      console.error('Error clearing recent searches:', error);
    }
  };

  const handleResultPress = (result: SearchResult) => {
    switch (result.type) {
      case 'user':
        navigation.navigate('Profile' as never, { userId: result.id } as never);
        break;
      case 'community':
        navigation.navigate('Community' as never, { communityId: result.id } as never);
        break;
      case 'post':
        navigation.navigate('Chat' as never, { postId: result.id } as never);
        break;
    }
  };

  const renderSearchResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleResultPress(item)}
    >
      <View style={styles.resultLeft}>
        {item.image && item.image.trim() ? (
          <Image source={{ uri: item.image.trim() }} style={styles.resultImage} />
        ) : (
          <View style={[styles.resultImage, styles.placeholderImage]}>
            <Icon 
              name={
                item.type === 'user' ? 'person' : 
                item.type === 'community' ? 'group' : 'article'
              } 
              size={24} 
              color={colors.dark.text + '80'} 
            />
          </View>
        )}
        
        <View style={styles.resultText}>
          <View style={styles.titleRow}>
            <Text style={styles.resultTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {item.verified && (
              <Icon name="verified" size={16} color={colors.dark.primary} />
            )}
          </View>
          
          {item.subtitle && (
            <Text style={styles.resultSubtitle} numberOfLines={1}>
              {item.subtitle}
            </Text>
          )}
          
          <View style={styles.resultMeta}>
            <Text style={styles.resultType}>
              {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
            </Text>
            {item.memberCount && (
              <Text style={styles.resultInfo}>
                • {item.memberCount} members
              </Text>
            )}
            {item.lastActive && (
              <Text style={styles.resultInfo}>
                • Active {item.lastActive}
              </Text>
            )}
          </View>
        </View>
      </View>
      
      <Icon name="chevron-right" size={20} color={colors.dark.text + '60'} />
    </TouchableOpacity>
  );

  const renderRecentSearch = (search: RecentSearch) => (
    <TouchableOpacity
      key={search.id}
      style={styles.recentItem}
      onPress={() => handleRecentSearchPress(search.query)}
    >
      <Icon name="history" size={20} color={colors.dark.text + '80'} />
      <Text style={styles.recentText}>{search.query}</Text>
      <TouchableOpacity
        onPress={() => {
          const updated = recentSearches.filter(s => s.id !== search.id);
          setRecentSearches(updated);
          AsyncStorage.setItem('recentSearches', JSON.stringify(updated));
        }}
      >
        <Icon name="close" size={16} color={colors.dark.text + '60'} />
      </TouchableOpacity>
    </TouchableOpacity>
  );

  const renderSuggestion = (suggestion: string) => (
    <TouchableOpacity
      key={suggestion}
      style={styles.suggestionChip}
      onPress={() => {
        setSearchQuery(suggestion);
        performSearch(suggestion, activeTab);
      }}
    >
      <Text style={styles.suggestionText}>{suggestion}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={globalStyles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color={colors.dark.text} />
        </TouchableOpacity>
        
        <View style={styles.searchContainer}>
          <Icon name="search" size={20} color={colors.dark.text + '80'} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search users, communities, posts..."
            placeholderTextColor={colors.dark.text + '60'}
            returnKeyType="search"
            onSubmitEditing={handleSearchSubmit}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="clear" size={20} color={colors.dark.text + '80'} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabContainer}>
        {(['all', 'users', 'communities', 'posts'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              activeTab === tab && styles.activeTab,
            ]}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.activeTabText,
              ]}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.dark.primary} />
            <Text style={styles.loadingText}>Searching...</Text>
          </View>
        )}

        {!searchQuery && !isLoading && (
          <View>
            {/* Recent Searches */}
            {recentSearches.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Recent Searches</Text>
                  <TouchableOpacity onPress={clearRecentSearches}>
                    <Text style={styles.clearText}>Clear All</Text>
                  </TouchableOpacity>
                </View>
                {recentSearches.map(renderRecentSearch)}
              </View>
            )}

            {/* Suggestions */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Trending Topics</Text>
              <View style={styles.suggestionsContainer}>
                {suggestions.map(renderSuggestion)}
              </View>
            </View>
          </View>
        )}

        {searchQuery && !isLoading && (
          <View>
            {searchResults.length > 0 ? (
              <FlatList
                data={searchResults}
                renderItem={renderSearchResult}
                keyExtractor={(item) => item.id}
                scrollEnabled={false}
              />
            ) : (
              <View style={styles.noResultsContainer}>
                <Icon name="search-off" size={64} color={colors.dark.text + '40'} />
                <Text style={styles.noResultsTitle}>No results found</Text>
                <Text style={styles.noResultsText}>
                  Try adjusting your search terms or filters
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
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
    borderBottomColor: colors.dark.card,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dark.card,
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    ...globalStyles.text,
    marginLeft: 8,
    marginRight: 8,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.card,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 20,
    backgroundColor: colors.dark.card,
  },
  activeTab: {
    backgroundColor: colors.dark.primary,
  },
  tabText: {
    ...globalStyles.text,
    fontSize: 14,
  },
  activeTabText: {
    color: colors.dark.text,
    fontWeight: '600',
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    ...globalStyles.text,
    marginTop: 12,
    color: colors.dark.text + '80',
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    ...globalStyles.text,
    fontSize: 18,
    fontWeight: '600',
  },
  clearText: {
    ...globalStyles.text,
    color: colors.dark.primary,
    fontSize: 14,
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.dark.card,
    borderRadius: 12,
    marginBottom: 8,
  },
  recentText: {
    ...globalStyles.text,
    flex: 1,
    marginLeft: 12,
  },
  suggestionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  suggestionChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.dark.card,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  suggestionText: {
    ...globalStyles.text,
    fontSize: 14,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.dark.card,
    borderRadius: 12,
    marginBottom: 8,
  },
  resultLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  resultImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  placeholderImage: {
    backgroundColor: colors.dark.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultTitle: {
    ...globalStyles.text,
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  resultSubtitle: {
    ...globalStyles.text,
    fontSize: 14,
    color: colors.dark.text + '80',
    marginTop: 2,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  resultType: {
    ...globalStyles.text,
    fontSize: 12,
    color: colors.dark.primary,
    fontWeight: '600',
  },
  resultInfo: {
    ...globalStyles.text,
    fontSize: 12,
    color: colors.dark.text + '60',
    marginLeft: 4,
  },
  noResultsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  noResultsTitle: {
    ...globalStyles.text,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 16,
  },
  noResultsText: {
    ...globalStyles.text,
    color: colors.dark.text + '80',
    textAlign: 'center',
    marginTop: 8,
  },
});

export default SearchScreen;