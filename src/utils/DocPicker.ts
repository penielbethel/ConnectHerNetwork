import type { ReadableArray } from 'react-native';
import {
  pick as dpPick,
  pickMultiple as dpPickMultiple,
  keepLocalCopy,
  types,
  isCancel,
} from '@react-native-documents/picker';

type CopyDestination = 'documentDirectory' | 'cachesDirectory';

type PickOptions = {
  type?: string[];
  allowMultiSelection?: boolean;
  copyTo?: CopyDestination | null;
};

type PickedFile = {
  uri: string;
  name?: string;
  type?: string;
  size?: number;
  fileCopyUri?: string | null;
};

async function maybeCopy(files: PickedFile[], copyTo?: CopyDestination | null): Promise<PickedFile[]> {
  if (!copyTo) return files;
  const destination = copyTo === 'documentDirectory' ? 'documentDirectory' : 'cachesDirectory';
  const inputs = files.map((f) => ({ uri: f.uri, fileName: f.name || 'file' }));
  const localCopies = await keepLocalCopy({ files: inputs, destination });
  return files.map((f, i) => ({ ...f, fileCopyUri: localCopies[i]?.uri || null }));
}

async function pick(options: PickOptions = {}): Promise<PickedFile[]> {
  const files = await dpPick({ type: options.type, allowMultiSelection: options.allowMultiSelection });
  const normalized: PickedFile[] = files.map((f: any) => ({ uri: f.uri, name: f.name, type: f.type, size: f.size }));
  return maybeCopy(normalized, options.copyTo);
}

async function pickSingle(options: PickOptions = {}): Promise<PickedFile> {
  const files = await pick({ ...options, allowMultiSelection: false });
  return files[0];
}

async function pickMultiple(options: PickOptions = {}): Promise<PickedFile[]> {
  const files = await dpPickMultiple({ type: options.type });
  const normalized: PickedFile[] = files.map((f: any) => ({ uri: f.uri, name: f.name, type: f.type, size: f.size }));
  return maybeCopy(normalized, options.copyTo);
}

const DocumentPicker = {
  types,
  isCancel,
  pick,
  pickSingle,
  pickMultiple,
};

export default DocumentPicker;
