import { fireEvent, screen } from "@testing-library/react-native";

import { renderWithProviders as render } from "./render";

import { TaskCard } from "@/components/daily-tasks/task-card";

test("jest-expo + RNTL can render an app component", async () => {
  const onToggle = jest.fn();
  await render(
    <TaskCard
      task={{ id: "t1", text: "Walk 20 minutes", createdAt: "", carriedOver: false }}
      completed={false}
      onToggle={onToggle}
      onEdit={jest.fn()}
      onDelete={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByRole("checkbox"));
  expect(onToggle).toHaveBeenCalledTimes(1);
});
