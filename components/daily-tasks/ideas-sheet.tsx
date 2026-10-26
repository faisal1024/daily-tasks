import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { useColors } from "@/hooks/use-colors";
import { showActionSheet } from "@/lib/daily-tasks/action-sheet";
import { suggestionsHint } from "@/lib/daily-tasks/ai-status";
import { routineBlock, routineBlockedLine } from "@/lib/daily-tasks/routines";
import { THINKING_HINT_DELAY_MS, type IdeasSource } from "@/lib/daily-tasks/today-view";

export interface IdeaItem {
  id: string;
  text: string;
  estimatedMinutes?: number;
}

interface IdeasSheetProps {
  visible: boolean;
  /** Opened from "Saved for later": show only the saved items, first. */
  savedOnly?: boolean;
  onClose: () => void;
  goalTitle: string | null;
  source: IdeasSource;
  ideas: IdeaItem[];
  addedTexts: Set<string>;
  remainingSlots: number;
  adaptationReason: string | null;
  canRegenerate: boolean;
  regenerating: boolean;
  failureMessage: string | null;
  onAdd: (text: string) => void;
  onAddAll: (texts: string[]) => void;
  onRegenerate: () => void;
  /** Brain-dump leftovers saved for later. */
  parked?: { id: string; text: string }[];
  onAddParked?: (id: string) => void;
  onRemoveParked?: (id: string) => void;
  /**
   * "Swap in" (1.5 D): on a full, unlocked day each saved item can take one
   * of today's open tasks' place (`taskId`); that task is saved for later.
   */
  onSwapParked?: (parkedId: string, taskId: string) => void;
  /** Today's open tasks, the ones a saved item can swap with. */
  swapTargets?: { id: string; text: string }[];
  /** Offered in the "full" state so the next step is one tap away. */
  onLock?: () => void;
  /** Routines due today and not on today's list yet (1.3). Nothing shows when empty. */
  routines?: { id: string; text: string }[];
  onAddRoutine?: (id: string) => void;
  /** Today is locked: nothing can be added until it's unlocked. */
  locked?: boolean;
  /** The user has routines (due today or not); without any, a quiet footer offers one. */
  hasRoutines?: boolean;
  /** Opens the routines sheet (the footer's routines link, Today's routines' Edit). */
  onManageRoutines?: () => void;
  /** The routine coming up next, said in the footer when none is due today ("on Monday", "tomorrow"). */
  nextRoutine?: { text: string; when: string } | null;
  /**
   * Suggestions for the next open milestone on the goal path (1.4), shown under
   * the source chip and hint, above the general list (then headed "More
   * ideas"). Null (no path, or every milestone reached): no group.
   */
  milestoneGroup?: { title: string; ideas: IdeaItem[] } | null;
  /** Adds a milestone suggestion; falls back to `onAdd`. */
  onAddMilestoneIdea?: (text: string) => void;
  /** Opened from Today's "Next on your path": bring the milestone group into view. */
  focusMilestone?: boolean;
}

const keyOf = (text: string) => text.trim().toLowerCase();

/** "Swap in" asks which of today's open tasks makes way (1.5 D). */
export const SWAP_IN_QUESTION = "Which task should it replace? That one goes to Saved for later.";

