import { useEffect, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import layout from '../../assets/splash/layout.json';

const pageLeft = require('../../assets/splash/page-left.png');
const pageRight = require('../../assets/splash/page-right.png');
const wordTuition = require('../../assets/splash/word-tuition.png');
const wordBook = require('../../assets/splash/word-book.png');

const TOTAL = 2500; // ms until the splash starts to fade away

/**
 * Animated TuitionBook logo, shown on cold start over the app.
 *  1. the two pages of the book swing open from the spine
 *  2. the book settles with a small bounce while a shine sweeps across it
 *  3. "Tuition" slides in from the left and "Book" from the right
 *  4. everything fades out into the app
 * `onShown` fires once the first frame is on screen (hide the native splash then).
 */
export function AnimatedSplash({ onShown, onDone }: { onShown: () => void; onDone: () => void }) {
  const { width: screenW } = useWindowDimensions();
  const markW = Math.min(150, ((screenW - 56) * layout.mark[0]) / layout.wordWidth);
  const s = markW / layout.mark[0];
  const markH = layout.mark[1] * s;
  const wordW = layout.wordWidth * s;
  const wordH = layout.wordHeight * s;
  const wordTop = layout.wordTop * s;
  const groupH = wordTop + wordH;
  const pivot = `${(layout.stemCenter / layout.mark[0]) * 100}%` as const;

  const [open] = useState(() => new Animated.Value(0)); // 0 closed -> 1 open
  const [settle] = useState(() => new Animated.Value(0));
  const [shine] = useState(() => new Animated.Value(0));
  const [words] = useState(() => new Animated.Value(0));
  const [out] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const run = Animated.parallel([
      Animated.timing(open, { toValue: 1, duration: 850, delay: 150, easing: Easing.out(Easing.back(1.3)), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(800),
        Animated.timing(settle, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(850),
        Animated.timing(shine, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(1100),
        Animated.timing(words, { toValue: 1, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.sequence([
        Animated.delay(TOTAL),
        Animated.timing(out, { toValue: 1, duration: 350, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    ]);
    run.start(({ finished }) => finished && onDone());
    return () => run.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const angle = (side: 1 | -1) =>
    open.interpolate({ inputRange: [0, 1], outputRange: [`${side * 88}deg`, '0deg'] });
  const pageStyle = (side: 1 | -1) => ({
    ...StyleSheet.absoluteFill,
    opacity: open.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] }),
    transformOrigin: `${pivot} 50%`,
    transform: [{ perspective: 900 }, { rotateY: angle(side) }],
  });
  const pop = settle.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.07, 1] });
  const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-markW * 0.5, markW * 1.1] });
  const shineOpacity = shine.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.55, 0.55, 0] });
  const slide = (from: number) => ({
    opacity: words,
    transform: [{ translateX: words.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
  });

  return (
    <Animated.View
      pointerEvents="auto"
      style={[StyleSheet.absoluteFill, styles.root, { opacity: out.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}
      onLayout={onShown}
    >
      <View style={{ width: wordW, height: groupH }} accessible accessibilityLabel="TuitionBook">
        <Animated.View style={{ position: 'absolute', left: (wordW - markW) / 2, width: markW, height: markH, transform: [{ scale: pop }] }}>
          <Animated.View style={pageStyle(1)}>
            <Image source={pageLeft} style={styles.fill} resizeMode="contain" />
          </Animated.View>
          <Animated.View style={pageStyle(-1)}>
            <Image source={pageRight} style={styles.fill} resizeMode="contain" />
          </Animated.View>
          {/* the shine only shows where the pages are: it is white, on a white screen */}
          <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
            <Animated.View
              style={{
                position: 'absolute', top: -markH * 0.3, height: markH * 1.6, width: markW * 0.18, backgroundColor: '#FFFFFF',
                opacity: shineOpacity, transform: [{ translateX: shineX }, { rotate: '20deg' }],
              }}
            />
          </View>
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', top: wordTop, left: 0, width: layout.tuition[0] * s, height: wordH }, slide(-40)]}>
          <Image source={wordTuition} style={styles.fill} resizeMode="contain" />
        </Animated.View>
        <Animated.View style={[{ position: 'absolute', top: wordTop, left: layout.bookLeft * s, width: layout.book[0] * s, height: wordH }, slide(40)]}>
          <Image source={wordBook} style={styles.fill} resizeMode="contain" />
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  fill: { width: '100%', height: '100%' },
});
