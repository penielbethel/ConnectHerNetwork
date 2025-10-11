import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialIcons';
import apiService from '../services/ApiService';
import { colors, globalStyles } from '../styles/globalStyles';

const VerificationScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'Verification'>>();
  const { email, phone, verificationType = 'email', userId: userIdFromParams, devOtp: devOtpFromParams, identifier: identifierFromParams, password: passwordFromParams } = route?.params || {};

  const [userId, setUserId] = useState<string | undefined>(userIdFromParams);
  const [devOtp, setDevOtp] = useState<string | undefined>(devOtpFromParams);

  const [verificationCode, setVerificationCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);

  useEffect(() => {
    startCountdown();
  }, []);

  const startCountdown = () => {
    setCanResend(false);
    setCountdown(60);
    
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setCanResend(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // route is already defined above with proper typing

  const handleVerification = async () => {
    if (!verificationCode.trim()) {
      Alert.alert('Error', 'Please enter the verification code');
      return;
    }

    if (verificationCode.length !== 6) {
      Alert.alert('Error', 'Verification code must be 6 digits');
      return;
    }

    setIsLoading(true);

    try {
      if (!userId) {
        Alert.alert('Error', 'Missing user ID for verification.');
        return;
      }

      const response = await apiService.request('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ userId, otpCode: verificationCode }),
      });

      if (response?.token && response?.user) {
        await AsyncStorage.setItem('currentUser', JSON.stringify(response.user));
        await AsyncStorage.setItem('authToken', response.token);
        await AsyncStorage.removeItem('pendingLoginUserId');

        const role = response.user?.role;
        if (role === 'superadmin') {
          navigation.navigate('SuperAdminPanel' as never);
        } else {
          navigation.navigate('Dashboard' as never);
        }
      } else {
        Alert.alert('Error', response?.message || 'Verification failed');
      }
    } catch (error: any) {
      const message =
        error?.response?.data?.message ||
        error?.message ||
        'Verification failed. Please try again.';
      console.error('Verification error:', error);
      Alert.alert('Error', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!canResend) return;

    setIsResending(true);

    try {
      // Preferred: use backend resend endpoint
      if (userId) {
        const response = await apiService.post('/auth/resend-otp', { userId });
        if (response?.success && response?.userId) {
          setUserId(String(response.userId));
          if (response?.devOtp) setDevOtp(String(response.devOtp));
          await AsyncStorage.setItem('pendingLoginUserId', String(response.userId));
          Alert.alert('Success', 'A new OTP has been sent to your email.');
          startCountdown();
          return;
        }
      }

      // Fallback: re-trigger OTP by logging in again with the same credentials
      if (!identifierFromParams || !passwordFromParams) {
        Alert.alert('Resend Code', 'Return to login and sign in again to receive a fresh OTP.');
        return;
      }
      const loginResponse = await apiService.login(identifierFromParams, passwordFromParams);
      if (loginResponse?.step === 'otp' && loginResponse?.userId) {
        setUserId(String(loginResponse.userId));
        if (loginResponse?.devOtp) setDevOtp(String(loginResponse.devOtp));
        await AsyncStorage.setItem('pendingLoginUserId', String(loginResponse.userId));
        Alert.alert('Success', 'A new OTP has been sent to your email.');
        startCountdown();
      } else {
        Alert.alert('Error', loginResponse?.message || 'Failed to resend code');
      }
    } catch (error: any) {
      console.error('Resend error:', error);
      Alert.alert(
        'Error',
        error?.response?.data?.message || error?.message || 'Failed to resend code. Please try again.'
      );
    } finally {
      setIsResending(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <KeyboardAvoidingView
      style={globalStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
          >
            <Icon name="arrow-back" size={24} color={colors.dark.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Verification</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Icon 
              name={verificationType === 'email' ? 'email' : 'phone'} 
              size={60} 
              color={colors.dark.primary} 
            />
          </View>

          <Text style={styles.subtitle}>
            Enter Verification Code
          </Text>

          <Text style={styles.description}>
            We've sent a 6-digit verification code to{'\n'}
            <Text style={styles.contactInfo}>
              {verificationType === 'email' ? email : phone}
            </Text>
          </Text>
          {devOtp ? (
            <Text style={styles.devHint}>
              Development build: use code {String(devOtp)}
            </Text>
          ) : null}

          <View style={styles.inputContainer}>
            <Text style={styles.label}>OTP Code</Text>
            <TextInput
              style={styles.codeInput}
              value={verificationCode}
              onChangeText={setVerificationCode}
              placeholder="Enter 6-digit code"
              placeholderTextColor={colors.dark.text + '80'}
              keyboardType="numeric"
              maxLength={6}
              autoFocus
              textAlign="center"
              fontSize={24}
              letterSpacing={8}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.verifyButton,
              (!verificationCode.trim() || isLoading) && styles.disabledButton
            ]}
            onPress={handleVerification}
            disabled={!verificationCode.trim() || isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.dark.text} />
            ) : (
              <Text style={styles.verifyButtonText}>Verify Code</Text>
            )}
          </TouchableOpacity>

          <View style={styles.resendContainer}>
            <Text style={styles.resendText}>
              Didn't receive the code?
            </Text>
            
            {canResend ? (
              <TouchableOpacity
                style={styles.resendButton}
                onPress={handleResendCode}
                disabled={isResending}
              >
                {isResending ? (
                  <ActivityIndicator size="small" color={colors.dark.primary} />
                ) : (
                  <Text style={styles.resendButtonText}>Resend Code</Text>
                )}
              </TouchableOpacity>
            ) : (
              <Text style={styles.countdownText}>
                Resend in {formatTime(countdown)}
              </Text>
            )}
          </View>

          <TouchableOpacity
            style={styles.changeMethodButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.changeMethodText}>
              Change {verificationType === 'email' ? 'Email' : 'Phone Number'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    flexGrow: 1,
    padding: 0,
  },
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
  title: {
    ...globalStyles.title,
    fontSize: 20,
    marginBottom: 0,
  },
  content: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.dark.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  subtitle: {
    ...globalStyles.subtitle,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    ...globalStyles.text,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  contactInfo: {
    color: colors.dark.primary,
    fontWeight: '600',
  },
  inputContainer: {
    width: '100%',
    marginBottom: 32,
  },
  codeInput: {
    ...globalStyles.input,
    height: 60,
    fontSize: 24,
    letterSpacing: 8,
    textAlign: 'center',
    fontWeight: '600',
  },
  label: {
    ...globalStyles.text,
    marginBottom: 8,
  },
  verifyButton: {
    ...globalStyles.button,
    width: '100%',
    marginBottom: 24,
  },
  disabledButton: {
    opacity: 0.6,
  },
  verifyButtonText: {
    ...globalStyles.buttonText,
  },
  resendContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  resendText: {
    ...globalStyles.text,
    marginBottom: 8,
  },
  resendButton: {
    padding: 8,
  },
  resendButtonText: {
    color: colors.dark.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  countdownText: {
    color: colors.dark.text + '80',
    fontSize: 16,
  },
  changeMethodButton: {
    padding: 12,
  },
  changeMethodText: {
    color: colors.dark.secondary,
    fontSize: 16,
    textDecorationLine: 'underline',
  },
});

export default VerificationScreen;