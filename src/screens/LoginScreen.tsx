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

    if (registerData.password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
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
      });

      if (response.success) {
        Alert.alert(
          'Registration Successful',
          'Please check your email to verify your account.',
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
});

export default LoginScreen;