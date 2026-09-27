// Jest stand-in for @react-native-community/datetimepicker (see setup.ts).
import { View } from "react-native";

export default function DateTimePicker(props: Record<string, unknown>) {
  return <View testID="native-time-picker" {...props} />;
}

export const DateTimePickerAndroid = { open: jest.fn(), dismiss: jest.fn() };
