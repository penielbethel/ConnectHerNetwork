import { AppRegistry } from 'react-native';
import { name as appName } from './package.json';

// Global error handler to surface early runtime issues (safe, non-invasive)
try {
  if (
    typeof global !== 'undefined' &&
    global.ErrorUtils &&
    typeof global.ErrorUtils.setGlobalHandler === 'function' &&
    !global.__CONNECTHER_GLOBAL_ERROR_HANDLER_SET__
  ) {
    global.__CONNECTHER_GLOBAL_ERROR_HANDLER_SET__ = true;
    global.ErrorUtils.setGlobalHandler((e, isFatal) => {
      try {
        const msg = e?.message || e;
        const stack = e?.stack;
        console.error('[GlobalError]', msg, stack, 'isFatal:', isFatal);
      } catch {}
    });
  }
} catch {}

// Register early with a lazy loader to avoid "not registered" invariant
try {
  console.log('[RegisterComponent] name:', appName);
  AppRegistry.registerComponent(appName, () => {
    try {
      // Minimal probes just before loading App to surface import errors
      try { console.log('[ProbeStart]', './src/services/ApiService'); require('./src/services/ApiService'); console.log('[ProbeOK]', './src/services/ApiService'); } catch (e1) { console.error('[ProbeFAIL]', './src/services/ApiService', e1?.message || e1, e1?.stack); }
      try { console.log('[ProbeStart]', './src/services/SocketService'); require('./src/services/SocketService'); console.log('[ProbeOK]', './src/services/SocketService'); } catch (e2) { console.error('[ProbeFAIL]', './src/services/SocketService', e2?.message || e2, e2?.stack); }
      try { console.log('[ProbeStart]', './src/services/pushNotifications'); require('./src/services/pushNotifications'); console.log('[ProbeOK]', './src/services/pushNotifications'); } catch (e3) { console.error('[ProbeFAIL]', './src/services/pushNotifications', e3?.message || e3, e3?.stack); }
      try { console.log('[ProbeStart]', './src/services/AudioRecorder'); require('./src/services/AudioRecorder'); console.log('[ProbeOK]', './src/services/AudioRecorder'); } catch (e4) { console.error('[ProbeFAIL]', './src/services/AudioRecorder', e4?.message || e4, e4?.stack); }

      console.log('[EntryImportStart]', './App');
      const App = require('./App').default;
      console.log('[EntryImportDone]', './App');
      return App;
    } catch (e) {
      console.error('[EntryImportError]', e?.message || e, e?.stack);
      return () => null;
    }
  });
  console.log('[RegisterComponent] completed');
} catch (e) {
  console.error('[RegisterComponentError]', e?.message || e, e?.stack);
}