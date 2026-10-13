import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fromRadixValue, NONE, Select, toRadixValue } from "./select";

const OPTIONS = [
  { value: "2826", label: "United Kingdom" },
  { value: "1006886", label: "London" },
];

function trigger(element: JSX.Element) {
  const html = renderToStaticMarkup(element);
  return { html, tag: html.slice(0, html.indexOf(">") + 1) };
}

describe("toRadixValue / fromRadixValue", () => {
  it("passes a real code through both ways", () => {
    expect(toRadixValue("2826", true)).toBe("2826");
    expect(toRadixValue("2826", false)).toBe("2826");
    expect(fromRadixValue("2826")).toBe("2826");
  });

  it("null selects the empty option when there is one", () => {
    expect(toRadixValue(null, true)).toBe(NONE);
    expect(fromRadixValue(NONE)).toBeNull();
  });

  it("null shows the placeholder when there is no empty option", () => {
    expect(toRadixValue(null, false)).toBe("");
  });
});

describe("Select trigger", () => {
  it("is a labelled combobox button, not a native select", () => {
    const { html, tag } = trigger(<Select id="location" value="2826" onChange={() => {}} options={OPTIONS} />);
    expect(html.match(/<select[^>]*>/g)?.every((tag) => tag.includes('aria-hidden="true"'))).not.toBe(false);
    expect(tag).toMatch(/^<button/);
    expect(tag).toContain('id="location"');
    expect(tag).toContain('role="combobox"');
    expect(tag).not.toContain("data-placeholder");
  });

  it("shows the placeholder when nothing is chosen and there is no empty option", () => {
    const { html, tag } = trigger(<Select value={null} onChange={() => {}} options={OPTIONS} placeholder="Select a location" />);
    expect(tag).toContain("data-placeholder");
    expect(html).toContain("Select a location");
  });

  it("does not fall back to the placeholder when null maps to the empty option", () => {
    const { tag } = trigger(<Select value={null} onChange={() => {}} options={OPTIONS} placeholder="Select a location" emptyLabel="No location" />);
    expect(tag).not.toContain("data-placeholder");
  });
});
