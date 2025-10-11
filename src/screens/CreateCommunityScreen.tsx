import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { launchImageLibrary } from 'react-native-image-picker';
import apiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';

const CreateCommunityScreen: React.FC = () => {
  const navigation = useNavigation();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: '',
    isPrivate: false,
    rules: '',
  });
  const [communityImage, setCommunityImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const categories = [
    'Technology',
    'Health & Wellness',
    'Business & Career',
    'Education',
    'Arts & Culture',
    'Sports & Fitness',
    'Travel',
    'Food & Cooking',
    'Parenting',
    'Relationships',
    'Finance',
    'Entertainment',
    'Other',
  ];

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleImagePicker = () => {
    launchImageLibrary(
      {
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 800,
        maxHeight: 800,
      },
      (response) => {
        if (response.assets && response.assets[0]) {
          setCommunityImage(response.assets[0].uri || null);
        }
      }
    );
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Community name is required');
      return false;
    }

    if (formData.name.length < 3) {
      Alert.alert('Error', 'Community name must be at least 3 characters');
      return false;
    }

    if (!formData.description.trim()) {
      Alert.alert('Error', 'Community description is required');
      return false;
    }

    if (formData.description.length < 10) {
      Alert.alert('Error', 'Description must be at least 10 characters');
      return false;
    }

    if (!formData.category) {
      Alert.alert('Error', 'Please select a category');
      return false;
    }

    return true;
  };

  const handleCreateCommunity = async () => {
    if (!validateForm()) return;

    setIsLoading(true);

    try {
      const userData = await AsyncStorage.getItem('currentUser');
      if (!userData) {
        Alert.alert('Error', 'Please log in to create a community');
        navigation.navigate('Login' as never);
        return;
      }

      const user = JSON.parse(userData);

      // Upload avatar first if a local image was selected
      let avatarUrl: string | undefined = undefined;
      if (communityImage) {
        const isRemote = /^https?:\/\//i.test(communityImage);
        if (isRemote) {
          avatarUrl = communityImage;
        } else {
          try {
            const uploadRes = await apiService.uploadImage(communityImage);
            avatarUrl = (uploadRes as any)?.url || undefined;
          } catch (e) {
            console.warn('Avatar upload failed, proceeding without avatar:', e);
          }
        }
      }

      const response = await apiService.createCommunity({
        name: formData.name,
        description: formData.description,
        category: formData.category,
        isPrivate: formData.isPrivate,
        avatar: avatarUrl,
      });

      if (response.success) {
        Alert.alert(
          'Success',
          'Community created successfully!',
          [
            {
              text: 'OK',
              onPress: async () => {
                const newId = (response as any)?.community?._id || (response as any)?.community?.id;
                if (newId) {
                  try {
                    await AsyncStorage.setItem('currentCommunityId', String(newId));
                  } catch (_) {}
                }
                navigation.goBack();
                // Navigate to the new community
                navigation.navigate('Community' as never, {
                  communityId: newId,
                } as never);
              },
            },
          ]
        );
      } else {
        Alert.alert('Error', response.message || 'Failed to create community');
      }
    } catch (error: any) {
      console.error('Create community error:', error);
      Alert.alert(
        'Error',
        error.response?.data?.message || 'Failed to create community. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={globalStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-back" size={24} color={colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Create Community</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.content}>
          {/* Community Image */}
          <TouchableOpacity style={styles.imageContainer} onPress={handleImagePicker}>
            {communityImage ? (
              <Image source={{ uri: communityImage }} style={styles.communityImage} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Icon name="add-a-photo" size={40} color={colors.dark.text + '80'} />
                <Text style={styles.imageText}>Add Community Photo</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Community Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Community Name *</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(value) => handleInputChange('name', value)}
              placeholder="Enter community name"
              placeholderTextColor={colors.dark.text + '80'}
              maxLength={50}
            />
            <Text style={styles.charCount}>{formData.name.length}/50</Text>
          </View>

          {/* Description */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.description}
              onChangeText={(value) => handleInputChange('description', value)}
              placeholder="Describe your community..."
              placeholderTextColor={colors.dark.text + '80'}
              multiline
              numberOfLines={4}
              maxLength={500}
            />
            <Text style={styles.charCount}>{formData.description.length}/500</Text>
          </View>

          {/* Category */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Category *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.categoryContainer}>
                {categories.map((category) => (
                  <TouchableOpacity
                    key={category}
                    style={[
                      styles.categoryChip,
                      formData.category === category && styles.selectedCategory,
                    ]}
                    onPress={() => handleInputChange('category', category)}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        formData.category === category && styles.selectedCategoryText,
                      ]}
                    >
                      {category}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Privacy Setting */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Privacy</Text>
            <TouchableOpacity
              style={styles.privacyOption}
              onPress={() => handleInputChange('isPrivate', !formData.isPrivate)}
            >
              <View style={styles.privacyInfo}>
                <Icon 
                  name={formData.isPrivate ? 'lock' : 'public'} 
                  size={20} 
                  color={colors.dark.primary} 
                />
                <View style={styles.privacyTextContainer}>
                  <Text style={styles.privacyTitle}>
                    {formData.isPrivate ? 'Private Community' : 'Public Community'}
                  </Text>
                  <Text style={styles.privacyDescription}>
                    {formData.isPrivate 
                      ? 'Only invited members can join' 
                      : 'Anyone can discover and join'
                    }
                  </Text>
                </View>
              </View>
              <Icon 
                name={formData.isPrivate ? 'radio-button-checked' : 'radio-button-unchecked'} 
                size={24} 
                color={colors.dark.primary} 
              />
            </TouchableOpacity>
          </View>

          {/* Community Rules */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Community Rules (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.rules}
              onChangeText={(value) => handleInputChange('rules', value)}
              placeholder="Set community guidelines and rules..."
              placeholderTextColor={colors.dark.text + '80'}
              multiline
              numberOfLines={3}
              maxLength={1000}
            />
            <Text style={styles.charCount}>{formData.rules.length}/1000</Text>
          </View>

          {/* Create Button */}
          <TouchableOpacity
            style={[
              styles.createButton,
              isLoading && styles.disabledButton
            ]}
            onPress={handleCreateCommunity}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.dark.text} />
            ) : (
              <>
                <Icon name="group-add" size={20} color={colors.dark.text} />
                <Text style={styles.createButtonText}>Create Community</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.dark.card,
  },
  backButton: {
    padding: 8,
  },
  title: {
    ...globalStyles.title,
    fontSize: 20,
    marginBottom: 0,
  },
  placeholder: {
    width: 40,
  },
  scrollContainer: {
    flexGrow: 1,
    padding: 0,
  },
  content: {
    padding: 16,
  },
  imageContainer: {
    alignSelf: 'center',
    marginBottom: 24,
  },
  communityImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  imagePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.dark.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.dark.text + '40',
    borderStyle: 'dashed',
  },
  imageText: {
    ...globalStyles.text,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    ...globalStyles.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    color: colors.dark.text,
  },
  input: {
    ...globalStyles.input,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  charCount: {
    ...globalStyles.text,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
    color: colors.dark.text + '80',
  },
  categoryContainer: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: colors.dark.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.dark.text + '40',
  },
  selectedCategory: {
    backgroundColor: colors.dark.primary,
    borderColor: colors.dark.primary,
  },
  categoryText: {
    ...globalStyles.text,
    fontSize: 14,
  },
  selectedCategoryText: {
    color: colors.dark.text,
    fontWeight: '600',
  },
  privacyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.dark.card,
    borderRadius: 12,
  },
  privacyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  privacyTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  privacyTitle: {
    ...globalStyles.text,
    fontSize: 16,
    fontWeight: '600',
  },
  privacyDescription: {
    ...globalStyles.text,
    fontSize: 14,
    color: colors.dark.text + '80',
    marginTop: 2,
  },
  createButton: {
    ...globalStyles.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  disabledButton: {
    opacity: 0.6,
  },
  createButtonText: {
    ...globalStyles.buttonText,
    marginLeft: 8,
  },
});

export default CreateCommunityScreen;