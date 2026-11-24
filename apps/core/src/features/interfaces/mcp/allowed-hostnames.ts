import { localhostAllowedHostnames } from "@modelcontextprotocol/server";

const isPreviewAliasOf = (publicHost: string) => (hostname: string) =>
  hostname.endsWith(`-${publicHost}`) && /^pr-\d+$/.test(hostname.slice(0, -publicHost.length - 1));

/** A preview may only be called from itself, so its alias is allowed per request. */
export const allowedHostnames = (
  publicHost: string | undefined,
  requestHostname: string,
): string[] => {
  switch (publicHost) {
    case undefined:
      return localhostAllowedHostnames();
    default:
      return [publicHost, ...[requestHostname].filter(isPreviewAliasOf(publicHost))];
  }
};
