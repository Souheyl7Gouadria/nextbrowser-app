---
name: 1password-autofill-login
description: Autofill a saved 1Password login into the currently focused sign-in form using the 1Password browser extension's own in-page sign-in prompt and inline menu, then verify the result. Use when a user asks to log in, sign in to, or fill saved credentials into a website with 1Password, including when the extension turns out to be locked, several logins match, or the site asks for a second factor.
---

# 1Password Autofill Login

## Goal

Fill a website's sign-in form with the correct saved 1Password item using the extension's
native filling UI, and report a clear, honest final state. The agent must never read, type,
guess, or reconstruct a password, account password, or one-time code itself. 1Password is
the only thing that ever touches the secret; the agent only drives the extension's visible
controls and reads the page's state.

## Setup and supported versions

- Chromium-based browser (Chrome, Edge, Brave, or the Clawbrowser runtime) with the
  **1Password – Password Manager** extension (1Password in the browser, version 8.x)
  installed from the Chrome Web Store.
- The extension is signed in directly with the 1Password account and unlocked. This skill
  targets the extension running on its own; it does not require or use the 1Password
  desktop app.
- Leave the extension's defaults in place unless the user asks for fill-only behaviour: by
  default 1Password signs in automatically after filling. Fill-only runs need
  **Settings › Autofill & save** in the extension with automatic sign-in after filling
  turned off. The agent must not change extension settings itself.
- At least one Login item saved for the target site.

## Official interfaces versus UI-only automation

- **No automation API in the extension.** 1Password in the browser exposes no scripting
  interface, no DOM-accessible fill function, and no page-level events. Its prompts render
  in closed extension frames, so page JavaScript cannot read or click them. Everything in
  this skill is UI automation of the extension's own controls: focusing fields, pressing
  keys, and clicking what the extension draws.
- **Keyboard shortcuts that exist for the extension:** Ctrl+Shift+X (Cmd+Shift+X on macOS)
  opens or closes the pop-up; inside the pop-up, Ctrl+Shift+F opens the selected item's
  site and fills it; Enter or Space fills the selected item in the sign-in prompt; Down
  Arrow opens **Other options**; Esc closes the prompt. The browser tools available to
  the agent send single keys only (Enter, Tab, Escape, Space, Backspace, Delete, arrows),
  so the modifier shortcuts are for the user's hands, not the agent's. The agent works
  the sign-in prompt with Down Arrow, Enter and Escape, which need no modifiers.
- **What the agent can and cannot click:** the page-state click tool only sees page
  elements, and the prompt is not one. The CLI's `click-xy X Y` command clicks a viewport
  coordinate and does reach the prompt, with the coordinates read from a screenshot.
- **Shortcuts that must not be used:** Ctrl+Shift+L (Cmd+Shift+L) **locks** 1Password. It is
  the Bitwarden autofill shortcut, so never reuse that habit here. Ctrl+\ (Cmd+\) is
  Universal Autofill / Auto-Type of the 1Password desktop app and does nothing with the
  extension alone.
- **Official programmatic routes exist only outside the extension:** the 1Password CLI
  (`op`), SDKs, Connect server, and service accounts read vault items for scripts, and
  **1Password for Claude** (agentic autofill, macOS with the desktop app, Claude desktop or
  Claude in Chrome) fills logins for an AI agent with a per-login approval prompt. None of
  them drive the standalone browser extension, and reading a secret through `op` is outside
  this skill's scope and permissions.

## Inputs

- The target tab or site (default: the currently focused tab, unless the user names a
  different site).
- Whether the user wants the form filled only, or filled and signed in.
- Browser profile, if the user's setup uses more than one and specified which to use.

## Workflow

1. Confirm the currently focused tab shows a recognizable sign-in form (username/email and
   password fields, or a single email or password step). If no login form is visible,
   navigate only if the user named a specific site; otherwise report
   `no_login_form_found`.
2. Confirm the extension is present and unlocked before touching the form. A 1Password
   icon inside the focused field, or a sign-in prompt appearing at the top of the page,
   means it is installed and unlocked. If the icon or prompt shows a lock or asks for the
   account password, go to step 7. If nothing from 1Password appears at all after
   clicking the field and waiting two seconds, take a screenshot and look again: the
   prompt is drawn by the extension and is invisible to page state, so only a screenshot
   shows it. Still nothing means the extension is missing, disabled or not signed in,
   which is `autofill_failed` with that reason.
3. Click into the username or email field (or the password field on a password-only
   step). Wait two seconds. 1Password shows its sign-in prompt at the top of the page
   with the suggested Login item, and the inline 1Password icon in the field.
4. Hand the keyboard to the prompt before pressing Enter. A bare Enter in the field can be
   taken by the page first and submit an empty form. So: press **ArrowDown** once, which
   opens the prompt's item list and moves keyboard focus into it, then press **Enter**
   on the highlighted item. Read the item title in the screenshot or the list first. If
   it is the login the user asked for, or the only sensible one, Enter it. With default
   settings 1Password fills both fields and submits the form; with automatic sign-in
   turned off it only fills.
