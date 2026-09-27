# Privacy Policy — Daily Tasks

**Effective date: 26 September 2026 (last updated for brain dump and break it down)**

<!-- Keep in sync with the published copy (gist a43d6373453761af70d495d640e38ffa,
     privacy-policy.html), which App Store Connect links to. The app links here. -->

## Summary

Daily Tasks is local-first. Your tasks, history, streaks, and settings are stored on your own device. There is no account, no sign-in, no analytics, no advertising, and no tracking. The only information that ever leaves your device is a small request when you use one of the smart (AI) features described below.

## What we store on your device

The app stores the following data locally using the operating system's standard private app storage (AsyncStorage on iOS):

- Your task text, completion status, and creation timestamps
- A history record of how many tasks you completed each day, and any optional reflections you write
- Your goal, onboarding answers (such as time per day, experience level, and main struggle), and the optional first name you enter for greetings
- Your progress (XP, level, streaks, milestones) and your reminder preferences

This data is not synced to any server or account.

## Smart features (AI)

Three optional features use an AI model. When you use them, the app sends a request to our own server, which asks an AI model (currently provided by Anthropic) to respond. Each request contains only what that feature needs:

- **Goal-based suggestions:** your goal and onboarding answers, a summary of recent completion counts, the titles of up to 12 of your recent tasks and whether each was completed, and your most recent optional reflection.
- **Brain dump:** the text you type or dictate into the brain dump (up to 2,000 characters), how many open slots you have today, and your goal.
- **Break it down:** the title of the task you ask to break down, and your goal.

These requests do **not** include your name, an account, a device identifier, advertising identifier, contact details, or location. Our server does not store them; it forwards each request to the AI provider and returns the result to your device. The AI provider processes the request to generate a response and may retain it for a limited period under its own API data policies (for example, for abuse and safety monitoring); it does not use this data to train its models. If an AI response is malformed, our server may record which fields it contained (not their content) in a short-lived error log for debugging.

This data is used only to provide these features inside the app. It is not linked to your identity, not used for advertising, and not sold or shared for any other purpose. If our server can't be reached, suggestions and brain dump fall back to simple on-device versions. Please don't include sensitive personal information (such as health, financial or account details) in a brain dump or task title.

## Permissions we request

**Notifications.** Used solely to deliver the local reminders you enable in Settings. Reminders are scheduled by iOS itself; the app never sends or receives push notifications from a remote server.

## Update check

When the app opens, it may ask Apple's public App Store lookup service whether a newer version of Daily Tasks is available. This request contains only the app's bundle identifier.

## Third parties

Apart from the AI provider used for suggestions (above), we do not use third-party analytics, advertising, crash reporting, or tracking services.

## Children

Daily Tasks is suitable for all ages and does not knowingly collect personal information from anyone, including children under 13.

## Your control

You can delete all data stored on your device at any time from Settings → Reset all data in the app, or by deleting the app. We do not keep a copy of your tasks or history on our servers.

## Changes to this policy

If a future version of the app changes how data is handled, this policy will be updated and the effective date above will change.

## Contact

Questions? Email faisal1024@gmail.com.
