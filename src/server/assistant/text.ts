// Output hygiene for model text (C3): plain text only, length-capped. Pure.

/** First `max` Unicode code points of `s`. */
export function capCodePoints(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("");
}

/**
 * Strips HTML tags, Markdown markup, links/URLs, control and invisible characters, then
 * trims and caps the result at `max` code points. The UI renders it as plain text anyway;
 * this keeps an injected link or formatting out of the reply.
 */
export function plainText(raw: string, max: number): string {
  let s = raw;
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "");
  s = s.replace(/```[a-z]*\n?/gi, "");
  s = s.replace(/[`*_~]{1,3}/g, "");
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  s = s.replace(/^\s*[-+]\s+/gm, "· ");
  // Control chars except \n, zero-width and bidi marks.
  s = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/g, "");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return capCodePoints(s, max).trim();
}
