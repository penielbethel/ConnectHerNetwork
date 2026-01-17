const fs = require('fs');
const path = require('path');

function log(msg) { console.log(`[postinstall] ${msg}`); }

function tryFixDocumentPicker() {
  try {
    const target = path.join(process.cwd(), 'node_modules', 'react-native-document-picker', 'android', 'src', 'main', 'java', 'com', 'reactnativedocumentpicker', 'RNDocumentPickerModule.java');
    if (!fs.existsSync(target)) { log('RNDocumentPickerModule.java not found; skipping'); return; }
    const src = fs.readFileSync(target, 'utf8');
    if (src.includes('GuardedResultAsyncTask')) {
      let out = src.replace(/import\s+com\.facebook\.react\.bridge\.GuardedResultAsyncTask;\s*/g, 'import android.os.AsyncTask;\n')
        .replace(/extends\s+GuardedResultAsyncTask<ReadableArray>/g, 'extends AsyncTask<Void, Void, ReadableArray>')
        .replace(/doInBackgroundGuarded\s*\(\)/g, 'doInBackground(Void... params)')
        .replace(/onPostExecuteGuarded\s*\(ReadableArray readableArray\)/g, 'onPostExecute(ReadableArray readableArray)')
        .replace(/\s*super\s*\(\s*reactContext\.getExceptionHandler\s*\(\)\s*\)\s*;\s*/g, '\n');
      fs.writeFileSync(target, out, 'utf8');
      log('Patched react-native-document-picker for RN 0.81 AsyncTask');
    } else {
      log('react-native-document-picker already compatible; no patch applied');
    }
  } catch (e) {
    console.warn('[postinstall] Failed to patch document-picker:', e.message);
  }
}

tryFixDocumentPicker();
