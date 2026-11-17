import createDOMPurify, { type Config } from "dompurify";
import { useId, useMemo, type JSX, type MouseEvent } from "react";
import styles from "./SafeHtml.module.css";

const PRIVATE_IMAGE_HOST = "private-user-images.githubusercontent.com";
const MEDIA_HOSTS = [
  "github.com",
  "user-images.githubusercontent.com",
  PRIVATE_IMAGE_HOST,
  "objects.githubusercontent.com",
];
const IMAGE_HOSTS = [
  ...MEDIA_HOSTS,
  "avatars.githubusercontent.com",
  "camo.githubusercontent.com",
  "raw.githubusercontent.com",
  "repository-images.githubusercontent.com",
  "opengraph.githubassets.com",
];
const MAX_IMAGE_DIMENSION = 8192;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const NAMED_PREFIX = "user-content-";
const RASTER_DATA_URL = /^data:image\/(?:png|gif|jpeg|webp);base64,[a-z\d+/]*={0,2}$/i;
const GITHUB_CLASS =
  /^(?:markdown-alert(?:-(?:note|tip|important|warning|caution|title))?|highlight|highlight-source-[\w-]+|pl-[\w-]+|user-mention|issue-link|task-list-item|contains-task-list|anchor|octicon(?:-[\w-]+)?|math(?:-[\w-]+)?|language-[\w-]+)$/;
const TAG_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  a: ["href"],
  img: ["src", "srcset", "alt", "width", "height"],
  source: ["srcset", "media", "type"],
  video: ["src", "controls", "width", "height"],
  input: ["type", "checked", "disabled"],
  ol: ["start"],
  li: ["value"],
  th: ["align", "colspan", "rowspan", "scope"],
  td: ["align", "colspan", "rowspan"],
  details: ["open"],
  "g-emoji": ["alias"],
});
const CONFIG = Object.freeze({
  ALLOWED_TAGS: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "img",
    "picture",
    "source",
    "ul",
    "ol",
    "li",
    "input",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "code",
    "pre",
    "kbd",
    "samp",
    "blockquote",
    "details",
    "summary",
    "sup",
    "sub",
    "del",
    "ins",
    "s",
    "hr",
    "br",
    "span",
    "div",
    "strong",
    "em",
    "b",
    "i",
    "dl",
    "dt",
    "dd",
    "g-emoji",
    "video",
  ],
  ALLOWED_ATTR: [
    "id",
    "class",
    "title",
    "dir",
    "lang",
    "aria-label",
    ...new Set(Object.values(TAG_ATTRIBUTES).flat()),
  ],
  ALLOWED_NAMESPACES: [HTML_NAMESPACE],
  FORBID_ATTR: ["style", "name"],
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  // Prefixes prevent named-property DOM clobbering.
  SANITIZE_NAMED_PROPS: true,
  RETURN_DOM_FRAGMENT: true,
} satisfies Config);
for (const option of Object.values(CONFIG)) {
  if (Array.isArray(option)) Object.freeze(option);
}
const purifier = createDOMPurify(window);

function absoluteUrl(value: string): URL | null {
  if (!/^(?:https?:\/\/|mailto:)/i.test(value) || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.username || url.password ? null : url;
}

function hostedUrl(value: string, hosts: readonly string[]): boolean {
  const url = absoluteUrl(value);
  return url !== null && url.protocol === "https:" && !url.port && hosts.includes(url.hostname);
}

function safeSrcset(value: string): boolean {
  return value.split(",").every((candidate) => {
    const [url, descriptor, ...extra] = candidate.trim().split(/\s+/);
    return (
      url !== undefined &&
      hostedUrl(url, IMAGE_HOSTS) &&
      extra.length === 0 &&
      (descriptor === undefined || /^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor))
    );
  });
}

function allowedAttribute(element: Element, name: string, value: string): boolean {
  const tag = element.localName;
  if (["id", "class", "title", "dir", "lang", "aria-label"].includes(name)) return true;
  if (!TAG_ATTRIBUTES[tag]?.includes(name)) return false;
  if (name === "href") return value.startsWith("#") || absoluteUrl(value) !== null;
  if (name === "src")
    return tag === "img"
      ? RASTER_DATA_URL.test(value) || hostedUrl(value, IMAGE_HOSTS)
      : hostedUrl(value, MEDIA_HOSTS);
  if (name === "srcset") return safeSrcset(value);
  if (name === "width" || name === "height")
    return /^\d+$/.test(value) && Number(value) <= MAX_IMAGE_DIMENSION;
  if (["colspan", "rowspan", "start", "value"].includes(name)) return /^\d+$/.test(value);
  if (name === "align") return /^(?:left|center|right)$/.test(value);
  return true;
}

