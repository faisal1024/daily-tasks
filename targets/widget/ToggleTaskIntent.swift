import AppIntents
import WidgetKit

/// Tick or untick one of today's tasks from the widget (iOS 17 interactive widgets).
struct ToggleTaskIntent: AppIntent {
  static var title: LocalizedStringResource = "Tick off a task"
  static var description = IntentDescription("Marks one of today's tasks done or not done.")
  // Runs in the widget process; the app applies the change when it next opens.
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Task ID") var taskId: String
  @Parameter(title: "Day") var date: String
  @Parameter(title: "Done") var done: Bool

  init() {}

  init(taskId: String, date: String, done: Bool) {
    self.taskId = taskId
    self.date = date
    self.done = done
  }

  func perform() async throws -> some IntentResult {
    // A tap on yesterday's widget (before it refreshed) must not change anything.
    guard date == Shared.todayKey(), var snapshot = Shared.loadSnapshot(), snapshot.date == date,
      let index = snapshot.tasks.firstIndex(where: { $0.id == taskId })
    else {
      return .result()
    }
    snapshot.tasks[index].done = done
    Shared.save(snapshot)
    Shared.appendToggle(id: taskId, date: date, done: done)
    return .result()
  }
}
