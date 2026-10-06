import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubStarStatus } from "../lib/githubStarReward";
import { GitHubStarCard, GitHubStarModal } from "./GitHubStarReward";

const state = vi.hoisted(() => ({
  githubStar: undefined as GitHubStarStatus | null | undefined,
  githubStarPromptOpen: false,
  setGitHubStarPromptOpen: vi.fn(),
  verifyGitHubStar: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (select: (value: typeof state) => unknown) => select(state),
}));

vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn() }));

const firstAsk: GitHubStarStatus = {
  required: true,
  claimed: false,
  revoked: false,
  repoUrl: "https://github.com/nextbrowser-oss/nextbrowser-app",
  rewardBytes: 1024 ** 3,
};
const revoked: GitHubStarStatus = { ...firstAsk, revoked: true };

beforeEach(() => {
  state.githubStar = undefined;
  state.githubStarPromptOpen = false;
});

describe("GitHub star prompt", () => {
  it("asks a new GitHub sign-up for the star", () => {
    state.githubStar = firstAsk;
    state.githubStarPromptOpen = true;

    const html = renderToStaticMarkup(<GitHubStarModal />);

    expect(html).toContain('role="dialog"');
    expect(html).toContain("Star Nextbrowser on GitHub to get 1 GiB free");
    expect(html).toContain("start with 1 MB of proxy traffic");
    expect(html).not.toContain("You removed your GitHub star");
  });

  it("tells an account that removed its star why the traffic stopped", () => {
    state.githubStar = revoked;
    state.githubStarPromptOpen = true;

    const html = renderToStaticMarkup(<GitHubStarModal />);

    expect(html).toContain("You removed your GitHub star");
    expect(html.replace(/<[^>]+>/g, "")).toContain(
      "Your proxy traffic is paused at what you&#x27;ve already used. Star nextbrowser-oss/nextbrowser-app"
        + " again and check it here to get the rest of your 1 GiB back.",
    );
    expect(html).toContain("<strong>nextbrowser-oss/nextbrowser-app</strong> again");
    expect(html).toContain("Open GitHub");
    expect(html).toContain("I starred it, check");
    expect(html).not.toContain("Star Nextbrowser on GitHub to get");
    expect(html).not.toContain("start with 1 MB");
  });

  it("waits for the agent connection gate and for its turn this launch", () => {
    state.githubStar = revoked;
    state.githubStarPromptOpen = true;
    expect(renderToStaticMarkup(<GitHubStarModal suppressed />)).toBe("");

    state.githubStarPromptOpen = false;
    expect(renderToStaticMarkup(<GitHubStarModal />)).toBe("");
  });

  it("goes away once the star is back", () => {
    state.githubStar = { ...firstAsk, required: false, claimed: true };
    state.githubStarPromptOpen = true;
    expect(renderToStaticMarkup(<GitHubStarModal />)).toBe("");
    expect(renderToStaticMarkup(<GitHubStarCard />)).toBe("");
  });
});

describe("GitHub star card", () => {
  it("keeps the first ask next to the proxy traffic", () => {
    state.githubStar = firstAsk;
    const html = renderToStaticMarkup(<GitHubStarCard />);
    expect(html).toContain("Star Nextbrowser on GitHub to get 1 GiB free");
    expect(html).not.toContain("You removed your GitHub star");
  });

  it("names the removed star next to the proxy traffic", () => {
    state.githubStar = revoked;
    const html = renderToStaticMarkup(<GitHubStarCard />);
    expect(html).toContain("You removed your GitHub star");
    expect(html).toContain("the rest of your 1 GiB back.");
    expect(html).toContain("I starred it, check");
    expect(html).not.toContain("Star Nextbrowser on GitHub to get");
  });

  it("stays out of the way of accounts the star does not concern", () => {
    state.githubStar = null;
    expect(renderToStaticMarkup(<GitHubStarCard />)).toBe("");
  });
});
