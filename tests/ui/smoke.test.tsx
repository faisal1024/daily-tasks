import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders as render } from "./render";

import { TaskRow } from "@/components/daily-tasks/task-row";

test("jest-expo + RNTL can render an app component", async () => {
  const onToggle = jest.fn();
  await render(
    <TaskRow
      task={{ id: "t1", text: "Walk 20 minutes", createdAt: "", carriedOver: false }}
      index={0}
      completed={false}
      editable
      onToggle={onToggle}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
      onNotToday={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("checkbox", { name: "Task 1: Walk 20 minutes" }));
  expect(onToggle).toHaveBeenCalledTimes(1);
});
