import { describe, expect, test } from "bun:test";
import { joinPath, matchingFolders, splitTypedPath, typedFolder } from "./path-entry";

describe("splitTypedPath", () => {
  test("splits an absolute path at its last slash", () => {
    expect(splitTypedPath("/Users/me/re", "/x")).toEqual({
      dir: "/Users/me",
      fragment: "re",
    });
    expect(splitTypedPath("/Users/me/", "/x")).toEqual({
      dir: "/Users/me",
      fragment: "",
    });
  });

  test("a name directly under the root lists the root", () => {
    expect(splitTypedPath("/re", "/x")).toEqual({ dir: "/", fragment: "re" });
    expect(splitTypedPath("/", "/x")).toEqual({ dir: "/", fragment: "" });
  });

  test("~ stays as typed, for the host to expand", () => {
    expect(splitTypedPath("~", "/x")).toEqual({ dir: "~", fragment: "" });
    expect(splitTypedPath("~/", "/x")).toEqual({ dir: "~", fragment: "" });
    expect(splitTypedPath("~/re", "/x")).toEqual({ dir: "~", fragment: "re" });
    expect(splitTypedPath("~/a/re", "/x")).toEqual({ dir: "~/a", fragment: "re" });
  });

  test("text that is not a path from the root is read below the folder on show", () => {
    expect(splitTypedPath("re", "/repos")).toEqual({ dir: "/repos", fragment: "re" });
    expect(splitTypedPath("src/re", "/repos")).toEqual({ dir: "/repos/src", fragment: "re" });
    expect(splitTypedPath("re", "/")).toEqual({ dir: "/", fragment: "re" });
    expect(splitTypedPath("", "/repos")).toEqual({ dir: "/repos", fragment: "" });
  });
});

describe("typedFolder", () => {
  test("drops trailing slashes, but never the root itself", () => {
    expect(typedFolder("/a/b///", "/x")).toBe("/a/b");
    expect(typedFolder("/", "/x")).toBe("/");
    expect(typedFolder("~/", "/x")).toBe("~");
    expect(typedFolder("sub", "/repos")).toBe("/repos/sub");
    expect(typedFolder("", "/repos")).toBe("/repos");
  });
});

describe("matchingFolders", () => {
  test("keeps names that begin with the text, in any case, and everything for no text", () => {
    const names = ["Projects", "repos", "Reports", "tmp"];
    expect(matchingFolders(names, "re")).toEqual(["repos", "Reports"]);
    expect(matchingFolders(names, "")).toEqual(names);
    expect(matchingFolders(names, "x")).toEqual([]);
  });
});

describe("joinPath", () => {
  test("joins below the root without a double slash", () => {
    expect(joinPath("/", "a")).toBe("/a");
    expect(joinPath("/a", "b")).toBe("/a/b");
  });
});
