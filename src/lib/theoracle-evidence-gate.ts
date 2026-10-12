import type { MiraTherapy } from "./mira/contract";
import { validTheOracleGrounding, type TheOracleGroundingBundle } from "./theoracle-grounding-types";
import { referenceIncludes, theOracleDiseases } from "./theoracle";

export type GateStatus = "verified" | "doseRemoved" | "removed";
// `dose` (and `drug`) are the raw model strings, kept for audit only; never display them.
export interface GateDrug { drug: string; dose: string; status: GateStatus; evidenceIds: string[] }
export interface EvidenceGateReport { forDiagnosis: { icd10: string; label: string }; therapyRemoved: boolean; reason: string; drugs: GateDrug[] }

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const GATE_STATUSES: readonly unknown[] = ["verified", "doseRemoved", "removed"];
export function validGate(value: unknown): value is EvidenceGateReport {
  return isRecord(value) && isRecord(value.forDiagnosis) && typeof value.forDiagnosis.icd10 === "string" && typeof value.forDiagnosis.label === "string" && typeof value.therapyRemoved === "boolean" && typeof value.reason === "string" && Array.isArray(value.drugs)
    && value.drugs.every(d => isRecord(d) && typeof d.drug === "string" && typeof d.dose === "string" && GATE_STATUSES.includes(d.status) && Array.isArray(d.evidenceIds) && d.evidenceIds.every(id => typeof id === "string"));
}