purifier.addHook("uponSanitizeElement", (node) => {
  if (!(node instanceof Element)) return;
  if (
    node.localName === "input" &&
    (node.getAttribute("type")?.toLowerCase() !== "checkbox" ||
      !node.parentElement?.closest(".task-list-item"))
  )
    node.remove();
  if (node.localName === "source" && node.parentElement?.localName !== "picture") node.remove();
});
purifier.addHook("uponSanitizeAttribute", (node, attribute) => {
  if (!(node instanceof Element)) return;
  attribute.keepAttr = allowedAttribute(node, attribute.attrName, attribute.attrValue);
  if (attribute.attrName === "class") {
    attribute.attrValue = attribute.attrValue
      .split(/\s+/)
      .filter((className) => GITHUB_CLASS.test(className))
      .join(" ");
    attribute.keepAttr = attribute.attrValue.length > 0;
  }
});
purifier.addHook("afterSanitizeAttributes", (node) => {
  if (!(node instanceof Element)) return;
  if (node.localName === "input") node.setAttribute("disabled", "");
  if (node.localName === "video") node.setAttribute("controls", "");
  if (node.localName === "img") {
    node.setAttribute("loading", "lazy");
    node.setAttribute("decoding", "async");
  }
  if (
    node.localName === "a" &&
    node.hasAttribute("href") &&
    !node.getAttribute("href")?.startsWith("#")
  ) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

function imagePlaceholder(image: HTMLImageElement, label: string): void {
  const placeholder = document.createElement("span");
  placeholder.className = styles.offlineImage ?? "";
  placeholder.setAttribute("role", "img");
  placeholder.setAttribute("aria-label", label);
  placeholder.textContent = label;
  (image.closest("picture") ?? image).replaceWith(placeholder);
}

function prepareHtml(
  fragment: DocumentFragment,
  prefix: string,
  offline: boolean,
  label: string,
): string {
  const wrapper = document.createElement("div");
  wrapper.append(fragment.cloneNode(true));
  const identifiers = new Map<string, string>();
  for (const element of wrapper.querySelectorAll("[id]")) {
    const original = element.id.slice(NAMED_PREFIX.length);
    const scoped = prefix + element.id;
    if (!identifiers.has(element.id)) identifiers.set(element.id, scoped);
    if (!identifiers.has(original)) identifiers.set(original, scoped);
    element.id = scoped;
  }
  for (const anchor of wrapper.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
    const fragmentName = anchor.hash.slice(1);
    let decoded: string;
    try {
      decoded = decodeURIComponent(fragmentName);
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      anchor.removeAttribute("href");
      continue;
    }
    const target = identifiers.get(decoded);
    if (target) anchor.setAttribute("href", "#" + target);
    else anchor.removeAttribute("href");
  }
  if (offline) {
    for (const image of wrapper.querySelectorAll("img")) {
      const candidates = [image, ...(image.closest("picture")?.querySelectorAll("source") ?? [])];
      const privateImage = candidates.some((candidate) => {
        const urls = [
          candidate.getAttribute("src") ?? "",
          ...(candidate.getAttribute("srcset") ?? "")
            .split(",")
            .map((entry) => entry.trim().split(/\s+/)[0] ?? ""),
        ];
        return urls.some((url) => absoluteUrl(url)?.hostname === PRIVATE_IMAGE_HOST);
      });
      if (privateImage) imagePlaceholder(image, label);
    }
  }
  return wrapper.innerHTML;
}

export function SafeHtml(props: {
  html: string;
  className?: string;
  onNavigate: (appPath: string) => void;
  toAppPath: (url: string) => string | null;
  offline?: boolean;
  offlineImageLabel: string;
}): JSX.Element {
  const { html, className, onNavigate, toAppPath, offline = false, offlineImageLabel } = props;
  const instance = useId();
  const sanitized = useMemo(() => purifier.sanitize(html, CONFIG), [html]);
  const prepared = useMemo(
    () => ({ __html: prepareHtml(sanitized, `markdown-${instance}-`, offline, offlineImageLabel) }),
    [sanitized, instance, offline, offlineImageLabel],
  );

  function navigate(event: MouseEvent<HTMLDivElement>): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    const href = anchor.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#")) {
      const target = Array.from(event.currentTarget.querySelectorAll("[id]")).find(
        (element) => element.id === href.slice(1),
      );
      if (target instanceof HTMLElement) {
        event.preventDefault();
        target.scrollIntoView();
        target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
      return;
    }
    const url = absoluteUrl(href);
    if (url?.hostname !== "github.com" || url.protocol !== "https:" || url.port) return;
    const appPath = toAppPath(href);
    if (appPath !== null) {
      event.preventDefault();
      onNavigate(appPath);
    }
  }

  return (
    <div
      key={`${String(offline)}-${offlineImageLabel}`}
      className={[styles.markdown, className].filter(Boolean).join(" ")}
      onClick={navigate}
      onErrorCapture={(event) => {
        if (offline && event.target instanceof HTMLImageElement)
          imagePlaceholder(event.target, offlineImageLabel);
      }}
      dangerouslySetInnerHTML={prepared}
    />
  );
}
