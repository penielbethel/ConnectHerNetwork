import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, globalStyles } from '../styles/globalStyles';

const TermsAttestationScreen: React.FC = () => {
  const navigation = useNavigation();
  const today = useMemo(() => new Date().toLocaleDateString(), []);

  const handleAccept = async () => {
    try {
      await AsyncStorage.setItem('termsAccepted_v1', 'true');
    } catch (e) {
      // ignore storage errors; proceed to dashboard
    }
    navigation.navigate('Dashboard' as never);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Connect Her Network Mobile App – Terms & Conditions & User Attestation</Text>

        <Text style={styles.meta}>Effective Date: {today}</Text>
        <Text style={styles.meta}>Last Updated: {today}</Text>

        <Section title="1. Eligibility">
          <Bullet>• The App is strictly for women users only.</Bullet>
          <Bullet>• By registering, you confirm that you are at least 18 years of age, or have legal parental/guardian consent if under 18.</Bullet>
        </Section>

        <Section title="2. Data Collection & Privacy">
          <Bullet>• We collect basic information such as name, email, phone number, country, and professional details to provide networking opportunities.</Bullet>
          <Bullet>• All personal data is collected in compliance with global data protection laws (including GDPR).</Bullet>
          <Bullet>• Your information will never be sold to third parties. It may only be used for:
            {'\n'}  - Verifying your account
            {'\n'}  - Matching you with opportunities and partnerships
            {'\n'}  - Research and reporting to improve women empowerment initiatives
          </Bullet>
          <Bullet>• You may request account deletion and data removal at any time by contacting our support team.</Bullet>
        </Section>

        <Section title="3. User Responsibilities">
          <Bullet>• Provide accurate and truthful information during registration.</Bullet>
          <Bullet>• Do not impersonate another individual or organization.</Bullet>
          <Bullet>• Do not use the App for illegal, fraudulent, or harmful activities.</Bullet>
          <Bullet>• Respect other users by refraining from harassment, hate speech, bullying, or inappropriate conduct.</Bullet>
          <Bullet>• Take personal responsibility for any information you share publicly on the App.</Bullet>
        </Section>

        <Section title="4. Intellectual Property">
          <Bullet>• All content, design, logo, and intellectual property associated with the App are owned by Connect Network Foundation.</Bullet>
          <Bullet>• Users may not copy, reproduce, or distribute App content without written consent.</Bullet>
        </Section>

        <Section title="5. Disclaimer of Liability">
          <Bullet>• The Connect Her Network App provides connection, empowerment, and networking opportunities, but does not guarantee specific outcomes (such as jobs, contracts, or financial benefits).</Bullet>
          <Bullet>• The Foundation is not liable for:
            {'\n'}  - Disputes between users
            {'\n'}  - Losses from third-party engagements
            {'\n'}  - Unauthorized use of your account due to negligence in safeguarding your login details
          </Bullet>
        </Section>

        <Section title="6. Account Suspension & Termination">
          <Bullet>• The Foundation reserves the right to suspend or terminate accounts that violate these Terms.</Bullet>
          <Bullet>• Users engaging in fraud, impersonation, or abusive behavior will be permanently banned.</Bullet>
        </Section>

        <Section title="7. Updates to Terms">
          <Bullet>• These Terms may be updated periodically. Users will be notified of any major changes. Continued use of the App after updates constitutes acceptance.</Bullet>
        </Section>

        <Text style={styles.subtitle}>User Attestation</Text>
        <Bullet>1. I am a woman user registering for this App.</Bullet>
        <Bullet>2. I have read, understood, and accepted the Terms & Conditions of the Connect Her Network Mobile App.</Bullet>
        <Bullet>3. I voluntarily provide my data for empowerment and networking purposes.</Bullet>
        <Bullet>4. I release the Connect Network Foundation from any liability arising from my misuse of the App or third-party engagements.</Bullet>
        <Bullet>5. I agree to uphold integrity, respect, and responsibility while using the platform.</Bullet>

        <TouchableOpacity style={styles.acceptButton} onPress={handleAccept}>
          <Text style={styles.acceptText}>✅ Accept & Continue</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    <View style={styles.sectionBody}>{children}</View>
  </View>
);

const Bullet: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.bullet}>{children}</Text>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 20,
  },
  title: {
    ...globalStyles.title,
    fontSize: 20,
    marginBottom: 8,
    textAlign: 'left',
  },
  meta: {
    ...globalStyles.text,
    marginBottom: 4,
  },
  subtitle: {
    ...globalStyles.subtitle,
    marginTop: 24,
    marginBottom: 12,
  },
  section: {
    marginTop: 16,
  },
  sectionTitle: {
    ...globalStyles.subtitle,
    fontSize: 16,
    marginBottom: 8,
  },
  sectionBody: {},
  bullet: {
    ...globalStyles.text,
    marginBottom: 8,
    lineHeight: 22,
  },
  acceptButton: {
    ...globalStyles.button,
    marginTop: 24,
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  acceptText: {
    ...globalStyles.buttonText,
  },
});

export default TermsAttestationScreen;