5. If the prompt offers several items, or the suggested item is not the one the user
   named, press Down Arrow or select **Other options** to open the list. If the user named
   the account to use, pick exactly that item by its title or username. Otherwise do not
   choose: press Esc, stop, and report `multiple_matches` with the visible item titles so
   the user can pick. Never fill an arbitrarily chosen item.
6. Wait briefly for the page to react, then check which of these states resulted before
   doing anything else:
   - **Filled** — the username and password fields now hold values (the password shows
     as masked dots) and, with automatic sign-in on, the page is submitting.
   - **Locked** — 1Password asks for the account password or shows a lock screen.
   - **MFA / second factor** — the site asks for a code, push approval, security key, or
     passkey after the credentials were submitted.
   - **Confirmation prompt** — 1Password asks the user to approve the fill (the
     **Ask before filling** setting). Leave it to the user; do not click Approve.
   - **Nothing changed** — no prompt, no inline icon, and empty fields.
7. If 1Password is locked, do not attempt to unlock it under any circumstances: never type
   a candidate account password, never use a "forgot password" or recovery flow on the
   user's behalf. Stop and report `vault_locked`, and ask the user to unlock 1Password
   themselves. The standalone extension locks on its own after the idle time set in
   **Settings › Security**, when the device sleeps, and always when the browser quits, so
   this state is normal and not an error.
8. If the site then asks for an MFA code, authenticator push, security key tap, or
   passkey, do not generate, guess, retrieve, or wait indefinitely for one. 1Password may
   offer to fill a one-time code from the item; only accept that if the user asked for a
   full login and the extension offers it on its own. Otherwise stop and report
   `mfa_required`, and ask the user to supply or approve it themselves.
9. If 1Password shows its in-page **Save** or **Update** prompt after sign-in, leave it
   as-is and tell the user it appeared rather than clicking Save, Update, or Never. That
   decision belongs to the person, not the agent.
10. Only submit the form yourself (click the visible sign-in button) if the user asked for
    a full login and 1Password filled without submitting. After any submission, verify an
    actual signed-in signal, such as an account name, avatar, dashboard redirect, or
    logout link, before calling the login successful. A submitted form without one of
    these signals is not a confirmed login.

## Recovery

- If the page submitted an empty form (a validation message such as "Please enter your
  email" and no filled values), the Enter went to the page. Reload the login page, click
  the field, wait two seconds, press ArrowDown, then Enter. One retry only.
- If the keyboard route fails twice, use the mouse route once: take a screenshot, find
  the **Sign in** button in the 1Password prompt at the top of the page (or the 1Password
  icon inside the field), and click its coordinates with the CLI, for example
  `nbc click-xy 640 72 --profile <profile> --json`. Then take another screenshot to read
  the result.
- If clicking the field produced no prompt and no inline icon, click directly into the
  password field once and retry. If still nothing, report `autofill_failed`; do not fall
  back to typing credentials manually.
- If the prompt disappears before Enter is pressed, click the field again to bring it
  back; do not press Enter blindly, because the page's own submit handler would run on an
  empty form.
- If the login page says the account is already signed in (for example "You are already
  logged in as …" with a Continue button), do not submit the form and do not report
  `filled_and_submitted`. Tell the user the browser already holds a session for that site
  and stop, unless the user asked to sign in as a different account.
- If the page navigates or the form is replaced mid-flow (for example a two-step login
  that shows the password field only after the email), re-identify the current form and
  repeat from step 3 on the new field. Do not restart the browser profile.
- If a captcha or bot check appears, stop and report `captcha_required`; do not attempt to
  solve it.
- Never log, echo, caption, or otherwise repeat the password, account password, or a
  one-time code in any response, tool call, or intermediate reasoning shown to the user.
  Copying the password from the pop-up (Ctrl+Shift+C) is forbidden.
- Do not retry a locked extension or a failed MFA challenge more than once in a single
  run; repeated attempts can trigger account lockout or fraud flags, and that is the
  user's call to make, not the agent's.

## Known limitations

- Fill-only requests depend on the extension setting for automatic sign-in after filling.
  If the site submitted anyway, report `filled_and_submitted`, not `filled_only`.
- Sign-in prompts for passkeys and "Sign in with Google/Apple/…" providers are shown by
  the same prompt; this skill only covers username and password Login items.
- Business accounts can enforce **Ask before filling** and auto-lock rules that make the
  user's approval mandatory on every fill.
- The extension's frames are invisible to page scripts and to page-state tools, so
  detection relies on screenshots and on the field values, not on DOM access.
- Pages whose form submits on Enter before the prompt can take the key need the
  ArrowDown-then-Enter sequence; a bare Enter is not reliable across sites.

## Completion

State the final outcome plainly, using one of: `filled_and_submitted`, `filled_only`,
`multiple_matches`, `vault_locked`, `mfa_required`, `no_login_form_found`,
`autofill_failed`, or `captcha_required`. Name the site, the item title that was used (never
its password), and what was attempted. Never include credential values, the account
password, or a one-time code in the final answer, even in redacted or partial form.
