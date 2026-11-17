import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SafeHtml } from "./SafeHtml";

const imageUrl = "https://user-images.githubusercontent.com/example.png";
const privateUrl = "https://private-user-images.githubusercontent.com/example.png?jwt=expired";
const defaults = {
  onNavigate: vi.fn(),
  toAppPath: () => null,
  offlineImageLabel: "Image unavailable offline",
};
afterEach(cleanup);

const payloads = [
  "<script>alert(1)</script>",
  `<img src="${imageUrl}" onerror="alert(1)">`,
  '<svg onload="alert(1)"><path d="M0 0"></path></svg>',
  '<a href="javascript:alert(1)">link</a>',
  '<a href="java&#x09;script:alert(1)">link</a>',
  '<a href="vbscript:msgbox(1)">link</a>',
  '<a href="data:text/html,<script>alert(1)</script>">link</a>',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<form action="https://evil.example"><input name="token"></form>',
  '<div style="width:expression(alert(1))">text</div>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example">',
  '<a id="location" name="cookie">link</a><img id="attributes" name="__proto__">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  "<svg><style><img src=x onerror=alert(1)></style></svg>",
  '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
  '<object data="https://evil.example"></object><embed src="https://evil.example">',
];

describe("SafeHtml security boundary", () => {
  it.each(payloads)("removes executable markup: %s", (html) => {
    const { container } = render(<SafeHtml {...defaults} html={html} />);
    expect(
      container.querySelector("script,style,svg,math,iframe,form,input,meta,base,object,embed"),
    ).toBeNull();
    for (const element of container.querySelectorAll("*")) {
      for (const attribute of element.attributes) {
        expect(attribute.name).not.toMatch(/^(?:on|style$|name$|srcdoc$)/i);
        if (["href", "src"].includes(attribute.name))
          expect(attribute.value).not.toMatch(/^(?:javascript|vbscript|data):/i);
      }
    }
    expect(container.querySelector('[id="location"], [id="attributes"]')).toBeNull();
  });

  it("keeps GitHub structures and removes unrelated classes", () => {
    const { container, getByText } = render(
      <SafeHtml
        {...defaults}
        html={`
      <h2>Heading</h2><ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked>Complete</li></ul>
      <div class="markdown-alert markdown-alert-note arbitrary"><p class="markdown-alert-title">Note</p><p>Read this.</p></div>
      <div class="highlight highlight-source-ts"><pre><code><span class="pl-k">const</span> answer = 42;</code></pre></div>
      <a class="user-mention" href="https://github.com/octocat">@octocat</a>
      <table><thead><tr><th>Feature</th></tr></thead><tbody><tr><td>Safe</td></tr></tbody></table>
      <details><summary>Details</summary><p>Expanded</p></details><g-emoji alias="smile">😄</g-emoji><span class="math math-inline">x²</span>`}
      />,
    );
    expect(container.querySelector('input[type="checkbox"]')?.hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("input")?.hasAttribute("checked")).toBe(true);
    for (const selector of [
      "h2",
      ".contains-task-list",
      ".markdown-alert-note",
      ".highlight .pl-k",
      ".user-mention",
      "table tbody td",
      "details summary",
      "g-emoji",
      ".math-inline",
    ])
      expect(container.querySelector(selector)).not.toBeNull();
    expect(container.querySelector(".arbitrary")).toBeNull();
    expect(getByText("Expanded")).toBeTruthy();
  });

  it("allows only disabled task-list checkboxes", () => {
    const { container } = render(
      <SafeHtml
        {...defaults}
        html='<input type="checkbox"><li class="task-list-item"><input type="text"><input type="CHECKBOX" onfocus="alert(1)"></li>'
      />,
    );
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(container.querySelector("input")?.hasAttribute("disabled")).toBe(true);
  });

  it("permits only raster data images and safe responsive candidates", () => {
    const { container } = render(
      <SafeHtml
        {...defaults}
        html={`
      <img src="data:image/png;base64,AAAA" width="640" height="999999" loading="eager">
      <picture><source srcset="${imageUrl} 1x, ${imageUrl}?large 2x" media="(min-width: 800px)"><img src="${imageUrl}" width="100%"></picture>
      <img srcset="${imageUrl} 1x, javascript:alert(1) 2x">
      <source srcset="${imageUrl} 1x"><img src="https://evil.example/track">
      <img srcset="data:image/png;base64,AAAA 1x"><img src="//github.com/image">`}
      />,
    );
    const images = container.querySelectorAll("img");
    expect(images[0]?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    expect(images[0]?.getAttribute("width")).toBe("640");
    expect(images[0]?.hasAttribute("height")).toBe(false);
    expect(images[1]?.hasAttribute("width")).toBe(false);
    expect(container.querySelectorAll("source")).toHaveLength(1);
    expect(container.querySelector("source")?.getAttribute("srcset")).toContain("2x");
    expect(images[2]?.hasAttribute("srcset")).toBe(false);
    expect(images[3]?.hasAttribute("src")).toBe(false);
    expect(images[4]?.hasAttribute("srcset")).toBe(false);
    expect(images[5]?.hasAttribute("src")).toBe(false);
    for (const image of images) {
      expect(image.getAttribute("loading")).toBe("lazy");
      expect(image.getAttribute("decoding")).toBe("async");
    }
  });

  it("restricts videos to HTTPS CSP hosts with controls and no autoplay", () => {
    const { container } = render(
      <SafeHtml
        {...defaults}
        html='<video src="https://github.com/user-attachments/assets/movie" autoplay loop><source src="https://evil.example/movie"></video><video src="https://github.com.evil.example/movie"></video><video src="http://github.com/movie"></video><video src="data:video/mp4;base64,AAAA"></video>'
      />,
    );
    const videos = container.querySelectorAll("video");
    expect(videos[0]?.getAttribute("src")).toBe("https://github.com/user-attachments/assets/movie");
    for (const video of videos) {
      expect(video.hasAttribute("controls")).toBe(true);
      expect(video.hasAttribute("autoplay")).toBe(false);
    }
    for (const video of Array.from(videos).slice(1)) expect(video.hasAttribute("src")).toBe(false);
    expect(container.querySelector("source")).toBeNull();
  });
});

describe("SafeHtml navigation", () => {
  it("sets safe external link attributes and drops relative URLs", () => {
    const { getByText } = render(
      <SafeHtml
        {...defaults}
        html='<a href="https://example.com" rel="opener" target="_self">External</a><a href="/auth/logout">Relative</a><a href="//example.com">Protocol relative</a><a href="mailto:user@example.com">Email</a>'
      />,
    );
    expect(getByText("External").getAttribute("target")).toBe("_blank");
    expect(getByText("External").getAttribute("rel")).toBe("noopener noreferrer");
    expect(getByText("Relative").hasAttribute("href")).toBe(false);
    expect(getByText("Protocol relative").hasAttribute("href")).toBe(false);
    expect(getByText("Email").getAttribute("href")).toBe("mailto:user@example.com");
  });

  it("intercepts mapped GitHub links and preserves their href", () => {
    const onNavigate = vi.fn();
    const toAppPath = vi.fn(() => "/owner/repo/issues/7");
    const { getByText } = render(
      <SafeHtml
        {...defaults}
        onNavigate={onNavigate}
        toAppPath={toAppPath}
        html='<a href="https://github.com/owner/repo/issues/7"><strong>Issue</strong></a>'
      />,
    );
    expect(fireEvent.click(getByText("Issue"))).toBe(false);
    expect(toAppPath).toHaveBeenCalledWith("https://github.com/owner/repo/issues/7");
    expect(onNavigate).toHaveBeenCalledWith("/owner/repo/issues/7");
    expect(getByText("Issue").closest("a")?.getAttribute("href")).toBe(
      "https://github.com/owner/repo/issues/7",
    );
  });

  it.each([
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ])("preserves native modified clicks: %j", (modifier) => {
    const onNavigate = vi.fn();
    const { getByText } = render(
      <SafeHtml
        {...defaults}
        onNavigate={onNavigate}
        toAppPath={() => "/repo"}
        html='<a href="https://github.com/owner/repo">Repo</a>'
      />,
    );
    expect(fireEvent.click(getByText("Repo"), modifier)).toBe(true);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("never passes non-GitHub links to the mapper", () => {
    const toAppPath = vi.fn(() => "/repo");
    const { getByText } = render(
      <SafeHtml
        {...defaults}
        toAppPath={toAppPath}
        html='<a href="https://example.com">External</a>'
      />,
    );
    expect(fireEvent.click(getByText("External"))).toBe(true);
    expect(toAppPath).not.toHaveBeenCalled();
  });

  it("resolves fragments within each renderer with clobber-safe unique IDs", () => {
    const html =
      '<h2 id="user-content-heading">Heading</h2><a href="#heading">Jump</a><a href="#%ZZ">Malformed</a>';
    const { container, getAllByText } = render(
      <>
        <SafeHtml {...defaults} html={html} />
        <SafeHtml {...defaults} html={html} />
      </>,
    );
    const headings = container.querySelectorAll("h2");
    expect(headings[0]?.id).not.toBe(headings[1]?.id);
    expect(headings[0]?.id).toMatch(/^markdown-.*user-content-/);
    for (const [index, link] of getAllByText("Jump").entries()) {
      const target = headings[index];
      if (!target) throw new Error("Missing fragment target");
      expect(link.getAttribute("href")).toBe(`#${target.id}`);
    }
    const heading = headings[0];
    const link = getAllByText("Jump")[0];
    if (!heading || !link) throw new Error("Missing fragment fixture");
    const scrollIntoView = vi.fn();
    heading.scrollIntoView = scrollIntoView;
    expect(fireEvent.click(link)).toBe(false);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(heading);
    for (const malformed of getAllByText("Malformed"))
      expect(malformed.hasAttribute("href")).toBe(false);
  });

  it("preserves GitHub footnote references and backlinks", () => {
    const { container, getByText } = render(
      <SafeHtml
        {...defaults}
        html='<sup><a id="user-content-fnref-1" href="#user-content-fn-1">1</a></sup><ol><li id="user-content-fn-1">Footnote <a href="#user-content-fnref-1">Back</a></li></ol>'
      />,
    );
    const reference = getByText("1");
    const footnote = container.querySelector("li");
    if (!footnote) throw new Error("Missing footnote fixture");
    expect(reference.getAttribute("href")).toBe(`#${footnote.id}`);
    expect(getByText("Back").getAttribute("href")).toBe(`#${reference.id}`);
  });
});

describe("SafeHtml offline images", () => {
  it.each([
    `<img src="${privateUrl}">`,
    `<img src="${imageUrl}" srcset="${privateUrl} 2x">`,
    `<picture><source srcset="${privateUrl} 2x"><img src="${imageUrl}"></picture>`,
  ])("replaces signed image candidates before insertion: %s", (html) => {
    const { container, getByRole } = render(<SafeHtml {...defaults} html={html} offline />);
    expect(container.querySelector("img,source,picture")).toBeNull();
    expect(getByRole("img", { name: defaults.offlineImageLabel }).textContent).toBe(
      defaults.offlineImageLabel,
    );
    expect(container.innerHTML).not.toContain("jwt=");
  });

  it("replaces any failed offline image using text and restores images online", () => {
    const html = `<picture><source srcset="${imageUrl} 2x"><img src="${imageUrl}"></picture>`;
    const label = '<img src=x onerror="alert(1)">';
    const { container, rerender, getByText } = render(
      <SafeHtml {...defaults} html={html} offline offlineImageLabel={label} />,
    );
    const image = container.querySelector("img");
    if (!image) throw new Error("Missing image fixture");
    fireEvent.error(image);
    expect(getByText(label)).toBeTruthy();
    expect(container.querySelector("img,source")).toBeNull();
    rerender(<SafeHtml {...defaults} html={html} offline={false} />);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("updates placeholders and preserves online signed URLs", () => {
    const html = `<img src="${privateUrl}">`;
    const { container, rerender, getByText } = render(<SafeHtml {...defaults} html={html} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(privateUrl);
    rerender(<SafeHtml {...defaults} html={html} offline />);
    expect(getByText(defaults.offlineImageLabel)).toBeTruthy();
    rerender(<SafeHtml {...defaults} html={html} offline offlineImageLabel="Unavailable" />);
    expect(getByText("Unavailable")).toBeTruthy();
    rerender(<SafeHtml {...defaults} html="<p>Updated body</p>" />);
    expect(getByText("Updated body")).toBeTruthy();
  });
});
