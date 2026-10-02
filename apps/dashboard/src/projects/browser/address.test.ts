import { describe, expect, test } from "bun:test";
import { displayAddress, pageLabel, resolveAddress, SEARCH_URL } from "./address";

const search = (text: string) => `${SEARCH_URL}${encodeURIComponent(text)}`;

describe("resolveAddress", () => {
  test("loads a web address as it stands", () => {
    expect(resolveAddress("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c");
    expect(resolveAddress("  http://localhost:3000/  ")).toBe("http://localhost:3000/");
    expect(resolveAddress("HTTPS://Example.com")).toBe("https://example.com/");
  });

  test("gives a bare public host https", () => {
    expect(resolveAddress("example.com")).toBe("https://example.com/");
    expect(resolveAddress("docs.bun.sh/docs/api")).toBe("https://docs.bun.sh/docs/api");
    expect(resolveAddress("github.com/get-aop/aop/pull/46")).toBe(
      "https://github.com/get-aop/aop/pull/46",
    );
  });

  test("gives local and private hosts http, since a dev server rarely has a certificate", () => {
    expect(resolveAddress("localhost")).toBe("http://localhost/");
    expect(resolveAddress("localhost:5173")).toBe("http://localhost:5173/");
    expect(resolveAddress("localhost:5173/projects/p1")).toBe("http://localhost:5173/projects/p1");
    expect(resolveAddress("my-app.localhost:3000")).toBe("http://my-app.localhost:3000/");
    expect(resolveAddress("127.0.0.1:25150")).toBe("http://127.0.0.1:25150/");
    expect(resolveAddress("192.168.1.20:8080")).toBe("http://192.168.1.20:8080/");
    expect(resolveAddress("10.0.0.5")).toBe("http://10.0.0.5/");
    expect(resolveAddress("172.20.1.1")).toBe("http://172.20.1.1/");
    expect(resolveAddress("100.101.102.103")).toBe("http://100.101.102.103/");
    expect(resolveAddress("printer.local")).toBe("http://printer.local/");
    expect(resolveAddress("[::1]:8080")).toBe("http://[::1]:8080/");
  });

  test("gives a public IP https", () => {
    expect(resolveAddress("8.8.8.8")).toBe("https://8.8.8.8/");
  });

  test("searches for words, single words and anything that is not a host", () => {
    for (const text of [
      "how to center a div",
      "bun",
      "react",
      "localhost is down",
      "999.1.1.1",
      "a.b",
      "user@example.com",
      "example.com:abc",
      "-bad.example.com",
    ]) {
      expect(resolveAddress(text)).toBe(search(text));
    }
  });

  test("never loads another scheme: it is searched for", () => {
    for (const text of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "mailto:a@b.c",
      "app://aop/",
    ]) {
      expect(resolveAddress(text)).toBe(search(text));
    }
  });

  test("loads nothing for nothing, and about:blank as itself", () => {
    expect(resolveAddress("")).toBeNull();
    expect(resolveAddress("   ")).toBeNull();
    expect(resolveAddress("about:blank")).toBe("about:blank");
  });
});

describe("what the browser shows of a page", () => {
  test("the address bar is empty for a blank page", () => {
    expect(displayAddress(null)).toBe("");
    expect(displayAddress("about:blank")).toBe("");
    expect(displayAddress("https://example.com/")).toBe("https://example.com/");
  });

  test("a tab is its title, else its host, else New tab", () => {
    expect(pageLabel("https://example.com/x", " Example ")).toBe("Example");
    expect(pageLabel("http://localhost:5173/a", "")).toBe("localhost:5173");
    expect(pageLabel(null)).toBe("New tab");
    expect(pageLabel("about:blank")).toBe("New tab");
  });
});
