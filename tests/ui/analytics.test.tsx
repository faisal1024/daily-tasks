// Anonymous analytics (PostHog batch API over plain fetch): off without a key,
// never sends free text, honours opt-out, and the batch is anonymous.
import {
  __resetAnalyticsForTests,
  __setAnalyticsFetchForTests,
  flush,
  sanitizeProps,
  setAnalyticsEnabled,
  track,
} from "@/lib/daily-tasks/analytics";

const fetchMock = jest.fn(async () => new Response("{}"));

beforeEach(() => {
  __resetAnalyticsForTests();
  __setAnalyticsFetchForTests(fetchMock as unknown as typeof fetch);
  fetchMock.mockClear();
  process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test";
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  __resetAnalyticsForTests();
});

function sentBody() {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, body: JSON.parse(String(init.body)) };
}

describe("analytics", () => {
  it("is a no-op when the build has no PostHog key", async () => {
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    track("app_opened", { plus: true });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps only allowlisted keys with short primitive values (never free text)", () => {
    expect(
      sanitizeProps({
        source: "brain_dump",
        count: 3,
        plus: false,
        task: "Call my therapist",
        goal: "Lose weight",
        // Short, text-like values are only allowed under allowlisted keys.
        name: "alex",
        email_domain: "gmail.com",
        feature: "Finish the report for Dana",
        plan: { kind: "annual" },
        outcome: "x".repeat(41),
      }),
    ).toEqual({ source: "brain_dump", count: 3, plus: false });
  });

  it("sends an anonymous batch: install id, no person profile, no IP", async () => {
    track("paywall_viewed", { source: "break_down", text: "secret task" });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, body } = sentBody();
    expect(url).toBe("https://us.i.posthog.com/batch/");
    expect(body.api_key).toBe("phc_test");
    expect(body.batch).toHaveLength(1);
    const [event] = body.batch;
    expect(event.event).toBe("paywall_viewed");
    expect(event.properties).toMatchObject({
      source: "break_down",
      $process_person_profile: false,
      $ip: null,
    });
    expect(event.properties.distinct_id).toMatch(/^anon_[0-9a-f]{32}$/);
    expect(event.properties).not.toHaveProperty("text");
  });

  it("drops the queue on opt-out and sends nothing while off", async () => {
    track("app_opened");
    setAnalyticsEnabled(false);
    track("task_completed", { count: 1 });
    await flush();
    setAnalyticsEnabled(true);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
