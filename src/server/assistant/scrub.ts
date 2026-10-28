// PII scrub (D118, SECURITY §8): before any customer text leaves the server for the model,
// WeChat-ID-like tokens, phone numbers, emails and street addresses become "***".
// Pure. Errs on the side of masking: a masked bread question still works, a leaked id does not.

const MASK = "***";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

// A WeChat (or similar) id after a keyword: masked whatever it looks like.
const KEYWORD_ID =
  /((?:微信号?|微信id|v信|加我|电话|手机号?|(?<![A-Za-z])(?:wechat(?:\s*id)?|weixin|wx|vx|phone|tel|mobile|qq)(?![A-Za-z]))\s*(?:号|id)?\s*(?:是|为|:|：|=)?\s*)([A-Za-z0-9_+\-.()\s]{3,30}[A-Za-z0-9_)])/giu;

// US-style street address: "123 N. University Ave Apt 4B", "1600 Pennsylvania Avenue".
const STREET_TYPES =
  "St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place|Pkwy|Parkway|Cir|Circle|Ter|Terrace|Hwy|Highway|Trl|Trail|Sq|Square";
const US_ADDRESS = new RegExp(
  String.raw`\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.'-]+\s+){0,4}(?:${STREET_TYPES})\b\.?` +
    String.raw`(?:\s*,?\s*(?:Apt|Apartment|Unit|Suite|Ste|Rm|#)\.?\s*[A-Za-z0-9-]+)?`,
  "gi",
);
const UNIT = /(?:\b(?:Apt|Apartment|Unit|Suite|Ste)\.?\s*|#)\s*\d+[A-Za-z]?\b/gi;
const ZIP = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g;

// Chinese address pieces: "大学路123号" → "大学路***", "5栋2单元301室" / "12号楼" / "5楼" → "***".
// Masking starts at the road keyword / the number, never earlier, so the words in front
// ("要3个红豆包送到…") survive. A road name alone is not a deliverable address.
const CN_ROAD_NUMBER =
  /(路|街|大道|大街|巷|弄|胡同)\s*\d+\s*号(?:\s*\d+\s*(?:号楼|栋|幢|单元|室|层|楼|号|座(?=\s*\d|楼)))*/gu;
const CN_BUILDING = /\d+\s*(?:号楼|栋|幢|单元|室|楼|座(?=\s*\d|楼))(?:\s*\d+\s*(?:号楼|栋|幢|单元|室|层|楼|号))*/gu;

// Full-width ASCII letters/digits and id punctuation (＠．＋－＿) → ASCII (NFKC on just these,
// so Chinese punctuation such as ，？ is left as typed).
const FULL_WIDTH = /[＋－．０-９＠-Ｚ＿ａ-ｚ]/g;

// Phone numbers: +86 / CN mobile, US (555) 123-4567, any longer digit run.
const PHONE =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b|(?<!\d)1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)|(?<!\d)\d{9,}(?!\d)/g;

// WeChat ids: 6–20 chars, start with a letter, letters/digits/_/-; we only mask tokens that
// also contain a digit, "_" or "-" (so plain English words survive).
const WECHAT_LIKE = /(?<![A-Za-z0-9_-])[A-Za-z][A-Za-z0-9_-]{5,19}(?![A-Za-z0-9_-])/g;
function wechatLike(token: string): boolean {
  return /[0-9_-]/.test(token);
}

export function scrubPii(text: string): string {
  let s = text.replace(FULL_WIDTH, (c) => c.normalize("NFKC"));
  s = s.replace(EMAIL, MASK);
  s = s.replace(KEYWORD_ID, (_m, lead: string) => `${lead}${MASK}`);
  s = s.replace(US_ADDRESS, MASK);
  s = s.replace(ZIP, MASK);
  s = s.replace(UNIT, MASK);
  s = s.replace(CN_ROAD_NUMBER, (_m, road: string) => `${road}${MASK}`);
  s = s.replace(CN_BUILDING, MASK);
  s = s.replace(PHONE, MASK);
  s = s.replace(WECHAT_LIKE, (m) => (wechatLike(m) ? MASK : m));
  // Collapse runs like "*** ***" left by overlapping patterns.
  return s.replace(/\*{3}(?:[\s,，]*\*{3})+/g, MASK);
}
