if (process.env.NODE_ENV === undefined || process.env.NODE_ENV === "production") {
  process.env.NODE_ENV = "test";
}
