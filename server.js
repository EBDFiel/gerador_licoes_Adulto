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

function safeStartsWith(line = "", label = "") {
  return normalizeLabel(line).startsWith(normalizeLabel(label));
}

function findLineIndex(lines, matcher) {
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i], i)) return i;
  }
  return -1;
}

function collectUntilStop(lines, startIndex, stopFn) {
  const collected = [];
  for (let i = startIndex; i < lines.length; i++) {
    if (stopFn(lines[i], i)) break;
    collected.push(lines[i]);
  }
  return collected;
}

function readInlineOrNext(lines, index) {
  const current = lines[index] || "";
  const inline = current.replace(/^.+?[:\-–]\s*/, "").trim();
  if (inline && inline !== current.trim()) return inline;

  const next = lines[index + 1] || "";
  if (next) return next.trim();

  return "";
}

function extractLessonIdentity(raw = "", numero = "", titulo = "") {
  const lines = splitLines(raw);
  const firstLine = lines[0] || "";

  let finalNumero = String(numero || "").trim();
  let finalTitulo = String(titulo || "").trim();

  const m = firstLine.match(/^li[cç][aã]o\s*(\d+)\s*[:\-–—]\s*(.+)$/i);
  if (m) {
    if (!finalNumero) finalNumero = String(m[1] || "").trim();
    if (!finalTitulo) finalTitulo = String(m[2] || "").trim();
  }

  if (!finalTitulo && firstLine) {
    finalTitulo = firstLine.replace(/^li[cç][aã]o\s*\d+\s*[:\-–—]\s*/i, "").trim();
  }

  finalTitulo = finalTitulo.replace(/^li[cç][aã]o\s*\d+\s*[:\-–—]\s*/i, "").trim();

  return {
    numero: finalNumero,
    titulo: finalTitulo || "Lição"
  };
}

function removeFirstLessonLine(lines = []) {
  if (!lines.length) return lines;
  if (/^li[cç][aã]o\s*\d+/i.test(lines[0])) return lines.slice(1);
  return lines;
}

function isTopicoLine(line = "") {
  return /^\d+\.\s+/.test(line) || /^\d+\.\s*[^0-9]/.test(line);
}

function isSubtopicoLine(line = "") {
  return /^\d+\.\d+\.\s+/.test(line) || /^\d+\.\d+\.\s*[^0-9]/.test(line);
}

