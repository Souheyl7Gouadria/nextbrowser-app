import { describe, expect, it } from "vitest";
import { socialEngine, socialEngines } from "./engines";
import { announcedToday, emptySocialFeed, isNew, normalizeSocialFeed, openMatches, withDone, withPass, type SocialMatch, type Urgency } from "./feed";

const HOUR = 60 * 60 * 1000;

const match = (key: string, createdAt: number, urgency: Urgency = "low"): SocialMatch => ({
  item: { key, kind: "comment", author: "buyer", text: key, url: `https://www.instagram.com/p/C0dEx1/c/${key}/`, createdAt },
  source: { kind: "own_comments", name: "your posts" },
  keywords: [],
  triage: { urgency, score: urgency === "high" ? 4 : 0, reasons: [] },
});

describe("the social feed", () => {
  it("lists matches most urgent first, marks what was announced, and keeps them for a day", () => {
    const urgent = match("b", 2 * HOUR, "high");
    const first = withPass(emptySocialFeed(), { matches: [match("a", HOUR), urgent], events: [{ type: "new_item", at: 0, ...urgent }], read: true }, 3 * HOUR);
    expect(first.matches.map((item) => item.item.key)).toEqual(["b", "a"]);
    expect(isNew(first, "b")).toBe(true);
    expect(announcedToday(first, 3 * HOUR, "high")).toBe(1);
    const later = withPass(first, { matches: [], events: [], read: true }, 25.5 * HOUR);
    expect(later.matches.map((item) => item.item.key)).toEqual(["b"]);
  });

  it("leaves the feed alone after a pass that read nothing, and hides what is done", () => {
    const feed = withPass(emptySocialFeed(), { matches: [match("a", HOUR)], events: [], read: true }, HOUR);
    expect(withPass(feed, { matches: [], events: [], read: false }, 2 * HOUR)).toBe(feed);
    expect(openMatches(withDone(feed, "a"))).toEqual([]);
  });

  it("accepts whatever was on disk", () => {
    expect(normalizeSocialFeed(null)).toEqual(emptySocialFeed());
    expect(normalizeSocialFeed({ matches: [match("a", 1), { item: {} }], done: ["a", 1] })).toMatchObject({ matches: [{ item: { key: "a" } }], done: ["a"] });
  });
});

describe("the engines", () => {
  it("knows each engine the app runs, and nothing else", () => {
    expect(socialEngines().map((spec) => spec.engine)).toContain("instagram-monitor");
    expect(socialEngine("reddit-monitor")).toBeUndefined();
    expect(socialEngine(undefined)).toBeUndefined();
  });

  it.each(socialEngines().map((spec) => [spec.engine, spec] as const))("%s asks the reply agent for a draft and an approval before anything is posted", (_engine, spec) => {
    const task = spec.replyTask(match("c1", HOUR, "high"), "brand-profile");
    expect(task).toContain('browser profile "brand-profile"');
    expect(task).toContain("Show me the draft and post nothing until I approve it.");
    expect(task).toContain("https://www.instagram.com/p/C0dEx1/c/c1/");
  });

  it.each(socialEngines().map((spec) => [spec.engine, spec] as const))("%s keeps its own files and a normalized state", (_engine, spec) => {
    const files = Object.values(spec.files);
    expect(new Set(files).size).toBe(3);
    expect(spec.normalizeState(null)).toMatchObject({ version: 1, settings: expect.any(Object) });
  });
});
