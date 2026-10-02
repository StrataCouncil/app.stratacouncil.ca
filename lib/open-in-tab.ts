/**
 * Open a link that has to be fetched first (a signed document URL) in a new
 * tab. The tab is opened straight away, inside the click, so browsers don't
 * treat it as a pop-up and block it; it's pointed at the link once it
 * arrives, or closed if it doesn't.
 */
export async function openInNewTab(
  getUrl: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tab = window.open("", "_blank");
  try {
    const result = await getUrl();
    if (!result.ok) {
      tab?.close();
      return result;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.url;
    } else {
      window.location.href = result.url;
    }
    return { ok: true };
  } catch {
    tab?.close();
    return { ok: false, error: "Couldn't open that document. Please try again." };
  }
}