function isHeadingLike(line = "") {
  return (
    isTopicoLine(line) ||
    isSubtopicoLine(line) ||
    safeStartsWith(line, "Ponto-Chave") ||
    safeStartsWith(line, "Ponto Chave") ||
    safeStartsWith(line, "Refletindo") ||
    safeStartsWith(line, "Subsídio para o Educador") ||
    safeStartsWith(line, "Subsidio para o Educador") ||
    safeStartsWith(line, "Conclusão") ||
    safeStartsWith(line, "Conclusao") ||
    safeStartsWith(line, "Complementando") ||
    safeStartsWith(line, "Eu ensinei que") ||
    safeStartsWith(line, "Hinos sugeridos") ||
    safeStartsWith(line, "Motivo de oração") ||
    safeStartsWith(line, "Motivo de oracao")
  );
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

function extractInlineOrMultiline(lines, labels = [], stopMatchers = []) {
  const startIndex = findLineIndex(lines, (line) =>
    labels.some(label => safeStartsWith(line, label))
  );
  if (startIndex < 0) return "";

  const current = lines[startIndex] || "";
  const inline = current.replace(/^.+?[:\-–]\s*/, "").trim();

  if (inline && inline !== current.trim()) {
    return inline;
  }

  const content = collectUntilStop(lines, startIndex + 1, (line) => {
    return stopMatchers.some(fn => fn(line));
  });

  return content.join("\n").trim();
}

function extractQuotedAfterMarker(lines, labels = []) {
  const startIndex = findLineIndex(lines, (line) =>
    labels.some(label => safeStartsWith(line, label))
  );
  if (startIndex < 0) return "";

  const current = lines[startIndex] || "";
  const inline = current.replace(/^.+?[:\-–]\s*/, "").trim();
  if (inline && inline !== current.trim()) {
    return inline.replace(/^["“”]+|["“”]+$/g, "").trim();
  }

  const content = collectUntilStop(lines, startIndex + 1, (line) => {
    return isHeadingLike(line);
  }).join(" ").trim();

  return content.replace(/^["“”]+|["“”]+$/g, "").trim();
}

function extractBetelTopicos(lines = []) {
  const blocks = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isTopicoLine(line) || isSubtopicoLine(line)) {
      if (current) blocks.push(current);

      const match = line.match(/^(\d+(?:\.\d+)?)\.\s*(.+?)\s*:\s*(.*)$/);
      if (match) {
        current = {
          numero: match[1],
          titulo: match[2].trim(),
          lines: [match[3].trim()].filter(Boolean)
        };
      } else {
        const match2 = line.match(/^(\d+(?:\.\d+)?)\.\s*(.+)$/);
        current = {
          numero: match2 ? match2[1] : "",
          titulo: match2 ? match2[2].trim() : line.trim(),
          lines: []
        };
      }
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
        safeStartsWith(line, "Eu ensinei que") ||
        safeStartsWith(line, "Hinos sugeridos") ||
        safeStartsWith(line, "Motivo de oração") ||
        safeStartsWith(line, "Motivo de oracao")
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

  return topicos.slice(0, 3);
}

function shortApplicationFromContent(sectionTitle = "", content = "", tipo = "adult") {
  const text = cleanInlineText(content);
  let shortBase = "";

  if (text) {
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
    shortBase = firstSentence.length > 180 ? `${firstSentence.slice(0, 177).trim()}...` : firstSentence.trim();
  }

  if (!shortBase) {
    shortBase = sectionTitle || "o ensino recebido";
  }

  if (tipo === "youth") {
    return `Os jovens devem transformar este ensino em atitudes concretas, vivendo essa verdade com fidelidade, discernimento e compromisso com Deus no dia a dia.`;
  }

  return `A classe deve colocar esse ensino em prática com maturidade, reverência e obediência, permitindo que a Palavra transforme a vida diária.`;
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
  const base = fallbackText(sectionContent, `O conteúdo referente a ${sectionTitle || "este ponto"} destaca princípios importantes da vida cristã.`);
  return [
    `No contexto da ${classe}, este ponto deve ser trabalhado de forma clara, organizada e pastoral, ajudando os alunos a compreenderem como "${lessonTitle || sectionTitle || "o tema da lição"}" se aplica à vida cristã.`,
    `${base} O professor pode explorar esse trecho com leitura em voz alta, perguntas dirigidas e observações que reforcem o sentido bíblico, doutrinário e formativo do ensino.`,
    `Pedagogicamente, é importante incentivar a participação da turma, retomando os conceitos principais, relacionando o assunto com experiências práticas e reforçando verdades que precisam ser guardadas no coração.`,
    `Ao final, este bloco deve servir como ponte entre conhecimento e vivência, mostrando que aprender a Palavra de Deus exige entendimento, reverência e compromisso com a obediência.`
  ].join("\n\n");
}

function buildApplicationText(sectionTitle = "", sectionContent = "", tipo = "adult") {
  return shortApplicationFromContent(sectionTitle, sectionContent, tipo);
}

function buildEuEnsineiQue(topicoTitulo = "") {
  return `Deus deseja que compreendamos ${fallbackText(topicoTitulo, "este ensino bíblico").toLowerCase()} com fidelidade, para vivermos a Sua Palavra com consciência, maturidade e prática cristã verdadeira.`;
}

function buildPointKey(titulo = "", intro = "") {
  return `O ensino desta lição mostra que ${fallbackText(titulo || intro, "o tema central da lição").toLowerCase()} deve ser compreendido com fé, responsabilidade e aplicação prática à vida cristã.`;
}

function dedupeParagraphs(text = "") {
  const parts = splitParagraphs(text);
  const seen = new Set();
  const filtered = [];

  for (const part of parts) {
    const norm = normalizeLabel(part);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    filtered.push(part);
  }

  return filtered.join("\n\n").trim();
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
    extractQuotedAfterMarker(lines, ["Ponto-Chave", "Ponto Chave"]) || "";

  const refletindo =
    extractQuotedAfterMarker(lines, ["Refletindo"]) || "";

  const subsidioEducador =
    extractInlineOrMultiline(
      lines,
      ["Subsídio para o Educador", "Subsidio para o Educador"],
      [
        (line) => safeStartsWith(line, "Conclusão"),
        (line) => safeStartsWith(line, "Conclusao"),
        (line) => safeStartsWith(line, "Complementando"),
        (line) => safeStartsWith(line, "Eu ensinei que"),
        (line) => safeStartsWith(line, "Hinos sugeridos"),
        (line) => safeStartsWith(line, "Motivo de oração"),
        (line) => safeStartsWith(line, "Motivo de oracao")
      ]
    ) || "";

  const complementando =
    extractInlineOrMultiline(
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
    extractInlineOrMultiline(
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
    const inline = current.replace(/^.+?[:\-–]\s*/, "").trim();

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

  const topicos = groupTopicos(extractBetelTopicos(lines)).map(topico => ({
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
    extractInlineOrMultiline(
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

  const conclusao = conclusaoBase.trim();

  const hinos =
    extractInlineOrMultiline(
      lines,
      ["Hinos sugeridos"],
      [
        (line) => safeStartsWith(line, "Motivo de oração"),
        (line) => safeStartsWith(line, "Motivo de oracao")
      ]
    ) || "";

  const motivoOracao =
    extractInlineOrMultiline(
      lines,
      ["Motivo de oração", "Motivo de oracao"],
      []
    ) || "";

  const analysis = buildAnalysisText(raw, extras.titulo || "", extras.tema || "");

  const apoioConclusaoBase = [
    conclusao,
    complementando,
    subsidioEducador
  ].filter(Boolean).join("\n\n");

  const apoioPedagogicoConclusao = dedupeParagraphs(
    buildSupportText("Conclusão", apoioConclusaoBase, extras.titulo || extras.tema || "", tipo)
  );

  const aplicacaoPraticaConclusao = buildApplicationText(
    "Conclusão",
    [conclusao, complementando, euEnsineiFinal].filter(Boolean).join("\n\n"),
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
    topicos,
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
  const label = isConclusion ? "📘 APOIO PEDAGÓGICO (CONCLUSÃO
