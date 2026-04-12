const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "8mb" }));

/* =========================================================
   HELPERS
========================================================= */

function escapeHtml(str = "") {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeLineBreaks(text = "") {
  return String(text ?? "").replace(/\r/g, "").trim();
}

function isHtml(text = "") {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(String(text || ""));
}

function decodeHtmlEntities(str = "") {
  return String(str)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(html = "") {
  return decodeHtmlEntities(String(html).replace(/<[^>]+>/g, " "));
}

function splitLines(text = "") {
  return normalizeLineBreaks(text)
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function splitParagraphs(text = "") {
  return normalizeLineBreaks(text)
    .split(/\n\s*\n+/)
    .map(p => p.trim())
    .filter(Boolean);
}

function toParagraphHtml(text = "") {
  const parts = splitParagraphs(text);
  if (!parts.length) {
    return `<p>${escapeHtml(String(text || "").trim())}</p>`;
  }
  return parts.map(p => `<p>${escapeHtml(p)}</p>`).join("\n");
}

function normalizeLabel(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function detectTipo(publico = "", fallbackTipo = "") {
  const raw = normalizeLabel(publico || fallbackTipo || "");
  if (
    raw.includes("jov") ||
    raw.includes("youth") ||
    raw.includes("young") ||
    raw.includes("juven")
  ) {
    return "youth";
  }
  return "adult";
}

function detectClasseLabel(tipo) {
  return tipo === "youth" ? "Classe de Jovens" : "Classe de Adultos";
}

function cleanInlineText(text = "") {
  return normalizeLineBreaks(
    String(text)
      .replace(/\u00A0/g, " ")
      .replace(/[ \t]+/g, " ")
  );
}

function fallbackText(text = "", fallback = "") {
  const clean = cleanInlineText(text);
  return clean || fallback;
}

function sentenceLimit(text = "", max = 2) {
  const raw = cleanInlineText(text);
  if (!raw) return "";
  const parts = raw.match(/[^.!?]+[.!?]?/g) || [raw];
  return parts.slice(0, max).join(" ").trim();
}

function clampWords(text = "", maxWords = 36) {
  const words = cleanInlineText(text).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function uniqueParagraphs(text = "") {
  const seen = new Set();
  return splitParagraphs(text).filter(p => {
    const key = normalizeLabel(p);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeUniqueParagraphs(...texts) {
  const merged = [];
  const seen = new Set();

  for (const txt of texts) {
    for (const p of splitParagraphs(txt || "")) {
      const key = normalizeLabel(p);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }
  }

  return merged.join("\n\n");
}

function extractLessonIdentity(raw = "", numero = "", titulo = "") {
  const lines = splitLines(raw);
  const firstLine = lines[0] || "";

  let finalNumero = String(numero || "").trim();
  let finalTitulo = String(titulo || "").trim();

  const m1 = firstLine.match(/^li[cç][aã]o\s*(\d+)\s*[:\-–]\s*(.+)$/i);
  const m2 = firstLine.match(/^li[cç][aã]o\s*(\d+)\s*[—\-–]\s*(.+)$/i);
  const match = m1 || m2;

  if (match) {
    if (!finalNumero) finalNumero = String(match[1] || "").trim();
    if (!finalTitulo) finalTitulo = String(match[2] || "").trim();
  }

  if (!finalTitulo && firstLine) {
    finalTitulo = firstLine
      .replace(/^li[cç][aã]o\s*\d+\s*[:\-–—]\s*/i, "")
      .trim();
  }

  finalTitulo = finalTitulo
    .replace(/^li[cç][aã]o\s*\d+\s*[:\-–—]\s*/i, "")
    .trim();

  return {
    numero: finalNumero,
    titulo: finalTitulo || "Lição"
  };
}

function safeStartsWith(line = "", label = "") {
  return normalizeLabel(line).startsWith(normalizeLabel(label));
}

function isSpecialMarker(line = "") {
  const norm = normalizeLabel(line);
  return [
    "ponto-chave",
    "ponto chave",
    "refletindo",
    "subsidio para o educador",
    "subsídio para o educador",
    "complementando",
    "eu ensinei que",
    "conclusao",
    "conclusão",
    "introducao",
    "introdução",
    "texto aureo",
    "texto áureo",
    "versiculo do dia",
    "versículo do dia",
    "verdade aplicada",
    "texto de referencia",
    "texto de referência",
    "textos de referencia",
    "textos de referência",
    "hinos sugeridos",
    "motivo de oracao",
    "motivo de oração"
  ].some(label => norm === label || norm.startsWith(`${label}:`));
}

function isTopicoLine(line = "") {
  return /^\d+\.\s+/.test(line) || /^\d+\.\s*[^0-9]/.test(line);
}

function isSubtopicoLine(line = "") {
  return /^\d+\.\d+\.\s+/.test(line) || /^\d+\.\d+\.\s*[^0-9]/.test(line);
}

function isAnyStructuredLine(line = "") {
  return isTopicoLine(line) || isSubtopicoLine(line) || isSpecialMarker(line);
}

function removeFirstLessonLine(lines = []) {
  if (!lines.length) return lines;
  const first = lines[0] || "";
  if (/^li[cç][aã]o\s*\d+/i.test(first)) {
    return lines.slice(1);
  }
  return lines;
}

function readInlineOrNext(lines, index) {
  const current = lines[index] || "";

  const inlineColon = current.replace(/^([^:]+):\s*/, "").trim();
  if (inlineColon && inlineColon !== current.trim()) return inlineColon;

  const inlineDash = current.replace(/^([^—\-–]+)[—\-–]\s*/, "").trim();
  if (inlineDash && inlineDash !== current.trim()) return inlineDash;

  const next = lines[index + 1] || "";
  if (next && !isAnyStructuredLine(next)) return next.trim();

  return "";
}

function collectUntilStop(lines, startIndex, stopFn) {
  const collected = [];
  for (let i = startIndex; i < lines.length; i++) {
    if (stopFn(lines[i], i)) break;
    collected.push(lines[i]);
  }
  return collected;
}

function findLineIndex(lines, matcher) {
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i], i)) return i;
  }
  return -1;
}

function extractFieldSingleLine(lines, labels = []) {
  for (let i = 0; i < lines.length; i++) {
    for (const label of labels) {
      if (safeStartsWith(lines[i], label)) {
        return readInlineOrNext(lines, i);
      }
    }
  }
  return "";
}

function extractSection(lines, labels = [], stopMatchers = []) {
  const startIndex = findLineIndex(lines, (line) =>
    labels.some(label => safeStartsWith(line, label))
  );

  if (startIndex < 0) return "";

  const current = lines[startIndex] || "";
  const inline = readInlineOrNext(lines, startIndex);

  if (inline && inline !== current.trim()) {
    return inline;
  }

  const content = collectUntilStop(lines, startIndex + 1, (line) => {
    return stopMatchers.some(fn => fn(line));
  });

  return content.join("\n").trim();
}

function stripMarkersFromConclusion(text = "") {
  const lines = splitLines(text);
  const keep = [];
  for (const line of lines) {
    if (safeStartsWith(line, "Complementando")) continue;
    if (safeStartsWith(line, "Eu ensinei que")) continue;
    keep.push(line);
  }
  return keep.join("\n").trim();
}

function extractBetelTopicos(lines = []) {
  const blocks = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isTopicoLine(line) || isSubtopicoLine(line)) {
      if (current) blocks.push(current);

      const match = line.match(/^(\d+(?:\.\d+)?)\.\s*(.+)$/);
      current = {
        numero: match ? match[1] : "",
        titulo: match ? match[2].trim() : line.trim(),
        lines: []
      };
      continue;
    }

    if (current) {
      if (
        safeStartsWith(line, "Refletindo") ||
        safeStartsWith(line, "Subsídio para o Educador") ||
        safeStartsWith(line, "Subsidio para o Educador") ||
        safeStartsWith(line, "Conclusão") ||
        safeStartsWith(line, "Conclusao") ||
        safeStartsWith(line, "Complementando") ||
        safeStartsWith(line, "Eu ensinei que")
      ) {
        blocks.push(current);
        current = null;
        continue;
      }

      current.lines.push(line);
    }
  }

  if (current) blocks.push(current);

  return blocks.map(b => ({
    numero: b.numero,
    titulo: b.titulo,
    conteudo: b.lines.join("\n").trim()
  }));
}

function groupTopicos(blocks = []) {
  const topicos = [];
  const map = new Map();

  for (const block of blocks) {
    if (!block.numero) continue;

    if (/^\d+$/.test(block.numero)) {
      const topico = {
        numero: block.numero,
        titulo: block.titulo,
        conteudo: block.conteudo,
        subtopicos: []
      };
      topicos.push(topico);
      map.set(block.numero, topico);
      continue;
    }

    if (/^\d+\.\d+$/.test(block.numero)) {
      const parentKey = block.numero.split(".")[0];
      const parent = map.get(parentKey);
      if (parent) {
        parent.subtopicos.push({
          numero: block.numero,
          titulo: block.titulo,
          conteudo: block.conteudo
        });
      }
    }
  }

  return topicos;
}

function buildAnalysisText(raw = "", titulo = "", tema = "") {
  return [
    `A lição "${titulo || tema || "proposta"}" apresenta um panorama bíblico e doutrinário do tema estudado, conduzindo a classe a uma compreensão fiel da mensagem das Escrituras.`,
    `Ao longo do conteúdo, os alunos são levados a perceber como o ensino bíblico se relaciona com a formação do caráter cristão, com a vida no Reino de Deus e com a prática cotidiana da fé.`,
    `Os tópicos e subtópicos destacam verdades essenciais que ajudam o professor a ensinar com clareza, profundidade e aplicação, valorizando tanto a exposição da Palavra quanto a resposta espiritual da turma.`,
    `Assim, esta análise geral prepara a classe para estudar a lição com reverência, atenção e disposição sincera para viver o que está sendo ensinado.`
  ].join("\n\n");
}

function buildSupportText(sectionTitle = "", sectionContent = "", lessonTitle = "", tipo = "adult") {
  const classe = detectClasseLabel(tipo);
  const base = fallbackText(
    sentenceLimit(sectionContent, 2),
    `O conteúdo referente a ${sectionTitle || "este ponto"} destaca princípios importantes da vida cristã.`
  );

  return [
    `No contexto da ${classe}, este ponto deve ser trabalhado de forma clara, organizada e pastoral, ajudando os alunos a compreenderem como "${lessonTitle || sectionTitle || "o tema da lição"}" se aplica à vida cristã.`,
    `${base} O professor pode explorar esse trecho com leitura em voz alta, perguntas dirigidas e observações que reforcem o sentido bíblico, doutrinário e formativo do ensino.`,
    `Pedagogicamente, é importante incentivar a participação da turma, retomando os conceitos principais, relacionando o assunto com experiências práticas e reforçando verdades que precisam ser guardadas no coração.`,
    `Ao final, este bloco deve servir como ponte entre conhecimento e vivência, mostrando que aprender a Palavra de Deus exige entendimento, reverência e compromisso com a obediência.`
  ].join("\n\n");
}

function buildApplicationText(sectionTitle = "", sectionContent = "", tipo = "adult") {
  const base = sentenceLimit(sectionContent, 1);
  const shortened = clampWords(base || sectionTitle || "o ensino estudado", 18).toLowerCase();

  if (tipo === "youth") {
    return `O aluno deve ser incentivado a levar "${shortened}" para suas escolhas, atitudes e relacionamento com Deus. Esse ensino precisa sair da teoria e produzir obediência, coerência cristã e transformação prática no dia a dia.`;
  }

  return `A classe deve ser encorajada a aplicar "${shortened}" na vida cristã diária. Esse ensino precisa gerar postura, discernimento espiritual e prática coerente com a Palavra de Deus.`;
}

function buildEuEnsineiQue(topicoTitulo = "") {
  return `Deus deseja que compreendamos ${fallbackText(topicoTitulo, "este ensino bíblico").toLowerCase()} com fidelidade, para vivermos a Sua Palavra com consciência, maturidade e prática cristã verdadeira.`;
}

function buildPointKey(titulo = "", intro = "") {
  return `O ensino desta lição mostra que ${fallbackText(titulo || intro, "o tema central da lição").toLowerCase()} deve ser compreendido com fé, responsabilidade e aplicação prática à vida cristã.`;
}

function ensureMinimumStructure(topicos = []) {
  return topicos
    .filter(t => t && t.numero && t.titulo)
    .slice(0, 3);
}

function extractSections(raw = "", tipo = "adult", extras = {}) {
  let lines = splitLines(raw);
  lines = removeFirstLessonLine(lines);

  const verse =
    extractFieldSingleLine(lines, ["TEXTO ÁUREO", "TEXTO AUREO", "VERSÍCULO DO DIA", "VERSICULO DO DIA"]) ||
    "[Inserir versículo aqui]";

  const truth =
    extractFieldSingleLine(lines, ["VERDADE APLICADA"]) ||
    "[Inserir verdade aplicada aqui]";

  const refs =
    extractFieldSingleLine(lines, ["TEXTOS DE REFERÊNCIA", "TEXTOS DE REFERENCIA", "TEXTO DE REFERÊNCIA", "TEXTO DE REFERENCIA"]) ||
    "[Inserir referências aqui]";

  const pontoChave =
    extractSection(
      lines,
      ["Ponto-Chave", "Ponto Chave"],
      [
        isTopicoLine,
        isSubtopicoLine,
        (line) => safeStartsWith(line, "Refletindo"),
        (line) => safeStartsWith(line, "Subsídio para o Educador"),
        (line) => safeStartsWith(line, "Subsidio para o Educador"),
        (line) => safeStartsWith(line, "Conclusão"),
        (line) => safeStartsWith(line, "Conclusao")
      ]
    ) || "";

  const refletindo =
    extractSection(
      lines,
      ["Refletindo"],
      [
        isTopicoLine,
        isSubtopicoLine,
        (line) => safeStartsWith(line, "Subsídio para o Educador"),
        (line) => safeStartsWith(line, "Subsidio para o Educador"),
        (line) => safeStartsWith(line, "Conclusão"),
        (line) => safeStartsWith(line, "Conclusao")
      ]
    ) || "";

  const subsidioEducador =
    extractSection(
      lines,
      ["Subsídio para o Educador", "Subsidio para o Educador"],
      [
        (line) => safeStartsWith(line, "Conclusão"),
        (line) => safeStartsWith(line, "Conclusao"),
        (line) => safeStartsWith(line, "Complementando"),
        (line) => safeStartsWith(line, "Eu ensinei que")
      ]
    ) || "";

  const complementando =
    extractSection(
      lines,
      ["Complementando"],
      [
        (line) => safeStartsWith(line, "Eu ensinei que"),
        (line) => safeStartsWith(line, "Hinos sugeridos"),
        (line) => safeStartsWith(line, "Motivo de oração"),
        (line) => safeStartsWith(line, "Motivo de oracao")
      ]
    ) || "";

  const euEnsineiFinal =
    extractSection(
      lines,
      ["Eu ensinei que"],
      [
        (line) => safeStartsWith(line, "Hinos sugeridos"),
        (line) => safeStartsWith(line, "Motivo de oração"),
        (line) => safeStartsWith(line, "Motivo de oracao")
      ]
    ) || "";

  const introIndex = findLineIndex(lines, (line) => safeStartsWith(line, "Introdução") || safeStartsWith(line, "Introducao"));
  let intro = "";

  if (introIndex >= 0) {
    const current = lines[introIndex];
    const inline = readInlineOrNext(lines, introIndex);

    if (inline && inline !== current.trim()) {
      intro = inline;
    } else {
      const introLines = collectUntilStop(lines, introIndex + 1, (line) => {
        return (
          safeStartsWith(line, "Ponto-Chave") ||
          safeStartsWith(line, "Ponto Chave") ||
          isTopicoLine(line) ||
          isSubtopicoLine(line) ||
          safeStartsWith(line, "Refletindo") ||
          safeStartsWith(line, "Subsídio para o Educador") ||
          safeStartsWith(line, "Subsidio para o Educador") ||
          safeStartsWith(line, "Conclusão") ||
          safeStartsWith(line, "Conclusao")
        );
      });
      intro = introLines.join("\n").trim();
    }
  }

  const topicosRaw = extractBetelTopicos(lines);
  const groupedTopicos = ensureMinimumStructure(groupTopicos(topicosRaw)).map(topico => ({
    ...topico,
    apoioPedagogico: buildSupportText(topico.titulo, topico.conteudo, extras.titulo || extras.tema || "", tipo),
    aplicacaoPratica: buildApplicationText(topico.titulo, topico.conteudo, tipo),
    euEnsineiQue: buildEuEnsineiQue(topico.titulo),
    subtopicos: (topico.subtopicos || []).map(sub => ({
      ...sub,
      apoioPedagogico: buildSupportText(sub.titulo, sub.conteudo, extras.titulo || extras.tema || "", tipo),
      aplicacaoPratica: buildApplicationText(sub.titulo, sub.conteudo, tipo)
    }))
  }));

  const conclusaoBase =
    extractSection(
      lines,
      ["Conclusão", "Conclusao"],
      [
        (line) => safeStartsWith(line, "Complementando"),
        (line) => safeStartsWith(line, "Eu ensinei que"),
        (line) => safeStartsWith(line, "Hinos sugeridos"),
        (line) => safeStartsWith(line, "Motivo de oração"),
        (line) => safeStartsWith(line, "Motivo de oracao")
      ]
    ) || "[Conteúdo da conclusão]";

  const conclusao = stripMarkersFromConclusion(conclusaoBase);

  const hinos =
    extractSection(
      lines,
      ["Hinos sugeridos"],
      [
        (line) => safeStartsWith(line, "Motivo de oração"),
        (line) => safeStartsWith(line, "Motivo de oracao")
      ]
    ) || "";

  const motivoOracao =
    extractSection(
      lines,
      ["Motivo de oração", "Motivo de oracao"],
      []
    ) || "";

  const analysis = buildAnalysisText(raw, extras.titulo || "", extras.tema || "");

  const apoioPedagogicoConclusao = mergeUniqueParagraphs(
    buildSupportText("Conclusão", conclusao, extras.titulo || extras.tema || "", tipo),
    complementando,
    subsidioEducador
  );

  const aplicacaoPraticaConclusao = buildApplicationText(
    "Conclusão",
    mergeUniqueParagraphs(conclusao, complementando, euEnsineiFinal),
    tipo
  );

  return {
    raw,
    verse,
    truth,
    refs,
    analysis,
    intro: intro || "[Conteúdo da introdução]",
    pontoChave,
    refletindo,
    subsidioEducador,
    complementando,
    euEnsineiFinal,
    topicos: groupedTopicos,
    conclusao,
    apoioPedagogicoConclusao,
    aplicacaoPraticaConclusao,
    hinos,
    motivoOracao
  };
}

/* =========================================================
   RENDER HTML
========================================================= */

function renderContentBlock(numero, titulo, conteudo) {
  return `<div><strong>${escapeHtml(numero)}. ${escapeHtml(titulo)}:</strong> ${escapeHtml(conteudo || "[Conteúdo original]")}</div>`;
}

function renderPedagogicalBlock(text = "", isConclusion = false) {
  const label = isConclusion ? "📘 APOIO PEDAGÓGICO (CONCLUSÃO):" : "📘 APOIO PEDAGÓGICO:";
  return `<div class="pedagogical-block"><strong>${label}</strong> ${toParagraphHtml(text)}</div>`;
}

function renderApplicationBlock(text = "", isConclusion = false) {
  const label = isConclusion ? "🎯 APLICAÇÃO PRÁTICA (CONCLUSÃO):" : "🎯 APLICAÇÃO PRÁTICA:";
  return `<div class="application-block"><strong>${label}</strong> ${escapeHtml(text || "[Aplicação prática]")}</div>`;
}

function buildTopicosHtml(topicos = []) {
  return topicos.map(topico => {
    const subs = (topico.subtopicos || []).map(sub => [
      renderContentBlock(sub.numero, sub.titulo, sub.conteudo),
      renderPedagogicalBlock(sub.apoioPedagogico),
      renderApplicationBlock(sub.aplicacaoPratica)
    ].join("\n")).join("\n\n");

    return [
      renderContentBlock(topico.numero, topico.titulo, topico.conteudo),
      renderPedagogicalBlock(topico.apoioPedagogico),
      renderApplicationBlock(topico.aplicacaoPratica),
      subs,
      `<div class="eu-ensinei"><strong>✨ Eu ensinei que:</strong> ${escapeHtml(topico.euEnsineiQue)}</div>`
    ].join("\n\n");
  }).join("\n\n");
}

function buildAdultHtml(data) {
  const {
    numero,
    titulo,
    trimestre,
    data: lessonDate,
    refs,
    truth,
    verse,
    analysis,
    intro,
    topicos,
    conclusao,
    apoioPedagogicoConclusao,
    aplicacaoPraticaConclusao,
    hinos,
    motivoOracao
  } = data;

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Lição ${escapeHtml(numero)} - ${escapeHtml(titulo)} | EBD Adultos</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background-color: #eef0e8; font-family: 'Segoe UI', 'Inter', Roboto, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.55; padding: 2rem 1rem; color: #1e2a1c; }
        .lesson-container { max-width: 1100px; margin: 0 auto; background: white; border-radius: 2rem; box-shadow: 0 20px 35px -12px
