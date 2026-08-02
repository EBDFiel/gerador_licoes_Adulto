"use strict";

const FIELD_STOPS = [
  "TEXTO ÁUREO", "VERSÍCULO DO DIA", "VERDADE APLICADA", "OBJETIVOS DA LIÇÃO",
  "TEXTOS DE REFERÊNCIA", "TEXTO DE REFERÊNCIA", "LEITURAS COMPLEMENTARES",
  "LEITURAS DIÁRIAS", "HINOS SUGERIDOS", "MOTIVO DE ORAÇÃO", "MOMENTO DE ORAÇÃO",
  "ESBOÇO DA LIÇÃO", "ANÁLISE GERAL", "INTRODUÇÃO", "PONTO-CHAVE", "REFLETINDO",
  "SUBSÍDIO PARA O EDUCADOR", "CONCLUSÃO", "COMPLEMENTANDO", "EU ENSINEI QUE"
];

const FORBIDDEN_ARTIFACTS = [
  /REFER[ÊE]NCIA\s+INDICADA/i,
  /A\s+SEREM?\s+INDICAD[OA]S?/i,
  /ABRIR\s+APOIO\s+PEDAG[ÓO]GICO/i,
  /LEITURAS?\s*,\s*HINOS?\s+E\s+ORA(?:Ç|C)[ÃA]O/i,
  /CONTE[ÚU]DO\s+A\s+SER\s+DEFINIDO/i,
  /\[(?:CONTE[ÚU]DO|PREENCHER|DEFINIR|REFER[ÊE]NCIA)[^\]]*\]/i
];