const UNVERIFIED = " (belum terverifikasi)";
const UNITS = { mg: "(?:mg|miligram)", mcg: "(?:mcg|µg|μg|ug|mikrogram)", g: "(?:g|gram)", iu: "(?:iu|ui|units?|u)", ml: "(?:ml|mililiter)", meq: "(?:meq)", mmol: "(?:mmol)", tetes: "(?:tetes|gtt)", semprotan: "(?:semprotan|semprot|spray)", puff: "(?:puff)", tablet: "(?:tablets?|tabs?|kaplets?)", kapsul: "(?:kapsul|kaps|capsules?)", "%": "%" };
// Drop, spray, puff, tablet and capsule counts are doses too: "1-2 semprotan" or "2 tablet" must appear in the passage like "500 mg".
// So are percent concentrations ("krim 5%") and a bare U, read as IU ("10 U" matches "10 IU" or "10 unit").
const UNIT: Record<string, string> = { ...UNITS, gtt: UNITS.tetes, semprot: UNITS.semprotan, spray: UNITS.semprotan, "µg": UNITS.mcg, "μg": UNITS.mcg, ug: UNITS.mcg, mikrogram: UNITS.mcg, miligram: UNITS.mg, gram: UNITS.g, ui: UNITS.iu, unit: UNITS.iu, units: UNITS.iu, u: UNITS.iu, mililiter: UNITS.ml, tablets: UNITS.tablet, tab: UNITS.tablet, tabs: UNITS.tablet, kaplet: UNITS.tablet, kaplets: UNITS.tablet, kaps: UNITS.kapsul, capsule: UNITS.kapsul, capsules: UNITS.kapsul };
// 1.200.000 and 1,200,000 are one number (thousands separators); "2,4 juta IU" keeps its multiplier.
const NUMBER = String.raw`(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:\s*(?:juta|ribu|million))?`;
// Range separators: hyphen and its Unicode forms (U+2010-2014), the minus sign U+2212 that FORNAS uses ("4−8 mL"),
// "~", "s/d", "sampai" and "hingga". Both ends are checked whichever is used: "250—500 mg" is not verified by "500 mg".
const DASH = "\\-‐‑‒–—−~";
const RANGE = String.raw`\s*(?:[${DASH}]|s\.?\/d\.?|s\.d\.?|sampai|hingga)\s*`;
// A strength, or a pair such as 5-40 mg (range) or 875/125 mg (combination) whose numbers share one unit.
const STRENGTH = new RegExp(String.raw`(?:(${NUMBER})(?:${RANGE}|\s*\/\s*))?(${NUMBER})\s*(tablets?|tabs?|kaplets?|kapsul|kaps|capsules?|mikrogram|miligram|mililiter|semprotan|semprot|spray|puff|tetes|gtt|gram|units?|mmol|meq|mcg|µg|μg|ug|mg|ui|iu|ml|g|u|%)(?:(?<=%)|\b)`, "gi");
// Per-unit tails such as "/5 ml", "/kg/24 jam" or "/m2"; a drug name after a slash is not one of them.
const PER = String.raw`(?:\s*(?:\/|\bper\b)\s*(?:\d[\d.,]*\s*)?(?:(?:ml|dl|l|vial|ampul|amp|tablet|tab|kapsul|kaps|kg\s*bb|kgbb|kilogram|kg|m2|hari|dosis|kali|jam|menit|mnt|detik)\b|m²))*(?:\s*(?:bb|berat\s*badan)\b)?`;
const SAFETY_TERM = /kontraindikasi|interaksi|hindari|jangan diberikan/;
// Two or more tablets per dose ("3 x 2 tablet", "2 tablet, 3 kali", "3 kali sehari 2 tablet", "2 kapsul sekaligus"): a strength just before it is tablet content, not a dose.
const TABLETS = String.raw`(?:1${RANGE})?[2-9]\s*(?:tablet|tab|kapsul|kaps|kaplet)s?\b`;
const UNITS_PER_DOSE = new RegExp(String.raw`\d+\s*[x×]\s*${TABLETS}|(?:^|[^\d.,/])${TABLETS}[\s,;]*(?:\d+\s*(?:[x×]|kali)|sekaligus|sekali|per\s*kali|tiap\s*kali)|\d+\s*kali\s*sehari[\s,;]*${TABLETS}`, "i");
// A passage doses with a strength when one of its occurrences is not followed, within 80 characters, by a multi-tablet dose;
// a tablet or capsule count is itself the dose.
const COUNTED = /(?:tablets?|tabs?|kaplets?|kapsul|kaps|capsules?)$/i;
// Only a strength inside [from, to) counts; the tablet check still reads on past `to` ("Diosmin 450 mg + Hesperidin 50 mg 3 x 2 tablet").
// A range counts only as the drug's own first strength: "parasetamol 500 mg; ibuprofen 200-400 mg" does not dose parasetamol 300 mg.
const FIRST_STRENGTH = new RegExp(STRENGTH.source, "i");
// A daily total ("1 mg/hari", "0,5-1,5 mg per hari", "1 mg sehari", "/kgBB/24 jam", "dibagi dalam 3 dosis", "dosis harian 1 mg",
// "sehari 1 mg") is not the amount of each of several doses (`several`, as in 3x1mg or 1mg 3 kali sehari), unless the source
// writes a frequency of 2 or more before it ("3 x 500 mg/hari", "3 x 2-3 tetes sehari"). "500 mg sehari 3 kali", "3 kali
// sehari 500 mg" and "500 mg/8 jam" are per dose.
const FREQUENCY_BEFORE = new RegExp(String.raw`(?<![\d.,])(?:[2-9]|[1-9]\d+)\s*(?:[x×]|kali)\s*(?:sehari\s*)?(?:${NUMBER}${RANGE})?$`, "i");
const DAILY = (text: string, from: number, at: number, end: number) => {
  const tail = text.slice(end).match(new RegExp(`^${PER}`, "i"))![0];
  const before = text.slice(Math.max(from, at - 30), at);
  return /hari|24\s*jam/i.test(tail) || /^\s*(?:(?:sehari|per\s*hari)(?!\s*\d+\s*(?:[x×]|kali))|,?\s*(?:dibagi|terbagi))/i.test(text.slice(end + tail.length))
    || (/(?:sehari|harian|per\s*hari)\s*:?\s*$/i.test(before) && !/\d\s*(?:[x×]|kali)\s*sehari\s*:?\s*$/i.test(before));
};
const doses = (pattern: RegExp, text: string, from = 0, to = text.length, several = false) => [...text.matchAll(new RegExp(pattern.source, "gi"))]
  .some(m => m.index >= from && m.index + m[0].length <= to && (m[1] === undefined || (inRange(pattern, m) && !FIRST_STRENGTH.test(text.slice(from, m.index))))
    && !(several && DAILY(text, from, m.index, m.index + m[0].length) && !FREQUENCY_BEFORE.test(text.slice(from, m.index)))
    && (COUNTED.test(m[0]) || !UNITS_PER_DOSE.test(text.slice(m.index + m[0].length, m.index + m[0].length + 80))));
