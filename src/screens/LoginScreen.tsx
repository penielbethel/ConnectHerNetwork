import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useNavigation} from '@react-navigation/native';
import apiService from '../services/ApiService';
import {colors, globalStyles} from '../styles/globalStyles';
import {launchImageLibrary} from 'react-native-image-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import Geolocation from '@react-native-community/geolocation';
import {check, request, PERMISSIONS, RESULTS} from 'react-native-permissions';

const LoginScreen = () => {
  const navigation = useNavigation();
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  
  // Login form state
  const [loginData, setLoginData] = useState({
    username: '',
    password: '',
  });

  // Register form state
  const [registerData, setRegisterData] = useState({
    firstName: '',
    surname: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  // Additional signup fields aligned with backend and web signup
  const [avatar, setAvatar] = useState<{uri: string; type?: string; name?: string} | null>(null);
  const [gender, setGender] = useState<'Female' | 'Company'>('Female');
  const [birthday, setBirthday] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [locationText, setLocationText] = useState('');
  const [adminToken, setAdminToken] = useState('');

  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      const currentUser = await AsyncStorage.getItem('currentUser');
      const authToken = await AsyncStorage.getItem('authToken');
      
      if (currentUser && authToken) {
        navigation.navigate('Dashboard' as never);
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
    }
  };

  const handleLogin = async () => {
    if (!loginData.username || !loginData.password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.login(loginData.username, loginData.password);

      // Backend returns OTP step to email with userId
      if (response?.step === 'otp' && response?.userId) {
        await AsyncStorage.setItem('pendingLoginUserId', String(response.userId));
        // In development, backend may include devOtp fallback; surface it to user
        if (response?.devOtp) {
          Alert.alert('Development OTP', `Use this code to verify: ${String(response.devOtp)}`);
        }
        navigation.navigate(
          'Verification' as never,
          {
            userId: String(response.userId),
            devOtp: response?.devOtp,
            identifier: loginData.username,
            password: loginData.password,
          } as never
        );
        return;
      }

      // If backend skips OTP and returns token/user directly (unlikely but safe)
      if (response?.token && response?.user) {
        await AsyncStorage.setItem('currentUser', JSON.stringify(response.user));
        await AsyncStorage.setItem('authToken', response.token);
        await AsyncStorage.setItem('username', response.user.username);
        const role = response.user?.role;
        if (role === 'superadmin') {
          navigation.navigate('SuperAdminPanel' as never);
        } else {
          navigation.navigate('Dashboard' as never);
        }
        return;
      }

      Alert.alert('Login Failed', response?.message || 'Invalid credentials');
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        'Network error. Please try again.';
      console.error('Login error:', error);
      Alert.alert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!registerData.firstName || !registerData.surname || !registerData.username || 
        !registerData.email || !registerData.password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (registerData.password !== registerData.confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    // Enforce strong password for regular users (no admin token)
    const strongPasswordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;
    if (!adminToken && !strongPasswordRegex.test(registerData.password)) {
      Alert.alert('Error', 'Password must include at least one uppercase letter, one number, and one special character.');
      return;
    }

    if (!avatar) {
      Alert.alert('Error', 'Please upload a profile picture (avatar).');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.register({
        firstName: registerData.firstName,
        surname: registerData.surname,
        username: registerData.username,
        email: registerData.email,
        password: registerData.password,
        birthday,
        location: locationText,
        gender,
        adminToken: adminToken || undefined,
        avatar: avatar,
      });

      if (response?.user) {
        Alert.alert(
          'Registration Successful',
          'Account created. Please sign in to continue.',
          [
            {
              text: 'OK',
              onPress: () => setIsLogin(true),
            },
          ]
        );
      } else {
        Alert.alert('Registration Failed', response.message || 'Registration failed');
      }
    } catch (error: any) {
      console.error('Registration error:', error);
      Alert.alert('Error', error?.message || 'Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const pickAvatar = async () => {
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', quality: 0.7 });
      const asset = res?.assets?.[0];
      if (asset?.uri) {
        setAvatar({
          uri: asset.uri,
          type: asset.type || 'image/jpeg',
          name: asset.fileName || 'avatar.jpg',
        });
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to select image');
    }
  };

  const formatDate = (date: Date) => {
    const y = date.getFullYear();
    const m = `${date.getMonth() + 1}`.padStart(2, '0');
    const d = `${date.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const onChangeBirthday = (_event: any, selectedDate?: Date) => {
    setShowDatePicker(false);
    if (selectedDate) setBirthday(formatDate(selectedDate));
  };

  const [detectingLocation, setDetectingLocation] = useState(false);
  const detectLocation = async () => {
    try {
      setDetectingLocation(true);
      const permission = Platform.OS === 'ios' ? PERMISSIONS.IOS.LOCATION_WHEN_IN_USE : PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;
      const status = await check(permission);
      let final = status;
      if (status !== RESULTS.GRANTED) {
        final = await request(permission);
      }
      if (final !== RESULTS.GRANTED) {
        Alert.alert('Permission Required', 'Location permission is needed to auto-detect your location.');
        setDetectingLocation(false);
        return;
      }

      Geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          setLocationText(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
          setDetectingLocation(false);
        },
        (error) => {
          console.warn('Geolocation error:', error);
          Alert.alert('Location Error', 'Unable to fetch location. Please try again.');
          setDetectingLocation(false);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    } catch (err) {
      console.warn('detectLocation error:', err);
      setDetectingLocation(false);
      Alert.alert('Error', 'Failed to detect location.');
    }
  };

  const renderLoginForm = () => (
    <View style={styles.formContainer}>
      <Text style={styles.title}>Welcome Back</Text>
      <Text style={styles.subtitle}>Sign in to continue</Text>

      <Text style={styles.label}>Email or Username</Text>
      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Email or Username"
        placeholderTextColor={colors.textMuted}
        value={loginData.username}
        onChangeText={(text) => setLoginData({...loginData, username: text})}
        autoCapitalize="none"
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        value={loginData.password}
        onChangeText={(text) => setLoginData({...loginData, password: text})}
        secureTextEntry
      />

      <TouchableOpacity
        style={[globalStyles.button, styles.button]}
        onPress={handleLogin}
        disabled={loading}>
        <Text style={globalStyles.buttonText}>
          {loading ? 'Signing In...' : 'Sign In'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.switchButton}
        onPress={() => setIsLogin(false)}>
        <Text style={styles.switchText}>
          Don't have an account? <Text style={styles.linkText}>Sign Up</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderRegisterForm = () => (
    <View style={styles.formContainer}>
      <Text style={styles.title}>Create Account</Text>
      <Text style={styles.subtitle}>Join ConnectHer today</Text>

      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="First Name"
        placeholderTextColor={colors.textMuted}
        value={registerData.firstName}
        onChangeText={(text) => setRegisterData({...registerData, firstName: text})}
      />

      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Last Name"
        placeholderTextColor={colors.textMuted}
        value={registerData.surname}
        onChangeText={(text) => setRegisterData({...registerData, surname: text})}
      />

      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Username"
        placeholderTextColor={colors.textMuted}
        value={registerData.username}
        onChangeText={(text) => setRegisterData({...registerData, username: text})}
        autoCapitalize="none"
      />

      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Email"
        placeholderTextColor={colors.textMuted}
        value={registerData.email}
        onChangeText={(text) => setRegisterData({...registerData, email: text})}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        value={registerData.password}
        onChangeText={(text) => setRegisterData({...registerData, password: text})}
        secureTextEntry
      />

      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Confirm Password"
        placeholderTextColor={colors.textMuted}
        value={registerData.confirmPassword}
        onChangeText={(text) => setRegisterData({...registerData, confirmPassword: text})}
        secureTextEntry
      />

      {/* Gender selection */}
      <Text style={styles.label}>Gender</Text>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        {(['Female', 'Company'] as const).map((g) => (
          <TouchableOpacity
            key={g}
            style={[styles.segment, gender === g ? styles.segmentActive : styles.segmentInactive]}
            onPress={() => setGender(g)}
          >
            <Text style={gender === g ? styles.segmentTextActive : styles.segmentTextInactive}>{g}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Birthday */}
      <Text style={styles.label}>Date of Birth</Text>
      <TouchableOpacity
        style={[globalStyles.input, styles.input, { justifyContent: 'center', height: 48 }]}
        onPress={() => setShowDatePicker(true)}
        activeOpacity={0.7}
      >
        <Text style={{ color: birthday ? colors.text : colors.textMuted }}>
          {birthday || 'Select your birthday'}
        </Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker
          value={birthday ? new Date(birthday) : new Date(2000, 0, 1)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onChangeBirthday}
          maximumDate={new Date()}
        />
      )}

      {/* Location */}
      <Text style={styles.label}>Location</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <TextInput
            style={[globalStyles.input, styles.input]}
            placeholder="City, Country or coordinates"
            placeholderTextColor={colors.textMuted}
            value={locationText}
            onChangeText={setLocationText}
          />
        </View>
        <TouchableOpacity
          style={{ marginLeft: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 6, backgroundColor: colors.primary }}
          onPress={detectLocation}
          disabled={detectingLocation}
        >
          <Text style={{ color: colors.buttonText || '#fff' }}>{detectingLocation ? 'Detecting...' : 'Use Current'}</Text>
        </TouchableOpacity>
      </View>

      {/* Admin Token (optional) */}
      <TextInput
        style={[globalStyles.input, styles.input]}
        placeholder="Admin Token (optional)"
        placeholderTextColor={colors.textMuted}
        value={adminToken}
        onChangeText={setAdminToken}
        autoCapitalize="none"
      />

      {/* Avatar Upload */}
      <View style={{ alignItems: 'center', marginVertical: 10 }}>
        {avatar ? (
          <Image source={{ uri: avatar.uri }} style={{ width: 96, height: 96, borderRadius: 48, marginBottom: 8 }} />
        ) : null}
        <TouchableOpacity style={[globalStyles.button, styles.button]} onPress={pickAvatar}>
          <Text style={globalStyles.buttonText}>{avatar ? 'Change Profile Picture' : 'Upload Profile Picture'}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[globalStyles.button, styles.button]}
        onPress={handleRegister}
        disabled={loading}>
        <Text style={globalStyles.buttonText}>
          {loading ? 'Creating Account...' : 'Create Account'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.switchButton}
        onPress={() => setIsLogin(true)}>
        <Text style={styles.switchText}>
          Already have an account? <Text style={styles.linkText}>Sign In</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={globalStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.logoContainer}>
          <Image
            source={{uri: 'https://connecther.network/logo.png'}}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.appName}>ConnectHer</Text>
        </View>

        {isLogin ? renderLoginForm() : renderRegisterForm()}
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 80,
    height: 80,
    marginBottom: 10,
  },
  appName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
  },
  formContainer: {
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 30,
  },
  input: {
    marginBottom: 15,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: 6,
    marginLeft: 4,
  },
  button: {
    marginTop: 10,
    marginBottom: 20,
  },
  switchButton: {
    alignItems: 'center',
  },
  switchText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  linkText: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  // Segmented control styles for gender selection
  segment: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginRight: 8,
    borderWidth: 1,
  },
  segmentActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentInactive: {
    backgroundColor: 'transparent',
    borderColor: colors.border || '#ccc',
  },
  segmentTextActive: {
    color: colors.buttonText || '#fff',
    fontWeight: '600',
  },
  segmentTextInactive: {
    color: colors.textSecondary,
  },
});

export default LoginScreen;