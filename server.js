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

function isHtml(text = "") {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(String(text || ""));
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

function chunkParagraphs(text = "", minPerBlock = 3, maxPerBlock = 4) {
  const parts = splitParagraphs(text);
  if (!parts.length) return [];

  const blocks = [];
  let i = 0;

  while (i < parts.length) {
    const remaining = parts.length - i;

    if (remaining <= maxPerBlock) {
      blocks.push(parts.slice(i));
      break;
    }

    blocks.push(parts.slice(i, i + minPerBlock));
    i += minPerBlock;
  }

  return blocks;
}

function toParagraphHtml(text = "") {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) {
    return `<p>${escapeHtml(String(text || "").trim())}</p>`;
  }

  return paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join("\n");
}

function cleanInlineText(text = "") {
  return normalizeLineBreaks(
    String(text)
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
  );
}

function stripAccents(str = "") {
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeLabel(str = "") {
  return stripAccents(String(str).toLowerCase()).trim();
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

function titleCasePreserve(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/(^|\s|[-–:])([a-zà-ú])/giu, (_, a, b) => `${a}${b.toUpperCase()}`);
}

function normalizeSpaces(text = "") {
  return String(text || "").replace(/[ \t]+/g, " ").trim();
}

function removeLeadingBullet(str = "") {
  return String(str || "").replace(/^[-•*]+\s*/, "").trim();
}

function fallbackSentence(text = "", fallback = "") {
  const clean = cleanInlineText(text);
  return clean || fallback;
}

function getFirstMeaningfulLine(text = "") {
  return splitLines(text)[0] || "";
}

function extractLessonIdentity(raw = "", numero = "", titulo = "") {
  const lines = splitLines(raw);
  const firstLine = lines[0] || "";

  let finalNumero = String(numero || "").trim();
  let finalTitulo = String(titulo || "").trim();

  const m = firstLine.match(/^li[cç][aã]o\s*(\d+)\s*[:\-–]\s*(.+)$/i);
  if (m) {
    if (!finalNumero) finalNumero = String(m[1] || "").trim();
    if (!finalTitulo) finalTitulo = String(m[2] || "").trim();
  }

  if (!finalTitulo && firstLine) {
    finalTitulo = firstLine.replace(/^li[cç][aã]o\s*\d+\s*[:\-–]\s*/i, "").trim();
  }

  return {
    numero: finalNumero,
    titulo: finalTitulo || "Lição"
  };
}

function extractSingleLineField(text = "", labels = []) {
  const lines = splitLines(text);

  for (const line of lines) {
    const lineNorm = normalizeLabel(line);

    for (const label of labels) {
      const labelNorm = normalizeLabel(label);
      if (lineNorm.startsWith(labelNorm)) {
        const raw = line.replace(new RegExp(`^${label}\\s*[:\\-–]?\\s*`, "i"), "").trim();
        if (raw) return raw;
      }
    }
  }

  return "";
}

function extractMultilineSection(text = "", labels = []) {
  const lines = splitLines(text);
  if (!lines.length) return "";

  const normalizedLabels = labels.map(normalizeLabel);

  const isHeader = (line) => {
    const lineNorm = normalizeLabel(line).replace(/[.:]$/, "").trim();
    return normalizedLabels.some(label => lineNorm === label || lineNorm.startsWith(`${label}:`));
  };

  for (let i = 0; i < lines.length; i++) {
    if (isHeader(lines[i])) {
      const current = lines[i];
      const currentInline = current.replace(/^.+?[:\-–]\s*/, "").trim();

      if (currentInline && normalizeLabel(currentInline) !== normalizeLabel(current)) {
        return currentInline;
      }

      const collected = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (isHeader(lines[j])) break;
        if (/^\d+(\.\d+)*\s*[:\-–]/.test(lines[j])) break;
        collected.push(lines[j]);
      }

      return collected.join("\n").trim();
    }
  }

  return "";
}

