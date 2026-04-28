export const trimTrailingBlankLogLines = (value: string) =>
  value.replace(/(?:\r?\n[ \t]*)+$/, "");
