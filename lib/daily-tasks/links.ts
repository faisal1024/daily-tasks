// External links shown in the app.

// GitHub renders this as a page (the gist's raw URL is served as plain text).
// Keep it in sync with the published gist copy App Store Connect links to.
export const PRIVACY_URL = "https://github.com/faisal1024/daily-tasks/blob/main/docs/privacy-policy.md";

// Apple's standard licence agreement, which covers subscriptions.
export const TERMS_URL = "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

export const SUPPORT_URL = "https://github.com/faisal1024/daily-tasks#support";

export const MANAGE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

// Three Today's App Store id. The App Store app opens straight to "Write a
// Review"; the https link is the fallback if the itms-apps scheme can't open.
export const APP_STORE_ID = "6762511782";
export const WRITE_REVIEW_URL = `itms-apps://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;
export const WRITE_REVIEW_WEB_URL = `https://apps.apple.com/app/id${APP_STORE_ID}?action=write-review`;

// Where "Send feedback" goes. The support page for now; this can become a
// mailto: link once a feedback address is chosen.
export const FEEDBACK_URL = "https://github.com/faisal1024/daily-tasks#support";