function extractTopicalBlocks(raw = "") {
  const lines = splitLines(raw);

  const blocks = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(/^(\d+(?:\.\d+)*)\s*[:\-–]\s*(.+)$/);

    if (match) {
      if (current) blocks.push(current);

      current = {
        numero: match[1],
        titulo: match[2].trim(),
        conteudoLines: []
      };
    } else if (current) {
      current.conteudoLines.push(line);
    }
  }

  if (current) blocks.push(current);

  return blocks.map(b => ({
    numero: b.numero,
    titulo: b.titulo,
    conteudo: b.conteudoLines.join("\n").trim()
  }));
}

function groupTopicos(blocks = []) {
  const topicosPrincipais = [];
  const mapa = new Map();

  for (const block of blocks) {
    const isSub = /^\d+\.\d+$/.test(block.numero);

    if (!isSub) {
      const top = {
        numero: block.numero,
        titulo: block.titulo,
        conteudo: block.conteudo,
        subtopicos: []
      };
      topicosPrincipais.push(top);
      mapa.set(block.numero, top);
      continue;
    }

    const parentKey = block.numero.split(".")[0];
    const parent = mapa.get(parentKey);

    if (parent) {
      parent.subtopicos.push({
        numero: block.numero,
        titulo: block.titulo,
        conteudo: block.conteudo
      });
    } else {
      const top = {
        numero: parentKey,
        titulo: `Tópico ${parentKey}`,
        conteudo: "",
        subtopicos: [{
          numero: block.numero,
          titulo: block.titulo,
          conteudo: block.conteudo
        }]
      };
      topicosPrincipais.push(top);
      mapa.set(parentKey, top);
    }
  }

  return topicosPrincipais;
}

function buildAnalysisText(raw = "", titulo = "", tema = "") {
  const introSeed = fallbackSentence(
    extractMultilineSection(raw, ["ANÁLISE GERAL DA LIÇÃO", "VISÃO GERAL", "COMENTÁRIO INTRODUTÓRIO"]),
    ""
  );

  if (introSeed) {
    const parts = splitParagraphs(introSeed);
    if (parts.length >= 4) return parts.join("\n\n");

    const base = parts.join(" ").trim() || introSeed;
    return [
      base,
      `Esta lição apresenta um panorama bíblico e doutrinário que ajuda a compreender com clareza o tema "${titulo || tema || "proposto"}" dentro da realidade da Escola Bíblica Dominical.`,
      `Ao longo do estudo, o professor pode destacar o desenvolvimento do assunto em sequência lógica, conectando o conteúdo principal aos subtópicos e enfatizando o valor espiritual, prático e pedagógico da mensagem.`,
      `Também é importante mostrar como a lição conduz o aluno a uma leitura reverente das Escrituras, fortalecendo convicções, ampliando a compreensão do texto bíblico e incentivando uma resposta concreta de fé e obediência.`,
      `Por isso, esta análise geral serve como visão ampla do estudo, preparando a turma para receber o conteúdo com atenção, participação e aplicação sincera à vida cristã.`
    ].join("\n\n");
  }

  return [
    `A lição "${titulo || tema || "proposta"}" oferece uma visão ampla do assunto estudado, conduzindo a turma a uma compreensão bíblica, doutrinária e prática do tema apresentado.`,
    `Em seu desenvolvimento, o conteúdo mostra como os princípios das Escrituras se conectam à vida cristã, ajudando o aluno a interpretar o texto com reverência, clareza e senso de responsabilidade espiritual.`,
    `Ao percorrer os tópicos e subtópicos, o professor poderá destacar verdades essenciais da Palavra de Deus, reforçando o valor do ensino fiel, da maturidade espiritual e da aplicação consciente da mensagem.`,
    `Assim, a análise geral da lição prepara a classe para estudar cada parte do conteúdo com maior profundidade, percepção espiritual e disposição para viver aquilo que foi ensinado.`
  ].join("\n\n");
}

