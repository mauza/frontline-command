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
  interface ViewStyle {
    boxShadow?: string;
    transition?: string;
  }
  interface TextStyle {
    boxShadow?: string;
    transition?: string;
  }
}
