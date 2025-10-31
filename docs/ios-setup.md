# iOS Setup and Build Guide (React Native 0.73.2)

This repo currently has Android configured. Use this guide to add iOS and produce App Store builds.

## Requirements
- macOS with Xcode 15+
- CocoaPods 1.12+ (`sudo gem install cocoapods`)
- Node 18+
- Apple Developer account (App Store Connect + Certificates)

## 1) Generate the `ios/` project
Run on macOS in the repo root:

```
npx react-native@0.73.2 init ConnectHerIOSScaffold --skip-install
cp -R ConnectHerIOSScaffold/ios ./ios
rm -rf ConnectHerIOSScaffold
```

Alternatively, create a fresh RN 0.73 project elsewhere and copy the `ios` folder into this repo.

## 2) Set bundle identifier, version, and build number
Edit `ios/ConnectHerMobile.xcodeproj/project.pbxproj` (or via Xcode):
- PRODUCT_BUNDLE_IDENTIFIER = `com.connecthermobile`
- MARKETING_VERSION = `1.0`
- CURRENT_PROJECT_VERSION = increment (start at `3` to match Android versionCode)

Ensure the scheme is `ConnectHerMobile` (or rename the app target to match).

## 3) Add required Info.plist keys
Edit `ios/ConnectHerMobile/Info.plist` and add:

```
<key>NSCameraUsageDescription</key><string>Camera access is required for video calls and photos.</string>
<key>NSMicrophoneUsageDescription</key><string>Microphone access is required for voice and video calls.</string>
<key>NSPhotoLibraryUsageDescription</key><string>Photo library access is required to select images and videos.</string>
<key>NSPhotoLibraryAddUsageDescription</key><string>Saving images and videos to your library.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Location is used to enhance community features.</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
  <string>remote-notification</string>
</array>
```

These cover modules used in this app (image picker, audio recorder, WebRTC calls, geolocation, notifications).

## 4) Firebase for iOS
- Download `GoogleService-Info.plist` from Firebase Console for the iOS app and place it at:
  `ios/ConnectHerMobile/GoogleService-Info.plist`
- Push Notifications require APNs keys/certificates in Firebase + Apple.

## 5) Pods install
From repo root on macOS:

```
cd ios
pod install
```

RN 0.73 template uses Hermes and static frameworks by default, which works with our dependencies: 
`react-native-video`, `@react-native-firebase/app`, `@react-native-firebase/messaging`, `react-native-webrtc`, `vector-icons`, etc., via autolinking.

## 6) App Capabilities
Enable in Xcode for the app target:
- Push Notifications
- Background Modes: `Remote notifications` and (if needed) `Audio`
- Add `ConnectHerMobile.entitlements` with `aps-environment` (development for debug, production for release)

## 7) Build and Archive (Xcode)
- Set signing to your team with automatic provisioning.
- Product → Archive, then export `.ipa` for TestFlight/App Store.

## 8) Optional: GitHub Actions (macOS) iOS build
Add a workflow using a macOS runner to automate builds. See `.github/workflows/ios-build.yml` in this repo.

---

### Notes
- This app’s RN version is `0.73.2`; match the template for best compatibility.
- Ensure `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` are updated for each release, similar to Android.
- If you want me to set up the iOS folder and the workflow directly, run this guide on a Mac or grant CI access; I’ll take it from there.