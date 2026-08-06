/// <reference types="vite/client" />

declare module "*.css";

// react-native-web supports these at runtime but @types/react-native, which
// describes the native renderer, does not declare them.
//   - dataSet  -> emitted as data-* attributes, our hook for :hover/:active and
//                 CSS keyframes, which cannot be expressed from the style prop.
//   - cursor / boxShadow / transition on ViewStyle -> plain CSS passthrough.
import "react-native";

declare module "react-native" {
  interface ViewProps {
    dataSet?: Record<string, string | number | undefined>;
  }
  interface TextProps {
    dataSet?: Record<string, string | number | undefined>;
  }
  interface PressableProps {
    dataSet?: Record<string, string | number | undefined>;
  }
  // boxShadow is already declared by react-native as
  // `ReadonlyArray<BoxShadowValue> | string`; re-declaring it narrower breaks
  // assignability between ViewStyle and TextStyle.
  interface ViewStyle {
    transition?: string;
    order?: number;
  }
  interface TextStyle {
    transition?: string;
  }
}