function buildSupportText(sectionTitle = "", sectionContent = "", lessonTitle = "", tipo = "adult") {
  const classe = detectClasseLabel(tipo);
  const tema = lessonTitle || sectionTitle || "o tema da lição";
  const conteudoBase = fallbackSentence(sectionContent, `O conteúdo relacionado a ${sectionTitle || "este ponto"} enfatiza princípios importantes da Palavra de Deus.`);

  return [
    `No contexto da ${classe}, este ponto da lição deve ser trabalhado de forma clara, organizada e pastoral, ajudando os alunos a perceberem como ${tema} se relaciona com a vida cristã diária.`,
    `${conteudoBase} O professor pode explorar o texto com perguntas simples, leitura em voz alta e observações que destaquem o sentido bíblico, doutrinário e formativo do assunto estudado.`,
    `Pedagogicamente, é importante incentivar a participação da turma, retomando os conceitos centrais, relacionando o conteúdo com experiências reais e reforçando as verdades que precisam ser guardadas no coração.`,
    `Ao final da exposição, este bloco pode servir como ponte entre o conhecimento e a prática, mostrando que aprender a Palavra de Deus exige atenção, entendimento, reverência e compromisso com a obediência.`
  ].join("\n\n");
}

function buildApplicationText(sectionTitle = "", sectionContent = "", tipo = "adult") {
  const base = fallbackSentence(sectionContent, sectionTitle || "o conteúdo estudado");
  const start =
    tipo === "youth"
      ? `O aluno deve ser incentivado a aplicar ${base.toLowerCase()} em suas escolhas, atitudes e relacionamento com Deus.`
      : `A classe deve ser encorajada a colocar em prática ${base.toLowerCase()} no dia a dia cristão.`;

  return [
    start,
    `Este ensino precisa produzir postura, decisão e obediência concreta, para que a lição não fique apenas no conhecimento, mas transforme a maneira de pensar e viver.`
  ].join(" ");
}

function buildEuEnsineiQue(topicoTitulo = "", conteudo = "") {
  const base = fallbackSentence(topicoTitulo, "este ensino bíblico");
  return `Deus deseja que compreendamos ${base.toLowerCase()} com fidelidade, para vivermos a Sua Palavra com consciência, maturidade e prática cristã verdadeira.`;
}

function buildPointKey(titulo = "", conteudo = "") {
  const base = fallbackSentence(titulo || conteudo, "o tema central da lição");
  return `O ensino desta lição mostra que ${base.toLowerCase()} deve ser compreendido com fé, responsabilidade e aplicação prática à vida cristã.`;
}

function ensureMinimumTopicos(topicos = []) {
  const result = [...topicos];

  while (result.length < 3) {
    const n = String(result.length + 1);
    result.push({
      numero: n,
      titulo: `Tópico ${n}`,
      conteudo: `Desenvolvimento do tópico ${n}.`,
      subtopicos: [
        {
          numero: `${n}.1`,
          titulo: `Subtópico ${n}.1`,
          conteudo: `Desenvolvimento do subtópico ${n}.1.`
        },
        {
          numero: `${n}.2`,
          titulo: `Subtópico ${n}.2`,
          conteudo: `Desenvolvimento do subtópico ${n}.2.`
        }
      ]
    });
  }

  return result.slice(0, 3);
}

