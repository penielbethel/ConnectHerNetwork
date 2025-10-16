import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import FAIcon from 'react-native-vector-icons/FontAwesome5';
import { colors, globalStyles } from '../styles/globalStyles';

const openUrl = async (url: string) => {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      console.warn('Cannot open URL:', url);
    }
  } catch (e) {
    console.error('openUrl error', e);
  }
};

const HelpDeskScreen: React.FC = () => {
  const navigation = useNavigation();

  const handleEmail = () => openUrl('mailto:support@connecther.network?subject=ConnectHer%20Support');
  const openWhatsApp = async (phone: string) => {
    const candidates = [
      `whatsapp://send?phone=${phone}`,
      `https://api.whatsapp.com/send?phone=${phone}`,
      `https://wa.me/${phone}`,
    ];
    for (const url of candidates) {
      try {
        const supported = await Linking.canOpenURL(url);
        if (supported) {
          await Linking.openURL(url);
          return;
        }
      } catch (_) {}
    }
    Alert.alert('WhatsApp not available', 'Unable to open WhatsApp on this device.');
  };
  const handleWhatsApp1 = () => openWhatsApp('2348072220696');
  const handleWhatsApp2 = () => openWhatsApp('2349014093003');

  return (
    <View style={[globalStyles.container, styles.container]}>
      {/* Local Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Icon name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help Desk</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Getting Started</Text>
          <Text style={styles.cardText}>Welcome to ConnectHer! Follow these quick steps to get the best out of the app.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Registration</Text>
          <Text style={styles.cardText}>- Create your account using a valid email or phone number.</Text>
          <Text style={styles.cardText}>- Complete your profile with name, username, and avatar.</Text>
          <Text style={styles.cardText}>- Save your login details securely for easy access.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Verification</Text>
          <Text style={styles.cardText}>- Complete face and voice verification to secure your account.</Text>
          <Text style={styles.cardText}>- Follow on-screen prompts to allow camera and microphone access.</Text>
          <Text style={styles.cardText}>- After successful verification, proceed to Terms Attestation.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Chatting</Text>
          <Text style={styles.cardText}>- Search for users and start private conversations.</Text>
          <Text style={styles.cardText}>- Send text, images, videos, and documents seamlessly.</Text>
          <Text style={styles.cardText}>- Use voice or video calls where available.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Community</Text>
          <Text style={styles.cardText}>- Join or create communities to connect with others.</Text>
          <Text style={styles.cardText}>- Post updates, like, comment, and share content.</Text>
          <Text style={styles.cardText}>- Participate in group chats and calls in your communities.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Contact Us</Text>
          <Text style={styles.cardText}>Head Office:</Text>
          <Text style={styles.cardText}>1st Floor, Amaden Plaza, Mabushi, FCT, Abuja</Text>
          <Text style={[styles.cardText, { marginTop: 8 }]}>Email:</Text>
          <TouchableOpacity onPress={handleEmail}>
            <Text style={styles.linkText}>support@connecther.network</Text>
          </TouchableOpacity>
          <Text style={[styles.cardText, { marginTop: 8 }]}>WhatsApp Support:</Text>
          <View style={styles.linkRow}>
            <TouchableOpacity style={styles.linkButton} onPress={handleWhatsApp1}>
              <FAIcon name="whatsapp" size={18} color="#25D366" />
              <Text style={styles.linkButtonText}>+234 807 222 0696</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.linkRow}>
            <TouchableOpacity style={styles.linkButton} onPress={handleWhatsApp2}>
              <FAIcon name="whatsapp" size={18} color="#25D366" />
              <Text style={styles.linkButtonText}>+234 901 409 3003</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.card, { marginBottom: 20 }]}>
          <Text style={styles.cardTitle}>Tips</Text>
          <Text style={styles.cardText}>- Keep your app updated for the latest features and fixes.</Text>
          <Text style={styles.cardText}>- Respect community guidelines; report abuse or spam promptly.</Text>
          <Text style={styles.cardText}>- For urgent support, use the WhatsApp buttons above.</Text>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg,
  },
  header: {
    ...globalStyles.flexRowBetween,
    ...globalStyles.paddingHorizontal,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  headerButton: {
    padding: 6,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.surface,
    marginHorizontal: 10,
    marginTop: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 6,
  },
  cardText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  linkText: {
    color: colors.primary,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  linkRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.secondary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  linkButtonText: {
    color: colors.text,
    fontWeight: '600',
  },
});

export default HelpDeskScreen;