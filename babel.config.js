module.exports = {
  presets: [
    '@react-native/babel-preset',
    ['@babel/preset-typescript', { allExtensions: true, isTSX: false, allowDeclareFields: true }]
  ],
  plugins: [
    [
      'module:react-native-dotenv',
      {
        moduleName: '@env',
        path: '.env',
        blacklist: null,
        whitelist: null,
        safe: false,
        allowUndefined: true,
      },
    ],
  ],
};
