// Capture from anywhere (1.6 E): the dump link, the App Group's open request
// and the capture inbox (one file per capture), parsed by the JS side. Native code writes these
// strings, so every parser must survive anything it might find.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAPTURE_REQUEST_MAX_AGE_MS,
  MAX_CAPTURE_CHARS,
  __resetCaptureForTests,
  CAPTURE_FULL_TOAST,
  captureToast,
  cleanCaptureText,
  parseCaptureFiles,
  parseCaptureLink,
  parseCaptureOpenRequest,
  queueCaptureOpen,
  subscribeCaptureOpens,
  planCaptureImport,
  takeCaptureOpens,
  type CaptureItem,
} from "../lib/daily-tasks/capture";

describe("parseCaptureLink", () => {
  it("reads the dump link as a URL or a router path, with its source and id", () => {
    expect(parseCaptureLink("dailytasks://dump")).toEqual({ source: "link" });
    expect(parseCaptureLink("dailytasks://dump?source=widget&id=A-1")).toEqual({ source: "widget", id: "A-1" });
    expect(parseCaptureLink("/dump?source=intent")).toEqual({ source: "intent" });
    expect(parseCaptureLink("dump")).toEqual({ source: "link" });
    expect(parseCaptureLink("  dailytasks://dump/  ")).toEqual({ source: "link" });
  });

  it("falls back to the link source for an unknown or share source (a link can't claim to be a share)", () => {
    expect(parseCaptureLink("dailytasks://dump?source=share")).toEqual({ source: "link" });
    expect(parseCaptureLink("dailytasks://dump?source=%E0%A4%A")).toEqual({ source: "link" });
    expect(parseCaptureLink("dailytasks://dump?source=")).toEqual({ source: "link" });
  });

  it("ignores malformed query pairs instead of throwing", () => {
    expect(parseCaptureLink("dailytasks://dump?%E0%A4%A&source=widget")).toEqual({ source: "widget" });
    expect(parseCaptureLink("dailytasks://dump?&&=&id=")).toEqual({ source: "link" });
  });

  it("leaves every other link alone (so the router handles it)", () => {
    for (const url of [
      "dailytasks://",
      "/",
      "",
      "dailytasks://dumpster",
      "dailytasks://dump/extra",
      "dailytasks://focus/start?task=next",
      "dailytasks://settings?next=dump",
      "https://example.com/dump",
    ]) {
      expect(parseCaptureLink(url), url).toBeNull();
    }
    expect(parseCaptureLink(null)).toBeNull();
    expect(parseCaptureLink(undefined)).toBeNull();
  });
});

describe("parseCaptureOpenRequest", () => {
  const NOW = 1_800_000_000_000;
  const req = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ id: "r1", source: "widget", at: NOW - 1000, ...over });

  it("takes a new, recent request", () => {
    expect(parseCaptureOpenRequest(req(), null, NOW)).toEqual({ id: "r1", source: "widget" });
    expect(parseCaptureOpenRequest(req({ source: "nope" }), null, NOW)).toEqual({ id: "r1", source: "intent" });
    // "share" is not an open source.
    expect(parseCaptureOpenRequest(req({ source: "share" }), null, NOW)).toEqual({ id: "r1", source: "intent" });
  });

  it("ignores the one already handled, a stale one, and a clock-skewed one", () => {
    expect(parseCaptureOpenRequest(req(), "r1", NOW)).toBeNull();
    expect(parseCaptureOpenRequest(req({ at: NOW - CAPTURE_REQUEST_MAX_AGE_MS - 1 }), null, NOW)).toBeNull();
    expect(parseCaptureOpenRequest(req({ at: NOW - CAPTURE_REQUEST_MAX_AGE_MS }), null, NOW)).not.toBeNull();
    expect(parseCaptureOpenRequest(req({ at: NOW + CAPTURE_REQUEST_MAX_AGE_MS + 1 }), null, NOW)).toBeNull();
  });

  it("ignores missing, malformed and wrongly typed requests", () => {
    for (const raw of [null, "", "{", "null", "7", '"x"', "[]", req({ id: "" }), req({ id: 5 }), req({ at: "now" }), req({ at: null })]) {
      expect(parseCaptureOpenRequest(raw, null, NOW), String(raw)).toBeNull();
    }
    expect(parseCaptureOpenRequest(JSON.stringify({ id: "r1", source: "widget" }), null, NOW)).toBeNull();
  });
});

