module.exports = {
  dependencies: {
    'react-native-vector-icons': {
      platforms: {
        android: {
          sourceDir: '../node_modules/react-native-vector-icons/android',
          packageImportPath: 'import com.oblador.vectoricons.VectorIconsPackage;',
        },
      },
    },
    'react-native-audio-recorder-player': {
      // Temporarily disable Android autolinking to avoid missing Nitro modules
      platforms: {
        android: null,
      },
    },
  },
  assets: ['./assets/fonts/'],
};