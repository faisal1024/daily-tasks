import { Component, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { track } from "@/lib/daily-tasks/analytics";

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Last line of defence for render errors: a calm screen with a way back
 * instead of a blank white app. Plain colours on purpose (the theme itself
 * may be what failed). Only the error's class name is recorded, never its
 * message (which could contain task text).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    const name = error instanceof Error ? error.name : "unknown";
    track("app_error", { source: "render", outcome: name });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <View
        // Always light: plain colours that don't depend on the theme (which may
        // be what failed), readable whatever the system appearance.
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 12,
          backgroundColor: "#FBFAFF",
        }}
        accessibilityRole="alert"
        testID="error-boundary"
      >
        <Text style={{ fontSize: 22, fontWeight: "700", textAlign: "center", color: "#1E1B2E" }}>
          Something went wrong
        </Text>
        <Text style={{ fontSize: 16, textAlign: "center", color: "#6A6580" }}>
          Your tasks are safe on this device. Try again, and if it keeps happening, restart the app.
        </Text>
        <Pressable
          onPress={() => this.setState({ hasError: false })}
          accessibilityRole="button"
          style={{ marginTop: 8, backgroundColor: "#5B52E8", borderRadius: 16, paddingVertical: 14, paddingHorizontal: 28 }}
        >
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "600" }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
