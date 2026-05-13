// ---------------------------------------------------------------------------
// formatters.ts
// Shared text formatters for the parcel detail view AND the server-side
// share-card path. Pure TypeScript, no React or DOM dependencies, no
// Node-only imports — safe to call from React components, Vercel
// serverless handlers, and the Edge runtime alike.
//
// Scope:
//   1. formatStreetAddress — Title Case + end-of-token street-suffix
//      abbreviations. Applied to displayed street addresses everywhere
//      EXCEPT curated friendly-name overrides from venueAliases.
//   2. formatBorough — Title Case for a single borough token.
//   3. cleanJobDescription — strips the "PLEASE ASSIGN TO HUB CDU…"
//      DOB internal routing prefix, then sentence-cases descriptions
//      that arrived in ALL CAPS while preserving short ALL-CAPS tokens
//      as acronyms and lowercasing common English short words via a
//      stoplist.
//   4. resolveWorkPermitSuffix — maps a work_permit code's trailing
//      2-3 char suffix to a plain-English label, resolving compound
//      suffixes against work_type. Drives the info-icon tooltip in
//      the expanded permit card.
//
// All functions are pure and idempotent for already-clean inputs.
//
// History:
//   May 12-13 2026 — initial sprint (items 1-4).
//   May 14    2026 — follow-up: stoplist added to cleanJobDescription;
//                    module made callable from api/render-parcel.ts and
//                    api/og/[bbl].tsx so share cards and tab titles
//                    render the same Title Case + suffix treatment as
//                    the in-app H1.
// ---------------------------------------------------------------------------

// ---- Title Case ------------------------------------------------------------

/**
 * Title-case `s`: capitalize the first alphabetic character that follows a
 * word separator (whitespace, hyphen, or slash) or the start of the string,
 * and lowercase everything else.
 *
 * Why separator-based and not \b-based: ordinal markers like "23rd" sit at
 * a \b boundary (digit→letter) and a naive Title Case would render them
 * "23Rd". Restricting capitalization to whitespace/hyphen/slash separators
 * keeps ordinals intact while still handling "park slope-gowanus" →
 * "Park Slope-Gowanus" correctly.
 *
 * Examples:
 *   "BROOKLYN"             → "Brooklyn"
 *   "112 WHITE STREET"     → "112 White Street"
 *   "East Williamsburg"    → "East Williamsburg"
 *   "PARK SLOPE-GOWANUS"   → "Park Slope-Gowanus"
 *   "112 EAST 23RD STREET" → "112 East 23rd Street"
 */
export function toTitleCase(s: string): string {
  if (!s) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/])([a-z])/g, (_match, sep: string, letter: string) =>
      sep + letter.toUpperCase(),
    );
}

// ---- Street suffix abbreviations -------------------------------------------

/**
 * End-of-token street name component abbreviations.
 * Each entry maps the lower-cased full token to its abbreviated form. The
 * abbreviation pass runs AFTER Title Case, so abbreviations are written in
 * their final cased form.
 */
const STREET_SUFFIX_MAP: Readonly<Record<string, string>> = {
  street: 'St',
  avenue: 'Ave',
  boulevard: 'Blvd',
  place: 'Pl',
  road: 'Rd',
  drive: 'Dr',
  court: 'Ct',
  lane: 'Ln',
  square: 'Sq',
  parkway: 'Pkwy',
  highway: 'Hwy',
  terrace: 'Ter',
  saint: 'St',
};

/**
 * Apply street-suffix abbreviations to any standalone token in `s` that
 * matches the map. "End-of-token" means whitespace-delimited; substrings of
 * larger words (e.g. "Streetside") are untouched.
 *
 * The Saint↔St edge case from the brief: a street literally named "Saint
 * Marks Avenue" becomes "St Marks Ave" because both "Saint" and "Avenue"
 * are standalone tokens that match the map.
 */
export function applyStreetSuffixes(s: string): string {
  if (!s) return s;
  return s
    .split(/(\s+)/) // keep whitespace as separate array items
    .map((tok) => {
      const lower = tok.toLowerCase();
      return STREET_SUFFIX_MAP[lower] ?? tok;
    })
    .join('');
}

