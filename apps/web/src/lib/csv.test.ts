import { describe, expect, it } from "vitest";
import { CsvError, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("splits plain fields and rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("accepts LF, CRLF and a lone CR as row ends, and ignores one trailing line break", () => {
    expect(parseCsv("a\r\nb\rc\nd\n")).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("keeps commas, doubled quotes and line breaks inside quoted fields", () => {
    expect(parseCsv('"Smith, Jones & Co","say ""hi""","line 1\r\nline 2"\nx,y,z')).toEqual([
      ["Smith, Jones & Co", 'say "hi"', "line 1\r\nline 2"],
      ["x", "y", "z"],
    ]);
  });

  it("keeps empty fields, including a trailing one and a quoted empty one", () => {
    expect(parseCsv('a,,c,\n"",b')).toEqual([
      ["a", "", "c", ""],
      ["", "b"],
    ]);
  });

  it("keeps a last row that holds only a quoted empty value", () => {
    expect(parseCsv('a\n""')).toEqual([["a"], [""]]);
  });

  it("treats a quote inside an unquoted field as text", () => {
    expect(parseCsv('5" pipe,x')).toEqual([['5" pipe', "x"]]);
  });

  it("drops the byte order mark Excel puts at the start", () => {
    expect(parseCsv("\uFEFFBusiness name\nAcme")).toEqual([["Business name"], ["Acme"]]);
  });

  it("returns no rows for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("refuses a file that ends inside a quoted value", () => {
    expect(() => parseCsv('a,"unclosed\nb')).toThrow(CsvError);
    expect(() => parseCsv('a,"unclosed\nb')).toThrow(/closing quote/);
  });
});
