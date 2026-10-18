import { setCloudflareContext } from "./helpers/context";

// Default context for every test file; individual tests can override
// (e.g. COOKIE_SAMESITE) by calling setCloudflareContext again.
setCloudflareContext();
