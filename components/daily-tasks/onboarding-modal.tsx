import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

interface OnboardingModalProps {
  visible: boolean;
  onDismiss: () => void;
}

const STEPS: { title: string; body: string }[] = [
  {
    title: "Choose less on purpose",
    body: "Most to-do apps help you collect more. This app helps you pick what actually deserves today.",
  },
  {
    title: "Set Today's Three",
    body: "Choose up to three focus commitments, then set the day so you can finish instead of reshuffle.",
  },
  {
    title: "Carry or release",
    body: "When tomorrow arrives, unfinished work asks for a decision. Carry it forward or release it.",
  },
];

export function OnboardingModal({ visible, onDismiss }: OnboardingModalProps) {
  const colors = useColors();

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onDismiss}
    >
      <View
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      >
        <View
          className="bg-background rounded-t-3xl p-6 gap-5"
          style={{ paddingBottom: 36 }}
        >
          <View className="gap-1">
            <Text className="text-sm" style={{ color: colors.muted }}>
              Welcome
            </Text>
            <Text className="text-2xl font-bold text-foreground">
              Pick three. Protect your day.
            </Text>
          </View>

          <ScrollView
            className="max-h-[320px]"
            contentContainerStyle={{ gap: 16 }}
            showsVerticalScrollIndicator={false}
          >
            {STEPS.map((step) => (
              <View
                key={step.title}
                className="rounded-2xl bg-surface border border-border p-4 gap-1"
              >
                <Text className="text-base font-semibold text-foreground">
                  {step.title}
                </Text>
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {step.body}
                </Text>
              </View>
            ))}
          </ScrollView>

          <Pressable
            onPress={onDismiss}
            className="self-stretch rounded-full py-3 items-center"
            style={{ backgroundColor: colors.primary }}
            accessibilityRole="button"
            accessibilityLabel="Start today"
          >
            <Text
              className="text-base font-semibold"
              style={{ color: colors.background }}
            >
              Choose Today's Three
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
