// The social monitoring engines the app runs the same way: Instagram, TikTok
// and Facebook. Each is an open-source package with the same contract —
// runPass(state) → { state, events, summary, matches }, checkAccount, a
// normalized settings document — so the app keeps one store slot, one panel
// and one schedule kind per engine, and this file says what differs: the
// files, the settings the panel edits, how a match is described, and what the
// reply agent is asked to do with one.
//
// The X and Reddit monitors came first and keep their own code paths.

import * as instagram from "@nextbrowser-oss/instagram-monitoring";
import type { SocialEvent, SocialMatch } from "./feed";

export type SocialEngineId = "instagram-monitor" | "tiktok-monitor" | "facebook-monitor";

export interface SocialAccount {
  handle?: string;
  signedIn: boolean;
  checkedAt: number;
}

/** The state fields the app reads; each engine's document has more. */
export interface SocialState {
  version: number;
  settings: object;
  account?: SocialAccount;
  lastPass?: { at: number; finishedAt?: number; notes: string[] };
}

export interface SocialSummary {
  signedIn: boolean;
  handle?: string;
  sourcesRead: number;
  newItems: number;
  urgent: number;
  loginRequired?: boolean;
  securityCheck?: boolean;
  rateLimited?: boolean;
  blocked?: string;
}

export interface SocialBrowser {
  open(url: string): Promise<void>;
  evaluate<T>(script: string, label?: string): Promise<T>;
  waitForLoad(timeoutSeconds?: number): Promise<void>;
}

export interface SocialLogEntry {
  t: string;
  ev: string;
  [field: string]: unknown;
}

export interface TermListSpec {
  /** The settings field the list edits. */
  key: string;
  label: string;
  placeholder: string;
  prefix?: string;
  /** Reads what a person typed: one entry or several, comma-separated. */
  parse: (text: string) => string[];
}

export interface ToggleSpec {
  key: string;
  label: string;
  title?: string;
}

export interface SocialEngineSpec {
  engine: SocialEngineId;
  /** "Instagram" */
  name: string;
  /** "instagram.com" */
  site: string;
  /** Written before the account's handle. */
  handlePrefix: string;
  files: { state: string; feed: string; log: string };
  normalizeState(raw: unknown): SocialState;
  withSettings(state: SocialState, patch: Record<string, unknown>): SocialState;
  /** Settings the app applies to every pass it runs on a schedule, for
   *  throttles the schedule already stands in for. */
  passSettings?: Record<string, unknown>;
  runPass(deps: {
    browser: SocialBrowser;
    state: SocialState;
    log?: (entry: SocialLogEntry) => void;
    onStep?: (step: string) => void;
    shouldStop?: () => boolean;
  }): Promise<{ state: SocialState; events: SocialEvent[]; summary: SocialSummary; matches: SocialMatch[] }>;
  checkAccount(deps: { browser: SocialBrowser; log?: (entry: SocialLogEntry) => void }): Promise<{
    signedIn: boolean;
    handle?: string;
    securityCheck?: boolean;
    blocked?: string;
  }>;
  /** The line under "What to watch". */
  intro: string;
  lists: TermListSpec[];
  toggles: ToggleSpec[];
  /** Whether the settings give a pass anything to read. */
  canStart(settings: Record<string, unknown>): boolean;
  startHint: string;
  /** What a signed-out account means for this engine. */
  signedOutNote: string;
  /** The account's own follower count and its history, when the engine
   *  tracks one. */
  followers(state: SocialState): { value?: number; history: { at: number; value: number }[] } | undefined;
  /** A short label for where a match was found. */
  where(match: SocialMatch): string;
  /** One line of context: the post or the group a match belongs to. */
  context(match: SocialMatch): string | undefined;
  /** A link to an author. */
  authorUrl(author: string): string;
  /** What the reply agent is asked to do with one match. */
  replyTask(match: SocialMatch, profileName?: string): string;
}

const MONITOR_ENGINES: SocialEngineId[] = ["instagram-monitor", "tiktok-monitor", "facebook-monitor"];

