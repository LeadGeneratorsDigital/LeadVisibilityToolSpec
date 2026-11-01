import { describe, expect, it } from "vitest";
import { mergePastedContacts, planContactPaste } from "./contact-paste";

describe("planContactPaste", () => {
  it("reads typed lines: name, job title and email in any position", () => {
    expect(planContactPaste("Jane Smith, Managing Director, jane@acme.co.uk\nbob@acme.co.uk, Bob Brown\nTom Lee <tom@acme.co.uk>").contacts).toEqual([
      { name: "Jane Smith", job_title: "Managing Director", email: "jane@acme.co.uk" },
      { name: "Bob Brown", job_title: null, email: "bob@acme.co.uk" },
      { name: "Tom Lee", job_title: null, email: "tom@acme.co.uk" },
    ]);
  });

  it("reads rows copied from a spreadsheet (tab-separated)", () => {
    expect(planContactPaste("Ann Lee\tOwner\tann@lee.co.za\r\nSam Hill\t\tsam@hill.com").contacts).toEqual([
      { name: "Ann Lee", job_title: "Owner", email: "ann@lee.co.za" },
      { name: "Sam Hill", job_title: null, email: "sam@hill.com" },
    ]);
  });

  it("names an email-only line by its address and strips mailto:", () => {
    expect(planContactPaste("  mailto:info@acme.co.uk  ").contacts).toEqual([{ name: "info@acme.co.uk", job_title: null, email: "info@acme.co.uk" }]);
  });

  it("reports non-empty lines without an email by line number and skips blank lines", () => {
    expect(planContactPaste("Jane, jane@a.co\n\nDarren Wain, Sales\n  \nx@y.co")).toEqual({
      contacts: [
        { name: "Jane", job_title: null, email: "jane@a.co" },
        { name: "x@y.co", job_title: null, email: "x@y.co" },
      ],
      missingEmail: [3],
    });
  });
});

describe("mergePastedContacts", () => {
  const blank = () => ({ name: "", job_title: "" as string | null, email: "", sort_order: 0 });
  const person = (n: string) => ({ name: n, job_title: null, email: `${n}@a.co` });

  it("drops still-empty rows, keeps filled ones, and appends the pasted people", () => {
    const form = [{ ...blank(), name: "Kept", email: "kept@a.co" }, blank()];
    const result = mergePastedContacts(form, [person("x"), person("y")], 5, blank);
    expect(result.form.map((p) => p.name)).toEqual(["Kept", "x", "y"]);
    expect(result).toMatchObject({ added: 2, notAdded: 0, duplicates: 0 });
    expect(result.form[1]).toEqual({ name: "x", job_title: null, email: "x@a.co", sort_order: 0 });
  });

  it("adds only up to the limit and counts the rest", () => {
    const form = [1, 2, 3, 4].map((i) => ({ ...blank(), name: `p${i}`, email: `p${i}@a.co` }));
    const result = mergePastedContacts(form, [person("x"), person("y"), person("z")], 5, blank);
    expect(result.form.map((p) => p.name)).toEqual(["p1", "p2", "p3", "p4", "x"]);
    expect(result).toMatchObject({ added: 1, notAdded: 2 });
  });

  it("adds nothing to a full form", () => {
    const form = [1, 2, 3, 4, 5].map((i) => ({ ...blank(), name: `p${i}`, email: `p${i}@a.co` }));
    expect(mergePastedContacts(form, [person("x")], 5, blank)).toMatchObject({ added: 0, notAdded: 1 });
  });

  it("skips an email already in the form or repeated in the paste, in any case", () => {
    const form = [{ ...blank(), name: "Kept", email: "Kept@a.co" }];
    const result = mergePastedContacts(form, [person("kept"), person("x"), { name: "X again", job_title: null, email: "X@a.co" }], 5, blank);
    expect(result.form.map((p) => p.name)).toEqual(["Kept", "x"]);
    expect(result).toMatchObject({ added: 1, notAdded: 0, duplicates: 2 });
  });
});