/**
 * Render a street address for display: Title Case + abbreviated suffixes.
 *
 * Examples:
 *   "112 WHITE STREET"      → "112 White St"
 *   "595 Dean Street"       → "595 Dean St"
 *   "104 CARLTON AVENUE"    → "104 Carlton Ave"
 *   "SAINT MARKS AVENUE"    → "St Marks Ave"
 */
export function formatStreetAddress(s: string): string {
  return applyStreetSuffixes(toTitleCase(s));
}

/**
 * Render a borough name for display: Title Case.
 *
 * Examples:
 *   "BROOKLYN"  → "Brooklyn"
 *   "Brooklyn"  → "Brooklyn"
 *   "MANHATTAN" → "Manhattan"
 */
export function formatBorough(s: string): string {
  return toTitleCase(s);
}

// ---- Job description cleanup ----------------------------------------------

/**
 * Matches the DOB internal routing prefix that occasionally leads filer
 * descriptions. The example pattern from Brooklyn Mirage:
 *   "PLEASE ASSIGN TO HUB CDU PER CONSULTATION ON 2/18/26."
 * Per the brief, minor variations on the date and trailing whitespace are
 * anticipated, so the regex consumes any non-period characters after the
 * "HUB CDU" anchor up to (and including) the next period.
 */
const HUB_CDU_PREFIX = /^PLEASE\s+ASSIGN\s+TO\s+HUB\s+CDU[^.]*\.\s*/i;

/**
 * Common English short words that the 2-4 char ALL-CAPS preservation rule
 * would otherwise leave uppercase. These get lowercased during the ALL-CAPS
 * → sentence-case conversion, after the preservation pass, so descriptions
 * read smoothly instead of jagged. Genuine 2-4 char acronyms (NYC, DOB, AV,
 * GPS, RRH, MEP, HVAC, USB, LED) are not on this list and remain uppercase.
 *
 * Match is exact, case-insensitive at the lookup point (we upper-case the
 * input token before consulting the set).
 */
const SHORT_WORD_STOPLIST: ReadonlySet<string> = new Set([
  // 1-letter
  'A',
  // 2-letter
  'AN', 'AS', 'AT', 'BY', 'IN', 'NO', 'OF', 'ON', 'OR', 'TO',
  // 3-letter
  'AND', 'FOR', 'JOB', 'NEW', 'PER', 'THE', 'USE',
  // 4-letter
  'CODE', 'DUTY', 'FEET', 'FROM', 'INTO', 'LBS',
  'LIVE', 'LOAD', 'OVER', 'ROOF', 'SHED', 'THIS',
  'WITH', 'WORK',
  // 5-letter
  'UNDER',
]);

/**
 * Apply the two mechanical transformations the brief calls for to a raw
 * `job_description` string:
 *
 *   1. Strip the DOB "PLEASE ASSIGN TO HUB CDU…" routing prefix if present.
 *   2. If the remaining text contains NO lowercase letter (i.e. the filer
 *      wrote in ALL CAPS), convert to sentence case. Per-token rules:
 *        a. If the token is in SHORT_WORD_STOPLIST → lowercase it.
 *        b. Else if the token is 2-4 chars all caps → preserve uppercase
 *           (likely acronym).
 *        c. Else → lowercase.
 *   3. Capitalize the first alphabetic character of the string and of each
 *      subsequent sentence (after . ! or ?). Runs last so a stoplist word
 *      landing at a sentence start (e.g. "Of the three…") still ends up
 *      properly capitalized.
 *
 * If any lowercase letter is present in the post-strip text, step 2 is
 * skipped — already-clean descriptions pass through with only the prefix
 * strip + step 3 applied.
 *
 * Known limitation: 5+ char proper-noun acronyms not in the implicit
 * preserve set (e.g. "VERIZON") get lowercased. If that surfaces as a
 * problem in launch content, add an explicit acronym extend-list rather
 * than weakening the conversion rule.
 */