describe("cleanCaptureText", () => {
  it("makes one trimmed line; nothing left is null", () => {
    expect(cleanCaptureText("  Call\nmum \t today  ")).toBe("Call mum today");
    for (const value of ["", "   ", "\n\t  ", null, undefined, 5, {}, ["a"]]) {
      expect(cleanCaptureText(value), String(value)).toBeNull();
    }
  });

  it("keeps a single web link whole", () => {
    expect(cleanCaptureText("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
  });

  it("cuts oversized text to the limit with an ellipsis, by characters (no split emoji)", () => {
    const cut = cleanCaptureText("a".repeat(MAX_CAPTURE_CHARS + 50))!;
    expect(Array.from(cut)).toHaveLength(MAX_CAPTURE_CHARS);
    expect(cut.endsWith("…")).toBe(true);
    const emoji = cleanCaptureText("😀".repeat(MAX_CAPTURE_CHARS + 5))!;
    expect(Array.from(emoji)).toHaveLength(MAX_CAPTURE_CHARS);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    // Exactly at the limit is untouched.
    expect(cleanCaptureText("b".repeat(MAX_CAPTURE_CHARS))).toBe("b".repeat(MAX_CAPTURE_CHARS));
  });
});

// The inbox is one JSON file per capture ({text, at, source}) in the App Group.
describe("parseCaptureFiles", () => {
  const file = (name: string, entry: unknown) => ({ name, contents: JSON.stringify(entry) });

  it("returns the captures oldest first by when they were captured, whatever the file order", () => {
    const { items, junk } = parseCaptureFiles([
      file("c.json", { text: "Third", at: 300, source: "share" }),
      file("a.json", { text: "First", at: 100, source: "intent" }),
      file("b.json", { text: "Second", at: 200, source: "share" }),
    ]);
    expect(items).toEqual([
      { name: "a.json", text: "First", at: 100 },
      { name: "b.json", text: "Second", at: 200 },
      { name: "c.json", text: "Third", at: 300 },
    ]);
    expect(junk).toEqual([]);
  });

  it("breaks a tie on `at` by name, and reads a missing or bad `at` as oldest", () => {
    const { items } = parseCaptureFiles([
      file("200-b.json", { text: "B", at: 200 }),
      file("200-a.json", { text: "A", at: 200 }),
      file("x.json", { text: "No time" }),
      file("y.json", { text: "Bad time", at: "soon" }),
    ]);
    expect(items.map((item) => item.text)).toEqual(["No time", "Bad time", "A", "B"]);
  });

  it("reads one web link as an item, trimmed", () => {
    expect(parseCaptureFiles([file("l.json", { text: " https://example.com/read-later ", at: 1 })]).items).toEqual([
      { name: "l.json", text: "https://example.com/read-later", at: 1 },
    ]);
  });

  it("files that can never be saved are junk (deleted at once): empty text, no text, malformed JSON", () => {
    const { items, junk } = parseCaptureFiles([
      file("1.json", { text: "   ", at: 1 }),
      file("2.json", { text: "", at: 2 }),
      file("3.json", { at: 3 }),
      file("4.json", { text: 9, at: 4 }),
      { name: "5.json", contents: "{not json" },
      { name: "6.json", contents: "null" },
      file("7.json", { text: "Good", at: 7 }),
    ]);
    expect(items.map((item) => item.name)).toEqual(["7.json"]);
    expect(junk).toEqual(["1.json", "2.json", "3.json", "4.json", "5.json", "6.json"]);
  });

  it("cuts oversized text", () => {
    const [item] = parseCaptureFiles([file("big.json", { text: "x".repeat(5000), at: 1 })]).items;
    expect(Array.from(item.text)).toHaveLength(MAX_CAPTURE_CHARS);
  });

  it("keeps duplicate texts (planCaptureImport decides)", () => {
    const { items } = parseCaptureFiles([file("a.json", { text: "Same", at: 1 }), file("b.json", { text: "same ", at: 2 })]);
    expect(items.map((item) => item.text)).toEqual(["Same", "same"]);
  });
});

describe("planCaptureImport", () => {
  const item = (name: string, text: string, at = 0): CaptureItem => ({ name, text, at });
  const saved = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `saved ${i}` }));

  it("saves new captures in order, while there's room", () => {
    const plan = planCaptureImport({ parkedTasks: [], tasks: [] }, [item("a", "One"), item("b", "Two")], 50);
    expect(plan.save.map((i) => i.name)).toEqual(["a", "b"]);
    expect(plan.present).toEqual([]);
    expect(plan.waiting).toEqual([]);
  });

  it("never pushes a saved item out: only as many as there's room for, oldest first; the rest wait", () => {
    const plan = planCaptureImport(
      { parkedTasks: saved(48), tasks: [] },
      [item("a", "One"), item("b", "Two"), item("c", "Three"), item("d", "Four")],
      50,
    );
    expect(plan.save.map((i) => i.name)).toEqual(["a", "b"]);
    expect(plan.waiting.map((i) => i.name)).toEqual(["c", "d"]);
  });

  it("a full Saved for later saves nothing; everything waits", () => {
    const plan = planCaptureImport({ parkedTasks: saved(50), tasks: [] }, [item("a", "One")], 50);
    expect(plan.save).toEqual([]);
    expect(plan.waiting.map((i) => i.name)).toEqual(["a"]);
  });

  it("text already saved, already on today, or earlier in the batch is present (its file can go), and takes no room", () => {
    const plan = planCaptureImport(
      { parkedTasks: [{ text: "Stamps" }, ...saved(48)], tasks: [{ text: "Walk" }] },
      [item("a", "stamps"), item("b", " WALK "), item("c", "New"), item("d", "new"), item("e", "Other")],
      50,
    );
    expect(plan.present.map((i) => i.name)).toEqual(["a", "b", "d"]);
    expect(plan.save.map((i) => i.name)).toEqual(["c"]);
    expect(plan.waiting.map((i) => i.name)).toEqual(["e"]);
  });
});