// A single dose strength may also match a source range of the same unit and per-kg form ("6 mg" in "3 x 6-12 mg"); `inside`
// holds its value for that pattern, and the range must contain it. Only the dose gets such a pattern, never a safety threshold.
const inside = new WeakMap<RegExp, number>();
const scaleOf = (value: string) => /(?:juta|million)$/.test(value) ? 1e6 : /ribu$/.test(value) ? 1e3 : 1;
// Thousands separators only after a leading 1-9 ("1.200.000"); "0,125" is a decimal. Anything else unreadable is NaN and fails.
const amount = (value: string, scale = scaleOf(value)) => {
  const digits = value.replace(/\s*(?:juta|ribu|million)$/, "");
  return scale * Number(/^[1-9]\d{0,2}(?:[.,]\d{3})+$/.test(digits) ? digits.replace(/[.,]/g, "") : digits.replace(",", "."));
};
// A multiplier written once covers both ends ("1,2-2,4 juta IU"); a lower end with its own, different multiplier does not count.
const inRange = (pattern: RegExp, m: RegExpMatchArray) => {
  const value = inside.get(pattern);
  const high = scaleOf(m[2]), low = scaleOf(m[1]);
  if (value === undefined || (low !== 1 && low !== high)) return false;
  const [lo, hi] = [amount(m[1], high), amount(m[2], high)];
  return lo <= hi && lo <= value && value <= hi;
};

// English and Indonesian spellings of generic names converge: amoxicillin and amoksisilin -> amoksisilin,
// chlorpheniramine and klorfeniramin -> klorfeniramin.
function spell(word: string): string {
  return word.replace(/ph/g, "f").replace(/th/g, "t").replace(/ch/g, "k").replace(/x/g, "ks").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/y/g, "i").replace(/(.)\1+/g, "$1").replace(/(.{4,})e$/, "$1");
}
const tokens = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z]+/).filter(Boolean).map(spell);
const names = (drug: string) => tokens(drug).filter(word => word.length >= 4);
const mentions = (passage: string[], drug: string) => { const wanted = names(drug); return wanted.length > 0 && wanted.every(word => passage.includes(word)); };
// A strength belongs to the drug it follows: the 200 characters after each mention of the drug's last name word ("dinitrat",
// not "isosorbid"), cut at the next lettered item ("b." or "B.", not the unit of "2 g.") or bullet. So "a. zidovudin 300 mg
// b. lamivudin 150 mg" does not dose lamivudin 300 mg, while FORNAS forms ("1. tab 5 mg"), a dewasa; anak split and a
// combination's shared count ("450 mg + Hesperidin 50 mg 3 x 2 tablet") stay.
const OWN_END = /(?:^|(?<!\d)\s)[A-Za-z][.)]\s|[•]|\n\s*-/;
// It also ends at a cut point (";", ",", newline, sentence end, "+", or a "/" right after a unit as in "300 mg/lamivudin") when a
// word between it and the next strength is not a population, phase, form, route, timing or function word or one of the drug's
// own name words. An unknown word cuts (fails safe): "dewasa 500 mg; anak 250 mg", "500 mg + asam klavulanat 125 mg" and "dapat
// dinaikkan sampai 40 mg" stay one window; "; natrium bikarbonat 25 mg", ", dilanjutkan sefiksim 200 mg", "+ lamivudin 300 mg"
// and ", INH 300 mg" do not. The text right after the name is not checked, since a FORNAS restriction precedes the form, so two
// names with no cut point between them ("Karbogliserin / Gliserin 10% ... 3 x 2-3 tetes") share one window. The window also ends
// at the drug's next mention: "isosorbid mononitrat 20 mg dan isosorbid dinitrat 5 mg".
const ALLOWED = new Set(["anak", "dewasa", "lansia", "bayi", "neonatus", "remaja", "pediatrik", "wanita", "pria", "dosis", "maks", "maksimal", "maksimum", "awal", "kemudian", "lalu", "dilanjutkan", "selanjutnya", "pemeliharaan", "rumatan", "diberikan", "pemberian", "sebanyak", "setiap", "tiap", "selama", "sekali", "kali", "sehari", "harian", "hari", "minggu", "bulan", "tahun", "jam", "menit", "pagi", "siang", "sore", "malam", "sebelum", "sesudah", "setelah", "makan", "tidur", "mulai", "diulang", "dibagi", "terbagi", "dinaikkan", "ditingkatkan", "diturunkan", "dititrasi", "dapat", "bisa", "bila", "jika", "apabila", "perlu", "untuk", "pada", "bagi", "dengan", "dalam", "dan", "atau", "yang", "per", "sampai", "hingga", "sd", "ke", "di", "berat", "badan", "usia", "umur", "bb", "kgbb", "kg", "mg", "mcg", "ml", "iu", "unit", "gram", "juta", "ribu", "mmol", "tablet", "tab", "kapsul", "kaps", "kaplet", "sirup", "suspensi", "drop", "tetes", "injeksi", "inj", "infus", "salep", "krim", "gel", "larutan", "serbuk", "granul", "granula", "supositoria", "ampul", "vial", "oral", "intravena", "intramuskular", "subkutan", "rektal", "topikal", "inhalasi", "iv", "im", "sc", "po", "ih", "sl", "tunggal", "asam", "natrium", "kalium", "x",
  // FORNAS form abbreviations ("1. tts mata 0,25%", "1. tab sal selaput 5 mg", "2. cairan ih 0,25 mg/mL")
  "tts", "mata", "telinga", "hidung", "sal", "salut", "selaput", "enterik", "serb", "cairan", "sir", "susp", "supp", "lar", "aerosol", "nebul", "film", "lepas", "lambat", "kunyah", "dispersibel", "btl", "tbg"].map(spell));
