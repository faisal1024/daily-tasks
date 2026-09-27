# Privacy Policy — Three Today

**Effective date: 30 September 2026 (last updated for free AI brain dumps and the anonymous purchase ID)**

<!-- Keep in sync with the published copy (gist a43d6373453761af70d495d640e38ffa,
     privacy-policy.html), which App Store Connect links to. The app links here. -->

## Summary

Three Today (formerly Daily Tasks) is local-first. Your tasks, history, streaks, and settings are stored on your own device. There is no account, no sign-in, no advertising, and no tracking across apps or websites. Information leaves your device only in three cases, each described below: a small request when you use one of the smart (AI) features, anonymous usage counts (which you can turn off), and, if you buy Plus, the purchase record handled by Apple and our subscription provider.

## What we store on your device

The app stores the following data locally using the operating system's standard private app storage (AsyncStorage on iOS):

- Your task text, completion status, and creation timestamps
- A history record of how many tasks you completed each day, and any optional reflections you write
- Your goal, onboarding answers (such as time per day, experience level, and main struggle), and the optional first name you enter for greetings
- Your progress (XP, level, streaks, milestones) and your reminder preferences

This data is not synced to any server or account. The Home Screen and Lock Screen widget reads today's tasks from storage shared between the app and its widget on your device; nothing is sent anywhere for the widget.

## Smart features (AI)

Four optional features use an AI model. When you use them, the app sends a request to our own server, which asks an AI model (currently provided by Anthropic) to respond. Each request contains only what that feature needs:

- **Goal-based suggestions:** your goal and onboarding answers, a summary of recent completion counts, the titles of up to 12 of your recent tasks and whether each was completed, and your most recent optional reflection.
- **Brain dump:** the text you type or dictate into the brain dump (up to 2,000 characters), how many open slots you have today, and your goal. When you first open the app, what you type on the first screen is sorted this way, and free users also get a few more AI-sorted brain dumps to try (the app shows how many are left); after that, brain dumps are sorted on your device unless you have Plus.
- **Break it down:** the title of the task you ask to break down, and your goal.
- **Evening check-in:** how your day felt (the option you tap), the titles of today's tasks and whether each was done, your optional note, your goal, and your coach memory (below).

**Calendar and Reminders (optional, iPhone only).** If you turn on "Plan around my calendar" in Settings and allow access, the app reads the titles and times of today's calendar events and of reminders due by the end of today (including overdue ones), up to 12 items. They are sent with goal-based suggestion and brain dump requests so your three fit around your day. They are never stored on our server, and the app never changes your calendar or reminders. You can turn this off in Settings, or remove access in iOS Settings, at any time.

**Coach memory.** After an evening check-in, the AI writes a short summary of patterns worth remembering (for example which kinds of tasks you tend to finish). It is stored on your device, is sent with goal-based suggestion and evening check-in requests so the coach can build on it, and is never stored on our server. "Reset all data" in Settings deletes it.

These requests do **not** include your name, an account, an advertising identifier, contact details, or location.

In versions of the app that offer Plus, each request also includes the anonymous app user ID that RevenueCat created on your device (see Purchases). Our server uses it only to ask RevenueCat whether Plus is active (and, if you had Plus for free as an early supporter, to record that with RevenueCat) and to apply fair-use limits. It is not sent to the AI provider and isn't linked to your name or Apple ID; for the limits, our server keeps only a one-way hash of it, for about a day.

Our server does not store the requests themselves; it forwards each request to the AI provider and returns the result to your device. The AI provider processes the request to generate a response and may retain it for a limited period under its own API data policies (for example, for abuse and safety monitoring); it does not use this data to train its models. If an AI response is malformed, our server may record which fields it contained (not their content) in a short-lived error log for debugging.

This data is used only to provide these features inside the app. It is not linked to your identity, not used for advertising, and not sold or shared for any other purpose. If our server can't be reached, suggestions and brain dump fall back to simple on-device versions. Please don't include sensitive personal information (such as health, financial or account details) in a brain dump or task title.

## Anonymous usage stats

To understand which features help, the app sends anonymous usage counts to our analytics provider (PostHog, US servers). Examples: "opened the app", "finished a task", "used brain dump", "viewed Plus", or that the app hit an error (only the kind of error, never its details). Each event carries only a random identifier created on your device, the app version, and a few short labels (for example which screen a feature was opened from). It never includes your tasks, goals, brain dump, reflections, name, contact details, device identifiers, or location, and the analytics provider is set to discard IP addresses. This data is not linked to your identity and is not used for advertising or tracking. You can turn it off at any time in Settings → Data → Share anonymous usage stats; resetting all data also creates a new random identifier.

## Purchases (Plus)

Plus subscriptions and purchases are processed by Apple; we never see your payment details. To check whether Plus is active on your device, the app uses RevenueCat, a subscription service, with an anonymous app user ID it creates on your device. RevenueCat receives your purchase history for this app (products, dates, and status) from Apple so it can confirm your access and let you restore purchases. This is not linked to your name or used for advertising.

## Permissions we request

**Notifications.** Used solely to deliver the local reminders you enable in Settings. Reminders are scheduled by iOS itself; the app never sends or receives push notifications from a remote server.

**Calendar and Reminders (optional).** Requested only if you turn on "Plan around my calendar" in Settings, and used only as described under Smart features. The app never changes your calendar or reminders.

## Update check

When the app opens, it may ask Apple's public App Store lookup service whether a newer version of Three Today is available. This request contains only the app's bundle identifier.

## Third parties

We use three service providers, each only for the purpose described above: an AI provider (Anthropic) for the smart features, PostHog for anonymous usage counts, and RevenueCat for Plus purchases. We do not use advertising, crash reporting, or tracking services, and we do not sell or share personal data.

## Children

Three Today is suitable for all ages and does not knowingly collect personal information from anyone, including children under 13.

## Your control

You can delete all data stored on your device at any time from Settings → Reset all data in the app, or by deleting the app. Reset keeps a few small counters that aren't personal data (how many free AI sorts were used, and whether a Plus offer was already shown), so free trials aren't repeated; deleting the app removes them too. We do not keep a copy of your tasks or history on our servers. You can turn off anonymous usage stats in Settings, and manage or cancel a subscription in your Apple ID settings.

## Changes to this policy

If a future version of the app changes how data is handled, this policy will be updated and the effective date above will change.

## Contact

Questions? Email faisal1024@gmail.com.
