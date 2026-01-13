const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withCustomAssets = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidResDir = path.join(projectRoot, 'android', 'app', 'src', 'main', 'res');
      
      const customAssetsDir = path.join(projectRoot, 'android-custom-assets');
      
      if (fs.existsSync(customAssetsDir)) {
          // Copy raw
          const rawSrc = path.join(customAssetsDir, 'raw');
          const rawDest = path.join(androidResDir, 'raw');
          if (fs.existsSync(rawSrc)) {
              if (!fs.existsSync(rawDest)) fs.mkdirSync(rawDest, { recursive: true });
              fs.readdirSync(rawSrc).forEach(file => {
                  fs.copyFileSync(path.join(rawSrc, file), path.join(rawDest, file));
              });
          }

          // Copy drawable
          const drawableSrc = path.join(customAssetsDir, 'drawable');
          const drawableDest = path.join(androidResDir, 'drawable');
           if (fs.existsSync(drawableSrc)) {
              if (!fs.existsSync(drawableDest)) fs.mkdirSync(drawableDest, { recursive: true });
              fs.readdirSync(drawableSrc).forEach(file => {
                  fs.copyFileSync(path.join(drawableSrc, file), path.join(drawableDest, file));
              });
          }
      }
      return config;
    },
  ]);
};

module.exports = withCustomAssets;