const CUT = /;|,(?!\d)|\n|(?<!\d)\.\s|\+|(?<=\d\s*(?:mg|mcg|g|ml|iu|%))\s*\/(?!\s*(?:\d|kg|hari|ml|m2|dosis|kali|jam|menit|mnt|tab|kaps|vial|amp|dl\b|l\b))/gi;
// A combination partner after "+" is masked rather than ending the window, so the product's shared count still reads:
// "Diosmin 450 mg + Hesperidin 50 mg) 3 x 2 tablet" doses diosmin 3 x 2 tablet, never 50 mg.
const ownEnd = (rest: string, own: string[]) => {
  const again = [...rest.matchAll(/\p{L}+/gu)].find(m => tokens(m[0]).includes(own[0]))?.index ?? -1;
  const masks: [number, number][] = [];
  let end = Math.min(...[rest.search(OWN_END), again].filter(i => i >= 0), rest.length);
  for (const m of rest.matchAll(CUT)) {
    if (m.index >= end) break;
    if (masks.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const after = rest.slice(m.index + m[0].length);
    const strength = after.match(FIRST_STRENGTH);
    if (!strength || !tokens(after.slice(0, strength.index)).some(word => word.length >= 2 && !ALLOWED.has(word) && !own.includes(word))) continue;
    if (m[0] !== "+") { end = m.index; break; }
    masks.push([m.index, m.index + m[0].length + strength.index! + strength[0].length]);
  }
  return { end, masks };
};
// The window opens after the drug's first name word, and only where the clause also holds its other name words, before or after
// it: "natrium diklofenak 50 mg" and "amoksisilin 500 mg + asam klavulanat" dose; the "isosorbid" of "; isosorbid mononitrat"
// does not open a window for isosorbid dinitrat. The name is read without its strength ("Benzatin penisilin G 2,4 juta IU").
const owned = (text: string, drug: string) => {
  const [first, ...rest] = names(unstrength(drug));
  const own = [first, ...tokens(unstrength(drug))];
  return [...text.matchAll(/\p{L}+/gu)].filter(m => tokens(m[0]).includes(first)).flatMap(m => {
    const from = m.index + m[0].length;
    const { end, masks } = ownEnd(text.slice(from, from + 200), own);
    const to = from + end;
    const clause = tokens(text.slice(Math.max(0, m.index - 60), m.index).split(/[;,\n]|\.\s/).at(-1) + " " + text.slice(from, to));
    const masked = masks.reduce((t, [a, b]) => t.slice(0, from + a) + " ".repeat(b - a) + t.slice(from + b), text);
    return rest.every(word => clause.includes(word)) ? [{ from, to, text: masked }] : [];
  });
};
// Words that do not single out one disease: qualifiers, function words, and any word in three or more catalog names (demam, akut, jantung).
const catalogCounts = new Map<string, number>();
theOracleDiseases.forEach(d => new Set(tokens(d.nama)).forEach(word => catalogCounts.set(word, (catalogCounts.get(word) ?? 0) + 1)));
const GENERIC = new Set(["kronis", "infeksi", "tanpa", "dengan", "komplikasi", "lain", "lainnya", "pada", "anak", "dewasa", "umum", "tidak", "lokasi", "spesifik", "acute", "chronic", "disease", "infection", "syndrome", "disorder", "without", "complication", "unspecified", "specified", "other", "status", "type", "tipe", "primer", "sekunder", "adult", "child", "fever", "signs", "warning", "human", "virus", "organism", "origin", "site", "acquired", "upper", "lower", "tract", "essential", "primary", "secondary", "mild", "moderate", "severe", "recurrent", "bacterial", "viral", "elsewhere", "classified", "presumed", "nos", "nec"].map(spell));
// The distinctive words of the diagnosis label and of the TheOracle catalog names for its code.
// Short capitals such as HIV count too, but not Roman numerals (stage II) or the words of a label written all in capitals.
// ICD-10 2010 (the BPJS list) codes haemorrhoids I84; the catalog uses the later K64. Guidelines write ODHA (orang dengan HIV/AIDS) for HIV.
const CATALOG_CODE: Record<string, string> = { I84: "K64" };
const SYNONYMS: Record<string, string[]> = { hiv: ["odha"] };
const diagnosisWords = (diagnosis: { icd10: string; label: string }) => {
  const code = diagnosis.icd10.trim().toUpperCase();
  const codes = [code, ...(CATALOG_CODE[code.slice(0, 3)] ? [CATALOG_CODE[code.slice(0, 3)]] : [])];
  return new Set([diagnosis.label, ...theOracleDiseases.filter(d => codes.some(c => referenceIncludes(d.kode, c))).map(d => d.nama)]
    .flatMap(name => [...tokens(name).filter(word => word.length >= 4 && (catalogCounts.get(word) ?? 0) < 3), ...(name === name.toUpperCase() ? [] : (name.match(/\b[A-Z]{2,}\b/g) ?? []).filter(word => !/^[IVXL]+$/.test(word)).flatMap(tokens))])
    .filter(word => !GENERIC.has(word)).flatMap(word => [word, ...(SYNONYMS[word] ?? [])]));
};
const number = (value: string) => value.replace(/[.,]/g, "[.,]").replace(/\s+/g, "\\s*");
// Each number of a pair needs its own match: the first stands alone or opens the same pair.
// One tablet or capsule next to a strength such as 500 mg adds nothing to check: the 500 mg is the dose.
// Without `percent`, a percent is not a strength (a safety item's "eGFR turun >50%" is a threshold).
// Each strength is per kg or not on its own ("10 mg/kgBB, maks 500 mg"), and "per kg" reads like "/kg".
// Per kg may follow another per-unit tail ("10 mg/hari/kgBB") or the other end of a range ("10 mg - 15 mg/kgBB").
const PER_KG = String.raw`(?:${RANGE}${NUMBER}\s*[a-zµμ]+)?(?:\s*\/\s*(?:\d[\d.,]*\s*)?(?:hari|dosis|kali|jam|menit|mnt|detik)\b)*\s*(?:\/|per)\s*(?:kg|kilogram)`;
// With `within`, a single strength also matches a source range around it (see `inside`); a model range keeps both ends exact.
const strengths = (dose: string, percent = true, within = false) => {
  const text = dose.toLowerCase();
  const found = [...text.matchAll(STRENGTH)].filter(m => percent || m[3] !== "%");
  return found.filter(m => !(COUNTED.test(m[3]) && !m[1] && m[2] === "1" && found.some(o => !COUNTED.test(o[3])))).flatMap(m => {
    const tail = new RegExp(`^${PER_KG}`).test(text.slice(m.index + m[0].length)) ? `(?=${PER_KG})` : `(?!${PER_KG})`;
    const unit = `\\s*${UNIT[m[3]]}${m[3] === "%" ? "" : "\\b"}${tail}`;
    if (within && !m[1]) {
      const ranged = new RegExp(`(?<![\\d.,])(?:${number(m[2])}|(${NUMBER})${RANGE}(${NUMBER}))${unit}`, "i");
      inside.set(ranged, amount(m[2]));
      return [ranged];
    }
    return [...(m[1] ? [`${number(m[1])}(?:(?:${RANGE}|\\s*\\/\\s*)${number(m[2])})?`] : []), number(m[2])].map(value => new RegExp(`(?<![\\d.,])${value}${unit}`, "i"));
  });
};
// Clauses end at ";", a newline, a "," that is not a decimal mark ("0,9%" stays whole) or a "." that ends a sentence ("maks. 4 g" stays whole).
const CLAUSE = /((?:[;\n]|(?<!\d),|,(?!\d)|\.(?=\s*(?:[A-Z]|$)))\s*)/;
const CONDITION = /^(?:kecuali|bila|jika|apabila|hanya)\b/i;
const PARTIAL = " (sebagian belum terverifikasi)";
// Strips every strength with its per-unit tails; "Amoxicillin 500 mg/clavulanate 125 mg" -> "Amoxicillin/clavulanate".
// A frequency glued to a strength goes with it ("3x500 mg", "500mg x 3", "x 3 hari"), so does the D of "D5%", and a
// bracket left empty or holding only a limit word goes too ("Isoniazid (maks 300 mg)" -> "Isoniazid").
const GLUED = String.raw`(?:\d+\s*[x×]\s*|(?<![a-z])[x×]\s*(?=\d)|(?<![a-z])d(?=\d+(?:[.,]\d+)?\s*%))?`;
const FREQUENCY = String.raw`(?:\s*[x×]\s*\d+(?:\s*(?:hari|kali)\b|(?![\d.,]*\s*[a-zµμ%])))?`;
const STRIP = new RegExp(GLUED + STRENGTH.source + PER + FREQUENCY, "gi");
const tidy = (text: string) => text.replace(STRIP, "")
  .replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "").replace(/\s+/g, " ")
  .replace(/[([]\s*(?:(?:max|maks|maksimal|maximum|hingga|sampai|s\.?d\.?|s\/d)(?![a-z]))?[\s,;:./]*[)\]]/gi, "").replace(/\(\s+/g, "(").replace(/\s+([,;:)])/g, "$1").replace(/\s+-(?=\p{L})/gu, "-")
  .replace(/\s+/g, " ").replace(/^[\s,;:\-‐‑‒–—−~/]+|[\s,;:\-‐‑‒–—−~/]+$/g, "");