export function cleanJobDescription(input: string): string {
  if (!input) return input;

  // 1. Strip the DOB routing prefix.
  let result = input.replace(HUB_CDU_PREFIX, '');

  // 2. ALL CAPS → mixed-case conversion. Only runs when no lowercase letter
  //    is present (i.e. the filer wrote in shouting caps); mixed-case source
  //    is treated as already-clean and the conversion is skipped.
  if (!/[a-z]/.test(result)) {
    result = result.replace(/\b[A-Z]+\b/g, (match) => {
      if (SHORT_WORD_STOPLIST.has(match)) return match.toLowerCase();
      if (match.length >= 2 && match.length <= 4) return match;
      return match.toLowerCase();
    });
  }

  // 3. Always capitalize the first alphabetic character of the string and
  //    of each subsequent sentence (after . ! or ?). Turns a stoplist word
  //    at sentence-start back into a capital ("Of the three…") and handles
  //    the "phase 2" → "Phase 2" case for already-clean descriptions.
  result = result.replace(
    /(^|[.!?]\s+)([a-z])/g,
    (_, prefix: string, letter: string) => prefix + letter.toUpperCase(),
  );

  return result;
}

// ---- Work-permit suffix glossary -------------------------------------------

/**
 * Plain-English labels for the DOB work_permit trailing suffix codes.
 * These are the 9 suffixes confirmed by the May 2026 audit; -CX and -EW
 * are deliberately omitted so the UI shows no info icon for unresolved
 * codes (silence is better than admitting the gap).
 */
const WORK_PERMIT_SUFFIX_GLOSSARY: Readonly<Record<string, string>> = {
  ST: 'Structural',
  GC: 'General Construction',
  PMM: 'Protection and Mechanical Methods',
  FN: 'Construction Fence',
  PL: 'Plumbing',
  AN: 'Antenna',
  SH: 'Sidewalk Shed',
  SP: 'Sprinklers',
  MS: 'Mechanical Systems',
};

export interface WorkPermitSuffixResolution {
  /** The matched suffix code, e.g. "PMM". */
  suffix: string;
  /** The plain-English label, e.g. "Protection and Mechanical Methods". */
  label: string;
}

/**
 * Parse the suffix codes from a DOB work_permit identifier (everything
 * after the first two dash-separated segments) and resolve them against
 * the glossary.
 *
 * Resolution strategy:
 *   - Single resolvable suffix → return it.
 *   - Compound suffix (e.g. "GC-CX", "EW-SP") → if multiple codes in the
 *     suffix are in the glossary, prefer the one whose label matches the
 *     row's `workType`; otherwise return the first glossary hit.
 *   - No resolvable suffix → return null. The caller should suppress the
 *     info icon in that case.
 *
 * Examples:
 *   ("B01345542-I1-PMM",     "Protection and Mechanical Methods") → PMM
 *   ("B01106091-S1-GC-CX",   "General Construction")              → GC
 *   ("B12345678-S1-EW-SP",   "Sprinklers")                        → SP
 *   ("B99999999-S1-CX",      "Curb Cut")                          → null
 *   ("B99999999-S1-EW",      "Earthwork")                         → null
 */
export function resolveWorkPermitSuffix(
  workPermit: string,
  workType: string,
): WorkPermitSuffixResolution | null {
  if (!workPermit) return null;

  const parts = workPermit.split('-');
  if (parts.length < 3) return null;

  const candidates = parts
    .slice(2)
    .map((p) => p.trim().toUpperCase())
    .filter((p) => p in WORK_PERMIT_SUFFIX_GLOSSARY)
    .map<WorkPermitSuffixResolution>((suffix) => ({
      suffix,
      label: WORK_PERMIT_SUFFIX_GLOSSARY[suffix],
    }));

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Compound — disambiguate against work_type.
  const wt = (workType || '').toLowerCase().trim();
  const byWorkType = candidates.find((c) => c.label.toLowerCase() === wt);
  return byWorkType ?? candidates[0];
}

/**
 * Tooltip copy for a resolved suffix. Matches the brief's exact pattern.
 */
export function formatSuffixTooltip(r: WorkPermitSuffixResolution): string {
  return `The "-${r.suffix}" suffix indicates a ${r.label} permit.`;
}
