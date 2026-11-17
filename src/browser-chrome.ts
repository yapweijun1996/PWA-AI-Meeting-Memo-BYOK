import iconTemplate from "../public/favicon.svg?raw";

/** Browser-tab artwork shares the existing SVG and the same colors as the in-app brand. */
export function syncBrowserChrome() {
  const styles = getComputedStyle(document.documentElement);
  const background = styles.getPropertyValue("--bg-app").trim();
  if (background)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", background);
  const accent = styles.getPropertyValue("--brand-mark-bg").trim();
  const foreground = styles.getPropertyValue("--brand-mark-text").trim();
  if (!CSS.supports("color", accent) || !CSS.supports("color", foreground))
    return;
  const svg = new DOMParser().parseFromString(iconTemplate, "image/svg+xml");
  svg.querySelector("rect")?.setAttribute("fill", accent);
  svg
    .querySelectorAll("[stroke]")
    .forEach((path) => path.setAttribute("stroke", foreground));
  const href = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg.documentElement))}`;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon && icon.getAttribute("href") !== href)
    icon.setAttribute("href", href);
}
