// Writes src/lib/theoracle-drug-words.json: the words of drug names the evidence gate uses to end a drug's dose window
// at another drug. Sources: the `drug` field of data/dose-inventory/{pnpk,ppk}_doses_verified.json and the generic
// entries of the FORNAS chunks in the TheOracle index ("12 amoksisilin ... 1. kaps 500 mg"). Not clinician reviewed.
// Salt, ion and form words are left out: "natrium" or "klorida" next to a strength belong to the drug they name.
// Run: node scripts/build-drug-words.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { indexDir, root } from "./theoracle-model.mjs";

const SALTS = new Set(["asam", "natrium", "sodium", "kalium", "potassium", "kalsium", "calcium", "magnesium", "sulfat", "sulfas", "sulfate", "klorida", "chloride", "hidroklorida", "hydrochloride", "fosfat", "phosphate", "sitrat", "citrate", "asetat", "acetate", "maleat", "maleate", "mesilat", "besilat", "tartrat", "suksinat", "bromida", "hidrobromida", "nitrat", "karbonat", "laktat", "glukonat", "propionat", "valerat", "dipropionat", "trihidrat", "monohidrat", "dihidrat", "anhidrat", "garam", "basa", "base", "ester", "vitamin", "kombinasi", "combination", "dosis", "tablet", "kapsul", "sirup", "injeksi", "infus", "salep", "krim", "tetes", "oral", "topikal", "untuk", "atau", "dengan", "dalam", "yang", "lain", "lainnya", "obat", "terapi", "pemberian",
  // Words of the sources that are not drug names: descriptors, procedures, diseases and vaccine targets, forms.
  "acid", "acidic", "acting", "activators", "akar", "alfa", "amino", "anak", "anti", "antagonis", "asma", "based", "basal", "bahan", "beta", "cairan", "contoh", "derivative", "detergen", "detergens", "detergent", "devitalisasi", "dialisa", "difteri", "elemental", "emulsi", "epsilon", "faktor", "fixed", "formulation", "forte", "fraksi", "fresh", "frozen", "gits", "ginggival", "golongan", "gula", "heavy", "hemodialisa", "hepatitis", "hidrat", "hidrofilik", "hiperbarik", "human", "intravenous", "intravitreus", "irigasi", "isap", "isotonis", "kumur", "larutan", "lebih", "liquor", "long", "mata", "mengandung", "murni", "normal", "pack", "paper", "pasta", "pelembab", "pengganti", "pengisi", "peritoneal", "plus", "polio", "premixed", "preparat", "purified", "rabies", "ratio", "recombinant", "reguler", "rendah", "saluran", "sementara", "serum", "setara", "shampo", "steril", "surgical", "suspensi", "telinga", "terfraksi", "terfraksinasi", "terkonjugasi", "tetanus", "tidak", "tissue", "total", "viii"]);
const words = new Set();
const add = name => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(w => w.length >= 4 && !SALTS.has(w)).forEach(w => words.add(w));
for (const file of ["pnpk_doses_verified.json", "ppk_doses_verified.json"]) JSON.parse(readFileSync(`${root}data/dose-inventory/${file}`, "utf8")).items.forEach(item => add(item.drug ?? ""));
const FORNAS_ENTRY = /(?:^|\s)\d{1,3}\s+([a-z][a-z\- ]{2,40}?)(?:\s*\([^)]{0,30}\))?\s+(?:[A-Z][^0-9]{0,200}?)?1\.\s/g;
for (const line of readFileSync(`${indexDir}chunks.jsonl`, "utf8").trim().split("\n")) {
  const chunk = JSON.parse(line);
  if (/fornas/i.test(chunk.title)) for (const m of chunk.text.matchAll(FORNAS_ENTRY)) add(m[1]);
}
const sorted = [...words].sort();
writeFileSync(`${root}src/lib/theoracle-drug-words.json`, JSON.stringify({ source: "scripts/build-drug-words.mjs: PNPK and PPK dose inventory drug names, FORNAS generic entries; not clinician reviewed", words: sorted }, null, 1) + "\n");
console.log(JSON.stringify({ words: sorted.length }));
