const hosts = new Set([
  "calendar.google.com",
  "outlook.live.com",
  "outlook.office365.com",
  "outlook.office.com",
]);
export function calendarFeedUrl(input: string) {
  const url = new URL(input.trim().replace(/^webcal:/i, "https:"));
  if (
    url.protocol !== "https:" ||
    !hosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new Error(
      "Use a Google Calendar or Outlook HTTPS calendar subscription link.",
    );
  return url.toString();
}