export function IdeasSheet({
  visible,
  savedOnly = false,
  onClose,
  goalTitle,
  source,
  ideas,
  addedTexts,
  remainingSlots,
  adaptationReason,
  canRegenerate,
  regenerating,
  failureMessage,
  onAdd,
  onAddAll,
  onRegenerate,
  parked = [],
  onAddParked,
  onRemoveParked,
  onSwapParked,
  swapTargets = [],
  onLock,
  routines = [],
  onAddRoutine,
  locked = false,
  hasRoutines = true,
  onManageRoutines,
  nextRoutine = null,
  milestoneGroup = null,
  onAddMilestoneIdea,
  focusMilestone = false,
}: IdeasSheetProps) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  const insets = useSafeAreaInsets();
  const stillThinking = useStillThinking(regenerating);
  // The saved-only view is just the saved items: no routines there.
  const shownRoutines = savedOnly ? [] : routines;
  // An idea with the same words as a routine due today is listed once, as the routine.
  const routineKeys = new Set(shownRoutines.map((routine) => keyOf(routine.text)));
  const shownIdeas = routineKeys.size > 0 ? ideas.filter((idea) => !routineKeys.has(keyOf(idea.text))) : ideas;
  const available = shownIdeas.filter((idea) => !addedTexts.has(keyOf(idea.text)));
  const full = remainingSlots <= 0;
  // Saved items can't move onto a full day, or a locked one.
  const parkedBlocked = full || locked;
  // A full, unlocked day: a saved item can swap places with an open task (1.5 D).
  const canSwap = full && !locked && Boolean(onSwapParked) && swapTargets.length > 0;
  // Android: the choice opens under the item (an alert has room for three
  // buttons, and three open tasks need a Cancel too).
  const [swapChoosing, setSwapChoosing] = useState<string | null>(null);
  useEffect(() => {
    if (!visible || !canSwap) setSwapChoosing(null);
  }, [visible, canSwap]);
  const chooseSwap = (item: { id: string; text: string }) => {
    if (!onSwapParked) return;
    const targets = swapTargets;
    if (Platform.OS === "ios") {
      showActionSheet(
        {
          title: `Swap in “${item.text}”`,
          message: SWAP_IN_QUESTION,
          options: [...targets.map((t) => t.text), "Cancel"],
          cancelButtonIndex: targets.length,
        },
        (index) => {
          const target = targets[index];
          if (target) onSwapParked(item.id, target.id);
        },
      );
      return;
    }
    setSwapChoosing((current) => (current === item.id ? null : item.id));
  };
  // The saved-only view is just the saved items: no milestone group either.
  const shownMilestone = !savedOnly && milestoneGroup && milestoneGroup.ideas.length > 0 ? milestoneGroup : null;
  // Opened for the milestone group: scroll to it once it has been laid out.
  const scrollRef = useRef<ScrollView>(null);
  const scrolledToMilestone = useRef(false);
  useEffect(() => {
    if (!visible) scrolledToMilestone.current = false;
  }, [visible]);

  // Live regions are Android-only; announce new failure notes on iOS too.
  useEffect(() => {
    if (visible && failureMessage) {
      AccessibilityInfo.announceForAccessibility(failureMessage);
    }
  }, [visible, failureMessage]);

  return (
    <Modal
      visible={visible}
      onRequestClose={onClose}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <View
        className="flex-1"
        style={{
          backgroundColor: colors.background,
          paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12,
        }}
        testID="ideas-sheet"
      >
        <View className="flex-row items-center justify-between px-5">
          <Text
            accessibilityRole="header"
            className="text-2xl text-foreground"
            style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
          >
            {savedOnly ? "Saved for later" : goalTitle ? `Ideas for ${goalTitle}` : "Ideas for today"}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close ideas"
            hitSlop={10}
            className="p-1"
          >
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 14 }}
        >
          {shownRoutines.length > 0 && (
            <TodaysRoutines
              routines={shownRoutines}
              onAdd={onAddRoutine}
              onEdit={onManageRoutines}
              blockedReason={routineBlockedLine(routineBlock({ locked, remainingSlots }), { where: "ideas" })}
            />
          )}

          {/* Not over the saved items: they're the user's own, not starter ideas (1.5 D). */}
          {!savedOnly && (
          <View className="flex-row items-center justify-between" testID="ideas-source-row">
            <View
              className="flex-row items-center gap-1.5 rounded-full px-3 py-1"
              style={{ backgroundColor: source.personalized ? `${colors.primary}18` : colors.surface }}
            >
              <Ionicons
                name={source.personalized ? "sparkles" : "leaf-outline"}
                size={13}
                color={source.personalized ? colors.primary : colors.muted}
              />
              <Text
                className="text-xs font-semibold"
                style={{ color: source.personalized ? colors.primary : colors.muted }}
              >
                {source.label}
              </Text>
            </View>
            {canRegenerate && !savedOnly && (
              <Pressable
                onPress={onRegenerate}
                disabled={regenerating}
                accessibilityRole="button"
                accessibilityLabel="Get new ideas"
                accessibilityState={{ busy: regenerating, disabled: regenerating }}
                hitSlop={12}
                className="flex-row items-center gap-1"
                style={{ opacity: regenerating ? 0.5 : 1 }}
              >
                <Ionicons name="refresh" size={16} color={colors.primary} />
                <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                  {regenerating ? "Refreshing…" : "New ideas"}
                </Text>
              </Pressable>
            )}
          </View>
          )}

          {stillThinking && (
            <Text className="text-xs" style={{ color: colors.muted }}>
              Still thinking… good ideas take a moment.
            </Text>
          )}

          {failureMessage && (
            <View
              className="flex-row items-start gap-2 rounded-2xl p-3"
              style={{ backgroundColor: colors.surface }}
              accessibilityLiveRegion="polite"
              testID="ideas-failure"
            >
              <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
              <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
                {failureMessage}
              </Text>
            </View>
          )}

          {/* The reason leads; the slot count under it is the smaller helper. */}
          {adaptationReason && !full && !savedOnly && !locked ? (
            <>
              <Text className="text-base" style={{ color: colors.muted }} testID="ideas-reason">
                {adaptationReason}
              </Text>
              <Text className="text-xs" style={{ color: colors.muted }} testID="ideas-hint">
                {suggestionsHint(remainingSlots)}
              </Text>
            </>
          ) : (
            <Text className="text-base" style={{ color: colors.muted }} testID="ideas-hint">
              {locked
                ? "Today is locked. Unlock it to add one."
                : savedOnly
                  ? canSwap
                    ? "Your day is full. Swap one of these in for an open task."
                    : "Your day is full. Free a slot to swap one of these in."
                  : full
                    ? "Today's three are picked. Nice."
                    : suggestionsHint(remainingSlots)}
            </Text>
          )}

          {shownMilestone && (
            <View
              onLayout={(event) => {
                if (!focusMilestone || scrolledToMilestone.current) return;
                scrolledToMilestone.current = true;
                scrollRef.current?.scrollTo({ y: Math.max(0, event.nativeEvent.layout.y - 12), animated: false });
              }}
            >
              <MilestoneIdeas
                title={shownMilestone.title}
                ideas={shownMilestone.ideas}
                addedTexts={addedTexts}
                blocked={full || locked}
                onAdd={onAddMilestoneIdea ?? onAdd}
              />
            </View>
          )}

          {/* Under a milestone group the general list gets its own heading;
              with nothing left for it (every idea is in the group), no heading. */}
          {shownMilestone && shownIdeas.length > 0 && (
            <Text
              accessibilityRole="header"
              className="text-sm font-semibold"
              style={{ color: colors.muted }}
              testID="more-ideas-heading"
            >
              More ideas
            </Text>
          )}

          {!savedOnly && shownIdeas.length > 0 && (
          <View className="gap-2" testID="general-ideas">
            {shownIdeas.map((idea) => {
              const added = addedTexts.has(keyOf(idea.text));
              // A day locked while the sheet was open takes nothing more.
              const disabled = added || full || locked;
              return (
                <Pressable
                  key={idea.id}
                  onPress={() => onAdd(idea.text)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={added ? `${idea.text}, added` : `Add ${idea.text}`}
                  accessibilityState={{ disabled }}
                  className="rounded-2xl border p-4 flex-row items-center gap-3"
                  style={{
                    backgroundColor: colors.surface,
                    borderColor: added ? colors.success : colors.border,
                    opacity: disabled && !added ? 0.5 : 1,
                  }}
                >
                  <Ionicons
                    name={added ? "checkmark-circle" : "add-circle-outline"}
                    size={26}
                    color={added ? colors.success : colors.primary}
                  />
                  <View className="flex-1 gap-0.5">
                    <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
                      {idea.text}
                    </Text>
                    {typeof idea.estimatedMinutes === "number" && (
                      <Text className="text-sm" style={{ color: colors.muted }}>
                        {idea.estimatedMinutes} min
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
          )}

          {/* The general list only: never routines or the milestone group. */}
          {!savedOnly && available.length > 1 && !full && !locked && (
            <Pressable
              onPress={() => onAddAll(available.slice(0, remainingSlots).map((idea) => idea.text))}
              accessibilityRole="button"
              accessibilityLabel={
                available.length > remainingSlots
                  ? `Add ${remainingSlots} ${remainingSlots === 1 ? "idea" : "ideas"}`
                  : "Add all ideas"
              }
              className="rounded-2xl py-4 items-center"
              style={{ backgroundColor: colors.primary }}
            >
              <Text className="text-lg" style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: colors.onPrimary }}>
                {/* Only the ideas below (never routines), so it says so. */}
                {available.length > remainingSlots
                  ? `Add ${remainingSlots} ${remainingSlots === 1 ? "idea" : "ideas"}`
                  : "Add all"}
              </Text>
            </Pressable>
          )}

          {parked.length > 0 && (
            <View className="gap-2 mt-2" testID="parked-ideas">
              {/* The saved-only sheet's title already says it. */}
              {!savedOnly && (
                <Text
                  className="text-sm font-semibold uppercase tracking-wide"
                  style={{ color: colors.muted }}
                >
                  Saved for later
                </Text>
              )}
              {parked.map((item) => (
                <View key={item.id} className="gap-2">
                <View
                  className="rounded-2xl border p-3 flex-row items-center gap-3"
                  style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                >
                  <Pressable
                    onPress={() => onAddParked?.(item.id)}
                    disabled={parkedBlocked}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${item.text}`}
                    accessibilityState={{ disabled: parkedBlocked }}
                    hitSlop={6}
                    className="flex-1 flex-row items-center gap-3"
                    style={{ opacity: parkedBlocked ? 0.5 : 1 }}
                  >
                    <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                    <Text className="flex-1 text-base text-foreground">{item.text}</Text>
                  </Pressable>
                  {canSwap ? (
                    <Pressable
                      onPress={() => chooseSwap(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`Swap in ${item.text}`}
                      accessibilityHint="Pick which of today's tasks it replaces"
                      hitSlop={6}
                      className="rounded-full px-3 justify-center"
                      style={{ minHeight: 36, borderWidth: 1, borderColor: colors.primary }}
                      testID={`swap-in-${item.id}`}
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                        Swap in
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => onRemoveParked?.(item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.text} from saved`}
                    hitSlop={10}
                  >
                    <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
                  </Pressable>
                </View>
                {canSwap && swapChoosing === item.id ? (
                  <View className="gap-2 px-1" testID={`swap-choices-${item.id}`}>
                    <Text className="text-sm" style={{ color: colors.muted }}>
                      {SWAP_IN_QUESTION}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {swapTargets.map((target) => (
                        <Pressable
                          key={target.id}
                          onPress={() => {
                            setSwapChoosing(null);
                            onSwapParked?.(item.id, target.id);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Replace ${target.text}`}
                          className="rounded-full px-3 justify-center"
                          style={{ minHeight: 44, borderWidth: 1, borderColor: colors.primary }}
                        >
                          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                            {target.text}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        onPress={() => setSwapChoosing(null)}
                        accessibilityRole="button"
                        accessibilityLabel="Cancel"
                        className="rounded-full px-3 justify-center"
                        style={{ minHeight: 44 }}
                      >
                        <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
                          Cancel
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
                </View>
              ))}
            </View>
          )}

          {full && !savedOnly && (
            <View className="gap-2">
              {onLock && (
                <Pressable
                  onPress={onLock}
                  accessibilityRole="button"
                  accessibilityLabel="Lock these three"
                  className="rounded-2xl py-4 items-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-lg" style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: colors.onPrimary }}>
                    Lock these three
                  </Text>
                </Pressable>
              )}
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                className="rounded-2xl py-4 items-center"
                style={
                  onLock
                    ? { borderWidth: 1, borderColor: colors.border }
                    : { backgroundColor: colors.primary }
                }
              >
                <Text
                  className="text-lg"
                  style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: onLock ? colors.primary : colors.onPrimary }}
                >
                  Done
                </Text>
              </Pressable>
            </View>
          )}

          {!savedOnly && !hasRoutines && onManageRoutines && (
            <Pressable
              onPress={onManageRoutines}
              accessibilityRole="button"
              accessibilityHint="Opens routines"
              className="flex-row items-center justify-center gap-1.5 mt-2"
              style={{ minHeight: 44 }}
              testID="ideas-make-routine"
            >
              <Ionicons name="repeat" size={14} color={colors.muted} />
              <Text className="text-sm" style={{ color: colors.muted }}>
                Do something on repeat?{" "}
                <Text style={{ color: colors.primary, fontWeight: "600" }}>Make it a routine.</Text>
              </Text>
            </Pressable>
          )}
          {/* With routines: always a way back to them, and (with none due
              today) when the next one shows. */}
          {!savedOnly && hasRoutines && onManageRoutines && (
            <Pressable
              onPress={onManageRoutines}
              accessibilityRole="button"
              accessibilityLabel={
                shownRoutines.length === 0 && nextRoutine
                  ? `Routines. Next: ${nextRoutine.text} ${nextRoutine.when}`
                  : "Routines"
              }
              accessibilityHint="Opens routines"
              className="flex-row items-center justify-center gap-1.5 mt-2"
              style={{ minHeight: 44 }}
              testID="ideas-routines-link"
            >
              <Ionicons name="repeat" size={14} color={colors.muted} />
              <Text className="text-sm" style={{ color: colors.muted }} numberOfLines={2}>
                {shownRoutines.length === 0 && nextRoutine ? `Next: ${nextRoutine.text} ${nextRoutine.when} · ` : ""}
                <Text style={{ color: colors.primary, fontWeight: "600" }}>Routines</Text>
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/**
 * Routines due today, at the top of the sheet. Same one-tap add as an idea;
 * when today is full or locked, the rows are disabled and say why. A routine
 * that isn't added simply isn't: nothing is marked missed.
 */
function TodaysRoutines({
  routines,
  onAdd,
  blockedReason,
  onEdit,
}: {
  routines: { id: string; text: string }[];
  onAdd?: (id: string) => void;
  blockedReason: string | null;
  /** Opens the routines sheet. */
  onEdit?: () => void;
}) {
  const colors = useColors();
  const disabled = blockedReason !== null;
  return (
    <View className="gap-2" testID="todays-routines">
      <View className="flex-row items-center justify-between">
        <Text accessibilityRole="header" className="text-sm font-semibold" style={{ color: colors.muted }}>
          Today&apos;s routines
        </Text>
        {onEdit && (
          <Pressable
            onPress={onEdit}
            accessibilityRole="button"
            accessibilityLabel="Edit routines"
            accessibilityHint="Opens routines"
            hitSlop={12}
            testID="todays-routines-edit"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Edit
            </Text>
          </Pressable>
        )}
      </View>
      {blockedReason && (
        <Text className="text-sm" style={{ color: colors.muted }} testID="todays-routines-blocked">
          {blockedReason}
        </Text>
      )}
      {routines.map((routine) => (
        <Pressable
          key={routine.id}
          onPress={() => onAdd?.(routine.id)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Add ${routine.text} to today`}
          accessibilityHint={blockedReason ?? "Adds this routine to today's three"}
          accessibilityState={{ disabled }}
          className="rounded-2xl border p-4 flex-row items-center gap-3"
          style={{
            minHeight: 44,
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: disabled ? 0.5 : 1,
          }}
          testID={`routine-suggestion-${routine.id}`}
        >
          <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
          <Text className="flex-1 text-base text-foreground" style={{ fontWeight: "700" }}>
            {routine.text}
          </Text>
          <Ionicons name="repeat" size={16} color={colors.muted} accessibilityElementsHidden importantForAccessibility="no" />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Suggestions for the next open milestone on the goal path. Same one-tap add
 * as any other idea, with the same rules: nothing is added once today is full
 * or locked, and one already on today's list shows as added.
 */
function MilestoneIdeas({
  title,
  ideas,
  addedTexts,
  blocked,
  onAdd,
}: {
  title: string;
  ideas: IdeaItem[];
  addedTexts: Set<string>;
  /** Today is full or locked. */
  blocked: boolean;
  onAdd: (text: string) => void;
}) {
  const colors = useColors();
  return (
    <View className="gap-2" testID="milestone-ideas">
      {/* One heading for VoiceOver, saying which step these are for: the rows
          below are plain "Add ..." buttons and don't repeat it. */}
      <View accessible accessibilityRole="header" accessibilityLabel={`Next on your path: ${title}`}>
        <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
          Next on your path
        </Text>
        <Text
          className="text-base text-foreground"
          style={{ fontWeight: "700" }}
          numberOfLines={2}
          testID="milestone-ideas-title"
        >
          {title}
        </Text>
      </View>
      {ideas.map((idea) => {
        const added = addedTexts.has(keyOf(idea.text));
        const disabled = added || blocked;
        return (
          <Pressable
            key={idea.id}
            onPress={() => onAdd(idea.text)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={added ? `${idea.text}, added` : `Add ${idea.text}`}
            accessibilityState={{ disabled }}
            className="rounded-2xl border p-4 flex-row items-center gap-3"
            style={{
              minHeight: 44,
              backgroundColor: colors.surface,
              borderColor: added ? colors.success : colors.border,
              opacity: disabled && !added ? 0.5 : 1,
            }}
            testID={`milestone-idea-${idea.id}`}
          >
            <Ionicons
              name={added ? "checkmark-circle" : "add-circle-outline"}
              size={26}
              color={added ? colors.success : colors.primary}
            />
            <View className="flex-1 gap-0.5">
              <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
                {idea.text}
              </Text>
              {typeof idea.estimatedMinutes === "number" && (
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {idea.estimatedMinutes} min
                </Text>
              )}
            </View>
            <Ionicons
              name="trail-sign-outline"
              size={16}
              color={colors.muted}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** True once a refresh has been running longer than THINKING_HINT_DELAY_MS. */
function useStillThinking(regenerating: boolean): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!regenerating) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), THINKING_HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [regenerating]);
  return slow && regenerating;
}
