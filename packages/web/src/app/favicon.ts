const base = "<rect width='32' height='32' rx='8' fill='%2366d9ef'/><text x='16' y='24' text-anchor='middle' font-size='22' font-weight='800' fill='%2306101a'>%CF%80</text>";
/** Amber, the needs-you colour, ringed in the page background so it reads on light and dark tab strips. */
const dot = "<circle cx='25' cy='7' r='6.5' fill='%23f5bf65' stroke='%2306101a' stroke-width='2.5'/>";

/** The π icon, with an amber dot while anything needs you. */
export function faviconHref(needsYou: number): string {
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>${base}${needsYou > 0 ? dot : ''}</svg>`;
}

/** Points the page icon at `href`, creating the link element when the page has none. */
export function setFavicon(href: string): void {
  const link = document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}