describe("captureToast", () => {
  it("quotes one thought, counts several, and calls it Saved for later", () => {
    expect(captureToast({ count: 1, text: "Buy stamps", full: false })).toBe("Saved for later: “Buy stamps”");
    expect(captureToast({ count: 3, text: null, full: false })).toBe("3 thoughts saved for later");
  });

  it("cuts a long quote", () => {
    const message = captureToast({ count: 1, text: "word ".repeat(30).trim(), full: false })!;
    expect(message.startsWith("Saved for later: “word")).toBe(true);
    expect(message.endsWith("…”")).toBe(true);
    expect(Array.from(message).length).toBeLessThan(70);
  });

  it("says when Saved for later is full, with or without some saved now; nothing to say is null", () => {
    expect(captureToast({ count: 0, text: null, full: true })).toBe(CAPTURE_FULL_TOAST);
    expect(CAPTURE_FULL_TOAST).toBe("Saved for later is full. Clear a few in Ideas to bring in the rest.");
    expect(captureToast({ count: 2, text: null, full: true })).toBe(`2 thoughts saved for later. ${CAPTURE_FULL_TOAST}`);
    expect(captureToast({ count: 0, text: null, full: false })).toBeNull();
  });
});

describe("the open queue (links wait for the store)", () => {
  beforeEach(() => __resetCaptureForTests());

  it("holds requests until taken, once, in order, and tells listeners", () => {
    const listener = vi.fn();
    const off = subscribeCaptureOpens(listener);
    queueCaptureOpen({ source: "widget", id: "a" });
    queueCaptureOpen({ source: "link" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(takeCaptureOpens()).toEqual([{ source: "widget", id: "a" }, { source: "link" }]);
    expect(takeCaptureOpens()).toEqual([]);
    off();
    queueCaptureOpen({ source: "link" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
