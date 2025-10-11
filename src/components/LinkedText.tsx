import React from 'react';
import { Text } from 'react-native';

type LinkedTextProps = {
  text: string;
  onUserPress: (username: string) => void;
  style?: any;
  numberOfLines?: number;
};

// Renders text and turns @mentions into tappable links that trigger onUserPress
const LinkedText: React.FC<LinkedTextProps> = ({ text, onUserPress, style, numberOfLines }) => {
  const parts: Array<{ type: 'text' | 'mention'; value: string }> = [];
  // Support @mentions for usernames and full names (allow spaces between words)
  const regex = /@([a-zA-Z][a-zA-Z0-9_]*(?:\s+[a-zA-Z][a-zA-Z0-9_]*)*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    if (start > lastIndex) {
      parts.push({ type: 'text', value: text.slice(lastIndex, start) });
    }
    const username = match[1];
    parts.push({ type: 'mention', value: username });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, idx) =>
        p.type === 'mention' ? (
          <Text
            key={idx}
            style={{ color: '#2e64e5' }}
            onPress={() => onUserPress(p.value.trim().toLowerCase())}
          >
            @{p.value}
          </Text>
        ) : (
          <Text key={idx}>{p.value}</Text>
        )
      )}
    </Text>
  );
};

export default LinkedText;