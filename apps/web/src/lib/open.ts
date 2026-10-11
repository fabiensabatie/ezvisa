/**
 * Opens a link fetched on demand in a new tab. The tab is opened during the click, before
 * the link arrives, because Safari blocks tabs opened later; it is then pointed at the link.
 */
export async function openInNewTab(getUrl: () => Promise<string>): Promise<void> {
  const tab = window.open("", "_blank");
  try {
    const url = await getUrl();
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch {
    tab?.close();
  }
}

/**
 * Saves a file from a link fetched on demand. The link answers with
 * Content-Disposition: attachment, so the browser downloads it and the page stays put.
 */
export async function downloadFrom(getUrl: () => Promise<string>): Promise<void> {
  try {
    window.location.assign(await getUrl());
  } catch {
    // The failed request already shows an error toast.
  }
}