export function isSocialEngine(engine: unknown): engine is SocialEngineId {
  return MONITOR_ENGINES.includes(engine as SocialEngineId);
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function quote(text: string | undefined, max = 80): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The approval rule every reply task ends with, word for word, so no engine
 *  can hand the agent a task that posts without asking. */
const APPROVAL = "Write one reply that answers this specific item in the account's own voice - never a canned line, and no claim the thread does not support. Show me the draft and post nothing until I approve it.";

interface InstagramPost {
  owner?: string;
  caption?: string;
}

const instagramSpec: SocialEngineSpec = {
  engine: "instagram-monitor",
  name: "Instagram",
  site: "instagram.com",
  handlePrefix: "@",
  files: { state: "instagram-monitor-state.json", feed: "instagram-monitor-feed.json", log: "instagram-monitor-log.jsonl" },
  normalizeState: (raw) => instagram.normalizeState(raw) as SocialState,
  withSettings: (state, patch) => instagram.withSettings(state as instagram.MonitorState, patch as Partial<instagram.MonitorSettings>) as SocialState,
  runPass: async (deps) => {
    const result = await instagram.runPass({ ...deps, state: deps.state as instagram.MonitorState });
    return {
      state: result.state as SocialState,
      events: result.events as unknown as SocialEvent[],
      summary: result.summary,
      matches: result.matches as unknown as SocialMatch[],
    };
  },
  checkAccount: (deps) => instagram.checkAccount(deps),
  intro: "Mentions, tags and comments on your posts always count. Keywords are found as whole words, hashtags included, in watched profiles' comments.",
  lists: [
    {
      key: "profiles",
      label: "Profiles to watch",
      placeholder: "competitor or partner, without @",
      prefix: "@",
      parse: (text) => text.split(/[\s,]+/).map(instagram.normalizeHandle).filter(Boolean),
    },
    { key: "keywords", label: "Keywords", placeholder: "brand, product or phrase", parse: instagram.splitKeywords },
    { key: "excludeKeywords", label: "Skip", placeholder: "words that rule a match out", parse: instagram.splitKeywords },
  ],
  toggles: [
    { key: "watchActivity", label: "Mentions and replies" },
    { key: "watchOwnComments", label: "Comments on your posts" },
    { key: "watchTags", label: "Posts you are tagged in" },
    { key: "watchProfileComments", label: "Keyword comments on watched profiles", title: "Read only when keywords are set" },
  ],
  canStart: (settings) => settings.watchActivity === true || settings.watchOwnComments === true || settings.watchTags === true || list(settings.profiles).length > 0,
  startHint: "Turn on a source or add a profile to watch first",
  signedOutNote: "Instagram shows nothing signed out — open it and sign in",
  followers: (state) => {
    const handle = state.account?.handle?.toLowerCase();
    const stats = handle ? (state as instagram.MonitorState).followers[handle] : undefined;
    return stats ? { value: stats.followers, history: stats.history } : undefined;
  },
  where: (match) => {
    switch (match.source.kind) {
      case "activity": return "Activity";
      case "own_comments": return "Your post";
      case "tags": return "Tagged";
      case "profile_comments": return `${match.source.name}'s post`;
      default: return match.source.name;
    }
  },
  context: (match) => {
    const post = match.item.post as InstagramPost | undefined;
    if (!post || match.item.kind === "post") return undefined;
    const owner = post.owner ? `@${post.owner}'s post` : "a post";
    return post.caption ? `on ${owner}: “${quote(post.caption)}”` : `on ${owner}`;
  },
  authorUrl: (author) => `https://www.instagram.com/${author}/`,
  replyTask: (match, profileName) => {
    const { item } = match;
    const profile = profileName ? `the browser profile "${profileName}"` : "the skill's browser profile";
    const what = item.kind === "post" ? "post" : "comment";
    const why = match.triage.reasons.length ? ` It was ranked ${match.triage.urgency} because: ${match.triage.reasons.join("; ")}.` : "";
    const how = item.kind === "post"
      ? "Once I approve it, add it as a comment on the post"
      : "Once I approve it, post it with the comment's own Reply button so it lands in the same thread";
    return [
      `Draft a reply to this Instagram ${what} that monitoring found, by @${item.author}: ${item.url}.${why}`,
      `Work in ClawBrowser on ${profile}, which is signed in to Instagram. Open the link with \`nbc open --profile <profile> ${item.url}\` and read the ${what} and the thread around it.`,
      APPROVAL,
      `${how}, follow the Instagram skill's posting steps, and report whether the reply appeared on the page.`,
    ].join("\n\n");
  },
};

const SPECS: Partial<Record<SocialEngineId, SocialEngineSpec>> = {
  "instagram-monitor": instagramSpec,
};

/** socialEngine returns the spec for an engine the app runs, or undefined for
 *  one it does not know. */
export function socialEngine(engine: unknown): SocialEngineSpec | undefined {
  return isSocialEngine(engine) ? SPECS[engine] : undefined;
}

export function socialEngines(): SocialEngineSpec[] {
  return Object.values(SPECS).filter((spec): spec is SocialEngineSpec => !!spec);
}
