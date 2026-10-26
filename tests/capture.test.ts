// Capture from anywhere (1.6 E): the dump link, the App Group's open request
// and the capture inbox, parsed by the JS side. Native code writes these
// strings, so every parser must survive anything it might find.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CAPTURE_REQUEST_MAX_AGE_MS,
  MAX_CAPTURE_CHARS,
  __resetCaptureForTests,
  captureToast,
  cleanCaptureText,
  parseCaptureInbox,
  parseCaptureLink,
  parseCaptureOpenRequest,
  queueCaptureOpen,
  subscribeCaptureOpens,
  takeCaptureOpens,
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

describe("parseCaptureInbox", () => {
  const inbox = (...entries: unknown[]) => JSON.stringify(entries);

  it("returns the unsaved items oldest first, and the last seq read", () => {
    expect(
      parseCaptureInbox(inbox({ seq: 3, text: "Third" }, { seq: 1, text: "First" }, { seq: 2, text: "Second" }), 0),
    ).toEqual({
      items: [
        { seq: 1, text: "First" },
        { seq: 2, text: "Second" },
        { seq: 3, text: "Third" },
      ],
      lastSeq: 3,
    });
  });

  it("skips what the app already saved (seq at or below processedSeq)", () => {
    const raw = inbox({ seq: 4, text: "Old" }, { seq: 5, text: "Old too" }, { seq: 6, text: "New" });
    expect(parseCaptureInbox(raw, 5)).toEqual({ items: [{ seq: 6, text: "New" }], lastSeq: 6 });
    expect(parseCaptureInbox(raw, 6)).toEqual({ items: [], lastSeq: 6 });
  });

  it("reads one web link as an item", () => {
    expect(parseCaptureInbox(inbox({ seq: 1, text: " https://example.com/read-later " }), 0).items).toEqual([
      { seq: 1, text: "https://example.com/read-later" },
    ]);
  });

  it("drops empty and whitespace entries but still marks them read (they can never be saved)", () => {
    expect(parseCaptureInbox(inbox({ seq: 1, text: "   " }, { seq: 2, text: "" }, { seq: 3 }, { seq: 4, text: 9 }), 0)).toEqual({
      items: [],
      lastSeq: 4,
    });
  });

  it("cuts oversized text", () => {
    const [item] = parseCaptureInbox(inbox({ seq: 1, text: "x".repeat(5000) }), 0).items;
    expect(Array.from(item.text)).toHaveLength(MAX_CAPTURE_CHARS);
  });

  it("reads malformed JSON, a non-array and missing storage as empty, leaving processedSeq alone", () => {
    for (const raw of [null, "", "{", "[{", "null", "{}", '"x"', "12"]) {
      expect(parseCaptureInbox(raw, 7), String(raw)).toEqual({ items: [], lastSeq: 7 });
    }
  });

  it("skips junk entries and bad seqs without losing the good ones", () => {
    const raw = inbox(null, 5, "x", [], { seq: "2", text: "string seq" }, { seq: 1.5, text: "fraction" }, { seq: NaN, text: "nan" }, {
      seq: -1,
      text: "negative",
    }, { seq: 2, text: "Good" });
    expect(parseCaptureInbox(raw, 0)).toEqual({ items: [{ seq: 2, text: "Good" }], lastSeq: 2 });
  });

  it("keeps duplicate texts (the store de-duplicates when it saves) and duplicate seqs stay stable", () => {
    const { items, lastSeq } = parseCaptureInbox(inbox({ seq: 1, text: "Same" }, { seq: 2, text: "same " }, { seq: 2, text: "Same" }), 0);
    expect(items.map((i) => i.text)).toEqual(["Same", "same", "Same"]);
    expect(lastSeq).toBe(2);
  });
});

describe("captureToast", () => {
  it("says one thought, or the count, and where", () => {
    expect(captureToast(1)).toBe("Your captured thought is saved for later in Ideas.");
    expect(captureToast(3)).toBe("3 captured thoughts saved for later in Ideas.");
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
