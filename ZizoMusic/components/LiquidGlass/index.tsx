import React, { useEffect } from 'react';
import { StyleSheet, View, Dimensions, TouchableWithoutFeedback } from 'react-native';
import { Canvas, Fill, Shader, Skia, vec } from '@shopify/react-native-skia';
import { useSharedValue, useDerivedValue, withSpring } from 'react-native-reanimated';
import { liquidGlassShader } from './shader';

const { width, height } = Dimensions.get('window');

const LiquidGlass = ({ children }: { children?: React.ReactNode }) => {
    const widthVal = useSharedValue(width);
    const heightVal = useSharedValue(height);
    const pointer = useSharedValue(vec(0, 0));
    const time = useSharedValue(0);

    useEffect(() => {
        let start = Date.now();
        const interval = setInterval(() => {
            time.value = (Date.now() - start) / 1000;
        }, 32); // ~30fps loop for time uniform
        return () => clearInterval(interval);
    }, []);

    const uniforms = useDerivedValue(() => {
        return {
            u_resolution: vec(widthVal.value, heightVal.value),
            u_pointer: pointer.value,
            u_time: time.value,
        };
    }, [time, pointer, widthVal, heightVal]);

    const handleTouch = (e: any) => {
        const { locationX, locationY } = e.nativeEvent;
        // Apply the "liquid spring" physics as requested
        pointer.value = withSpring(
            vec(locationX, locationY),
            {
                damping: 15,
                stiffness: 150,
            }
        );
    };

    return (
        <View
            style={styles.container}
            onTouchStart={handleTouch}
            onTouchMove={handleTouch}
            onTouchEnd={() => {
                // Optionally spring back to center or stay
                // pointer.value = withSpring(vec(width / 2, height / 2));
            }}
        >
            <Canvas style={styles.canvas}>
                <Fill>
                    <Shader source={liquidGlassShader} uniforms={uniforms} />
                </Fill>
            </Canvas>

            <View style={styles.contentContainer}>
                {children}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#000',
    },
    canvas: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    contentContainer: {
        flex: 1,
        // Ensure content is interactive
    },
    text: {
        color: 'white',
        fontSize: 24,
        fontWeight: 'bold',
    }
});

export default LiquidGlass;
