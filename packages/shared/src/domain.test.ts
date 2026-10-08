import { describe, expect, it } from "vitest";
import { domainMatches, normalizeDomain } from "./domain";

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Example.co.uk/services?x=1", "example.co.uk"],
    ["http://example.co.uk:8080", "example.co.uk"],
    ["www.example.co.uk.", "example.co.uk"],
    ["  shop.example.co.uk/#top ", "shop.example.co.uk"],
    ["example.co.uk", "example.co.uk"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe("domainMatches", () => {
  it("matches the same host regardless of www/protocol", () => {
    expect(domainMatches("www.example.co.uk", "https://example.co.uk/")).toBe(true);
  });

  it("matches a subdomain of the lead site", () => {
    expect(domainMatches("shop.example.co.uk", "example.co.uk")).toBe(true);
  });

  it("does not match a different site that only ends with the same letters", () => {
    expect(domainMatches("notexample.co.uk", "example.co.uk")).toBe(false);
  });

  it("does not match a parent domain of the lead site", () => {
    expect(domainMatches("example.co.uk", "shop.example.co.uk")).toBe(false);
  });

  it("an empty lead domain matches nothing", () => {
    expect(domainMatches("www.example.co.uk", "  ")).toBe(false);
  });
});
