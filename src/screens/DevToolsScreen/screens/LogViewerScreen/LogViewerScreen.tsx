import React, {useEffect, useState, useRef} from 'react';
import {
  View,
  ScrollView,
  Share,
  Alert,
  Platform,
  StyleSheet,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Card, Text, Button} from 'react-native-paper';
import {useFocusEffect} from '@react-navigation/native';
import {getLogLines, getLogsAsText, clearLogBuffer} from '../../../../utils/logBuffer';
import {useTheme} from '../../../../hooks';
import {createStyles} from '../../styles';

const LogViewerScreen: React.FC = () => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [lines, setLines] = useState<Array<{level: string; time: string; args: string}>>([]);
  const scrollRef = useRef<ScrollView>(null);

  const refresh = () => setLines(getLogLines());

  useFocusEffect(
    React.useCallback(() => {
      refresh();
      const id = setInterval(refresh, 1500);
      return () => clearInterval(id);
    }, []),
  );

  useEffect(() => {
    if (lines.length > 0) {
      scrollRef.current?.scrollToEnd({animated: true});
    }
  }, [lines.length]);

  const handleCopy = async () => {
    const text = getLogsAsText();
    if (text.length === 0) {
      Alert.alert('Logs', 'No logs to copy.');
      return;
    }
    const {Clipboard} = await import('@react-native-clipboard/clipboard');
    Clipboard.setString(text);
    Alert.alert('Logs', 'Logs copied to clipboard.');
  };

  const handleShare = async () => {
    const text = getLogsAsText();
    if (text.length === 0) {
      Alert.alert('Logs', 'No logs to share.');
      return;
    }
    try {
      await Share.share({
        message: text,
        title: 'PocketPal logs',
      });
    } catch (e) {
      Alert.alert('Share failed', (e as Error).message);
    }
  };

  const handleClear = () => {
    Alert.alert(
      'Clear logs',
      'Clear the in-memory log buffer? New logs will still be captured.',
      [
        {text: 'Cancel', style: 'cancel'},
        {text: 'Clear', onPress: () => { clearLogBuffer(); refresh(); }},
      ],
    );
  };

  const levelColor = (level: string) => {
    if (level === 'error') return theme.colors?.error ?? '#c62828';
    if (level === 'warn') return theme.colors?.secondary ?? '#f9a825';
    return theme.colors?.onSurface ?? '#333';
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Card elevation={1} style={styles.card}>
        <Card.Content>
          <Text variant="bodyMedium" style={styles.description}>
            Recent console.log / warn / error (when Xcode debugger doesn't show them). Refreshes every 1.5s. Max 800 lines.
          </Text>
          <View style={localStyles.buttonRow}>
            <Button mode="outlined" onPress={handleCopy} style={localStyles.btn}>
              Copy
            </Button>
            <Button mode="outlined" onPress={handleShare} style={localStyles.btn}>
              Share
            </Button>
            <Button mode="outlined" onPress={handleClear} style={localStyles.btn}>
              Clear
            </Button>
          </View>
        </Card.Content>
      </Card>
      <ScrollView
        ref={scrollRef}
        style={localStyles.scroll}
        contentContainerStyle={localStyles.scrollContent}
        nestedScrollEnabled>
        {lines.length === 0 ? (
          <Text variant="bodySmall" style={styles.description}>
            No logs yet. Use the app and come back here to see console output.
          </Text>
        ) : (
          lines.map(({level, time, args}, i) => (
            <Text
              key={`${i}-${time}`}
              variant="bodySmall"
              style={[localStyles.line, {color: levelColor(level)}]}
              selectable>
              [{time}] {level}: {args}
            </Text>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const localStyles = StyleSheet.create({
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 8,
  },
  btn: {
    flex: 0,
  },
  scroll: {
    flex: 1,
    marginHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  line: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    marginBottom: 2,
  },
});

export default LogViewerScreen;