function extractSections(raw = "", tipo = "adult", extras = {}) {
  const text = normalizeLineBreaks(raw);

  const verse =
    extractSingleLineField(text, ["TEXTO ÁUREO", "TEXTO AUREO", "VERSÍCULO DO DIA", "VERSICULO DO DIA"]) ||
    "[Inserir versículo aqui]";

  const truth =
    extractSingleLineField(text, ["VERDADE APLICADA", "VERDADE PRÁTICA", "VERDADE PRATICA", "VERDADE CENTRAL"]) ||
    "[Inserir verdade aplicada aqui]";

  const refs =
    extractSingleLineField(text, [
      "TEXTOS DE REFERÊNCIA",
      "TEXTOS DE REFERENCIA",
      "TEXTO DE REFERÊNCIA",
      "TEXTO DE REFERENCIA",
      "LEITURA BÍBLICA",
      "LEITURA BIBLICA",
      "REFERÊNCIAS",
      "REFERENCIAS"
    ]) ||
    "[Inserir referências aqui]";

  const intro =
    extractMultilineSection(text, ["INTRODUÇÃO", "INTRODUCAO"]) ||
    "[Conteúdo da introdução]";

  const conclusao =
    extractMultilineSection(text, ["CONCLUSÃO", "CONCLUSAO"]) ||
    "[Conteúdo da conclusão]";

  const hinosOuOracao =
    extractMultilineSection(text, [
      "HINOS SUGERIDOS",
      "MOTIVO DE ORAÇÃO",
      "MOTIVO DE ORACAO",
      "HINOS SUGERIDOS / MOMENTO DE ORAÇÃO",
      "HINOS SUGERIDOS / MOMENTO DE ORACAO"
    ]) || "";

  const analysis = buildAnalysisText(text, extras.titulo || "", extras.tema || "");

  const allBlocks = extractTopicalBlocks(text);
  const grouped = groupTopicos(allBlocks);
  const topicos = ensureMinimumTopicos(grouped).map(topico => ({
    ...topico,
    apoioPedagogico: buildSupportText(topico.titulo, topico.conteudo, extras.titulo || extras.tema || "", tipo),
    aplicacaoPratica: buildApplicationText(topico.titulo, topico.conteudo, tipo),
    euEnsineiQue: buildEuEnsineiQue(topico.titulo, topico.conteudo),
    subtopicos: (topico.subtopicos || []).map(sub => ({
      ...sub,
      apoioPedagogico: buildSupportText(sub.titulo, sub.conteudo, extras.titulo || extras.tema || "", tipo),
      aplicacaoPratica: buildApplicationText(sub.titulo, sub.conteudo, tipo)
    }))
  }));

  const apoioPedagogicoConclusao = buildSupportText("Conclusão", conclusao, extras.titulo || extras.tema || "", tipo);
  const aplicacaoPraticaConclusao = buildApplicationText("Conclusão", conclusao, tipo);

  return {
    raw: text,
    verse,
    truth,
    refs,
    analysis,
    intro,
    topicos,
    conclusao,
    apoioPedagogicoConclusao,
    aplicacaoPraticaConclusao,
    hinosOuOracao
  };
}

function renderContentBlock(titleNumber, titleText, contentText) {
  return `<div><strong>${escapeHtml(titleNumber)}. ${escapeHtml(titleText)}:</strong> ${escapeHtml(contentText || "[Conteúdo original]")}</div>`;
}

function renderSubContentBlock(titleNumber, titleText, contentText) {
  return `<div><strong>${escapeHtml(titleNumber)}. ${escapeHtml(titleText)}:</strong> ${escapeHtml(contentText || "[Conteúdo original]")}</div>`;
}

function renderPedagogicalBlock(text = "", isConclusion = false) {
  const label = isConclusion ? "📘 APOIO PEDAGÓGICO (CONCLUSÃO):" : "📘 APOIO PEDAGÓGICO:";
  return `<div class="pedagogical-block"><strong>${label}</strong> ${toParagraphHtml(text)}</div>`;
}

function renderApplicationBlock(text = "", isConclusion = false) {
  const label = isConclusion ? "🎯 APLICAÇÃO PRÁTICA (CONCLUSÃO):" : "🎯 APLICAÇÃO PRÁTICA:";
  return `<div class="application-block"><strong>${label}</strong> ${escapeHtml(text || "[Aplicação prática]")}</div>`;
}

function buildAdultTopicosHtml(topicos = []) {
  return topicos.map(topico => {
    const subtopicosHtml = (topico.subtopicos || []).map(sub => {
      return [
        renderSubContentBlock(sub.numero, sub.titulo, sub.conteudo),
        renderPedagogicalBlock(sub.apoioPedagogico),
        renderApplicationBlock(sub.aplicacaoPratica)
      ].join("\n");
    }).join("\n\n");

    return [
      renderContentBlock(topico.numero, topico.titulo, topico.conteudo),
      renderPedagogicalBlock(topico.apoioPedagogico),
      renderApplicationBlock(topico.aplicacaoPratica),
      subtopicosHtml,
      `<div class="eu-ensinei"><strong>✨ Eu ensinei que:</strong> ${escapeHtml(topico.euEnsineiQue)}</div>`
    ].join("\n\n");
  }).join("\n\n");
}