// Repeats until nothing changes: a removal can bring a leftover number next to a leftover unit ("3 (500 mg) kapsul"),
// and STRIP matches every strength, so the fixed point holds none.
export const unstrength = (text: string): string => { const next = tidy(text); return next === text ? text : unstrength(next); };

// The gate reads the therapy passages and then the diagnosis passages of the same case, each passage once: a dose the
// diagnosis retrieval found (tenofovir 300 mg for HIV) is evidence too, and both bundles are cited with the draft.
export function gateEvidence(therapyGrounding: unknown, grounding: unknown): TheOracleGroundingBundle | undefined {
  const tx = validTheOracleGrounding(therapyGrounding) ? therapyGrounding : undefined;
  const dx = validTheOracleGrounding(grounding) ? grounding : undefined;
  return tx && dx ? { ...tx, evidence: [...tx.evidence, ...dx.evidence.filter(e => !tx.evidence.some(t => t.evidenceId === e.evidenceId))] } : tx ?? dx;
}

export function gateTherapy(therapy: MiraTherapy, bundle: TheOracleGroundingBundle | undefined, diagnosis: { icd10: string; label: string } | undefined): { therapy: MiraTherapy | undefined; report: EvidenceGateReport } {
  const forDiagnosis = therapy.forDiagnosis;
  const removed = (reason: string) => ({ therapy: undefined, report: { forDiagnosis, therapyRemoved: true, reason, drugs: therapy.regimen.map((r): GateDrug => ({ drug: r.drug, dose: r.dose, status: "removed", evidenceIds: [] })) } });
  if (!bundle?.evidence.length) return removed("Referensi TheOracle untuk terapi tidak tersedia; dosis tidak ditampilkan.");
  if (!diagnosis || forDiagnosis.icd10.trim().toUpperCase().slice(0, 3) !== diagnosis.icd10.trim().toUpperCase().slice(0, 3)) return removed(`Terapi ditulis untuk diagnosis lain (${forDiagnosis.icd10}), bukan ${diagnosis?.icd10 ?? "diagnosis kerja"}.`);
  const named = diagnosisWords(diagnosis);
  const passages = bundle.evidence.map(item => { const words = tokens(item.text); return { id: item.evidenceId, text: item.text, words, about: [...tokens(item.source.title), ...words].some(word => named.has(word)) }; });
  const naming = (drug: string) => passages.filter(p => mentions(p.words, drug));
  // A strength counts only from a passage about the diagnosis: an azole list for cryptococcosis does not dose pityriasis versicolor.
  const dosingFor = (drug: string) => naming(drug).filter(p => p.about);
  // A strength outside `dose` is shown only when one passage naming the drug carries all of it.
  const carried = (text: string, among: { text: string }[], percent = true) => { const patterns = strengths(text, percent); return !patterns.length || among.some(p => patterns.every(pattern => pattern.test(p.text))); };
  const drugs = therapy.regimen.map((r): GateDrug => {
    const named = naming(r.drug);
    if (!named.length) return { drug: r.drug, dose: r.dose, status: "removed", evidenceIds: [] };
    const patterns = strengths(r.dose + " " + r.drug, true, true);
    // "3x1mg", "2-3x2%", "1mg 3 kali sehari" and "1mg x 3" are several doses; the "x3" of "1x3g" is not a frequency.
    const several = [...r.dose.matchAll(/(?<![\d.,])(\d+)\s*(?:[x×]|kali)|[x×]\s*(\d+)(?![\d.,]*\s*[a-zµμ%])/gi)].some(m => Number(m[1] ?? m[2]) >= 2);
    const dosing = patterns.length ? dosingFor(r.drug).filter(p => owned(p.text, r.drug).some(({ from, to, text }) => patterns.every(pattern => doses(pattern, text, from, to, several)))) : [];
    return dosing.length ? { drug: r.drug, dose: r.dose, status: "verified", evidenceIds: dosing.map(p => p.id) } : { drug: r.drug, dose: r.dose, status: "doseRemoved", evidenceIds: named.map(p => p.id) };
  });
  const kept = therapy.regimen.filter((_, i) => drugs[i].status !== "removed");
  const shown = (r: MiraTherapy["regimen"][number]) => {
    // A field keeps its leading clauses up to the first unsupported one: "IV, 1 g dalam 100 ml" keeps "IV" when 1 g is unsupported.
    // It is blanked when that would cut a condition loose or drop an exception ("Hindari bila CrCl <30 ml/menit, kurangi dosis").
    const named = dosingFor(r.drug);
    const text = (field: string) => {
      const parts = field.split(CLAUSE);
      const clauses = parts.filter((_, i) => i % 2 === 0);
      const cut = clauses.findIndex(clause => !carried(clause, named));
      if (cut < 0) return carried(field, named) ? field : "";
      const kept = parts.slice(0, 2 * cut).join("").replace(/[\s;,.]+$/, "");
      const balanced = (kept.match(/\(/g) ?? []).length === (kept.match(/\)/g) ?? []).length;
      return cut && balanced && carried(kept, named) && !clauses.slice(cut).some(clause => CONDITION.test(clause.trim())) ? kept + PARTIAL : "";
    };
    return { ...(drugs[therapy.regimen.indexOf(r)].status === "verified" ? r : { ...r, drug: unstrength(r.drug), dose: "" }), route: text(r.route), duration: text(r.duration), note: text(r.note) };
  };
  const safety = (items: string[]) => items.flatMap(item => {
    const words = tokens(item);
    const named = therapy.regimen.filter(r => mentions(words, r.drug));
    const keptNamed = kept.filter(r => named.includes(r));
    if (named.length && !keptNamed.length) return [];
    if (!carried(item, passages.filter(p => (keptNamed.length ? keptNamed : kept).some(r => mentions(p.words, r.drug))), false)) return [];
    const specific = words.filter(w => w.length >= 5 && !named.some(r => tokens(r.drug).includes(w)));
    const supported = keptNamed.length > 0 && passages.some(p => keptNamed.every(r => mentions(p.words, r.drug)) && SAFETY_TERM.test(p.text.toLowerCase()) && specific.some(w => p.words.includes(w)));
    return [supported ? item : item + UNVERIFIED];
  });
  const gated: MiraTherapy = { forDiagnosis, regimen: kept.map(shown), interactions: safety(therapy.interactions), contraindications: safety(therapy.contraindications) };
  const reason = kept.length ? "" : "Tidak ada obat yang indikasinya terverifikasi di TheOracle.";
  return { therapy: kept.length ? gated : undefined, report: { forDiagnosis, therapyRemoved: !kept.length, reason, drugs } };
}
