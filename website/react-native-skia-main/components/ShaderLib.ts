import { Skia } from "@shopify/react-native-skia";

export const glsl = (source: TemplateStringsArray, ...values: any[]) => {
    const str = source.reduce((result, s, i) => result + s + (values[i] || ""), "");
    return str;
};

export const frag = (source: TemplateStringsArray, ...values: any[]) => {
    const str = glsl(source, ...values);
    const effect = Skia.RuntimeEffect.Make(str);
    if (!effect) {
        throw new Error("Failed to compile shader: " + str);
    }
    return effect;
};