function buildYouthTopicosHtml(topicos = []) {
  return topicos.map(topico => {
    const subtopicosHtml = (topico.subtopicos || []).map(sub => {
      return [
        renderSubContentBlock(sub.numero, sub.titulo, sub.conteudo),
        renderPedagogicalBlock(sub.apoioPedagogico),
        renderApplicationBlock(sub.aplicacaoPratica)
      ].join("\n");
    }).join("\n\n");

    return [
      renderContentBlock(topico.numero, topico.titulo, topico.conteudo),
      renderPedagogicalBlock(topico.apoioPedagogico),
      renderApplicationBlock(topico.aplicacaoPratica),
      subtopicosHtml,
      `<div class="eu-ensinei"><strong>✨ Eu ensinei que:</strong> ${escapeHtml(topico.euEnsineiQue)}</div>`
    ].join("\n\n");
  }).join("\n\n");
}

/* =========================================================
   MODELOS HTML
========================================================= */

function buildAdultHtml({
  numero,
  titulo,
  trimestre,
  data,
  refs,
  truth,
  verse,
  analysis,
  intro,
  topicos = [],
  conclusao,
  apoioPedagogicoConclusao,
  aplicacaoPraticaConclusao,
  hinosOuOracao
}) {
  const lessonTitle = titulo || "Lição";
  const lessonNumber = numero || "";
  const verseText = verse || "[Inserir versículo aqui]";
  const truthText = truth || "[Inserir verdade aplicada aqui]";
  const refsText = refs || "[Inserir referências aqui]";
  const analysisText = analysis || "[Conteúdo da análise geral]";
  const introText = intro || "[Conteúdo da introdução]";
  const topicosHtml = buildAdultTopicosHtml(topicos);
  const conclusaoText = conclusao || "[Conteúdo da conclusão]";
  const apoioConclusaoText = apoioPedagogicoConclusao || "[Conteúdo pedagógico]";
  const aplicConclusaoText = aplicacaoPraticaConclusao || "[Aplicação prática]";

  let hinos = "[Inserir hinos]";
  let motivoOracao = "[Inserir motivo de oração]";

  if (hinosOuOracao) {
    const parts = splitLines(hinosOuOracao);
    if (parts[0]) hinos = parts[0];
    if (parts[1]) motivoOracao = parts.slice(1).join(" ");
  }

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Lição ${escapeHtml(lessonNumber)} - ${escapeHtml(lessonTitle)} | EBD Adultos</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background-color: #eef0e8;
            font-family: 'Segoe UI', 'Inter', Roboto, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.55;
            padding: 2rem 1rem;
            color: #1e2a1c;
        }

        .lesson-container {
            max-width: 1100px;
            margin: 0 auto;
            background: white;
            border-radius: 2rem;
            box-shadow: 0 20px 35px -12px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            padding: 2rem 2rem 3rem;
            transition: all 0.2s;
        }

        .header-gradient {
            background: linear-gradient(115deg, #3b5a2b 0%, #6b4c2c 100%);
            color: white;
            padding: 2rem 2rem 1.8rem;
            margin: -2rem -2rem 2rem -2rem;
            border-bottom: 5px solid #e5b83c;
            border-radius: 0 0 2rem 2rem;
        }

        .lesson-number {
            font-size: 0.9rem;
            letter-spacing: 1px;
            text-transform: uppercase;
            background: rgba(255,255,240,0.2);
            display: inline-block;
            padding: 0.2rem 1rem;
            border-radius: 40px;
            margin-bottom: 0.75rem;
        }

        .lesson-title {
            font-size: 2rem;
            font-weight: 800;
            line-height: 1.2;
            margin: 0.5rem 0 0.25rem;
        }

        .lesson-meta {
            margin-top: 0.6rem;
            font-size: 0.92rem;
            opacity: 0.95;
        }

        strong {
            color: #5a3e2b;
            font-weight: 700;
        }

        .verse, .truth, .refs {
            margin: 1rem 0 1.2rem;
        }

        .pedagogical-block {
            background-color: #edf3e8;
            border-left: 6px solid #7fa06b;
            padding: 1.2rem 1.5rem;
            border-radius: 20px;
            margin: 1.5rem 0;
            font-size: 0.98rem;
        }

        .application-block {
            background-color: #fff4e5;
            border-left: 6px solid #f5c542;
            padding: 1rem 1.5rem;
            border-radius: 20px;
            margin: 1.2rem 0;
        }

        .eu-ensinei {
            background: #f9f7ef;
            padding: 0.8rem 1.5rem;
            border-radius: 40px;
            color: #c2691b;
            font-weight: 600;
            margin: 1.2rem 0;
            border: 1px solid #f0e0bc;
            text-align: center;
        }

        hr {
            margin: 1.5rem 0;
            border: none;
            height: 1px;
            background: linear-gradient(to right, #ddd2bc, transparent);
        }

        footer {
            text-align: center;
            margin-top: 2.5rem;
            font-size: 0.75rem;
            color: #9b8e76;
            border-top: 1px solid #e7dfd1;
            padding-top: 1.5rem;
        }

        .footer-print {
            text-align: center;
            margin-top: 2rem;
            margin-bottom: 0.5rem;
        }

        .print-btn {
            background-color: #6b4c2c;
            padding: 0.6rem 1.8rem;
            border-radius: 40px;
            font-size: 0.9rem;
            font-weight: 600;
            color: white;
            cursor: pointer;
            transition: 0.2s;
            border: none;
            font-family: inherit;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }

        .print-btn:hover {
            background-color: #4a341e;
            transform: scale(1.02);
        }

        p {
            margin: 0.7rem 0;
        }

        @media (max-width: 700px) {
            .lesson-container {
                padding: 1.5rem;
            }
            .header-gradient {
                padding: 1.5rem;
                margin: -1.5rem -1.5rem 1.5rem -1.5rem;
            }
            .lesson-title {
                font-size: 1.6rem;
            }
            body {
                padding: 0.8rem;
            }
        }

        @media print {
            body {
                background: white;
                padding: 0;
            }
            .print-btn {
                display: none;
            }
            .pedagogical-block, .application-block {
                break-inside: avoid;
            }
            .footer-print {
                display: none;
            }
        }
    </style>
</head>
<body>
<div class="lesson-container">
    <div class="header-gradient">
        <div class="lesson-number">📘 Escola Bíblica Dominical | Classe de Adultos</div>
        <div class="lesson-title">Lição ${escapeHtml(lessonNumber)}: ${escapeHtml(lessonTitle)}</div>
        <div class="lesson-meta">Trimestre ${escapeHtml(String(trimestre || ""))}${data ? " • " + escapeHtml(String(data)) : ""}</div>
    </div>

    <div class="verse"><strong>📖 TEXTO ÁUREO:</strong> ${escapeHtml(verseText)}</div>

    <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truthText)}</div>

    <div class="refs"><strong>📌 TEXTOS DE REFERÊNCIA:</strong> ${escapeHtml(refsText)}</div>

    <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>
    ${toParagraphHtml(analysisText)}
    </div>

    <div><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(introText)}</div>

    ${topicosHtml}

    <div><strong>CONCLUSÃO:</strong> ${escapeHtml(conclusaoText)}</div>
    ${renderPedagogicalBlock(apoioConclusaoText, true)}
    ${renderApplicationBlock(aplicConclusaoText, true)}

    <hr>
    <div><strong>🎵 HINOS SUGERIDOS:</strong> ${escapeHtml(hinos)}</div>
    <div><strong>🙏 MOTIVO DE ORAÇÃO:</strong> ${escapeHtml(motivoOracao)}</div>

    <div class="footer-print">
        <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    </div>

    <footer>Lição ${escapeHtml(lessonNumber)} — ${escapeHtml(lessonTitle)} | Base bíblica: ${escapeHtml(refsText)} | EBD Adultos</footer>
