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
  const inline = current.replace(/^.+?[:\-–]\s*/, "").trim();
  if (inline && inline !== current.trim()) return inline;

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
  const inline = current.replace(/^.+?[:\-–]\s*/, "").trim();

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
  const base = fallbackText(sectionContent, `O conteúdo referente a ${sectionTitle || "este ponto"} destaca princípios importantes da vida cristã.`);
  return [
    `No contexto da ${classe}, este ponto deve ser trabalhado de forma clara, organizada e pastoral, ajudando os alunos a compreenderem como "${lessonTitle || sectionTitle || "o tema da lição"}" se aplica à vida cristã.`,
    `${base} O professor pode explorar esse trecho com leitura em voz alta, perguntas dirigidas e observações que reforcem o sentido bíblico, doutrinário e formativo do ensino.`,
    `Pedagogicamente, é importante incentivar a participação da turma, retomando os conceitos principais, relacionando o assunto com experiências práticas e reforçando verdades que precisam ser guardadas no coração.`,
    `Ao final, este bloco deve servir como ponte entre conhecimento e vivência, mostrando que aprender a Palavra de Deus exige entendimento, reverência e compromisso com a obediência.`
  ].join("\n\n");
}

function buildApplicationText(sectionTitle = "", sectionContent = "", tipo = "adult") {
  const base = fallbackText(sectionContent, sectionTitle || "o ensino estudado");
  const start =
    tipo === "youth"
      ? `O aluno deve ser incentivado a aplicar ${base.toLowerCase()} em suas escolhas, atitudes e relacionamento com Deus.`
      : `A classe deve ser encorajada a colocar em prática ${base.toLowerCase()} no dia a dia cristão.`;

  return `${start} Este ensino precisa produzir postura, decisão e obediência concreta, para que a lição não fique apenas no conhecimento, mas transforme a maneira de pensar e viver.`;
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

  let apoioPedagogicoConclusao = buildSupportText(
    "Conclusão",
    [conclusao, complementando, subsidioEducador].filter(Boolean).join("\n\n"),
    extras.titulo || extras.tema || "",
    tipo
  );

  let aplicacaoPraticaConclusao = buildApplicationText(
    "Conclusão",
    [conclusao, complementando, euEnsineiFinal].filter(Boolean).join("\n\n"),
    tipo
  );

  if (subsidioEducador) {
    apoioPedagogicoConclusao = `${apoioPedagogicoConclusao}\n\n${subsidioEducador}`;
  }

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
        .lesson-container { max-width: 1100px; margin: 0 auto; background: white; border-radius: 2rem; box-shadow: 0 20px 35px -12px rgba(0, 0, 0, 0.1); overflow: hidden; padding: 2rem 2rem 3rem; }
        .header-gradient { background: linear-gradient(115deg, #3b5a2b 0%, #6b4c2c 100%); color: white; padding: 2rem 2rem 1.8rem; margin: -2rem -2rem 2rem -2rem; border-bottom: 5px solid #e5b83c; border-radius: 0 0 2rem 2rem; }
        .lesson-number { font-size: 0.9rem; letter-spacing: 1px; text-transform: uppercase; background: rgba(255,255,240,0.2); display: inline-block; padding: 0.2rem 1rem; border-radius: 40px; margin-bottom: 0.75rem; }
        .lesson-title { font-size: 2rem; font-weight: 800; line-height: 1.2; margin: 0.5rem 0 0.25rem; }
        .lesson-meta { margin-top: 0.6rem; font-size: 0.92rem; opacity: 0.95; }
        strong { color: #5a3e2b; font-weight: 700; }
        .verse, .truth, .refs { margin: 1rem 0 1.2rem; }
        .pedagogical-block { background-color: #edf3e8; border-left: 6px solid #7fa06b; padding: 1.2rem 1.5rem; border-radius: 20px; margin: 1.5rem 0; font-size: 0.98rem; }
        .application-block { background-color: #fff4e5; border-left: 6px solid #f5c542; padding: 1rem 1.5rem; border-radius: 20px; margin: 1.2rem 0; }
        .eu-ensinei { background: #f9f7ef; padding: 0.8rem 1.5rem; border-radius: 40px; color: #c2691b; font-weight: 600; margin: 1.2rem 0; border: 1px solid #f0e0bc; text-align: center; }
        hr { margin: 1.5rem 0; border: none; height: 1px; background: linear-gradient(to right, #ddd2bc, transparent); }
        footer { text-align: center; margin-top: 2.5rem; font-size: 0.75rem; color: #9b8e76; border-top: 1px solid #e7dfd1; padding-top: 1.5rem; }
        .footer-print { text-align: center; margin-top: 2rem; margin-bottom: 0.5rem; }
        .print-btn { background-color: #6b4c2c; padding: 0.6rem 1.8rem; border-radius: 40px; font-size: 0.9rem; font-weight: 600; color: white; cursor: pointer; border: none; font-family: inherit; }
        .print-btn:hover { background-color: #4a341e; }
        p { margin: 0.7rem 0; }
        @media (max-width: 700px) {
            .lesson-container { padding: 1.5rem; }
            .header-gradient { padding: 1.5rem; margin: -1.5rem -1.5rem 1.5rem -1.5rem; }
            .lesson-title { font-size: 1.6rem; }
            body { padding: 0.8rem; }
        }
        @media print {
            body { background: white; padding: 0; }
            .print-btn, .footer-print { display: none; }
            .pedagogical-block, .application-block { break-inside: avoid; }
        }
    </style>
</head>
<body>
<div class="lesson-container">
    <div class="header-gradient">
        <div class="lesson-number">📘 Escola Bíblica Dominical | Classe de Adultos</div>
        <div class="lesson-title">Lição ${escapeHtml(numero)}: ${escapeHtml(titulo)}</div>
        <div class="lesson-meta">Trimestre ${escapeHtml(String(trimestre || ""))}${lessonDate ? " • " + escapeHtml(String(lessonDate)) : ""}</div>
    </div>

    <div class="verse"><strong>📖 TEXTO ÁUREO:</strong> ${escapeHtml(verse)}</div>
    <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truth)}</div>
    <div class="refs"><strong>📌 TEXTOS DE REFERÊNCIA:</strong> ${escapeHtml(refs)}</div>

    <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>${toParagraphHtml(analysis)}</div>

    <div><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(intro)}</div>

    ${buildTopicosHtml(topicos)}

    <div><strong>CONCLUSÃO:</strong> ${escapeHtml(conclusao)}</div>
    ${renderPedagogicalBlock(apoioPedagogicoConclusao, true)}
    ${renderApplicationBlock(aplicacaoPraticaConclusao, true)}

    <hr>
    <div><strong>🎵 HINOS SUGERIDOS:</strong> ${escapeHtml(hinos || "[Inserir hinos]")}</div>
    <div><strong>🙏 MOTIVO DE ORAÇÃO:</strong> ${escapeHtml(motivoOracao || "[Inserir motivo de oração]")}</div>

    <div class="footer-print">
        <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    </div>

    <footer>Lição ${escapeHtml(numero)} — ${escapeHtml(titulo)} | Base bíblica: ${escapeHtml(refs)} | EBD Adultos</footer>
</div>
</body>
</html>`;
}

function buildYouthHtml(data) {
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
    pontoChave,
    refletindo,
    topicos,
    conclusao,
    apoioPedagogicoConclusao,
    aplicacaoPraticaConclusao,
    hinos
  } = data;

  const pointKey = pontoChave || buildPointKey(titulo, intro);

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Lição ${escapeHtml(numero)} - ${escapeHtml(titulo)} | EBD Jovens</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background-color: #eef0e8; font-family: 'Segoe UI', 'Inter', Roboto, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.55; padding: 2rem 1rem; color: #1e2a1c; }
        .lesson-container { max-width: 1100px; margin: 0 auto; background: white; border-radius: 2rem; box-shadow: 0 20px 35px -12px rgba(0, 0, 0, 0.1); overflow: hidden; padding: 2rem 2rem 3rem; }
        .header-gradient { background: linear-gradient(115deg, #2c5f2d 0%, #8b5a2b 100%); color: white; padding: 2rem 2rem 1.8rem; margin: -2rem -2rem 2rem -2rem; border-bottom: 5px solid #e5b83c; border-radius: 0 0 2rem 2rem; }
        .lesson-number { font-size: 0.9rem; letter-spacing: 1px; text-transform: uppercase; background: rgba(255,255,240,0.2); display: inline-block; padding: 0.2rem 1rem; border-radius: 40px; margin-bottom: 0.75rem; }
        .lesson-title { font-size: 2rem; font-weight: 800; line-height: 1.2; margin: 0.5rem 0 0.25rem; }
        .lesson-meta { margin-top: 0.6rem; font-size: 0.92rem; opacity: 0.95; }
        strong { color: #5a3e2b; font-weight: 700; }
        .verse, .truth, .refs { margin: 1rem 0 1.2rem; }
        .pedagogical-block { background-color: #edf3e8; border-left: 6px solid #7fa06b; padding: 1.2rem 1.5rem; border-radius: 20px; margin: 1.5rem 0; font-size: 0.98rem; }
        .application-block { background-color: #fff4e5; border-left: 6px solid #f5c542; padding: 1rem 1.5rem; border-radius: 20px; margin: 1.2rem 0; }
        .eu-ensinei { background: #f9f7ef; padding: 0.8rem 1.5rem; border-radius: 40px; color: #c2691b; font-weight: 600; margin: 1.2rem 0; border: 1px solid #f0e0bc; text-align: center; }
        hr { margin: 1.5rem 0; border: none; height: 1px; background: linear-gradient(to right, #ddd2bc, transparent); }
        footer { text-align: center; margin-top: 2.5rem; font-size: 0.75rem; color: #9b8e76; border-top: 1px solid #e7dfd1; padding-top: 1.5rem; }
        .footer-print { text-align: center; margin-top: 2rem; margin-bottom: 0.5rem; }
        .print-btn { background-color: #8b5a2b; padding: 0.6rem 1.8rem; border-radius: 40px; font-size: 0.9rem; font-weight: 600; color: white; cursor: pointer; border: none; font-family: inherit; }
        .print-btn:hover { background-color: #6b451f; }
        p { margin: 0.7rem 0; }
        @media (max-width: 700px) {
            .lesson-container { padding: 1.5rem; }
            .header-gradient { padding: 1.5rem; margin: -1.5rem -1.5rem 1.5rem -1.5rem; }
            .lesson-title { font-size: 1.6rem; }
            body { padding: 0.8rem; }
        }
        @media print {
            body { background: white; padding: 0; }
            .print-btn, .footer-print { display: none; }
            .pedagogical-block, .application-block { break-inside: avoid; }
        }
    </style>
</head>
<body>
<div class="lesson-container">
    <div class="header-gradient">
        <div class="lesson-number">📘 Escola Bíblica Dominical | Classe de Jovens</div>
        <div class="lesson-title">Lição ${escapeHtml(numero)}: ${escapeHtml(titulo)}</div>
        <div class="lesson-meta">Trimestre ${escapeHtml(String(trimestre || ""))}${lessonDate ? " • " + escapeHtml(String(lessonDate)) : ""}</div>
    </div>

    <div class="verse"><strong>📖 TEXTO ÁUREO / VERSÍCULO DO DIA:</strong> ${escapeHtml(verse)}</div>
    <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truth)}</div>
    <div class="refs"><strong>📌 TEXTO DE REFERÊNCIA:</strong> ${escapeHtml(refs)}</div>

    <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>${toParagraphHtml(analysis)}</div>

    <div><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(intro)}</div>

    <div class="eu-ensinei" style="background:#e8f0e0;"><strong>🔑 Ponto-Chave:</strong> ${escapeHtml(pointKey)}</div>

    ${refletindo ? `<div class="eu-ensinei"><strong>💬 Refletindo:</strong> ${escapeHtml(refletindo)}</div>` : ""}

    ${buildTopicosHtml(topicos)}

    <div><strong>CONCLUSÃO:</strong> ${escapeHtml(conclusao)}</div>
    ${renderPedagogicalBlock(apoioPedagogicoConclusao, true)}
    ${renderApplicationBlock(aplicacaoPraticaConclusao, true)}

    <hr>
    <div><strong>🎵 HINOS SUGERIDOS / MOMENTO DE ORAÇÃO:</strong> ${escapeHtml(hinos || "[Conteúdo]")}</div>

    <div class="footer-print">
        <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    </div>

    <footer>${escapeHtml(titulo)} | Base bíblica: ${escapeHtml(refs)} | EBD Jovens</footer>
</div>
</body>
</html>`;
}

/* =========================================================
   GERAÇÃO
========================================================= */

function smartTemplate({
  numero,
  titulo,
  conteudoBase,
  textoBase,
  publico,
  tipo,
  trimestre,
  data,
  mode,
  tema,
  objetivo,
  tom,
  instrucoes,
  formato
}) {
  const finalTipo = detectTipo(publico, tipo);
  const rawInput = normalizeLineBreaks(conteudoBase || textoBase || "");
  const identity = extractLessonIdentity(rawInput, numero, titulo);

  const finalNumero = identity.numero;
  const finalTitulo = identity.titulo;
  const finalPublico = publico || (finalTipo === "youth" ? "jovens" : "adultos");

  if (isHtml(rawInput)) {
    return {
      ok: true,
      numero: finalNumero,
      titulo: finalTitulo,
      publico: finalPublico,
      tipo: finalTipo,
      trimestre: trimestre || "",
      data: data || "",
      mode: mode || "smart_template",
      formato: formato || "html",
      conteudo: rawInput,
      conteudoHtml: rawInput,
      texto: stripHtml(rawInput),
      markdown: stripHtml(rawInput)
    };
  }

  const sections = extractSections(rawInput, finalTipo, {
    titulo: finalTitulo,
    tema,
    objetivo,
    tom,
    instrucoes
  });

  const payload = {
    numero: finalNumero,
    titulo: finalTitulo,
    trimestre: trimestre || "",
    data: data || "",
    refs: sections.refs,
    truth: sections.truth,
    verse: sections.verse,
    analysis: sections.analysis,
    intro: sections.intro,
    pontoChave: sections.pontoChave,
    refletindo: sections.refletindo,
    topicos: sections.topicos,
    conclusao: sections.conclusao,
    apoioPedagogicoConclusao: sections.apoioPedagogicoConclusao,
    aplicacaoPraticaConclusao: sections.aplicacaoPraticaConclusao,
    hinos: sections.hinos,
    motivoOracao: sections.motivoOracao
  };

  const conteudoHtml =
    finalTipo === "youth"
      ? buildYouthHtml(payload)
      : buildAdultHtml(payload);

  return {
    ok: true,
    numero: finalNumero,
    titulo: finalTitulo,
    publico: finalPublico,
    tipo: finalTipo,
    trimestre: trimestre || "",
    data: data || "",
    mode: mode || "smart_template",
    formato: formato || "html",
    conteudo: rawInput,
    conteudoHtml,
    texto: rawInput,
    markdown: rawInput,
    secoes: sections
  };
}

function generateLessonFromRequest(body = {}) {
  const {
    numero,
    titulo,
    conteudoBase,
    textoBase,
    publico,
    tipo,
    trimestre,
    data,
    mode,
    tema,
    objetivo,
    tom,
    instrucoes,
    formato
  } = body || {};

  return smartTemplate({
    numero,
    titulo,
    conteudoBase,
    textoBase,
    publico,
    tipo,
    trimestre,
    data,
    mode,
    tema,
    objetivo,
    tom,
    instrucoes,
    formato
  });
}

/* =========================================================
   ENDPOINTS
========================================================= */

app.post("/api/gerar-licao", (req, res) => {
  try {
    const lesson = generateLessonFromRequest(req.body || {});
    return res.json({
      ok: true,
      content: lesson.conteudoHtml || lesson.conteudo || lesson.texto || "",
      html: lesson.conteudoHtml || "",
      lesson
    });
  } catch (err) {
    console.error("Erro em /api/gerar-licao:", err);
    return res.status(500).json({
      ok: false,
      error: "Erro ao gerar lição"
    });
  }
});

app.post("/api/admin/deepseek/generate", async (req, res) => {
  try {
    const lesson = generateLessonFromRequest(req.body || {});
    return res.json({
      ok: true,
      content: lesson.conteudoHtml || lesson.conteudo || lesson.texto || "",
      html: lesson.conteudoHtml || "",
      lesson
    });
  } catch (err) {
    console.error("Erro em /api/admin/deepseek/generate:", err);
    return res.status(500).json({
      ok: false,
      error: "Erro no DeepSeek"
    });
  }
});

app.post("/api/admin/deepseek/refinar", async (req, res) => {
  try {
    const { texto } = req.body || {};
    const refinado = normalizeLineBreaks(texto);
    return res.json({
      ok: true,
      content: refinado,
      texto: refinado
    });
  } catch (err) {
    console.error("Erro em /api/admin/deepseek/refinar:", err);
    return res.status(500).json({
      ok: false,
      error: "Erro ao refinar"
    });
  }
});

app.get("/", (req, res) => {
  res.send("EBD Fiel Server OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