function decodeEntities(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainTextKeepLines(value = "") {
  return decodeEntities(String(value || ""))
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(value = "") {
  return plainTextKeepLines(value).replace(/\s+/g, " ").trim();
}

function normalizeComparable(value = "") {
  return oneLine(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^licao\s*\d+\s*[:\-–—]?\s*/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractLessonIdentity(source = "") {
  const lines = plainTextKeepLines(source).split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice(0, 30)) {
    const match = line.match(/^\s*Li(?:ç|c)[ãa]o\s*(\d{1,3})\s*[:\-–—]\s*(.{3,220})$/i);
    if (match) {
      return {
        numero: String(match[1] || "").trim(),
        titulo: oneLine(match[2] || "").replace(/[\s.!?]+$/g, "").trim(),
        raw: line
      };
    }
  }
  return { numero: "", titulo: "", raw: "" };
}

function extractLabeledField(source = "", labels = [], stopLabels = FIELD_STOPS) {
  const plain = plainTextKeepLines(source);
  if (!plain) return "";

  const labelPattern = labels.map(escapeRegex).join("|");
  const stopPattern = stopLabels
    .filter((label) => !labels.some((own) => normalizeComparable(own) === normalizeComparable(label)))
    .map(escapeRegex)
    .join("|");

  const regex = new RegExp(
    `(?:^|\\n)\\s*(?:${labelPattern})\\s*[:：]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:(?:${stopPattern})\\s*[:：]?|[123]\\.\\s+)|$)`,
    "i"
  );
  const match = plain.match(regex);
  return match ? oneLine(match[1] || "") : "";
}

function dedupeRepeatedSentence(value = "") {
  const clean = oneLine(value);
  if (!clean) return "";
  const half = Math.floor(clean.length / 2);
  for (let offset = Math.max(12, half - 12); offset <= Math.min(clean.length - 12, half + 12); offset += 1) {
    const left = clean.slice(0, offset).trim().replace(/[.;]+$/g, "");
    const right = clean.slice(offset).trim().replace(/^[.;\s]+|[.;]+$/g, "");
    if (left && normalizeComparable(left) === normalizeComparable(right)) return left + (/[.!?]$/.test(left) ? "" : ".");
  }
  return clean;
}

function extractAdultFixedFields(source = "") {
  const identity = extractLessonIdentity(source);
  return {
    identity,
    textoAureo: extractLabeledField(source, ["TEXTO ÁUREO", "TEXTO AUREO"]),
    verdadeAplicada: dedupeRepeatedSentence(extractLabeledField(source, ["VERDADE APLICADA"])),
    textosReferencia: extractLabeledField(source, ["TEXTOS DE REFERÊNCIA", "TEXTOS DE REFERENCIA", "TEXTO DE REFERÊNCIA", "TEXTO DE REFERENCIA"])
  };
}

function findForbiddenArtifacts(value = "") {
  const text = oneLine(value);
  return FORBIDDEN_ARTIFACTS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

function validateSourceIdentity({ source = "", numero = "", titulo = "", requireAdultFields = false } = {}) {
  const fixed = extractAdultFixedFields(source);
  const errors = [];
  const inputNumber = String(numero || "").trim().replace(/\D/g, "");
  const inputTitle = oneLine(titulo).replace(/^Li(?:ç|c)[ãa]o\s*\d+\s*[:\-–—]?\s*/i, "").trim();

  if (!inputNumber) errors.push("Informe o número da lição no painel.");
  if (!inputTitle || normalizeComparable(inputTitle) === "licao") errors.push("Informe o título completo da lição no painel.");

  if (fixed.identity.numero && inputNumber && fixed.identity.numero !== inputNumber) {
    errors.push(`O texto-base identifica a Lição ${fixed.identity.numero}, mas o painel está configurado para a Lição ${inputNumber}.`);
  }
  if (fixed.identity.titulo && inputTitle && normalizeComparable(fixed.identity.titulo) !== normalizeComparable(inputTitle)) {
    errors.push(`O título do texto-base (“${fixed.identity.titulo}”) é diferente do título informado no painel (“${inputTitle}”).`);
  }

  if (requireAdultFields) {
    if (!fixed.textoAureo) errors.push("TEXTO ÁUREO não encontrado no texto-base.");
    if (!fixed.verdadeAplicada) errors.push("VERDADE APLICADA não encontrada no texto-base.");
    if (!fixed.textosReferencia) errors.push("TEXTOS DE REFERÊNCIA não encontrados no texto-base.");
    if (findForbiddenArtifacts(fixed.textosReferencia).length) {
      errors.push("O campo TEXTOS DE REFERÊNCIA contém placeholder ou texto de interface; corrija o texto-base antes de gerar.");
    }
  }

  return { ok: errors.length === 0, errors, fixed, numero: inputNumber, titulo: inputTitle };
}

function labelRegex(label = "") {
  if (/TEXTOS? DE REFER/i.test(label)) return "TEXTOS?\\s+DE\\s+REFER[ÊE]NCIA";
  if (/TEXTO ÁUREO/i.test(label)) return "TEXTO\\s+[ÁA]UREO";
  if (/VERDADE APLICADA/i.test(label)) return "VERDADE\\s+APLICADA";
  return escapeRegex(label).replace(/\\ /g, "\\s+");
}

function forceLabeledHtmlField(html = "", label = "", value = "") {
  let out = String(html || "");
  const cleanValue = oneLine(value);
  if (!out || !cleanValue) return out;

  const labelRe = labelRegex(label);
  const escaped = escapeHtml(cleanValue);
  let replaced = false;

  const inlineParagraph = new RegExp(`(<p[^>]*>)((?:(?!<\\/p>)[\\s\\S])*?${labelRe}\\s*[:：]?\\s*(?:<\\/(?:strong|span|b)>)?\\s*)(?:(?!<\\/p>)[\\s\\S])*(<\\/p>)`, "i");
  out = out.replace(inlineParagraph, (_match, open, prefix, close) => {
    replaced = true;
    return `${open}${prefix}${escaped}${close}`;
  });

  if (!replaced) {
    const headingThenParagraph = new RegExp(`(<h[1-6][^>]*>[\\s\\S]*?${labelRe}[\\s\\S]*?<\\/h[1-6]>\\s*<p[^>]*>)[\\s\\S]*?(<\\/p>)`, "i");
    out = out.replace(headingThenParagraph, (_match, open, close) => {
      replaced = true;
      return `${open}${escaped}${close}`;
    });
  }

  return out;
}

function extractHtmlField(html = "", labels = []) {
  return extractLabeledField(plainTextKeepLines(html), labels);
}

function countLabelOccurrences(html = "", label = "") {
  const pattern = new RegExp(labelRegex(label), "gi");
  return (plainTextKeepLines(html).match(pattern) || []).length;
}

function extractHtmlTitle(html = "") {
  const source = String(html || "");
  const candidates = [
    source.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1],
    source.match(/<p[^>]*class=["'][^"']*(?:titulo-inline|titulo-licao)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1],
    source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  ].filter(Boolean);
  return candidates.length ? oneLine(candidates[0]) : "";
}

function enforceAdultIntegrity(html = "", fixed = {}) {
  let out = String(html || "");
  out = forceLabeledHtmlField(out, "TEXTO ÁUREO", fixed.textoAureo || "");
  out = forceLabeledHtmlField(out, "VERDADE APLICADA", fixed.verdadeAplicada || "");
  out = forceLabeledHtmlField(out, "TEXTOS DE REFERÊNCIA", fixed.textosReferencia || "");
  return out;
}

function validateAdultGeneratedHtml({ html = "", fixed = {}, numero = "", titulo = "" } = {}) {
  const errors = [];
  const generatedTitle = extractHtmlTitle(html);
  const expectedTitle = oneLine(titulo);
  const expectedNumber = String(numero || "").replace(/\D/g, "");
  const generatedIdentity = extractLessonIdentity(generatedTitle || plainTextKeepLines(html));

  if (!generatedTitle) errors.push("Título principal não encontrado no HTML.");
  if (expectedTitle && normalizeComparable(generatedTitle) !== normalizeComparable(expectedTitle)) {
    errors.push(`O título gerado não corresponde ao título informado: “${expectedTitle}”.`);
  }
  if (expectedNumber && generatedIdentity.numero && generatedIdentity.numero !== expectedNumber) {
    errors.push(`O número da lição gerado (${generatedIdentity.numero}) não corresponde ao número informado (${expectedNumber}).`);
  }

  const checks = [
    { label: "TEXTO ÁUREO", labels: ["TEXTO ÁUREO", "TEXTO AUREO"], expected: fixed.textoAureo },
    { label: "VERDADE APLICADA", labels: ["VERDADE APLICADA"], expected: fixed.verdadeAplicada },
    { label: "TEXTOS DE REFERÊNCIA", labels: ["TEXTOS DE REFERÊNCIA", "TEXTOS DE REFERENCIA", "TEXTO DE REFERÊNCIA", "TEXTO DE REFERENCIA"], expected: fixed.textosReferencia }
  ];

  for (const check of checks) {
    const actual = extractHtmlField(html, check.labels);
    if (!actual) errors.push(`${check.label} não encontrado no HTML gerado.`);
    else if (check.expected && normalizeComparable(actual) !== normalizeComparable(check.expected)) {
      errors.push(`${check.label} foi alterado; o campo deve ser copiado literalmente do texto-base.`);
    }
    if (countLabelOccurrences(html, check.label) !== 1) {
      errors.push(`${check.label} deve aparecer exatamente uma vez.`);
    }
  }

  if (findForbiddenArtifacts(html).length) {
    errors.push("O HTML contém placeholder ou texto de interface proibido.");
  }

  return { ok: errors.length === 0, errors, generatedTitle };
}

module.exports = {
  plainTextKeepLines,
  oneLine,
  normalizeComparable,
  extractLessonIdentity,
  extractLabeledField,
  extractAdultFixedFields,
  findForbiddenArtifacts,
  validateSourceIdentity,
  forceLabeledHtmlField,
  extractHtmlField,
  enforceAdultIntegrity,
  validateAdultGeneratedHtml
};