</div>
</body>
</html>`;
}

function buildYouthHtml({
  numero,
  titulo,
  trimestre,
  data,
  refs,
  truth,
  verse,
  analysis,
  intro,
  topicos = [],
  conclusao,
  apoioPedagogicoConclusao,
  aplicacaoPraticaConclusao,
  hinosOuOracao
}) {
  const lessonTitle = titulo || "Lição";
  const lessonNumber = numero || "";
  const verseText = verse || "[Inserir versículo aqui]";
  const truthText = truth || "[Inserir verdade aplicada aqui]";
  const refsText = refs || "[Inserir referências aqui]";
  const analysisText = analysis || "[Conteúdo da análise geral]";
  const introText = intro || "[Conteúdo da introdução]";
  const pointKeyText = buildPointKey(lessonTitle, introText);
  const topicosHtml = buildYouthTopicosHtml(topicos);
  const conclusaoText = conclusao || "[Conteúdo da conclusão]";
  const apoioConclusaoText = apoioPedagogicoConclusao || "[Conteúdo pedagógico]";
  const aplicConclusaoText = aplicacaoPraticaConclusao || "[Aplicação prática]";
  const hinosText = hinosOuOracao || "[Conteúdo]";

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Lição ${escapeHtml(lessonNumber)} - ${escapeHtml(lessonTitle)} | EBD Jovens</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background-color: #eef0e8;
            font-family: 'Segoe UI', 'Inter', Roboto, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
            line-height: 1.55;
            padding: 2rem 1rem;
            color: #1e2a1c;
        }

        .lesson-container {
            max-width: 1100px;
            margin: 0 auto;
            background: white;
            border-radius: 2rem;
            box-shadow: 0 20px 35px -12px rgba(0, 0, 0, 0.1);
            overflow: hidden;
            padding: 2rem 2rem 3rem;
            transition: all 0.2s;
        }

        .header-gradient {
            background: linear-gradient(115deg, #2c5f2d 0%, #8b5a2b 100%);
            color: white;
            padding: 2rem 2rem 1.8rem;
            margin: -2rem -2rem 2rem -2rem;
            border-bottom: 5px solid #e5b83c;
            border-radius: 0 0 2rem 2rem;
        }

        .lesson-number {
            font-size: 0.9rem;
            letter-spacing: 1px;
            text-transform: uppercase;
            background: rgba(255,255,240,0.2);
            display: inline-block;
            padding: 0.2rem 1rem;
            border-radius: 40px;
            margin-bottom: 0.75rem;
        }

        .lesson-title {
            font-size: 2rem;
            font-weight: 800;
            line-height: 1.2;
            margin: 0.5rem 0 0.25rem;
        }

        .lesson-meta {
            margin-top: 0.6rem;
            font-size: 0.92rem;
            opacity: 0.95;
        }

        strong {
            color: #5a3e2b;
            font-weight: 700;
        }

        .verse, .truth, .refs {
            margin: 1rem 0 1.2rem;
        }

        .pedagogical-block {
            background-color: #edf3e8;
            border-left: 6px solid #7fa06b;
            padding: 1.2rem 1.5rem;
            border-radius: 20px;
            margin: 1.5rem 0;
            font-size: 0.98rem;
        }

        .application-block {
            background-color: #fff4e5;
            border-left: 6px solid #f5c542;
            padding: 1rem 1.5rem;
            border-radius: 20px;
            margin: 1.2rem 0;
        }

        .eu-ensinei {
            background: #f9f7ef;
            padding: 0.8rem 1.5rem;
            border-radius: 40px;
            color: #c2691b;
            font-weight: 600;
            margin: 1.2rem 0;
            border: 1px solid #f0e0bc;
            text-align: center;
        }

        hr {
            margin: 1.5rem 0;
            border: none;
            height: 1px;
            background: linear-gradient(to right, #ddd2bc, transparent);
        }

        footer {
            text-align: center;
            margin-top: 2.5rem;
            font-size: 0.75rem;
            color: #9b8e76;
            border-top: 1px solid #e7dfd1;
            padding-top: 1.5rem;
        }

        .footer-print {
            text-align: center;
            margin-top: 2rem;
            margin-bottom: 0.5rem;
        }

        .print-btn {
            background-color: #8b5a2b;
            padding: 0.6rem 1.8rem;
            border-radius: 40px;
            font-size: 0.9rem;
            font-weight: 600;
            color: white;
            cursor: pointer;
            transition: 0.2s;
            border: none;
            font-family: inherit;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }

        .print-btn:hover {
            background-color: #6b451f;
            transform: scale(1.02);
        }

        p {
            margin: 0.7rem 0;
        }

        @media (max-width: 700px) {
            .lesson-container {
                padding: 1.5rem;
            }
            .header-gradient {
                padding: 1.5rem;
                margin: -1.5rem -1.5rem 1.5rem -1.5rem;
            }
            .lesson-title {
                font-size: 1.6rem;
            }
            body {
                padding: 0.8rem;
            }
        }

        @media print {
            body {
                background: white;
                padding: 0;
            }
            .print-btn {
                display: none;
            }
            .pedagogical-block, .application-block {
                break-inside: avoid;
            }
            .footer-print {
                display: none;
            }
        }
    </style>
</head>
<body>
<div class="lesson-container">
    <div class="header-gradient">
        <div class="lesson-number">📘 Escola Bíblica Dominical | Classe de Jovens</div>
        <div class="lesson-title">Lição ${escapeHtml(lessonNumber)}: ${escapeHtml(lessonTitle)}</div>
        <div class="lesson-meta">Trimestre ${escapeHtml(String(trimestre || ""))}${data ? " • " + escapeHtml(String(data)) : ""}</div>
    </div>

    <div class="verse"><strong>📖 TEXTO ÁUREO / VERSÍCULO DO DIA:</strong> ${escapeHtml(verseText)}</div>

    <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truthText)}</div>

    <div class="refs"><strong>📌 TEXTO DE REFERÊNCIA:</strong> ${escapeHtml(refsText)}</div>

    <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>
    ${toParagraphHtml(analysisText)}
    </div>

    <div><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(introText)}</div>

    <div class="eu-ensinei" style="background:#e8f0e0;"><strong>🔑 Ponto-Chave:</strong> ${escapeHtml(pointKeyText)}</div>

    ${topicosHtml}

    <div><strong>CONCLUSÃO:</strong> ${escapeHtml(conclusaoText)}</div>
    ${renderPedagogicalBlock(apoioConclusaoText, true)}
    ${renderApplicationBlock(aplicConclusaoText, true)}

    <hr>
    <div><strong>🎵 HINOS SUGERIDOS / MOMENTO DE ORAÇÃO:</strong> ${escapeHtml(hinosText)}</div>

    <div class="footer-print">
        <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    </div>

    <footer>${escapeHtml(lessonTitle)} | Base bíblica: ${escapeHtml(refsText)} | EBD Jovens</footer>
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

  const conteudoHtml =
    finalTipo === "youth"
      ? buildYouthHtml({
          numero: finalNumero,
          titulo: finalTitulo,
          trimestre,
          data,
          refs: sections.refs,
          truth: sections.truth,
          verse: sections.verse,
          analysis: sections.analysis,
          intro: sections.intro,
          topicos: sections.topicos,
          conclusao: sections.conclusao,
          apoioPedagogicoConclusao: sections.apoioPedagogicoConclusao,
          aplicacaoPraticaConclusao: sections.aplicacaoPraticaConclusao,
          hinosOuOracao: sections.hinosOuOracao
        })
      : buildAdultHtml({
          numero: finalNumero,
          titulo: finalTitulo,
          trimestre,
          data,
          refs: sections.refs,
          truth: sections.truth,
          verse: sections.verse,
          analysis: sections.analysis,
          intro: sections.intro,
          topicos: sections.topicos,
          conclusao: sections.conclusao,
          apoioPedagogicoConclusao: sections.apoioPedagogicoConclusao,
          aplicacaoPraticaConclusao: sections.aplicacaoPraticaConclusao,
          hinosOuOracao: sections.hinosOuOracao
        });

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
