"use strict";

const fs = require("fs");
const path = require("path");

const CLASS_ALIASES = Object.freeze({
  adult: "adult",
  adultos: "adult",
  youth: "youth",
  jovem: "youth",
  jovens: "youth",
  teen: "teen",
  adolescente: "teen",
  adolescentes: "teen",
  preteen: "preteen",
  preadolescente: "preteen",
  preadolescentes: "preteen",
  "pre-adolescente": "preteen",
  "pre-adolescentes": "preteen",
  "pré-adolescente": "preteen",
  "pré-adolescentes": "preteen"
});

const cache = new Map();

function normalizeClassKey(value) {
  return CLASS_ALIASES[String(value || "").trim().toLowerCase()] || "";
}

function normalizeInteger(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : 0;
}

function dataDirectory(year, trimester) {
  return path.join(__dirname, "data", "lesson-bases", String(year), `trimestre-${String(trimester).padStart(2, "0")}`);
}

function loadJson(filePath) {
  const stats = fs.statSync(filePath);
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs) return cached.value;
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  cache.set(filePath, { mtimeMs: stats.mtimeMs, value });
  return value;
}

function getManifest({ year, trimester }) {
  const y = normalizeInteger(year, 2020, 2100);
  const t = normalizeInteger(trimester, 1, 4);
  if (!y || !t) return null;
  const filePath = path.join(dataDirectory(y, t), "manifest.json");
  if (!fs.existsSync(filePath)) return null;
  return loadJson(filePath);
}

function getClassBank({ year, trimester, classKey }) {
  const y = normalizeInteger(year, 2020, 2100);
  const t = normalizeInteger(trimester, 1, 4);
  const key = normalizeClassKey(classKey);
  if (!y || !t || !key) return null;
  const filePath = path.join(dataDirectory(y, t), `${key}.json`);
  if (!fs.existsSync(filePath)) return null;
  return loadJson(filePath);
}

function getLessonBase({ year, trimester, classKey, number, includeHtml = false }) {
  const bank = getClassBank({ year, trimester, classKey });
  const lessonNumber = normalizeInteger(number, 1, 99);
  if (!bank || !lessonNumber) return null;
  const lesson = bank.lessons?.[String(lessonNumber).padStart(2, "0")];
  if (!lesson) return null;
  const result = {
    version: bank.version,
    year: Number(lesson.year || bank.year),
    trimester: Number(lesson.trimester || bank.trimester),
    classKey: normalizeClassKey(lesson.classKey || bank.classKey),
    classLabel: String(lesson.classLabel || bank.classLabel || ""),
    number: Number(lesson.number || lessonNumber),
    numberPadded: String(lesson.numberPadded || lessonNumber).padStart(2, "0"),
    title: String(lesson.title || "").trim(),
    date: String(lesson.date || "").trim(),
    sourceText: String(lesson.sourceText || "").trim(),
    sourceType: String(lesson.sourceType || "lesson-bank"),
    sourceFile: String(lesson.sourceFile || ""),
    loadedAt: new Date().toISOString()
  };
  if (includeHtml) result.sourceHtml = String(lesson.sourceHtml || "");
  return result;
}

function listLessonBases({ year, trimester, classKey }) {
  const bank = getClassBank({ year, trimester, classKey });
  if (!bank) return null;
  return {
    version: bank.version,
    year: Number(bank.year),
    trimester: Number(bank.trimester),
    classKey: normalizeClassKey(bank.classKey),
    classLabel: String(bank.classLabel || ""),
    count: Number(bank.count || Object.keys(bank.lessons || {}).length),
    lessons: Object.values(bank.lessons || {}).map((lesson) => ({
      number: Number(lesson.number || 0),
      numberPadded: String(lesson.numberPadded || lesson.number || "").padStart(2, "0"),
      title: String(lesson.title || "").trim(),
      date: String(lesson.date || "").trim()
    })).sort((a, b) => a.number - b.number)
  };
}

function buildLessonContext({ year, trimester, classKey, number }) {
  const lesson = getLessonBase({ year, trimester, classKey, number, includeHtml: false });
  if (!lesson) return null;
  const maxChars = Number(process.env.PROFESSOR_FIEL_LESSON_CONTEXT_MAX_CHARS || 24000);
  return {
    ...lesson,
    sourceText: lesson.sourceText.slice(0, Math.max(4000, maxChars))
  };
}

module.exports = {
  normalizeClassKey,
  getManifest,
  getClassBank,
  getLessonBase,
  listLessonBases,
  buildLessonContext
};
