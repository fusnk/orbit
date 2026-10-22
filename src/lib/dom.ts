type Attrs = Record<string, string | boolean>;

/**
 * Creates an element. String children become text nodes, so markup inside them
 * (e.g. from an addon) is displayed literally and never parsed as HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    // Inline handlers are blocked by CSP too; this keeps the mistake from shipping.
    if (/^on/i.test(name)) throw new Error(`event attribute not allowed: ${name}`);
    if (value === false) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  el.append(...children);
  return el;
}
