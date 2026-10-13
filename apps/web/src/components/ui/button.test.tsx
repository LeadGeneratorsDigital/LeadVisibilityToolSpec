import { ArrowRight, RefreshCw } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

const decode = (text: string) => text.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function render(element: JSX.Element) {
  const html = renderToStaticMarkup(element);
  const buttonTag = html.slice(0, html.indexOf(">") + 1);
  const buttonClasses = decode(/class="([^"]*)"/.exec(buttonTag)?.[1] ?? "").split(" ");
  const svgClasses = [...html.matchAll(/<svg[^>]*class="([^"]*)"/g)].map((m) => decode(m[1]!).split(" "));
  return {
    html,
    buttonClasses,
    disabled: buttonTag.includes(' disabled=""'),
    busy: buttonTag.includes(' aria-busy="true"'),
    spinsLeadingIcon: buttonClasses.includes("[&>svg:first-child]:animate-spin"),
    svgCount: svgClasses.length,
    addedSpinner: svgClasses.some((c) => c.includes("lucide-loader-circle") && c.includes("animate-spin")),
  };
}

describe("Button loading", () => {
  it("is idle by default: enabled, not busy, no spinner", () => {
    const button = render(
      <Button>
        <RefreshCw /> Pull rankings
      </Button>,
    );
    expect(button).toMatchObject({ disabled: false, busy: false, spinsLeadingIcon: false, svgCount: 1, addedSpinner: false });
  });

  it("spins the leading icon instead of adding a second one", () => {
    const button = render(
      <Button loading>
        <RefreshCw /> Pulling...
      </Button>,
    );
    expect(button).toMatchObject({ disabled: true, busy: true, spinsLeadingIcon: true, svgCount: 1, addedSpinner: false });
  });

  it("adds a spinner before the label when it has no leading icon", () => {
    const button = render(<Button loading>Saving...</Button>);
    expect(button).toMatchObject({ disabled: true, busy: true, spinsLeadingIcon: false, svgCount: 1, addedSpinner: true });
    expect(button.html.indexOf("<svg")).toBeLessThan(button.html.indexOf("Saving..."));
  });

  it("a trailing icon is not spun; the spinner is added in front instead", () => {
    const button = render(
      <Button loading>
        Adding... <ArrowRight />
      </Button>,
    );
    expect(button).toMatchObject({ spinsLeadingIcon: false, svgCount: 2, addedSpinner: true });
  });

  it("a caller's disabled still applies when not loading", () => {
    expect(render(<Button disabled>Save</Button>)).toMatchObject({ disabled: true, busy: false, svgCount: 0 });
  });

  it("loading buttons fade less than disabled ones so the spinner stays visible", () => {
    expect(render(<Button disabled>Save</Button>).buttonClasses).toContain("disabled:opacity-45");
    const loading = render(<Button loading>Save</Button>).buttonClasses;
    expect(loading).toContain("disabled:opacity-70");
    expect(loading).not.toContain("disabled:opacity-45");
  });
});
