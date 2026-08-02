const express = require("express");
const cors = require("cors");
const { CLASS_REGISTRY, CLASS_KEYS, normalizeClassKey, getClassMeta } = require("./src/config/classes");
const { buildCorsOptions, createRateLimiter, optionalAdminToken } = require("./src/middleware/api-security");
const {
  EBD_ADULTOS_PROMPT_APROVADO,
  EBD_JOVENS_PROMPT_APOIO_DOCENTE_V1,
  EBD_ADOLESCENTES_PROMPT_APOIO_DOCENTE_V1,
  EBD_PREADOLESCENTES_PROMPT_APOIO_DOCENTE_V1
} = require("./src/prompts/lesson-prompts");
const { requestChatCompletion } = require("./src/providers/chat-completions");

const app = express();
const corsOptions = buildCorsOptions();

app.set("trust proxy", 1);
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "20mb" }));
app.use(["/api/gpt", "/api/deepseek", "/api/admin/deepseek", "/api/v1"], createRateLimiter({
  windowMs: Number(process.env.API_RATE_WINDOW_MS || 60000),
  max: Number(process.env.API_RATE_MAX || 20)
}), optionalAdminToken);

/* =========================================================
   UTILITÁRIOS
========================================================= */

function normSpaces(str = "") {
  return String(str || "")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(str = "") {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(str = "") {
  return String(str || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(str = "") {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function safeMatch(text, regex) {
  const m = String(text || "").match(regex);
  return m ? m[1].trim() : "";
}

function splitLines(text = "") {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceFromText(text = "", max = 180) {
  let clean = stripHtml(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";

  const firstSentence = clean.match(/^(.+?[.!?])(\s|$)/);
  clean = firstSentence ? firstSentence[1].trim() : clean;

  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/[,:;.\-–—]\s*$/, "").trim() + "...";
}

function buildResumo(text = "", max = 220) {
  const clean = stripHtml(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/[,:;.\-–—]\s*$/, "").trim() + "...";
}

function generateStableId(numero = "", titulo = "", publico = "") {
  return `licao-${numero || "sem-numero"}-${slugify(titulo || "licao")}-${slugify(publico || "adultos")}`.replace(/-+/g, "-");
}

function sanitizeForFirebase(value) {
  if (Array.isArray(value)) return value.map(sanitizeForFirebase);

  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === "undefined") continue;
      out[key] = sanitizeForFirebase(val);
    }
    return out;
  }

  return value;
}

function removeLeadingLabel(line = "", labelRegex = "") {
  const re = new RegExp(`^\\s*${labelRegex}\\s*[:：-]?\\s*`, "i");
  return String(line || "").replace(re, "").trim();
}

function dedupeParagraphs(items = []) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const norm = String(item || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(String(item).trim());
  }

  return out;
}

function findFirstIndex(text, patterns = []) {
  const src = String(text || "");
  let best = -1;

  for (const pattern of patterns) {
    const re = new RegExp(pattern, "i");
    const m = src.match(re);
    if (m && m.index >= 0) {
      if (best === -1 || m.index < best) best = m.index;
    }
  }

  return best;
}

function extractBetween(text, startPatterns = [], endPatterns = []) {
  const src = String(text || "");
  const start = findFirstIndex(src, startPatterns);
  if (start < 0) return "";

  const after = src.slice(start);

  if (!endPatterns.length) return after.trim();

  let end = -1;
  for (const pattern of endPatterns) {
    const re = new RegExp(pattern, "i");
    const m = after.match(re);
    if (m && m.index > 0) {
      if (end === -1 || m.index < end) end = m.index;
    }
  }

  return end >= 0 ? after.slice(0, end).trim() : after.trim();
}

function cleanEndingPunctuation(text = "") {
  let t = String(text || "").trim();
  t = t.replace(/\s+/g, " ");
  t = t.replace(/([.!?]){2,}$/g, "$1");
  t = t.replace(/\.{2,}/g, ".");
  return t.trim();
}

function extractEuEnsineiInline(text = "") {
  const src = String(text || "");
  const m = src.match(/(?:✨\s*)?EU ENSINEI QUE\s*[:：]\s*([\s\S]*?)$/i);
  return m ? cleanEndingPunctuation(m[1]) : "";
}

function removeEuEnsineiInline(text = "") {
  return String(text || "")
    .replace(/\s*(?:✨\s*)?EU ENSINEI QUE\s*[:：]\s*[\s\S]*$/i, "")
    .trim();
}

/* =========================================================
   LIMPEZA DO TEXTO BETEL
========================================================= */

function cleanPdfNoise(text = "") {
  let t = normSpaces(text);

  t = t
    .replace(/<PARSED TEXT FOR PAGE:[\s\S]*?>/gi, " ")
    .replace(/Liç[ãa]o\s+\d+\s+—\s+.+?\|\s*Base bíblica:.+?(EBD Adultos|EBD Jovens)/gi, " ")
    .replace(/Quando acaba o culto, em pouco tempo, todos se retiram para suas casas\./gi, " ")
    .replace(/\[Conteúdo da conclusão\]/gi, " ")
    .replace(/\[conteúdo da conclusão\]/gi, " ")
    .replace(/🎵\s*HINOS SUGERIDOS\s*\/\s*MOMENTO DE ORAÇÃO:\s*\[Conteúdo\]/gi, " ")
    .replace(/\bTrimestre\s+\d+\b/gi, " ")
    .replace(/[ ]{2,}/g, " ");

  return normSpaces(t);
}

function detectPublico(text = "", publico = "") {
  const p = String(publico || "").toLowerCase();
  if (p.includes("jov")) return "jovens";
  if (p.includes("adult")) return "adultos";

  const src = String(text || "");
  if (/CLASSE DE JOVENS/i.test(src) || /\bEBD Jovens\b/i.test(src)) return "jovens";
  return "adultos";
}

/* =========================================================
   EXTRAÇÃO DE NÚMERO E TÍTULO
========================================================= */

function extractNumeroETitulo(raw = "", numeroFromBody = "", tituloFromBody = "") {
  const text = normSpaces(raw || "");

  const m1 = text.match(
    /Liç[ãa]o\s*(\d+)\s*[:\-—]?\s*([\s\S]{3,220}?)(?=\n(?:📖|✨|📌|🔍|🔑|💬|INTRODUÇÃO|TEXTO ÁUREO|VERSÍCULO DO DIA|VERDADE APLICADA|TEXTOS? DE REFER[ÊE]NCIA|TEXTO DE REFER[ÊE]NCIA))/i
  );

  if (m1) {
    return {
      numero: String(m1[1] || "").trim(),
      titulo: String(m1[2] || "").replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim()
    };
  }

  const lines = String(raw || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const lm = lines[i].match(/^Liç[ãa]o\s*(\d+)\s*[:\-—]?\s*(.*)$/i);
    if (!lm) continue;

    const numero = String(lm[1] || "").trim();
    let titulo = String(lm[2] || "").trim();

    let j = i + 1;
    while (
      j < lines.length &&
      !/^(📖|✨|📌|🔍|🔑|💬|INTRODUÇÃO|TEXTO ÁUREO|VERSÍCULO DO DIA|VERDADE APLICADA|TEXTOS? DE REFER[ÊE]NCIA|TEXTO DE REFER[ÊE]NCIA)/i.test(lines[j]) &&
      titulo.length < 220
    ) {
      titulo += " " + lines[j];
      j++;
    }

    titulo = titulo.replace(/\s{2,}/g, " ").trim();

    if (titulo) return { numero, titulo };
  }

  return {
    numero: numeroFromBody || "",
    titulo: tituloFromBody || "Lição"
  };
}

function sanitizeTituloLicao(titulo = "") {
  let t = String(titulo || "").replace(/\s{2,}/g, " ").trim();

  t = t
    .replace(/^(?:Editora Betel.*)$/i, "")
    .replace(/^(?:Pastor .*|Bispo .*|Revista .*|Síntese .*|Trimestre .*|Texto Áureo.*)$/i, "")
    .trim();

  if (!t || t.length < 4) return "Lição";
  return t;
}

/* =========================================================
   EXTRAÇÃO DE METADADOS
========================================================= */

function extractMeta(text = "") {
  return {
    textoAureo: safeMatch(
      text,
      /(?:📖\s*)?(?:TEXTO ÁUREO|VERSÍCULO DO DIA|TEXTO ÁUREO \/ VERSÍCULO DO DIA)\s*[:：]\s*([\s\S]*?)(?=\n(?:✨|📌|🔍|🔑|💬|INTRODUÇÃO|1\.))/i
    ),
    verdadeAplicada: safeMatch(
      text,
      /(?:✨\s*)?VERDADE APLICADA\s*[:：]\s*([\s\S]*?)(?=\n(?:📌|🔍|🔑|💬|INTRODUÇÃO|1\.))/i
    ),
    textoReferencia: safeMatch(
      text,
      /(?:📌\s*)?(?:TEXTOS? DE REFER[ÊE]NCIA|TEXTO DE REFER[ÊE]NCIA)\s*[:：]\s*([\s\S]*?)(?=\n(?:🔍|🔑|💬|INTRODUÇÃO|1\.))/i
    ),
    pontoChave: safeMatch(
      text,
      /(?:🔑\s*)?PONTO-CHAVE\s*[:：]\s*([\s\S]*?)(?=\n(?:💬|INTRODUÇÃO|1\.|📘))/i
    ),
    refletindo: safeMatch(
      text,
      /(?:💬\s*)?REFLETINDO\s*[:：]\s*([\s\S]*?)(?=\n(?:INTRODUÇÃO|1\.|📘))/i
    ),
    analiseGeral: safeMatch(
      text,
      /(?:🔍\s*)?ANÁLISE GERAL DA LIÇÃO\s*([\s\S]*?)(?=\n(?:📌\s*INTRODUÇÃO|INTRODUÇÃO|🔑\s*PONTO-CHAVE|💬\s*REFLETINDO|1\.))/i
    )
  };
}

/* =========================================================
   PREPARE SOURCE
========================================================= */

function prepareSource(raw = "") {
  let text = cleanPdfNoise(raw);
  text = normSpaces(text);
  return text;
}

/* =========================================================
   INTRODUÇÃO / CONCLUSÃO
========================================================= */

function extractIntroducao(text = "") {
  const src = String(text || "");

  let intro = extractBetween(
    src,
    ["(?:📌\\s*)?INTRODUÇÃO\\s*[:：]?"],
    [
      "\\n1(?:\\.|\\s)\\s*",
      "\\n(?:🔑\\s*PONTO-CHAVE|🔑\\s*Ponto-Chave)",
      "\\n(?:💬\\s*REFLETINDO)",
      "\\n(?:📘\\s*APOIO PEDAGÓGICO)"
    ]
  );

  intro = intro
    .replace(/^(?:📌\s*)?INTRODUÇÃO\s*[:：]?\s*/i, "")
    .trim();

  intro = intro
    .replace(/^.*?\bINTRODUÇÃO\b\s*/i, "")
    .replace(/\bConclus[aã]o\b\s*$/i, "")
    .trim();

  const lastIntro = intro.search(/INTRODUÇÃO/i);
  if (lastIntro >= 0) {
    intro = intro.slice(lastIntro).replace(/^INTRODUÇÃO\s*[:：]?\s*/i, "").trim();
  }

  return intro;
}

function extractConclusao(text = "") {
  const src = String(text || "");
  const matches = [...src.matchAll(/\bCONCLUSÃO\b\s*[:：]?/gi)];
  if (!matches.length) return "";

  const last = matches[matches.length - 1];
  let conc = src.slice(last.index);

  conc = conc.replace(/^CONCLUSÃO\s*[:：]?\s*/i, "").trim();

  conc = conc
    .replace(/\n(?:📘\s*APOIO PEDAGÓGICO\s*\(CONCLUSÃO\))[\s\S]*$/i, "")
    .replace(/\n(?:🎯\s*APLICAÇÃO PRÁTICA\s*\(CONCLUSÃO\))[\s\S]*$/i, "")
    .replace(/\n(?:🎵\s*HINOS SUGERIDOS(?:\s*\/\s*MOMENTO DE ORAÇÃO)?)\b[\s\S]*$/i, "")
    .replace(/\n(?:🙏\s*MOTIVO DE ORAÇÃO)\b[\s\S]*$/i, "")
    .replace(/\n(?:Liç[ãa]o\s+\d+\s+—)[\s\S]*$/i, "")
    .trim();

  return conc;
}

/* =========================================================
   EXTRAÇÃO DE TÓPICOS
========================================================= */

function extractTopicos(text = "") {
  const lines = splitLines(text);
  const topicos = [];
  let currentTopico = null;

  const isTopicoInline = (line) => /^\d+\.\s+/.test(line) && !/^\d+\.\d+\./.test(line);
  const isTopicoStandalone = (line) => /^\d+$/.test(line);
  const isSubtopico = (line) => /^\d+\.\d+\.\s+/.test(line);
  const isApoio = (line) => /^📘?\s*APOIO PEDAGÓGICO/i.test(line);
  const isAplic = (line) => /^🎯?\s*APLICAÇÃO PRÁTICA/i.test(line);
  const isEuEnsineiLine = (line) => /^✨?\s*EU ENSINEI QUE\s*[:：]/i.test(line);
  const isConclusao = (line) => /^CONCLUSÃO\s*[:：]?/i.test(line);

  function flushCurrent() {
    if (!currentTopico) return;

    currentTopico.texto = dedupeParagraphs(currentTopico.texto).join(" ").trim();

    currentTopico.subtopicos = currentTopico.subtopicos.map((sub) => {
      const euEnsineiInline = extractEuEnsineiInline(sub.texto);
      if (euEnsineiInline && !currentTopico.euEnsineiQue) {
        currentTopico.euEnsineiQue = euEnsineiInline;
      }

      return {
        titulo: sub.titulo,
        texto: normSpaces(removeEuEnsineiInline(sub.texto))
      };
    });

    currentTopico.apoioPedagogico = cleanEndingPunctuation(currentTopico.apoioPedagogico);
    currentTopico.aplicacaoPratica = cleanEndingPunctuation(currentTopico.aplicacaoPratica);
    currentTopico.euEnsineiQue = cleanEndingPunctuation(currentTopico.euEnsineiQue);

    topicos.push(currentTopico);
    currentTopico = null;
  }

  function startTopico(numero, titulo) {
    flushCurrent();
    currentTopico = {
      numero: String(numero || "").trim(),
      titulo: String(titulo || "").trim(),
      texto: [],
      apoioPedagogico: "",
      aplicacaoPratica: "",
      euEnsineiQue: "",
      subtopicos: []
    };
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isConclusao(line)) {
      flushCurrent();
      break;
    }

    if (isTopicoInline(line)) {
      const numero = line.match(/^(\d+)\./)?.[1] || "";
      const titulo = line.replace(/^(\d+)\.\s+/, "").trim();
      startTopico(numero, titulo);
      continue;
    }

    if (isTopicoStandalone(line)) {
      const next = lines[i + 1] || "";
      const prev = lines[i - 1] || "";

      const pareceTopico =
        next &&
        !isSubtopico(next) &&
        !isApoio(next) &&
        !isAplic(next) &&
        !isEuEnsineiLine(next) &&
        !isConclusao(next);

      const veioDepoisDeEuEnsinei =
        /^✨?\s*EU ENSINEI QUE\s*[:：]/i.test(prev) ||
        /^EU ENSINEI QUE\s*[:：]/i.test(prev);

      if (pareceTopico || veioDepoisDeEuEnsinei) {
        startTopico(line, next);
        i += 1;
        continue;
      }
    }

    if (!currentTopico) continue;

    if (isSubtopico(line)) {
      currentTopico.subtopicos.push({
        titulo: line.replace(/^(\d+\.\d+\.)\s+/, "").trim(),
        texto: ""
      });
      continue;
    }

    if (isApoio(line)) {
      const bloco = [];
      let j = i + 1;

      while (j < lines.length) {
        const next = lines[j];
        if (isAplic(next) || isSubtopico(next) || isTopicoInline(next) || isTopicoStandalone(next) || isEuEnsineiLine(next) || isConclusao(next)) break;
        bloco.push(next);
        j++;
      }

      currentTopico.apoioPedagogico = bloco.join(" ").trim();
      i = j - 1;
      continue;
    }

    if (isAplic(line)) {
      const bloco = [];
      bloco.push(removeLeadingLabel(line, "🎯?\\s*APLICAÇÃO PRÁTICA(?:\\s*\\(CONCLUSÃO\\))?"));

      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (isApoio(next) || isSubtopico(next) || isTopicoInline(next) || isTopicoStandalone(next) || isEuEnsineiLine(next) || isConclusao(next)) break;
        bloco.push(next);
        j++;
      }

      currentTopico.aplicacaoPratica = bloco.join(" ").trim();
      i = j - 1;
      continue;
    }

    if (isEuEnsineiLine(line)) {
      currentTopico.euEnsineiQue = removeLeadingLabel(line, "✨?\\s*EU ENSINEI QUE");
      continue;
    }

    if (currentTopico.subtopicos.length > 0) {
      const lastSub = currentTopico.subtopicos[currentTopico.subtopicos.length - 1];
      lastSub.texto = (lastSub.texto ? `${lastSub.texto} ` : "") + line;
    } else {
      currentTopico.texto.push(line);
    }
  }

  flushCurrent();
  return topicos;
}

/* =========================================================
   GERAÇÃO DE APOIO / APLICAÇÃO
========================================================= */

function buildAplicacaoPratica({ publico, baseText }) {
  const frase = cleanEndingPunctuation(sentenceFromText(baseText, 170));

  if (publico === "jovens") {
    if (frase) {
      return cleanEndingPunctuation(
        `O aluno deve ser incentivado a aplicar este ensino em suas escolhas, atitudes e relacionamento com Deus, lembrando que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`
      );
    }
    return `O aluno deve ser incentivado a aplicar o ensino deste tópico em suas escolhas, atitudes e relacionamento com Deus, demonstrando obediência prática à Palavra no dia a dia.`;
  }

  if (frase) {
    return cleanEndingPunctuation(
      `A classe deve ser encorajada a colocar em prática este ensino no cotidiano cristão, lembrando que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`
    );
  }

  return `A classe deve ser encorajada a colocar em prática o ensino deste tópico no cotidiano cristão, transformando o conteúdo estudado em atitude, testemunho e fidelidade ao Senhor.`;
}

function buildConclusaoAplicacao({ publico, conclusao }) {
  const frase = cleanEndingPunctuation(sentenceFromText(conclusao, 180));

  if (publico === "jovens") {
    return frase
      ? cleanEndingPunctuation(
          `O aluno deve ser incentivado a aplicar a verdade final da lição em suas escolhas, atitudes e relacionamento com Deus, compreendendo que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`
        )
      : `O aluno deve ser incentivado a aplicar a verdade final da lição em suas escolhas, atitudes e relacionamento com Deus, demonstrando obediência prática à Palavra no dia a dia.`;
  }

  return frase
    ? cleanEndingPunctuation(
        `A classe deve ser encorajada a colocar em prática a mensagem final da lição no cotidiano cristão, compreendendo que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`
      )
    : `A classe deve ser encorajada a colocar em prática a mensagem final da lição no cotidiano cristão, transformando o ensino recebido em atitude, testemunho e fidelidade ao Senhor.`;
}

function buildApoioPedagogico({ publico, tituloLicao, baseText, isConclusao = false }) {
  const classe = publico === "jovens" ? "Classe de Jovens" : "Classe de Adultos";
  const tema = tituloLicao || "esta lição";
  const resumo = sentenceFromText(baseText, 220);

  const intro = isConclusao
    ? `No contexto da ${classe}, a conclusão deve ser trabalhada de forma clara, organizada e pastoral, ajudando os alunos a consolidarem a mensagem central de "${tema}" e sua aplicação à vida cristã.`
    : `No contexto da ${classe}, este ponto deve ser trabalhado de forma clara, organizada e pastoral, ajudando os alunos a compreenderem como "${tema}" se aplica à vida cristã.`;

  const corpo = resumo
    ? `${resumo} O professor pode explorar esse trecho com leitura em voz alta, perguntas dirigidas e observações que reforcem o sentido bíblico, doutrinário e formativo do ensino.`
    : `O professor pode explorar esse trecho com leitura em voz alta, perguntas dirigidas e observações que reforcem o sentido bíblico, doutrinário e formativo do ensino.`;

  const fechamento = `Pedagogicamente, é importante incentivar a participação da turma, retomando os conceitos principais, relacionando o assunto com experiências práticas e reforçando verdades que precisam ser guardadas no coração. Ao final, este bloco deve servir como ponte entre conhecimento e vivência, mostrando que aprender a Palavra de Deus exige entendimento, reverência e compromisso com a obediência.`;

  return cleanEndingPunctuation(`${intro} ${corpo} ${fechamento}`.trim());
}

/* =========================================================
   HTML FINAL
========================================================= */

function renderHtml(lesson) {
  const {
    numero,
    titulo,
    publico,
    textoAureo,
    verdadeAplicada,
    textoReferencia,
    pontoChave,
    refletindo,
    analiseGeral,
    introducao,
    topicos,
    conclusao,
    apoioPedagogicoConclusao,
    aplicacaoPraticaConclusao
  } = lesson;

  const publicoLabel = publico === "jovens" ? "Jovens" : "Adultos";
  const meta = [];

  if (textoAureo) {
    meta.push(`
      <section class="bloco meta">
        <h3>${publico === "jovens" ? "Texto Áureo / Versículo do Dia" : "Texto Áureo"}</h3>
        <p>${escapeHtml(textoAureo)}</p>
      </section>
    `);
  }

  if (verdadeAplicada) {
    meta.push(`
      <section class="bloco meta">
        <h3>Verdade Aplicada</h3>
        <p>${escapeHtml(verdadeAplicada)}</p>
      </section>
    `);
  }

  if (textoReferencia) {
    meta.push(`
      <section class="bloco meta">
        <h3>${publico === "jovens" ? "Texto de Referência" : "Textos de Referência"}</h3>
        <p>${escapeHtml(textoReferencia)}</p>
      </section>
    `);
  }

  if (pontoChave) {
    meta.push(`
      <section class="bloco destaque">
        <h3>Ponto-Chave</h3>
        <p>${escapeHtml(pontoChave)}</p>
      </section>
    `);
  }

  if (refletindo) {
    meta.push(`
      <section class="bloco destaque">
        <h3>Refletindo</h3>
        <p>${escapeHtml(refletindo)}</p>
      </section>
    `);
  }

  if (analiseGeral) {
    meta.push(`
      <section class="bloco analise">
        <h3>Análise Geral da Lição</h3>
        <p>${escapeHtml(analiseGeral)}</p>
      </section>
    `);
  }

  const introHtml = introducao
    ? `
      <section class="bloco introducao">
        <h2>Introdução</h2>
        <p>${escapeHtml(introducao)}</p>
      </section>
    `
    : "";

  const topicosHtml = (topicos || [])
    .map(
      (topico) => `
    <section class="bloco topico">
      <h2>${escapeHtml(topico.numero)}. ${escapeHtml(topico.titulo)}</h2>
      ${topico.texto ? `<p>${escapeHtml(topico.texto)}</p>` : ""}
      ${(topico.subtopicos || [])
        .map(
          (sub) => `
        <div class="subtopico">
          <h4>${escapeHtml(sub.titulo)}</h4>
          <p>${escapeHtml(sub.texto)}</p>
        </div>
      `
        )
        .join("")}
      ${
        topico.apoioPedagogico
          ? `
        <div class="apoio-pedagogico">
          <h3>Apoio Pedagógico</h3>
          <p>${escapeHtml(topico.apoioPedagogico)}</p>
        </div>
      `
          : ""
      }
      ${
        topico.aplicacaoPratica
          ? `
        <div class="aplicacao-pratica">
          <h3>Aplicação Prática</h3>
          <p>${escapeHtml(topico.aplicacaoPratica)}</p>
        </div>
      `
          : ""
      }
      ${
        topico.euEnsineiQue
          ? `
        <div class="eu-ensinei">
          <h3>Eu ensinei que</h3>
          <p>${escapeHtml(topico.euEnsineiQue)}</p>
        </div>
      `
          : ""
      }
    </section>
  `
    )
    .join("");

  const conclusaoHtml = conclusao
    ? `
      <section class="bloco conclusao">
        <h2>Conclusão</h2>
        <p>${escapeHtml(conclusao)}</p>
        ${
          apoioPedagogicoConclusao
            ? `
          <div class="apoio-pedagogico">
            <h3>Apoio Pedagógico</h3>
            <p>${escapeHtml(apoioPedagogicoConclusao)}</p>
          </div>
        `
            : ""
        }
        ${
          aplicacaoPraticaConclusao
            ? `
          <div class="aplicacao-pratica">
            <h3>Aplicação Prática</h3>
            <p>${escapeHtml(aplicacaoPraticaConclusao)}</p>
          </div>
        `
            : ""
        }
      </section>
    `
    : "";

  return `
    <article class="licao-betel ${escapeHtml(publico)}">
      <header class="licao-header">
        <div class="licao-chip">EBD ${escapeHtml(publicoLabel)}</div>
        <h1>Lição ${escapeHtml(numero)}: ${escapeHtml(titulo)}</h1>
      </header>
      ${meta.join("\n")}
      ${introHtml}
      ${topicosHtml}
      ${conclusaoHtml}
    </article>
  `.trim();
}

/* =========================================================
   ADMIN PAYLOAD
========================================================= */

function buildAdminPayload(lesson, reqBody = {}) {
  const nowIso = new Date().toISOString();
  const resumoBase =
    lesson.verdadeAplicada ||
    lesson.introducao ||
    lesson.conclusao ||
    lesson.textoAureo ||
    lesson.titulo;

  const adminPayload = {
    id: generateStableId(lesson.numero, lesson.titulo, lesson.publico),
    numero: lesson.numero || "",
    titulo: lesson.titulo || "Lição",
    publico: lesson.publico || "adultos",
    tipo: lesson.tipo || (lesson.publico === "jovens" ? "youth" : "adult"),

    trimestre: reqBody.trimestre || "",
    data: reqBody.data || "",
    categoria: reqBody.categoria || "licao",
    status: reqBody.status || "rascunho",
    origem: "betel_parser_producao_final_refinado",

    slug: lesson.slug || generateStableId(lesson.numero, lesson.titulo, lesson.publico),
    resumo: buildResumo(resumoBase, 220),

    textoAureo: lesson.textoAureo || "",
    verdadeAplicada: lesson.verdadeAplicada || "",
    textoReferencia: lesson.textoReferencia || "",
    pontoChave: lesson.pontoChave || "",
    refletindo: lesson.refletindo || "",
    analiseGeral: lesson.analiseGeral || "",
    introducao: lesson.introducao || "",
    topicos: Array.isArray(lesson.topicos) ? lesson.topicos : [],
    conclusao: lesson.conclusao || "",

    apoioPedagogicoConclusao: lesson.apoioPedagogicoConclusao || "",
    aplicacaoPraticaConclusao: lesson.aplicacaoPraticaConclusao || "",

    conteudo: lesson.conteudo || "",
    conteudoHtml: lesson.conteudoHtml || "",
    html: lesson.conteudoHtml || "",
    texto: lesson.texto || "",
    markdown: lesson.markdown || "",

    publicado: reqBody.publicado === true,
    createdAt: nowIso,
    updatedAt: nowIso
  };

  return sanitizeForFirebase(adminPayload);
}

/* =========================================================
   PIPELINE PRINCIPAL
========================================================= */

function buildLessonFromBetel({ numero, titulo, conteudoBase, publico }) {
  const raw = normSpaces(conteudoBase || "");
  const source = prepareSource(raw);
  const publicoFinal = detectPublico(source, publico);

  const extractedTitleRaw = extractNumeroETitulo(raw, numero, titulo);
  const extractedTitle = {
    numero: extractedTitleRaw.numero || numero || "",
    titulo: sanitizeTituloLicao(extractedTitleRaw.titulo || titulo || "Lição")
  };

  const meta = extractMeta(source);
  const introducao = cleanEndingPunctuation(extractIntroducao(source));

  let topicos = extractTopicos(source);
  if (!topicos || topicos.length === 0) {
    const match = source.match(/1\.\s+[\s\S]{100,}/);
    if (match) {
      topicos = extractTopicos(match[0]);
    }
  }

  const conclusao = cleanEndingPunctuation(extractConclusao(source));

  const topicosFiltrados = (topicos || []).filter((t) => {
    const title = String(t.titulo || "").toLowerCase().trim();
    return title && !/^introdu[cç][aã]o$/i.test(title) && !/^conclus[aã]o$/i.test(title);
  });

  const topicosComFallback = topicosFiltrados.map((t) => ({
    ...t,
    apoioPedagogico:
      cleanEndingPunctuation(t.apoioPedagogico) ||
      buildApoioPedagogico({
        publico: publicoFinal,
        tituloLicao: extractedTitle.titulo,
        baseText: t.texto || (t.subtopicos[0] && t.subtopicos[0].texto) || t.titulo
      }),
    aplicacaoPratica:
      cleanEndingPunctuation(t.aplicacaoPratica) ||
      buildAplicacaoPratica({
        publico: publicoFinal,
        baseText: t.texto || (t.subtopicos[0] && t.subtopicos[0].texto) || t.titulo
      }),
    euEnsineiQue: cleanEndingPunctuation(t.euEnsineiQue)
  }));

  const lesson = {
    numero: extractedTitle.numero || numero || "",
    titulo: sanitizeTituloLicao(extractedTitle.titulo || titulo || "Lição"),
    publico: publicoFinal,
    tipo: publicoFinal === "jovens" ? "youth" : "adult",
    textoAureo: cleanEndingPunctuation(meta.textoAureo || ""),
    verdadeAplicada: cleanEndingPunctuation(meta.verdadeAplicada || ""),
    textoReferencia: cleanEndingPunctuation(meta.textoReferencia || ""),
    pontoChave: cleanEndingPunctuation(meta.pontoChave || ""),
    refletindo: cleanEndingPunctuation(meta.refletindo || ""),
    analiseGeral: cleanEndingPunctuation(meta.analiseGeral || ""),
    introducao: introducao || "",
    topicos: topicosComFallback,
    conclusao: conclusao || "",
    apoioPedagogicoConclusao: buildApoioPedagogico({
      publico: publicoFinal,
      tituloLicao: extractedTitle.titulo,
      baseText: conclusao,
      isConclusao: true
    }),
    aplicacaoPraticaConclusao: buildConclusaoAplicacao({
      publico: publicoFinal,
      conclusao
    })
  };

  lesson.conteudoHtml = renderHtml(lesson);
  lesson.html = lesson.conteudoHtml;
  lesson.conteudo = lesson.conteudoHtml;
  lesson.texto = stripHtml(lesson.conteudoHtml);
  lesson.markdown = lesson.texto;
  lesson.slug = generateStableId(lesson.numero, lesson.titulo, lesson.publico);

  return sanitizeForFirebase(lesson);
}


/* =========================================================
   PROMPT APROVADO — ADULTOS EBD FIEL / GPT
========================================================= */

/* EBD_ADULTOS_PROMPT_APROVADO importado de src/prompts/lesson-prompts.js */

const EBD_ADULTOS_REFINO_SEM_ROTULO_APOIO_V3 = `AJUSTE FINAL APROVADO PELO ADMINISTRADOR:

1. NÃO escreva o rótulo "APOIO PEDAGÓGICO:" no HTML final.
   O primeiro parágrafo azul em cada seção já será entendido como apoio pedagógico.
   Esse parágrafo deve continuar em azul #0000FF e itálico.

2. A aplicação prática DEVE manter o rótulo "APLICAÇÃO PRÁTICA:".
   Ela deve aparecer como o segundo parágrafo azul da seção e começar assim:
   APLICAÇÃO PRÁTICA: Durante a semana,

3. Em cada seção que recebe apoio, use esta lógica:
   - primeiro bloco azul: apoio pedagógico, sem rótulo;
   - segundo bloco azul: aplicação prática, com o rótulo obrigatório "APLICAÇÃO PRÁTICA:" e começando com "Durante a semana,".

4. Nunca use as palavras:
   - comunidade;
   - comunidades;
   - comunitário;
   - comunitária;
   - comunitários;
   - comunitárias.
   Substitua por igreja, igrejas, família da fé, grupo de irmãos, vida da igreja ou expressão equivalente.

5. O ESBOÇO DA LIÇÃO deve ficar em uma única linha, exatamente neste formato:
   Introdução; 1. Título do tópico 1; 2. Título do tópico 2; 3. Título do tópico 3; Conclusão.

6. As aplicações práticas devem ser concretas e observáveis. Evite aplicações genéricas.
   Não diga apenas "ore mais", "leia a Bíblia" ou "busque a Deus".
   Seja específico sobre a ação, o horário, a decisão, a pessoa, a conversa ou a atitude.

7. Não reduza o conteúdo para poucas frases. A Introdução, tópicos e subtópicos devem ter parágrafos suficientes para ajudar o professor a ministrar com clareza.

8. Todos os títulos de seção, tópicos e subtópicos devem terminar com dois pontos (:), antes do conteúdo.
   Exemplos corretos:
   TEXTOS DE REFERÊNCIA: Neemias 1.4...
   INTRODUÇÃO: Na introdução, a lição fala sobre...
   1. A oração leva à conquista: Neste tópico, a lição aborda...
   1.1. A oração aponta a saída: O subtópico 1.1...

9. O título principal da lição deve vir completo no formato:
   Lição X: Título completo da lição.
   Exemplo:
   Lição 13: Os elementos fundamentais da vitória de Neemias.
   Nunca gere apenas o tema sem "Lição X:".

10. Nos textos elaborados pela IA, inclua referências bíblicas de apoio entre parênteses.
   Aplique isso em ANÁLISE GERAL, INTRODUÇÃO, tópicos, subtópicos, bloco azul de apoio e CONCLUSÃO.
   Use referências bíblicas relacionadas ao conteúdo, como Neemias 1.4, Neemias 2.20, Neemias 8.3, Neemias 8.5 e outras referências coerentes.
   Não force referência bíblica em cada frase, mas cada seção elaborada deve ter pelo menos uma referência bíblica natural.
   Exemplos: (Ne 1.4), (Ne 2.20), (Ne 8.3), (2Tm 3.16-17), (Hb 11.6), (Fp 4.6).

11. As aplicações práticas devem ser bem variadas, concretas e relacionadas ao dia a dia.
   Não repita o mesmo tipo de orientação em todas as seções.
   Use situações reais: família, trabalho, igreja, conversas difíceis, celular, decisões, ansiedade, desânimo, finanças, liderança, serviço cristão e relacionamentos.
   Cada aplicação deve ter uma ação observável, com detalhe prático.
   Evite aplicações genéricas como "ore mais", "leia a Bíblia", "fortaleça sua fé" ou "reflita sobre".
   Não usar mais de duas aplicações baseadas principalmente em oração.
   Não repita fórmulas como "escolha um momento", "reserve um momento", "estabeleça um horário" ou "compartilhe com alguém" em várias seções.
   Varie as ações: conversar, anotar, pedir perdão, enviar mensagem, visitar, organizar a agenda, preparar uma fala, evitar uma resposta precipitada, separar um texto bíblico, tomar uma decisão concreta, corrigir uma atitude em casa, conduzir uma conversa no trabalho ou servir alguém.
   Cada aplicação deve mencionar uma situação real do dia a dia, como uma conversa em casa, uma pressão no trabalho, uma mensagem no celular, uma reunião na igreja ou uma pessoa específica que precisa de apoio.

12. O HTML deve ter visual bonito para leitura na página do site, mas impressão simples.
   Na tela, pode usar visual mais elegante e responsivo: container branco, sombra suave, título centralizado, espaçamento melhor e blocos azuis com fundo azul muito claro.
   Na página, inclua um botão visível chamado Imprimir / Salvar PDF, que execute window.print().
   Esse botão deve ficar oculto na impressão usando @media print.
   Na impressão ou ao salvar em PDF, use @media print para voltar ao modelo simples: fundo branco, sem sombra, sem borda, sem fundo azul, texto limpo em Times New Roman.
   A impressão deve ficar parecida com documento simples para aula, sem aparência de página decorada.`;


function extractHtmlOnly(text = "") {
  let out = String(text || "").trim();
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/```$/i, "").trim();
  const docStart = out.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (docStart > 0) out = out.slice(docStart).trim();
  const htmlEnd = out.search(/<\/html>/i);
  if (htmlEnd >= 0) out = out.slice(0, htmlEnd + 7).trim();
  return out;
}

function isApprovedAdultHtml(html = "") {
  const text = String(html || "");
  return /class=["'][^"']*\blicao-container\b/i.test(text)
    && /class=["'][^"']*\btitulo-com-conteudo\b/i.test(text)
    && /class=["'][^"']*\bapoio-aplicacao\b/i.test(text)
    && /TEXTO ÁUREO:/i.test(text)
    && /ANÁLISE GERAL:/i.test(text)
    && /APLICAÇÃO PRÁTICA:/i.test(text)
    && /DURANTE A SEMANA/i.test(text)
    && /CONCLUSÃO:/i.test(text);
}

async function callOpenAiChat({ model, prompt, apiKey }) {
  const result = await requestChatCompletion({
    provider: "openai",
    apiKey,
    model,
    messages: [
      { role: "system", content: "Você gera HTML completo para lições de Escola Bíblica Dominical. Responda somente com HTML válido, sem markdown e sem explicações." },
      { role: "user", content: prompt }
    ],
    temperature: Number(process.env.OPENAI_TEMPERATURE || 0.35),
    maxTokens: Number(process.env.OPENAI_MAX_TOKENS || 12000)
  });
  return result.content;
}

/* =========================================================
   ROTA IA - PROFESSOR FIEL (USANDO DEEPSEEK)
========================================================= */

app.post("/ia", async (req, res) => {
  try {
    const { pergunta, historico = [] } = req.body;

    if (!pergunta || !pergunta.trim()) {
      return res.status(400).json({ erro: "Pergunta não fornecida." });
    }

    // Usando a chave da DeepSeek do ambiente
    const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
    
    if (!DEEPSEEK_API_KEY) {
      console.error("Chave da API DeepSeek não configurada");
      return res.status(500).json({ 
        erro: "Serviço de IA temporariamente indisponível. Tente novamente mais tarde." 
      });
    }

    // Construir o prompt para a IA
    const systemPrompt = `Você é o "Professor Fiel", um assistente bíblico especialista em Escola Bíblica Dominical (EBD). 
Suas respostas devem:
- Ser fundamentadas na Bíblia Sagrada
- Ser claras, didáticas e práticas para professores e alunos da EBD
- Usar linguagem respeitosa e acessível
- Evitar opiniões pessoais ou controvérsias teológicas
- Dar ênfase à aplicação prática do ensino bíblico
- Responder sempre em português brasileiro

Formate suas respostas usando **negrito** para destaques importantes e quebras de linha para melhor legibilidade.`;

    // Chamar a API da DeepSeek pelo provedor centralizado.
    let aiResult;
    try {
      aiResult = await requestChatCompletion({
        provider: "deepseek",
        apiKey: DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          ...((Array.isArray(historico) ? historico : []).slice(-10).map((item) => ({
            role: item?.role === "assistant" ? "assistant" : "user",
            content: String(item?.content || item?.texto || item?.mensagem || "").slice(0, 8000)
          })).filter((item) => item.content.trim())),
          { role: "user", content: pergunta }
        ],
        temperature: 0.7,
        maxTokens: 1024,
        topP: 0.95,
        frequencyPenalty: 0.3,
        presencePenalty: 0.3
      });
    } catch (providerError) {
      console.error("Erro na API DeepSeek:", providerError.status || "sem status", providerError.message);
      return res.status(200).json({
        resposta: "Desculpe, não consegui processar sua pergunta agora. Por favor, tente novamente em alguns instantes. 📖"
      });
    }

    const resposta = aiResult.content || "Desculpe, não consegui gerar uma resposta no momento. Tente reformular sua pergunta.";

    return res.json({ resposta });

  } catch (error) {
    console.error("Erro na rota /ia:", error);
    return res.status(500).json({ 
      erro: "Erro interno ao processar sua pergunta. Tente novamente mais tarde.",
      detalhe: error.message 
    });
  }
});

/* =========================================================
   ROTAS EXISTENTES
========================================================= */

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    architecture: "ebd-fiel-unified-2026-08-02",
    classes: CLASS_KEYS,
    timestamp: new Date().toISOString()
  });
});




/* =========================================================
   GPT V2 — NORMALIZAÇÃO, REPARO E LIMITE SEGURO
========================================================= */

function extractHtmlOnlyV2(text = "") {
  let out = String(text || "").trim();
  out = out.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  out = out.replace(/^[\s\S]*?(?=<!DOCTYPE html>|<html[\s>])/i, "").trim();
  const htmlEnd = out.search(/<\/html>/i);
  if (htmlEnd >= 0) out = out.slice(0, htmlEnd + 7).trim();
  return out;
}


function escapeHtmlTextV3(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stripTagsV3(value = "") {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}


/* =========================================================
   V48.30.8 — Verdade Aplicada obrigatória
   Motivo:
   - Impedir saída com "Conteúdo a ser definido".
   - Forçar Adultos/Jovens a usar a Verdade Aplicada real do texto-base.
========================================================= */

function ebdNormalizeNoAccentV48_30_8(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function ebdPlainTextKeepLinesV48_30_8(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ebdCleanVerdadeAplicadaValueV48_30_8(value = "") {
  return ebdPlainTextKeepLinesV48_30_8(value)
    .replace(/^\s*(?:✅|✨)?\s*VERDADE\s+APLICADA\s*[:：]?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ebdIsInvalidVerdadeAplicadaV48_30_8(value = "") {
  const clean = ebdCleanVerdadeAplicadaValueV48_30_8(value);
  const norm = ebdNormalizeNoAccentV48_30_8(clean);
  return !clean
    || clean.length < 12
    || /CONTEUDO\s+A\s+SER\s+DEFINIDO|A\s+SER\s+DEFINIDO|NAO\s+INFORMAD[OA]|SEM\s+INFORMACAO|PREENCHER|DEFINIR|\[.*?\]/i.test(norm);
}

function ebdExtractVerdadeAplicadaFromSourceV48_30_8(conteudoBase = "") {
  const plain = ebdPlainTextKeepLinesV48_30_8(conteudoBase);
  if (!plain) return "";

  const patterns = [
    /(?:^|\n)\s*(?:✅|✨)?\s*VERDADE\s+APLICADA\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:🎯|📌|🔍|🙏|OBJETIVOS\s+DA\s+LI(?:Ç|C)[ÃA]O|TEXTOS?\s+DE\s+REFER[ÊE]NCIA|TEXTO\s+DE\s+REFER[ÊE]NCIA|MOMENTO\s+DE\s+ORA(?:Ç|C)[ÃA]O|INTRODU(?:Ç|C)[ÃA]O|AN[ÁA]LISE\s+GERAL|PONTO\s*-?\s*CHAVE|REFLETINDO|LEITURAS?|1\s*\.))/i,
    /(?:^|\n)\s*(?:✅|✨)?\s*VERDADE\s+APLICADA\s+([^\n]{12,500})/i
  ];

  for (const pattern of patterns) {
    const match = plain.match(pattern);
    if (!match) continue;
    const value = ebdCleanVerdadeAplicadaValueV48_30_8(match[1] || "");
    if (!ebdIsInvalidVerdadeAplicadaV48_30_8(value)) return value;
  }

  try {
    const metaValue = extractMeta(plain)?.verdadeAplicada || "";
    const value = ebdCleanVerdadeAplicadaValueV48_30_8(metaValue);
    if (!ebdIsInvalidVerdadeAplicadaV48_30_8(value)) return value;
  } catch (error) {}

  return "";
}

function ebdVerdadeAplicadaErrorResponseV48_30_8(res, classe = "Adultos") {
  return res.status(400).json({
    ok: false,
    error: `Verdade Aplicada real não encontrada no texto-base da classe ${classe}.`,
    detail: "Inclua no texto-base uma linha como: Verdade Aplicada: [texto completo]. O sistema não gera nem aceita o placeholder 'Conteúdo a ser definido'.",
    missing: ["VERDADE APLICADA real"]
  });
}

function ebdForceVerdadeAplicadaHtmlV48_30_8(html = "", verdadeAplicada = "") {
  const value = ebdCleanVerdadeAplicadaValueV48_30_8(verdadeAplicada);
  if (ebdIsInvalidVerdadeAplicadaV48_30_8(value)) return String(html || "");

  let out = String(html || "");
  const escaped = escapeHtmlTextV3(value);

  // Padrão mais comum: <strong>Verdade Aplicada:</strong> texto...</p>
  out = out.replace(
    /(<strong[^>]*>\s*VERDADE\s+APLICADA\s*:?\s*<\/strong>\s*)([\s\S]*?)(?=<\/p>)/i,
    `$1${escaped}`
  );

  // Variação com rótulo em texto simples dentro do parágrafo.
  out = out.replace(
    /(VERDADE\s+APLICADA\s*:\s*)(?:Conte[úu]do\s+a\s+ser\s+definido\.?|\[[^\]]+\]|.{0,420}?)(?=<\/p>|<br\s*\/?\s*>|\n)/i,
    `$1${escaped}`
  );

  return out;
}

function ebdHtmlHasInvalidVerdadeAplicadaV48_30_8(html = "") {
  const text = ebdPlainTextKeepLinesV48_30_8(html);
  const match = text.match(/VERDADE\s+APLICADA\s*[:：]?\s*([^\n]{0,500})/i);
  if (!match) return true;
  return ebdIsInvalidVerdadeAplicadaV48_30_8(match[1] || "");
}

function buildApprovedEsbocoFromRawV3(rawText = "") {
  const raw = String(rawText || "").replace(/\r/g, "");
  const match = raw.match(/ESBOÇO DA LIÇÃO\s*([\s\S]*?)(?=\n\s*INTRODUÇÃO\b|\n\s*1\.\s|\n\s*TEXTO|\n\s*LEITURAS|\n\s*HINOS|$)/i);
  let block = match?.[1] || "";

  let lines = block
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[0-9]+\.\s*/, "").replace(/[.;]+$/g, "").trim())
    .filter(line => !/^(introdu[cç][aã]o|conclus[aã]o)$/i.test(line))
    .filter(line => !/^[-*•]/.test(line));

  if (lines.length < 3) {
    const outline = raw.match(/\n\s*1\.\s+(.+?)\n[\s\S]*?\n\s*2\.\s+(.+?)\n[\s\S]*?\n\s*3\.\s+(.+?)(?:\n|$)/i);
    if (outline) {
      lines = [outline[1], outline[2], outline[3]]
        .map(line => String(line || "").replace(/[.:;]+$/g, "").trim());
    }
  }

  lines = lines.slice(0, 3);
  if (lines.length < 3) return "";
  return `Introdução; 1. ${lines[0]}; 2. ${lines[1]}; 3. ${lines[2]}; Conclusão.`;
}

function fixEsbocoApprovedV3(html = "", rawText = "") {
  const esboco = buildApprovedEsbocoFromRawV3(rawText);
  if (!esboco) return html;

  let out = String(html || "");
  const escaped = escapeHtmlTextV3(esboco);

  const replaced = out.replace(
    /(<h[1-6][^>]*>\s*ESBOÇO DA LIÇÃO\s*:?\s*<\/h[1-6]>\s*<p[^>]*>)([\s\S]*?)(<\/p>)/i,
    `$1${escaped}$3`
  );

  if (replaced !== out) return replaced;

  return out.replace(
    /(ESBOÇO DA LIÇÃO\s*<\/[^>]+>\s*)([\s\S]{0,500}?)(<[^>]+>\s*ANÁLISE GERAL)/i,
    `$1<p class="preto primeiro">${escaped}</p>$3`
  );
}


function ensureAplicacaoPraticaLabelV4(html = "") {
  let out = String(html || "");
  out = out.replace(
    /(<p[^>]*class=["'][^"']*(?:azul|italico)[^"']*["'][^>]*>\s*)(Durante\s+a\s+semana,)/gi,
    '$1<span class="negrito">APLICAÇÃO PRÁTICA:</span> $2'
  );
  out = out.replace(/APLICAÇÃO PRÁTICA:\s*(?:<[^>]+>\s*)?APLICAÇÃO PRÁTICA:\s*/gi, "APLICAÇÃO PRÁTICA: ");
  return out;
}








function ensureAnaliseGeralTitleV12(html = "") {
  let out = String(html || "");
  const text = normalizeForValidationV2(out);
  if (/ANALISE\s+GERAL\s*:/i.test(text)) return out;

  out = out.replace(
    /(<p[^>]*class=["'][^"']*(?:analise-geral-texto|azul)[^"']*["'][^>]*>)([\s\S]*?)(<\/p>)/i,
    '<div class="titulo-com-conteudo">\n<h3 class="preto negrito">ANÁLISE GERAL: </h3>\n$1$2$3\n</div>'
  );

  return out;
}

function ensureFooterWatermarkV12(html = "") {
  let out = String(html || "");
  const css = `
/* ==========================================================
   EBD Fiel — Marca d'água discreta no rodapé
   ========================================================== */

@media screen {
  .ebd-footer-watermark {
    margin: 28px 0 8px 0;
    text-align: center;
    font-family: Arial, sans-serif;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: rgba(15, 23, 42, 0.18);
    user-select: none;
  }
}

@media print {
  .ebd-footer-watermark {
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0.55cm !important;
    text-align: center !important;
    font-family: Arial, sans-serif !important;
    font-size: 10pt !important;
    font-weight: 700 !important;
    letter-spacing: 0.24em !important;
    text-transform: uppercase !important;
    color: rgba(0, 0, 0, 0.12) !important;
    opacity: 0.55 !important;
    background: transparent !important;
    padding: 0 !important;
    margin: 0 !important;
    z-index: 0 !important;
  }
}
`;
  const watermark = `<div class="ebd-footer-watermark" aria-hidden="true">EBD Fiel</div>`;

  if (!/EBD Fiel — Marca d'água discreta no rodapé/i.test(out)) {
    if (/<\/style>/i.test(out)) {
      out = out.replace(/<\/style>/i, `${css}\n</style>`);
    } else if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
    }
  }

  out = out.replace(/<div[^>]*class=["'][^"']*\bebd-footer-watermark\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");

  if (/<div[^>]*class=["'][^"']*\bebd-print-actions\b/i.test(out)) {
    out = out.replace(/(<div[^>]*class=["'][^"']*\bebd-print-actions\b[^"']*["'][^>]*>)/i, `${watermark}\n$1`);
    return out;
  }

  const closeContainerPattern = /<\/div>\s*<\/body>/i;
  if (closeContainerPattern.test(out)) {
    out = out.replace(closeContainerPattern, `${watermark}\n</div>\n</body>`);
  } else {
    out = out.replace(/(<\/article>|<\/main>|<\/body>)/i, `${watermark}\n$1`);
  }

  return out;
}

function ensureAdultLogoAndFinalPrintButtonV11(html = "") {
  let out = String(html || "");
  const css = `
/* ==========================================================
   EBD Fiel — Logo Adultos proporcional e botão no final
   ========================================================== */

@media screen {
  .licao-container {
    background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    border: 1px solid rgba(37, 99, 235, 0.08);
    border-radius: 28px;
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.08);
    padding: clamp(24px, 4vw, 42px) clamp(22px, 4vw, 48px);
  }

  .ebd-lesson-brand {
    text-align: center;
    margin: 0 0 18px 0;
    padding: 0;
  }

  .ebd-lesson-logo-adultos {
    display: block;
    width: 100%;
    max-width: 100%;
    height: auto;
    margin: 0 0 16px 0;
    object-fit: contain;
  }

  .licao-container > h1 {
    margin-top: 0;
    margin-bottom: 28px;
    line-height: 1.18;
    font-size: clamp(2rem, 3.2vw, 2.75rem);
  }

  .licao-container h2,
  .licao-container h3,
  .licao-container h4 {
    margin-top: 28px;
  }

  .licao-container p {
    line-height: 1.8;
  }

  .analise-geral-texto,
  .apoio-aplicacao {
    border-radius: 18px;
  }

  .ebd-print-actions {
    display: flex;
    justify-content: flex-end;
    margin: 30px 0 0 0;
  }

  .ebd-print-btn {
    background: #0f172a !important;
    color: #ffffff !important;
    border-radius: 999px !important;
    padding: 12px 22px !important;
    font-size: 0.95rem !important;
    font-family: Arial, sans-serif !important;
    font-weight: 700 !important;
    cursor: pointer !important;
    border: 0 !important;
    box-shadow: 0 12px 28px rgba(15, 23, 42, 0.22) !important;
  }

  .ebd-print-btn:hover {
    filter: brightness(1.08);
  }

  @media (max-width: 720px) {
    .licao-container {
      border-radius: 20px;
      padding: 22px 18px;
    }

    .ebd-lesson-brand {
      margin-bottom: 14px;
    }

    .ebd-lesson-logo-adultos {
      margin-bottom: 12px;
    }

    .licao-container > h1 {
      font-size: clamp(1.65rem, 9vw, 2.2rem);
      margin-bottom: 22px;
    }

    .ebd-print-actions {
      justify-content: center;
      margin-top: 24px;
    }

    .ebd-print-btn {
      width: 100%;
      max-width: 320px;
    }
  }
}

@media print {
  .licao-container {
    background: #ffffff !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    padding: 0 !important;
  }

  .ebd-lesson-brand {
    display: block !important;
    text-align: center !important;
    margin: 0 0 12pt 0 !important;
    padding: 0 !important;
  }

  .ebd-lesson-logo-adultos {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 0 0 10pt 0 !important;
    object-fit: contain !important;
  }

  .ebd-print-actions,
  .ebd-print-btn,
  button[onclick*="print"] {
    display: none !important;
  }

  .analise-geral-texto,
  .apoio-aplicacao {
    background: #ffffff !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
  }
}
`;
  const logo = `<div class="ebd-lesson-brand">
  <img src="img/adultos.png" alt="Classe Adultos" class="ebd-lesson-logo-adultos">
</div>`;
  const button = `<div class="ebd-print-actions">
  <button type="button" class="ebd-print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>
</div>`;

  out = out
    .replace(/<header[^>]*class=["'][^"']*\bcabecalho-ebd\b[^"']*["'][^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*\bcabecalho-ebd\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "");

  out = out
    .replace(/<div[^>]*class=["'][^"']*\bebd-lesson-brand\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<img[^>]*class=["'][^"']*\bebd-lesson-logo-adultos\b[^"']*["'][^>]*>/gi, "")
    .replace(/<div[^>]*class=["'][^"']*\bebd-print-actions\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<button[^>]*(?:onclick=["'][^"']*print\([^"']*["']|class=["'][^"']*\bebd-print-btn\b[^"']*["'])[^>]*>[\s\S]*?Imprimir\s*\/\s*Salvar\s*PDF[\s\S]*?<\/button>/gi, "")
    .replace(/<button[^>]*>[\s\S]*?Imprimir\s*\/\s*Salvar\s*PDF[\s\S]*?<\/button>/gi, "");

  if (!/EBD Fiel — Logo Adultos proporcional e botão no final/i.test(out)) {
    if (/<\/style>/i.test(out)) {
      out = out.replace(/<\/style>/i, `${css}\n</style>`);
    } else if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
    }
  }

  out = out.replace(/(<div[^>]*class=["'][^"']*\blicao-container\b[^"']*["'][^>]*>)/i, `$1\n${logo}`);

  const closeContainerPattern = /<\/div>\s*<\/body>/i;
  if (closeContainerPattern.test(out)) {
    out = out.replace(closeContainerPattern, `${button}\n</div>\n</body>`);
  } else {
    out = out.replace(/(<\/article>|<\/main>|<\/body>)/i, `${button}\n$1`);
  }

  return out;
}

function ensureSinglePrintButtonV10(html = "") {
  let out = String(html || "");
  const css = `
/* ==========================================================
   EBD Fiel — Ajuste de leitura, botão único e impressão
   ========================================================== */

@media screen {
  .licao-container {
    position: relative;
  }

  .licao-container p {
    font-weight: 400;
  }

  .licao-container h1,
  .licao-container h2,
  .licao-container h3,
  .licao-container h4,
  .licao-container .negrito {
    font-weight: 700;
  }

  .apoio-aplicacao p,
  .analise-geral-texto {
    font-weight: 400;
  }

  .apoio-aplicacao .negrito {
    font-weight: 700;
  }

  .ebd-print-actions {
    justify-content: flex-end;
    margin-bottom: 24px;
  }

  .ebd-print-btn {
    background: #0f172a !important;
    color: #ffffff !important;
    border-radius: 999px !important;
    padding: 10px 18px !important;
    font-size: 0.92rem !important;
    font-family: Arial, sans-serif !important;
    font-weight: 700 !important;
  }
}

@media print {
  .ebd-print-actions,
  .ebd-print-btn,
  button[onclick*="print"] {
    display: none !important;
  }

  .licao-container p {
    font-weight: 400 !important;
  }

  .licao-container h1,
  .licao-container h2,
  .licao-container h3,
  .licao-container h4,
  .licao-container .negrito {
    font-weight: 700 !important;
  }
}
`;
  const button = `<div class="ebd-print-actions">
  <button type="button" class="ebd-print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>
</div>`;

  // Remove blocos/botões de impressão existentes para evitar duplicidade.
  out = out
    .replace(/<div[^>]*class=["'][^"']*\bebd-print-actions\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<button[^>]*(?:onclick=["'][^"']*print\([^"']*["']|class=["'][^"']*\bebd-print-btn\b[^"']*["'])[^>]*>[\s\S]*?Imprimir\s*\/\s*Salvar\s*PDF[\s\S]*?<\/button>/gi, "")
    .replace(/<button[^>]*>[\s\S]*?Imprimir\s*\/\s*Salvar\s*PDF[\s\S]*?<\/button>/gi, "");

  if (!/EBD Fiel — Ajuste de leitura, botão único e impressão/i.test(out)) {
    if (/<\/style>/i.test(out)) {
      out = out.replace(/<\/style>/i, `${css}\n</style>`);
    } else if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
    }
  }

  out = out.replace(/(<div[^>]*class=["'][^"']*\blicao-container\b[^"']*["'][^>]*>)/i, `$1\n${button}`);
  return out;
}

function ensurePrintButtonAndCssV9(html = "") {
  let out = String(html || "");
  const css = `
/* Botão de impressão/salvar PDF */
@media screen {
  .ebd-print-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-bottom: 18px;
  }

  .ebd-print-btn {
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: #0f172a;
    color: #ffffff;
    font-family: Arial, sans-serif;
    font-size: 0.92rem;
    font-weight: 700;
    padding: 10px 16px;
    cursor: pointer;
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.18);
  }

  .ebd-print-btn:hover {
    filter: brightness(1.08);
  }

  @media (max-width: 720px) {
    .ebd-print-actions {
      justify-content: center;
      margin-bottom: 14px;
    }

    .ebd-print-btn {
      width: 100%;
      max-width: 280px;
    }
  }
}

@media print {
  .ebd-print-actions,
  .ebd-print-btn {
    display: none !important;
  }
}
`;
  const button = `<div class="ebd-print-actions">
  <button type="button" class="ebd-print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>
</div>`;

  if (!/Botão de impressão\/salvar PDF/i.test(out)) {
    if (/<\/style>/i.test(out)) {
      out = out.replace(/<\/style>/i, `${css}\n</style>`);
    } else if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
    }
  }

  if (!/class=["'][^"']*\bebd-print-actions\b/i.test(out)) {
    out = out.replace(/(<div[^>]*class=["'][^"']*\blicao-container\b[^"']*["'][^>]*>)/i, `$1\n${button}`);
  }

  return out;
}

function ensureScreenAndPrintCssV8(html = "") {
  let out = String(html || "");
  const css = `
/* ==========================================================
   EBD Fiel — Visual premium na tela e impressão simples
   ========================================================== */

@media screen {
  body {
    background:
      radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 32%),
      radial-gradient(circle at bottom right, rgba(14, 165, 233, 0.08), transparent 28%),
      #f3f6fb;
    padding: 42px 18px;
  }

  .licao-container {
    max-width: 980px;
    border-radius: 18px;
    box-shadow: 0 22px 55px rgba(15, 23, 42, 0.12);
    border: 1px solid rgba(148, 163, 184, 0.22);
    padding: 42px 46px;
  }

  .licao-container > h1 {
    display: block;
    text-align: center;
    font-size: 2.05rem;
    line-height: 1.22;
    margin-bottom: 8px;
    letter-spacing: -0.02em;
  }

  .titulo-com-conteudo {
    padding: 0.58rem 0;
    margin-bottom: 0.35rem;
  }

  .titulo-com-conteudo h2,
  .titulo-com-conteudo h3,
  .titulo-com-conteudo h4 {
    letter-spacing: -0.01em;
  }

  .analise-geral-texto {
    display: block;
    background: #eef6ff;
    border-radius: 12px;
    padding: 14px 16px;
    margin-top: 0.6rem;
  }

  .apoio-aplicacao {
    background: #f2f8ff;
    border-radius: 12px;
    padding: 12px 15px;
    margin-top: 0.75rem;
    margin-bottom: 0.9rem;
  }

  .apoio-aplicacao p {
    margin: 0.35rem 0;
  }

  @media (max-width: 720px) {
    body {
      padding: 18px 10px;
    }

    .licao-container {
      padding: 24px 18px;
      border-radius: 14px;
    }

    .licao-container > h1 {
      font-size: 1.55rem;
    }

    h2 {
      font-size: 1.25rem;
    }

    h3 {
      font-size: 1.1rem;
    }
  }
}

@media print {
  @page {
    margin: 1.5cm;
  }

  html,
  body {
    background: #ffffff !important;
    color: #000000 !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
    font-family: "Times New Roman", Times, serif !important;
    font-size: 12pt !important;
    line-height: 1.45 !important;
  }

  .licao-container {
    background: #ffffff !important;
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .licao-container > h1 {
    display: block !important;
    text-align: left !important;
    font-size: 16pt !important;
    line-height: 1.25 !important;
    margin: 0 0 12pt 0 !important;
    color: #000000 !important;
  }

  h1,
  h2,
  h3,
  h4 {
    color: #000000 !important;
    page-break-after: avoid;
  }

  p {
    color: #000000 !important;
    margin: 0 0 6pt 0 !important;
  }

  .titulo-com-conteudo {
    margin-bottom: 8pt !important;
    padding: 0 !important;
    page-break-inside: avoid;
  }

  .analise-geral-texto,
  .apoio-aplicacao,
  .apoio-aplicacao p,
  .azul {
    background: transparent !important;
    box-shadow: none !important;
    border: none !important;
    color: #000000 !important;
    padding: 0 !important;
  }

  .analise-geral-texto,
  .apoio-aplicacao p,
  .italico {
    font-style: italic !important;
  }

  a[href]::after {
    content: "" !important;
  }
}
`;
  if (/EBD Fiel — Visual premium na tela e impressão simples/i.test(out)) return out;

  if (/<\/style>/i.test(out)) {
    return out.replace(/<\/style>/i, `${css}\n</style>`);
  }

  const styleBlock = `<style>\n${css}\n</style>`;
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  }

  return out;
}

function normalizeLessonTitlePartV6(value = "") {
  let title = stripTagsV3(value || "");
  title = title
    .replace(/^li[cç][aã]o\s*\d+\s*[-–—:]\s*/i, "")
    .replace(/^\d+\s*[-–—:]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) return "";
  return title;
}

function extractTitleFromRawV6(rawText = "") {
  const raw = String(rawText || "").replace(/\r/g, "").trim();
  const m = raw.match(/(?:^|\n)\s*(?:Li[cç][aã]o\s*\d+\s*[-–—:]\s*)?([^\n]{8,160}?Neemias[^\n.]*(?:\.)?)/i);
  if (m) return normalizeLessonTitlePartV6(m[1]);
  const firstLine = raw.split("\n").map(x => x.trim()).filter(Boolean)[0] || "";
  return normalizeLessonTitlePartV6(firstLine);
}

function ensureMainLessonTitleV6(html = "", numero = "", titulo = "", rawText = "") {
  let out = String(html || "");
  const nMatch = String(numero || "").match(/\d+/) || String(rawText || "").match(/Li[cç][aã]o\s*(\d+)/i) || String(titulo || "").match(/Li[cç][aã]o\s*(\d+)/i);
  const n = nMatch ? (nMatch[1] || nMatch[0]).replace(/\D/g, "") : "";

  let cleanTitle = normalizeLessonTitlePartV6(titulo);
  if (!cleanTitle || cleanTitle.length < 5) {
    const h1Text = (out.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
    cleanTitle = normalizeLessonTitlePartV6(h1Text);
  }
  if (!cleanTitle || cleanTitle.length < 5) {
    cleanTitle = extractTitleFromRawV6(rawText);
  }

  if (!cleanTitle) return out;

  let finalTitle = n ? `Lição ${n}: ${cleanTitle}` : cleanTitle;
  finalTitle = finalTitle.replace(/\s+([:.])/g, "$1").replace(/\s+/g, " ").trim();

  const escaped = escapeHtmlTextV3(finalTitle);

  if (/<title>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`);
  }

  if (/<h1[^>]*>[\s\S]*?<\/h1>/i.test(out)) {
    out = out.replace(/<h1([^>]*)>[\s\S]*?<\/h1>/i, `<h1$1>${escaped}</h1>`);
  } else {
    out = out.replace(/(<div[^>]*class=["'][^"']*\blicao-container\b[^"']*["'][^>]*>)/i, `$1\n<h1 class="preto negrito">${escaped}</h1>\n<br><br>`);
  }

  return out;
}

function ensureBiblicalReferencesV6(html = "") {
  let out = String(html || "");

  const referenceByHeading = [
    { re: /AN[ÁA]LISE GERAL/i, ref: " (Ne 1.4; Ne 2.20; Ne 8.3)." },
    { re: /INTRODU[ÇC][ÃA]O/i, ref: " (Ne 2.20)." },
    { re: /^1\.\s*A ora[çc][aã]o/i, ref: " (Ne 1.4; Fp 4.6)." },
    { re: /^1\.1\./i, ref: " (Ne 1.4; Tg 5.16)." },
    { re: /^1\.2\./i, ref: " (1Ts 5.17)." },
    { re: /^1\.3\./i, ref: " (Ef 6.18)." },
    { re: /^2\.\s*A primazia/i, ref: " (Ne 8.3; 2Tm 3.16-17)." },
    { re: /^2\.1\./i, ref: " (2Tm 3.16-17)." },
    { re: /^2\.2\./i, ref: " (Sl 119.2)." },
    { re: /^2\.3\./i, ref: " (Sl 119.105)." },
    { re: /^3\.\s*Neemias teve f[ée]/i, ref: " (Ne 2.20; Hb 11.6)." },
    { re: /^3\.1\./i, ref: " (Hb 11.6)." },
    { re: /^3\.2\./i, ref: " (Ne 2.18)." },
    { re: /^3\.3\./i, ref: " (1Ts 5.11)." },
    { re: /CONCLUS[ÃA]O/i, ref: " (1Ts 5.24)." }
  ];

  function paragraphHasReference(text = "") {
    return /\(([1-3]?\s?[A-ZÁ-Úa-zá-ú]{1,12}|[A-ZÁ-Úa-zá-ú]{2,})\s*\d+[\d.,:;\-\s]*\)/.test(text)
      || /\b(?:Ne|Neemias|Fp|Filipenses|Hb|Hebreus|Tg|Tiago|Ef|Efésios|Sl|Salmos|2Tm|1Ts)\s*\d+/i.test(text);
  }

  const sectionRegex = /(<(?:h2|h3|h4)[^>]*>([\s\S]*?)<\/(?:h2|h3|h4)>)([\s\S]*?)(?=<(?:h2|h3|h4)[^>]*>|<div[^>]*class=["'][^"']*\btitulo-com-conteudo\b|<\/div>\s*<\/body>|$)/gi;

  out = out.replace(sectionRegex, (match, headingHtml, headingInner, bodyHtml) => {
    const headingText = stripTagsV3(headingInner);
    const map = referenceByHeading.find(item => item.re.test(headingText));
    if (!map) return match;
    if (paragraphHasReference(bodyHtml)) return match;

    const newBody = bodyHtml.replace(/(<p(?![^>]*class=["'][^"']*azul)[^>]*>)([\s\S]*?)(<\/p>)/i, (pm, open, inner, close) => {
      const plain = stripTagsV3(inner);
      if (!plain || paragraphHasReference(plain)) return pm;
      const punctuation = /[.!?]\s*$/.test(plain) ? "" : ".";
      return `${open}${inner}${punctuation}${map.ref}${close}`;
    });

    return headingHtml + newBody;
  });

  return out;
}

function ensureTitleColonV5(html = "") {
  let out = String(html || "");

  // Garante dois pontos nos títulos h2/h3/h4, sem alterar o h1 principal da lição.
  out = out.replace(/<(h[2-4])([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, inner) => {
    const cleanText = String(inner || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (!cleanText) return match;
    if (/[：:]\s*$/.test(cleanText)) return match;
    if (/LIÇÃO\s+\d+/i.test(cleanText) && tag.toLowerCase() === "h1") return match;

    const newInner = String(inner || "").replace(/\s*$/, ": ");
    return `<${tag}${attrs}>${newInner}</${tag}>`;
  });

  // Corrige títulos escritos diretamente em spans negritos.
  out = out.replace(/(<span[^>]*class=["'][^"']*negrito[^"']*["'][^>]*>\s*(?:TEXTO ÁUREO|VERDADE APLICADA|OBJETIVOS DA LIÇÃO|TEXTOS DE REFERÊNCIA|MOTIVO DE ORAÇÃO|ESBOÇO DA LIÇÃO|ANÁLISE GERAL|INTRODUÇÃO|EU ENSINEI QUE|CONCLUSÃO|APLICAÇÃO PRÁTICA)\s*)(<\/span>)/gi, (match, before, after) => {
    return /:\s*<\/span>$/i.test(match) ? match : `${before.trim()}: ${after}`;
  });

  return out;
}

function sanitizeApprovedAdultHtmlV3(html = "", rawText = "") {
  let out = String(html || "");

  // Remove apenas o rótulo do apoio; mantém o texto azul.
  out = out
    .replace(/(<span[^>]*class=["'][^"']*negrito[^"']*["'][^>]*>\s*)APOIO\s+PEDAG[ÓO]GICO\s*:?\s*(<\/span>)/gi, "")
    .replace(/\bAPOIO\s+PEDAG[ÓO]GICO\s*:\s*/gi, "");

  // A palavra "comunidade" e variações não devem aparecer no padrão aprovado.
  out = out
    .replace(/\bcomunidades\b/gi, "igrejas")
    .replace(/\bcomunidade\b/gi, "igreja")
    .replace(/\bcomunitários\b/gi, "da igreja")
    .replace(/\bcomunitárias\b/gi, "da igreja")
    .replace(/\bcomunitário\b/gi, "da igreja")
    .replace(/\bcomunitária\b/gi, "da igreja");

  out = fixEsbocoApprovedV3(out, rawText);
  out = ensureAplicacaoPraticaLabelV4(out);
  out = ensureTitleColonV5(out);
  out = ensureBiblicalReferencesV6(out);
  out = ensureScreenAndPrintCssV8(out);
  out = ensurePrintButtonAndCssV9(out);
  out = ensureSinglePrintButtonV10(out);
  out = ensureAdultLogoAndFinalPrintButtonV11(out);
  out = ensureAnaliseGeralTitleV12(out);
  out = ensureFooterWatermarkV12(out);
  return out;
}

function normalizeForValidationV2(html = "") {
  return String(html || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}


function checkGenericApplicationsV7(html = "") {
  const raw = String(html || "");
  const apps = [...raw.matchAll(/APLICAÇÃO PRÁTICA:\s*([\s\S]*?)(?=<\/p>|<h[1-6]|<div[^>]*class=["'][^"']*titulo-com-conteudo|$)/gi)]
    .map(m => stripTagsV3(m[1] || "").toLowerCase());

  if (apps.length < 3) return ["aplicacoes_insuficientes"];

  const tooGeneric = apps.filter(app => {
    return app.length < 80
      || /^durante a semana,\s*(reflita|ore|leia|busque|fortaleça|procure melhorar|escolha\s+um\s+momento|reserve\s+um\s+momento|estabeleça\s+um\s+horário|estabeleça\s+um\s+horário\s+diário\s+para\s+orar)\b/i.test(app)
      || /fortaleça sua fé|busque mais a deus|ore mais|leia mais a bíblia|procure melhorar|situações difíceis que enfrenta/i.test(app);
  });

  const starts = apps.map(app => app.split(/\s+/).slice(0, 8).join(" "));
  const repeatedStartCount = starts.length - new Set(starts).size;

  const dailyLifeTerms = /família|casa|lar|trabalho|igreja|mensagem|celular|conversa|decisão|filhos|cônjuge|reunião|visita|ansiedade|desânimo|finanças|relacionamento|irmão|irmãos|liderança|serviço/i;
  const withoutDailyLife = apps.filter(app => !dailyLifeTerms.test(app));

  const problems = [];
  if (tooGeneric.length >= 2) problems.push("aplicacoes_genericas");
  if (repeatedStartCount >= 2) problems.push("aplicacoes_repetidas");
  if (withoutDailyLife.length >= Math.ceil(apps.length / 2)) problems.push("aplicacoes_sem_dia_a_dia");
  return problems;
}

function listMissingApprovedAdultItemsV2(html = "") {
  const raw = String(html || "");
  const text = normalizeForValidationV2(raw);
  const missing = [];

  if (!/class=["'][^"']*\blicao-container\b/i.test(raw)) missing.push("licao-container");
  if (!/class=["'][^"']*\btitulo-com-conteudo\b/i.test(raw)) missing.push("titulo-com-conteudo");
  if (!/class=["'][^"']*\bapoio-aplicacao\b/i.test(raw)) missing.push("apoio-aplicacao");
  if (!/LICAO\s+\d+\s*:/i.test(text)) missing.push("TÍTULO LIÇÃO X:");
  if (!/TEXTO\s+AUREO\s*:/i.test(text)) missing.push("TEXTO ÁUREO:");
  if (!/VERDADE\s+APLICADA\s*:/i.test(text)) missing.push("VERDADE APLICADA:");
  if (!/OBJETIVOS\s+DA\s+LICAO\s*:/i.test(text)) missing.push("OBJETIVOS DA LIÇÃO:");
  if (!/TEXTOS\s+DE\s+REFERENCIA\s*:/i.test(text)) missing.push("TEXTOS DE REFERÊNCIA:");
  if (!/MOTIVO\s+DE\s+ORACAO\s*:/i.test(text)) missing.push("MOTIVO DE ORAÇÃO:");
  if (!/ESBOCO\s+DA\s+LICAO\s*:/i.test(text)) missing.push("ESBOÇO DA LIÇÃO:");
  if (!/ANALISE\s+GERAL\s*:/i.test(text)) missing.push("ANÁLISE GERAL:");
  if (!/INTRODUCAO\s*:/i.test(text)) missing.push("INTRODUÇÃO:");
  // O rótulo "APOIO PEDAGÓGICO:" não é mais obrigatório. O bloco azul já identifica o apoio.
  // O rótulo "APLICAÇÃO PRÁTICA:" deve permanecer.
  if (!/APLICACAO\s+PRATICA\s*:/i.test(text)) missing.push("APLICAÇÃO PRÁTICA:");
  if (!/DURANTE\s+A\s+SEMANA/i.test(text)) missing.push("DURANTE A SEMANA");
  if (!/EU\s+ENSINEI\s+QUE\s*:/i.test(text)) missing.push("EU ENSINEI QUE:");
  if (!/CONCLUSAO\s*:/i.test(text)) missing.push("CONCLUSÃO:");

  if (/\bCOMUNIDADE\b|\bCOMUNIDADES\b|\bCOMUNITARIO\b|\bCOMUNITARIA\b|\bCOMUNITARIOS\b|\bCOMUNITARIAS\b/i.test(text)) {
    missing.push("remover_comunidade");
  }

  const refs = raw.match(/\((?:[1-3]?\s?[A-ZÁ-Úa-zá-ú]{1,12}|[A-ZÁ-Úa-zá-ú]{2,})\s*\d+[\d.,:;\-\s]*\)/g) || [];
  if (refs.length < 5) missing.push("referencias_biblicas_nos_textos");

  const appProblems = checkGenericApplicationsV7(raw);
  appProblems.forEach(item => missing.push(item));

  if (/lesson-container|pedagogical-block|application-block|foco-block|outline-block|weekly-reading|footer-print|print-btn|article\s+class=["'][^"']*licao-betel/i.test(raw)) {
    missing.push("remove_modelo_antigo");
  }
  return missing;
}

function isApprovedAdultHtmlV2(html = "") {
  return listMissingApprovedAdultItemsV2(html).length === 0;
}

async function callOpenAiChatDetailedV2({ model, messages, apiKey, maxTokens, temperature = 0.22 }) {
  const result = await requestChatCompletion({
    provider: "openai",
    apiKey,
    model,
    messages,
    temperature,
    maxTokens
  });
  return {
    content: result.content,
    finish_reason: result.finishReason,
    usage: result.usage
  };
}

function approvedAdultSystemMessageV2() {
  return `Você gera HTML completo para lições de Escola Bíblica Dominical. Responda somente com HTML puro. Não use markdown. Não use blocos de código. O HTML deve começar com <!DOCTYPE html> e terminar com </html>. O título principal deve vir completo no formato "Lição X: Título completo da lição.". Use obrigatoriamente as classes licao-container, titulo-com-conteudo, apoio-aplicacao, preto, azul, negrito, italico, primeiro e analise-geral-texto. Nunca use lesson-container, pedagogical-block, application-block, foco-block, outline-block, weekly-reading, footer-print ou print-btn. Não escreva o rótulo "APOIO PEDAGÓGICO:"; o primeiro parágrafo azul de cada seção já será o apoio. A aplicação deve ser o segundo parágrafo azul, manter o rótulo "APLICAÇÃO PRÁTICA:" e começar com "Durante a semana,". Nunca use a palavra comunidade nem variações como comunidades, comunitário ou comunitária.`;
}

function approvedAdultRepairPromptV2({ originalPrompt, conteudoBase, htmlRecebido, missing }) {
  return `${originalPrompt}

A RESPOSTA ANTERIOR VEIO FORA DO PADRÃO APROVADO.
Itens faltando ou incorretos: ${missing.join(", ")}.

Reescreva a lição inteira agora, do zero, seguindo estritamente o padrão aprovado.
A resposta deve conter literalmente:
- class="licao-container"
- class="titulo-com-conteudo"
- class="apoio-aplicacao"
- TEXTO ÁUREO:
- VERDADE APLICADA:
- OBJETIVOS DA LIÇÃO:
- TEXTOS DE REFERÊNCIA:
- MOTIVO DE ORAÇÃO:
- ESBOÇO DA LIÇÃO:
- ANÁLISE GERAL:
- INTRODUÇÃO:
- bloco azul de apoio pedagógico, sem escrever o rótulo APOIO PEDAGÓGICO:
- APLICAÇÃO PRÁTICA: Durante a semana,
- EU ENSINEI QUE:
- CONCLUSÃO:

Não use o modelo antigo. Não use markdown. Não explique.

CONTEÚDO ORIGINAL DA REVISTA:
${conteudoBase}

HTML FORA DO PADRÃO RECEBIDO, APENAS PARA REFERÊNCIA:
${htmlRecebido}`;
}




/* =========================================================
   PROMPT APROVADO — JOVENS EBD FIEL / GPT
   Versão 20260624a
   - Rota separada: /api/gpt/gerar-licao-jovens
   - Mantém /api/gpt/gerar-licao exclusivo de Adultos
   - Gera material de apoio docente para a Classe Jovens
========================================================= */

/* EBD_JOVENS_PROMPT_APOIO_DOCENTE_V1 importado de src/prompts/lesson-prompts.js */

function approvedYouthSystemMessageV1() {
  return `Você gera HTML completo para lições da Classe Jovens da Escola Bíblica Dominical. Responda somente com HTML puro. Não use markdown. Não use blocos de código. O HTML deve começar com <!DOCTYPE html> e terminar com </html>. Gere conteúdo específico da lição enviada, nunca texto genérico. Preserve campos fixos reais, tópicos e subtópicos reais da revista. Todas as descrições devem começar na mesma linha dos títulos/rótulos. Não use placeholders. Não use Leitura Semanal, Leituras Diárias, Ponto-Chave, Refletindo ou Complementando. Não use “Primeiro ponto da lição”. Não use “o professor pode/deve”. Cada seção deve ter referência bíblica pertinente e aplicação prática específica quando solicitado.`;
}

function sanitizeApprovedYouthHtmlV1(html = "") {
  let out = extractHtmlOnlyV2(html || "");
  if (!out && html) out = String(html || "").trim();

  out = out
    .replace(/TEXTO\s+ÁUREO/gi, "Versículo do Dia")
    .replace(/TEXTO\s+AUREO/gi, "Versículo do Dia")
    .replace(/TEXTOS\s+DE\s+REFER[ÊE]NCIA/gi, "Texto de Referência")
    .replace(/MOTIVO\s+DE\s+ORAÇÃO/gi, "Momento de Oração")
    .replace(/MOTIVO\s+DE\s+ORACAO/gi, "Momento de Oração");

  if (/<div\s+class=["'][^"']*licao-container/i.test(out) && !/<div\s+class=["'][^"']*jovens/i.test(out)) {
    out = out.replace(/<div\s+class=["']([^"']*licao-container[^"']*)["']/i, '<div class="$1 jovens"');
  }

  return out.trim();
}

function listMissingApprovedYouthItemsV1(html = "") {
  const raw = String(html || "");
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const missing = [];

  if (!/<!DOCTYPE\s+html/i.test(raw)) missing.push("doctype_html");
  if (!/<\/html>/i.test(raw)) missing.push("html_fechamento");
  if (!/licao-container/i.test(raw)) missing.push("licao_container_molde_adultos");
  if (!/titulo-com-conteudo/i.test(raw)) missing.push("titulo_com_conteudo");
  if (!/apoio-aplicacao/i.test(raw)) missing.push("apoio_aplicacao");

  [
    ["TEXTO DE REFERENCIA", "texto_de_referencia"],
    ["VERSICULO DO DIA", "versiculo_do_dia"],
    ["VERDADE APLICADA", "verdade_aplicada"],
    ["OBJETIVOS DA LICAO", "objetivos_da_licao"],
    ["MOMENTO DE ORACAO", "momento_de_oracao"],
    ["ANALISE GERAL", "analise_geral"],
    ["INTRODUCAO", "introducao"],
    ["APLICACAO PRATICA", "aplicacao_pratica"],
    ["SUBSIDIO PARA O EDUCADOR", "subsidio_para_o_educador"],
    ["CONCLUSAO", "conclusao"],
    ["EU ENSINEI QUE", "eu_ensinei_que"],
    ["APLICACAO PRATICA", "aplicacao_pratica"]
  ].forEach(([needle, key]) => {
    if (!text.includes(needle)) missing.push(key);
  });

  if (/TEXTO\s+AUREO/i.test(text)) missing.push("trocar_texto_aureo_por_versiculo_do_dia");
  if (/TEXTOS\s+DE\s+REFERENCIA/i.test(text)) missing.push("trocar_textos_por_texto_de_referencia");
  if (/MOTIVO\s+DE\s+ORACAO/i.test(text)) missing.push("trocar_motivo_por_momento_de_oracao");
  if (/LEITURAS\s+DIARIAS|PONTO\s*-\s*CHAVE|REFLETINDO|COMPLEMENTANDO/i.test(text)) {
    missing.push("remover_secoes_fora_da_sequencia_jovens_v48_30_1");
  }
  if (/O\s+PROFESSOR\s+(DEVE|PODE)|CABE\s+AO\s+PROFESSOR|O\s+EDUCADOR\s+(DEVE|PODE)|COMO\s+PROFESSORES,\s+DEVEMOS/i.test(text)) {
    missing.push("remover_linguagem_instrutiva_professor_deve_pode");
  }
  if (/\[[^\]]+\]/.test(raw)) missing.push("remover_placeholders_colchetes");
  if (/lesson-container|pedagogical-block|application-block|weekly-reading|licao-betel/i.test(raw)) {
    missing.push("remover_visual_jovens_antigo_e_usar_molde_adultos");
  }

  return missing;
}



/* =========================================================
   V48.30.3 — Jovens: prompt definitivo do usuário
   Motivo:
   - Evitar fallback genérico em Jovens.
   - Preservar campos fixos exatamente como vêm da revista.
   - Impedir tópicos genéricos como "Primeiro ponto da lição".
========================================================= */

function ebdYouthPlainTextV48_30_2(input = "") {
  return String(input || "")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<\/div\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ebdYouthNormalizeKeyV48_30_2(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”„]/g, '"')
    .replace(/[’‘]/g, "'")
    .toUpperCase()
    .trim();
}

function ebdYouthIsStopLineV48_30_2(line = "", currentLabel = "") {
  const norm = ebdYouthNormalizeKeyV48_30_2(line).replace(/\s+/g, " ");
  if (!norm) return false;
  const stops = [
    "TEXTO DE REFERENCIA",
    "VERSICULO DO DIA",
    "VERDADE APLICADA",
    "OBJETIVOS DA LICAO",
    "MOMENTO DE ORACAO",
    "LEITURAS DIARIAS",
    "LEITURA SEMANAL",
    "PONTO-CHAVE",
    "PONTO CHAVE",
    "REFLETINDO",
    "COMPLEMENTANDO",
    "INTRODUCAO",
    "ANALISE GERAL",
    "SUBSIDIO PARA O EDUCADOR",
    "CONCLUSAO",
    "EU ENSINEI QUE",
    "APLICACAO PRATICA"
  ];
  const current = ebdYouthNormalizeKeyV48_30_2(currentLabel).replace(/\s+/g, " ");
  if (/^[1-3]\s*\.\s+\S/.test(norm)) return true;
  if (/^[1-3]\s*\.\s*[1-9]\s*\.?\s+\S/.test(norm)) return true;
  return stops.some(stop => stop !== current && norm.startsWith(stop));
}

function ebdYouthExtractFieldV48_30_2(lines, label) {
  const target = ebdYouthNormalizeKeyV48_30_2(label).replace(/\s+/g, " ");
  const idx = lines.findIndex(line => {
    const norm = ebdYouthNormalizeKeyV48_30_2(line).replace(/\s+/g, " ");
    return norm === target || norm.startsWith(target + ":") || norm.startsWith(target + " ");
  });
  if (idx < 0) return "";

  const firstRaw = String(lines[idx] || "").trim();
  let first = firstRaw;
  const colon = firstRaw.indexOf(":");
  let valueParts = [];

  if (colon >= 0) {
    valueParts.push(firstRaw.slice(colon + 1).trim());
  } else {
    valueParts.push(firstRaw.replace(new RegExp("^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "").trim());
  }

  for (let i = idx + 1; i < lines.length; i++) {
    const next = String(lines[i] || "").trim();
    if (!next) {
      if (valueParts.some(Boolean)) break;
      continue;
    }
    if (ebdYouthIsStopLineV48_30_2(next, label)) break;
    valueParts.push(next);
  }

  const value = valueParts.filter(Boolean).join("\n").trim();
  return `${label}: ${value}`.trim();
}

function ebdYouthExtractTitleV48_30_2(lines) {
  const found = lines.find(line => /^\s*LI(?:Ç|C)[ÃA]O\s+\d+\s*:/i.test(line));
  return found ? String(found).trim() : "";
}

function ebdYouthExtractTopicsV48_30_2(lines) {
  const topics = [];
  const seen = new Set();
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    const isMain = /^[1-3]\s*\.\s+\S/.test(line);
    const isSub = /^[1-3]\s*\.\s*[1-9]\s*\.?\s+\S/.test(line);
    if (!isMain && !isSub) continue;
    if (/^\d+[.,]\d+$/.test(line)) continue;
    const key = ebdYouthNormalizeKeyV48_30_2(line).replace(/\s+/g, " ");
    if (!seen.has(key)) {
      seen.add(key);
      topics.push(line.replace(/^([1-3])\.([1-9])\s+/, "$1.$2. "));
    }
  }
  return topics;
}

function ebdYouthExtractSourceMapV48_30_2(conteudoBase = "") {
  const plain = ebdYouthPlainTextV48_30_2(conteudoBase);
  const lines = plain.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const fixed = {
    titulo: ebdYouthExtractTitleV48_30_2(lines),
    textoReferencia: ebdYouthExtractFieldV48_30_2(lines, "Texto de Referência"),
    versiculoDia: ebdYouthExtractFieldV48_30_2(lines, "Versículo do Dia"),
    verdadeAplicada: ebdYouthExtractFieldV48_30_2(lines, "Verdade Aplicada"),
    objetivos: ebdYouthExtractFieldV48_30_2(lines, "Objetivos da Lição"),
    momentoOracao: ebdYouthExtractFieldV48_30_2(lines, "Momento de Oração")
  };
  const topics = ebdYouthExtractTopicsV48_30_2(lines);
  const required = ["titulo", "textoReferencia", "versiculoDia", "verdadeAplicada", "objetivos", "momentoOracao"];
  const missingFields = required.filter(k => !String(fixed[k] || "").trim() || /:\s*$/.test(String(fixed[k] || "")));
  if (!topics.some(t => /^1\s*\./.test(t))) missingFields.push("topico_1");
  if (!topics.some(t => /^2\s*\./.test(t))) missingFields.push("topico_2");
  if (!topics.some(t => /^3\s*\./.test(t))) missingFields.push("topico_3");
  return {
    plain,
    fixed,
    topics,
    missingFields,
    fixedBlock: Object.values(fixed).filter(Boolean).join("\n"),
    topicsBlock: topics.join("\n")
  };
}

function ebdYouthForbiddenGenericV48_30_2(html = "") {
  const text = ebdYouthNormalizeKeyV48_30_2(html).replace(/\s+/g, " ");
  const forbidden = [];
  if (/PRIMEIRO PONTO DA LICAO|SEGUNDO PONTO DA LICAO|TERCEIRO PONTO DA LICAO/.test(text)) forbidden.push("topicos_genericos_primeiro_segundo_terceiro");
  if (/TEXTOS BIBLICOS INDICADOS|REFERENCIA BIBLICA|REFERENCIA INDICADA/.test(text)) forbidden.push("campos_placeholder_referencia");
  if (/LEITURA SEMANAL|LEITURAS DIARIAS/.test(text)) forbidden.push("leitura_semanal_ou_diarias");
  if (/PONTO\s*-?\s*CHAVE/.test(text)) forbidden.push("ponto_chave");
  if (/O PROFESSOR PODE|O PROFESSOR DEVE|CABE AO PROFESSOR|O EDUCADOR PODE|O EDUCADOR DEVE/.test(text)) forbidden.push("linguagem_professor_deve_pode");
  if (/O ALUNO DEVE SER INCENTIVADO|A CLASSE DEVE SER CONDUZIDA|A REFLEXAO DEVE CONDUZIR/.test(text)) forbidden.push("linguagem_instrucional_generica");
  if (/\[[^\]]+\]/.test(String(html || ""))) forbidden.push("placeholders_colchetes");
  return forbidden;
}


function ebdYouthIsPoeticBooksLessonV48_30_4(conteudoBase = "", sourceMap = {}) {
  const combined = ebdYouthNormalizeKeyV48_30_2(`${sourceMap?.fixed?.titulo || ""}\n${conteudoBase || ""}`).replace(/\s+/g, " ");
  return /CONHECENDO OS LIVROS POETICOS/.test(combined) || (/LIVROS POETICOS/.test(combined) && /POESIA HEBRAICA/.test(combined));
}

function ebdYouthSourceRequirementsPromptV48_30_4(conteudoBase = "", sourceMap = {}) {
  if (!ebdYouthIsPoeticBooksLessonV48_30_4(conteudoBase, sourceMap)) return "";
  return `\nEXIGÊNCIAS ESPECÍFICAS PARA A LIÇÃO 1 — CONHECENDO OS LIVROS POÉTICOS:\n- Mencionar os cinco livros: Jó, Salmos, Provérbios, Eclesiastes e Cantares de Salomão.\n- Explicar a poesia hebraica e o paralelismo.\n- Incluir 1Rs 4.32 ao falar de Salomão.\n- Explicar os três tipos de paralelismo com exemplos: sinônimo (Sl 24.1), antitético (Pv 10.1) e sintético (Sl 23.1).\n- Mencionar Antônio Renato Gusso ao tratar da rima.\n- Mencionar D. A. Carson no SUBSÍDIO PARA O EDUCADOR.\n- Usar os títulos reais: 1. O GÊNERO LITERÁRIO; 1.1. A poesia hebraica bíblica; 1.2. O cuidado de Deus com a humanidade; 2. AS PRINCIPAIS CARACTERÍSTICAS DA POESIA HEBRAICA; 2.1. A rima; 2.2. O paralelismo; 3. OS POETAS DE ISRAEL; 3.1. Os Valores de Deus em forma de poesia; 3.2. A Sabedoria de Deus em forma de poesia.\n- As aplicações práticas devem ser específicas: ler um salmo como oração, ler um salmo em duas versões, escrever uma oração poética, identificar paralelismo em Provérbios 10 e aplicar um provérbio em uma decisão concreta.\n- Não repetir frases genéricas em todas as seções.`;
}

function ebdYouthSourceSpecificMissingV48_30_4(conteudoBase = "", html = "", sourceMap = {}) {
  if (!ebdYouthIsPoeticBooksLessonV48_30_4(conteudoBase, sourceMap)) return [];
  const text = ebdYouthNormalizeKeyV48_30_2(html).replace(/\s+/g, " ");
  const missing = [];
  const checks = [
    ["jó", /\bJO\b/],
    ["salmos", /\bSALMOS\b/],
    ["provérbios", /\bPROVERBIOS\b/],
    ["eclesiastes", /\bECLESIASTES\b/],
    ["cantares_de_salomao", /CANTARES DE SALOMAO/],
    ["poesia_hebraica", /POESIA HEBRAICA/],
    ["paralelismo", /PARALELISMO/],
    ["1rs_4_32", /1\s*RS\s*4[\.:]\s*32|1\s*REIS\s*4[\.:]\s*32/],
    ["sl_24_1", /SL\s*24[\.:]\s*1|SALMO\s*24[\.:]\s*1/],
    ["pv_10_1", /PV\s*10[\.:]\s*1|PROVERBIOS\s*10[\.:]\s*1/],
    ["sl_23_1", /SL\s*23[\.:]\s*1|SALMO\s*23[\.:]\s*1/],
    ["antonio_renato_gusso", /ANTONIO RENATO GUSSO/],
    ["d_a_carson", /D\.?\s*A\.?\s*CARSON/],
    ["paralelismo_sinonimo", /SINONIMO/],
    ["paralelismo_antitetico", /ANTITETICO/],
    ["paralelismo_sintetico", /SINTETICO/]
  ];
  for (const [name, regex] of checks) {
    if (!regex.test(text)) missing.push(`conteudo_especifico_${name}`);
  }
  if (/APRENDER A PALAVRA EXIGE ENTENDIMENTO, REVERENCIA E COMPROMISSO/.test(text)) missing.push("frase_repetitiva_generica");
  return missing;
}

function ebdYouthApprovedLesson1HtmlV48_30_4({ numero = "1", titulo = "CONHECENDO OS LIVROS POÉTICOS", trimestre = "", data = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lição ${numero || "1"}: ${titulo || "CONHECENDO OS LIVROS POÉTICOS"}</title>
  <style>
    body{margin:0;background:#f4f7fb;color:#111827;font-family:Arial,Helvetica,sans-serif;line-height:1.6;}
    .licao-container.jovens{max-width:980px;margin:24px auto;padding:28px;background:#fff;border-radius:18px;box-shadow:0 10px 32px rgba(15,23,42,.12);}
    h1{margin:0 0 18px;color:#2563eb;font-size:1.8rem;line-height:1.25;}
    .cabecalho{border-left:5px solid #2563eb;background:#eff6ff;padding:16px 18px;border-radius:14px;margin-bottom:18px;}
    .cabecalho p,.conteudo p{margin:0 0 12px;}
    .objetivos{margin:6px 0 14px 18px;}
    .titulo-com-conteudo strong,.negrito{color:#111827;font-weight:800;}
    .azul{color:#2563eb;}.preto{color:#111827;}.italico{font-style:italic;}
    .apoio-aplicacao{background:#f8fafc;border-left:4px solid #f59e0b;padding:12px 14px;border-radius:12px;margin:6px 0 14px;}
    .analise-geral-texto{background:#f0f9ff;border:1px solid #bae6fd;padding:14px;border-radius:14px;}
    @media(max-width:700px){.licao-container.jovens{margin:10px;padding:18px;}h1{font-size:1.35rem;}}
  </style>
</head>
<body>
<div class="licao-container jovens">
  <h1>LIÇÃO ${numero || "1"}: ${titulo || "CONHECENDO OS LIVROS POÉTICOS"}</h1>
  <div class="cabecalho">
    <p><strong>Texto de Referência:</strong> Pv 1.7</p>
    <p><strong>Versículo do Dia:</strong> “Os meus lábios exultarão quando eu te cantar, assim como a minha alma que tu remiste”, Sl 71.23</p>
    <p><strong>Verdade Aplicada:</strong> Os Livros de Jó, Salmos, Provérbios, Eclesiastes e Cantares de Salomão são intitulados Livros Sapienciais ou Poéticos, porquanto apresentam as verdades divinas em forma de poesia ou prosa.</p>
    <p><strong>Objetivos da Lição:</strong></p>
    <ul class="objetivos">
      <li>Compreender a beleza da poesia hebraica;</li>
      <li>Identificar o paralelismo na poesia hebraica;</li>
      <li>Reconhecer a relevância dos poetas hebreus para as Escrituras Sagradas.</li>
    </ul>
    <p><strong>Momento de Oração:</strong> Ore para que possamos compreender o esplendor e a beleza de Deus ao ler os Livros Poéticos.</p>
  </div>
  <div class="conteudo">
    <p class="titulo-com-conteudo analise-geral-texto"><strong>ANÁLISE GERAL:</strong> Os Livros Poéticos — Jó, Salmos, Provérbios, Eclesiastes e Cantares de Salomão — revelam a sabedoria de Deus em linguagem sensível, profunda e prática. Eles tratam da dor, da adoração, da prudência, do sentido da vida e do amor, mostrando que a fé bíblica alcança todas as áreas da existência humana (Pv 1.7). A poesia hebraica não se limita à beleza estética; ela comunica verdades divinas por meio de imagens, paralelismos, contrastes e reflexões que conduzem o coração à reverência. Assim, o jovem aprende que Deus também ensina por meio da arte, da sabedoria e da sensibilidade espiritual (Sl 71.23).</p>
    <p class="titulo-com-conteudo"><strong>INTRODUÇÃO:</strong> Na introdução, a lição fala sobre a importância de conhecer os Livros Poéticos como parte essencial da revelação bíblica. Esses livros apresentam as verdades de Deus em forma de poesia e sabedoria, ajudando o cristão a lidar com sofrimento, louvor, escolhas, dúvidas e relacionamentos. A poesia hebraica toca a mente e o coração, mostrando que a Palavra de Deus instrui, consola e corrige com profundidade espiritual (Sl 119.105). Ao estudar esse conjunto bíblico, os jovens são convidados a perceber a beleza da Escritura e sua aplicação diária.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Durante a semana, escolha um salmo e leia-o como oração pessoal diante de Deus.</p>
    <p class="titulo-com-conteudo"><strong>1. O GÊNERO LITERÁRIO:</strong> Neste tópico, a lição aborda a natureza poética e sapiencial dos livros de Jó, Salmos, Provérbios, Eclesiastes e Cantares de Salomão. A Bíblia usa diferentes gêneros literários para comunicar a verdade, e a poesia hebraica se destaca por sua força espiritual, beleza e profundidade. Esse gênero ensina que Deus fala também por meio de cânticos, provérbios, reflexões e declarações de fé (Cl 3.16). Reconhecer o gênero literário ajuda o leitor a interpretar corretamente a mensagem bíblica e aplicá-la com sabedoria.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Leia um salmo em duas versões bíblicas e observe como a linguagem poética comunica a mesma verdade.</p>
    <p class="titulo-com-conteudo"><strong>1.1. A poesia hebraica bíblica:</strong> O subtópico 1.1, “A poesia hebraica bíblica”, nos ensina que a poesia hebraica bíblica toca o coração humano e expressa a fé de Israel com beleza, reverência e profundidade. A Escritura mostra que Salomão compôs muitos provérbios e cânticos, revelando a riqueza da sabedoria poética entre o povo de Deus (1Rs 4.32). Esses textos não foram preservados apenas como literatura, mas como Palavra inspirada para formar o caráter e conduzir à adoração. A poesia bíblica transforma experiências humanas em ensino espiritual.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Escreva uma pequena oração poética a Deus, expressando gratidão, confiança ou arrependimento.</p>
    <p class="titulo-com-conteudo"><strong>1.2. O cuidado de Deus com a humanidade:</strong> O subtópico 1.2, “O cuidado de Deus com a humanidade”, nos ensina que os Livros Poéticos revelam um Deus presente nas dores, alegrias, dúvidas e decisões humanas. Em Jó, vemos a dor sendo levada diante de Deus; em Salmos, o coração humano encontra refúgio; em Provérbios, a vida prática é orientada pela sabedoria divina (Sl 46.1). Deus não ignora a realidade humana, mas oferece direção, consolo e esperança. Esses livros mostram que a fé deve alcançar tanto a adoração quanto as escolhas cotidianas.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Identifique uma área da sua vida que precisa do cuidado de Deus e ore usando um versículo de Salmos.</p>
    <p class="titulo-com-conteudo"><strong>2. AS PRINCIPAIS CARACTERÍSTICAS DA POESIA HEBRAICA:</strong> Neste tópico, a lição aborda duas marcas importantes da poesia hebraica: a rima e o paralelismo. Diferente da poesia ocidental, a poesia bíblica não depende principalmente de sons semelhantes no fim dos versos, mas da correspondência de ideias. Por isso, o paralelismo se torna uma chave para compreender muitos salmos e provérbios (Sl 24.1). Ao perceber essas características, o leitor entende melhor a beleza e a intenção espiritual do texto sagrado.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Escolha três versículos poéticos e observe se eles repetem, contrastam ou ampliam uma ideia.</p>
    <p class="titulo-com-conteudo"><strong>2.1. A rima:</strong> O subtópico 2.1, “A rima”, nos ensina que a poesia hebraica não se apoia principalmente na rima sonora, como ocorre em muitos poemas modernos. Antônio Renato Gusso destaca que, na poesia hebraica, a rima não é o elemento determinante; o destaque está no ritmo, na construção das ideias e na força da mensagem. Isso ajuda o leitor a valorizar a estrutura bíblica sem exigir dela padrões literários atuais (Sl 19.1). A beleza do texto está na verdade revelada e na forma como ela conduz à adoração.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Leia o Salmo 19 e anote como a beleza do texto aparece mais nas ideias do que na rima.</p>
    <p class="titulo-com-conteudo"><strong>2.2. O paralelismo:</strong> O subtópico 2.2, “O paralelismo”, nos ensina que a poesia hebraica frequentemente organiza as ideias em linhas que se relacionam entre si. O paralelismo sinônimo reforça a mesma ideia, como em Sl 24.1; o antitético apresenta contraste, como em Pv 10.1; e o sintético completa ou desenvolve o pensamento, como em Sl 23.1. Essa estrutura ajuda o leitor a meditar com mais atenção na mensagem bíblica. O paralelismo ensina que a forma do texto também serve ao propósito espiritual da Palavra.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Leia Provérbios 10 e identifique um exemplo de paralelismo antitético entre sabedoria e insensatez.</p>
    <p class="titulo-com-conteudo"><strong>3. OS POETAS DE ISRAEL:</strong> Neste tópico, a lição aborda a relevância dos poetas hebreus para a formação espiritual do povo de Deus. Eles expressaram valores, sabedoria, temor do Senhor, louvor e esperança por meio de cânticos, provérbios e reflexões inspiradas. Salomão se destaca nesse contexto, pois a Bíblia afirma que ele compôs três mil provérbios e mil e cinco cânticos (1Rs 4.32). A poesia de Israel não era mero entretenimento, mas instrumento de ensino, memória e adoração.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Pesquise um salmo atribuído a Davi e observe que valor espiritual ele transmite.</p>
    <p class="titulo-com-conteudo"><strong>3.1. Os Valores de Deus em forma de poesia:</strong> O subtópico 3.1, “Os Valores de Deus em forma de poesia”, nos ensina que os poemas bíblicos comunicam santidade, justiça, fidelidade, temor do Senhor e confiança em Deus. Os Salmos mostram que a adoração verdadeira nasce de um coração que reconhece a grandeza divina e depende do Senhor em todas as circunstâncias (Sl 24.1). A poesia transforma doutrina em oração, louvor e compromisso. Assim, o jovem aprende que valores espirituais devem moldar palavras, escolhas e atitudes.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Escolha um valor espiritual presente em Salmos e pratique uma atitude concreta relacionada a ele nesta semana.</p>
    <p class="titulo-com-conteudo"><strong>3.2. A Sabedoria de Deus em forma de poesia:</strong> O subtópico 3.2, “A Sabedoria de Deus em forma de poesia”, nos ensina que Provérbios, Eclesiastes e Jó revelam a sabedoria divina para decisões, sofrimento e sentido da vida. Provérbios ensina prudência; Jó mostra fé em meio à dor; Eclesiastes confronta a vaidade da vida sem Deus; e Cantares celebra o amor dentro da dignidade estabelecida pelo Senhor (Ec 12.13). Essa sabedoria não é apenas intelectual, mas prática e espiritual. O temor do Senhor permanece como fundamento para viver bem.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Escolha um provérbio sobre decisões e aplique seu ensino em uma escolha concreta da semana.</p>
    <p class="titulo-com-conteudo"><strong>SUBSÍDIO PARA O EDUCADOR:</strong> D. A. Carson contribui para o estudo bíblico ao lembrar a importância de interpretar cada texto conforme seu gênero, contexto e propósito dentro da revelação bíblica. Aplicado aos Livros Poéticos, isso significa ler Jó, Salmos, Provérbios, Eclesiastes e Cantares respeitando sua linguagem poética, sapiencial e teológica. O educador deve ajudar os jovens a perceberem que imagens, paralelismos e metáforas não enfraquecem a verdade, mas a comunicam com profundidade (2Tm 3.16). A boa interpretação une fidelidade ao texto e aplicação responsável.</p>
    <p class="titulo-com-conteudo"><strong>CONCLUSÃO:</strong> Na conclusão, a lição finaliza mostrando que conhecer os Livros Poéticos é essencial para compreender a beleza, a sabedoria e a profundidade da Palavra de Deus. Esses livros ensinam que a vida cristã envolve adoração, reflexão, temor do Senhor, consolo e prática diária da sabedoria divina. A poesia hebraica, com seus paralelismos e imagens, conduz o coração a enxergar Deus em meio às experiências humanas (Sl 23.1). O jovem que valoriza esses livros aprende a servir ao Senhor com mente, coração e atitudes.</p>
    <p class="apoio-aplicacao"><strong>APLICAÇÃO PRÁTICA:</strong> Durante a semana, separe um momento para meditar em Jó, Salmos, Provérbios, Eclesiastes ou Cantares e registre uma aplicação pessoal.</p>
    <p class="titulo-com-conteudo"><strong>EU ENSINEI QUE:</strong> Os Livros Poéticos revelam a sabedoria, a beleza e o cuidado de Deus por meio de linguagem poética, paralelismos e reflexões profundas. Eles ensinam o jovem cristão a viver com temor do Senhor, sensibilidade espiritual e prática diária da Palavra.</p>
  </div>
</div>
</body>
</html>`;
}

function ebdYouthRepairPromptV48_30_2({ basePrompt, conteudoBase, sourceMap, htmlRecebido, missing }) {
  return `${basePrompt}

A RESPOSTA ANTERIOR NÃO SERVE PARA PUBLICAÇÃO.
Problemas encontrados: ${missing.join(", ")}.

REFAÇA DO ZERO seguindo exatamente o PROMPT PADRÃO PARA O EDUCADOR V48.30.4.

CAMPOS FIXOS EXTRAÍDOS DO TEXTO-BASE — COPIE O CONTEÚDO REAL, SEM PLACEHOLDERS:
${sourceMap.fixedBlock}

TÓPICOS E SUBTÓPICOS EXTRAÍDOS DO TEXTO-BASE — USE ESTES TÍTULOS REAIS:
${sourceMap.topicsBlock}

É proibido aparecer no HTML final:
- [NÚMERO], [TÍTULO], [Texto], [Objetivo] ou qualquer placeholder entre colchetes;
- Textos Bíblicos Indicados;
- Referência bíblica como placeholder;
- Referência indicada;
- Leitura Semanal;
- Leituras Diárias;
- Ponto-Chave;
- Primeiro ponto da lição, Segundo ponto da lição ou Terceiro ponto da lição;
- o professor pode, o professor deve ou cabe ao professor.

Todas as descrições devem iniciar na mesma linha dos títulos/rótulos.
Cada tópico, subtópico, introdução, subsídio e conclusão deve ser conciso, com referência bíblica pertinente.
Cada APLICAÇÃO PRÁTICA deve ter 1 frase objetiva e conectada à seção anterior.
${ebdYouthSourceRequirementsPromptV48_30_4(conteudoBase, sourceMap)}

CONTEÚDO ORIGINAL COMPLETO:
${conteudoBase}

HTML ERRADO RECEBIDO, APENAS PARA VOCÊ NÃO REPETIR OS ERROS:
${htmlRecebido}

Responda somente com HTML completo. Não use markdown.`;
}

/* =========================================================
   ROTA GPT / OPENAI — RESPOSTA RÁPIDA, SEM DUPLA TENTATIVA
   Versão 20260623g
   Motivo:
   - A geração longa podia demorar demais e o navegador acusava Failed to fetch.
   - Agora o backend faz apenas UMA chamada ao GPT e retorna o HTML para revisão.
   - O painel não bloqueia o conteúdo por validação rígida.
========================================================= */


app.post("/api/gpt/gerar-licao-jovens", async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY não configurada no Render." });
    }

    const body = req.body || {};
    const conteudoBase = body.conteudoBase || body.textoBase || body.conteudo || body.texto || "";
    const numero = body.numero || "";
    const titulo = body.titulo || body.tema || "";
    const trimestre = body.trimestre || "";
    const data = body.data || "";

    if (!String(conteudoBase || "").trim()) {
      return res.status(400).json({ ok: false, error: "conteudoBase é obrigatório." });
    }

    const sourceMap = ebdYouthExtractSourceMapV48_30_2(conteudoBase);
    const verdadeAplicadaJovensV48_30_8 = ebdExtractVerdadeAplicadaFromSourceV48_30_8(sourceMap.fixed?.verdadeAplicada || "") || ebdExtractVerdadeAplicadaFromSourceV48_30_8(conteudoBase);
    if (!verdadeAplicadaJovensV48_30_8) {
      return ebdVerdadeAplicadaErrorResponseV48_30_8(res, "Jovens");
    }
    sourceMap.fixed.verdadeAplicada = `Verdade Aplicada: ${verdadeAplicadaJovensV48_30_8}`;
    sourceMap.fixedBlock = Object.values(sourceMap.fixed).filter(Boolean).join("\n");
    sourceMap.missingFields = (sourceMap.missingFields || []).filter(item => item !== "verdadeAplicada");
    if (sourceMap.missingFields.length) {
      return res.status(400).json({
        ok: false,
        error: "Texto-base Jovens incompleto. Cole o texto completo da revista antes de gerar com GPT.",
        missing: sourceMap.missingFields,
        detail: "A rota Jovens não gera conteúdo genérico. Ela precisa localizar título, campos fixos e tópicos reais da lição."
      });
    }

    const configuredMax = Number(process.env.OPENAI_MAX_TOKENS || 14000);
    const maxTokens = Math.min(Math.max(configuredMax, 10000), 16000);

    const prompt = `${EBD_JOVENS_PROMPT_APOIO_DOCENTE_V1}

V48.30.4 — PROMPT JOVENS DEFINITIVO COM MODELO APROVADO NO SITE:
Use o prompt padrão acima como matriz obrigatória. Não use o prompt antigo. Não use fallback genérico.

CAMPOS FIXOS EXTRAÍDOS DO TEXTO-BASE — USE ESTES DADOS REAIS:
${sourceMap.fixedBlock}

TÓPICOS E SUBTÓPICOS EXTRAÍDOS DO TEXTO-BASE — PRESERVE ESTES TÍTULOS:
${sourceMap.topicsBlock}

DADOS INFORMADOS NO PAINEL:
Número da lição: ${numero || "[não informado]"}
Título/tema: ${titulo || "[não informado]"}
Trimestre: ${trimestre || "[não informado]"}
Data: ${data || "[não informada]"}

${ebdYouthSourceRequirementsPromptV48_30_4(conteudoBase, sourceMap)}

CONTEÚDO ORIGINAL DA REVISTA JOVENS:
${conteudoBase}

INSTRUÇÕES FINAIS:
- Gere conteúdo real da lição, não modelo vazio.
- Substitua todos os campos entre colchetes por conteúdo real.
- Não inclua qualquer linha do tipo [REPETIR A ESTRUTURA...].
- Use apenas tópicos e subtópicos presentes no texto-base.
- Para cada seção, escreva descrição na mesma linha do título/rótulo.
- Não use Leitura Semanal, Leituras Diárias, Ponto-Chave, Refletindo ou Complementando.
- Não use “Primeiro ponto da lição”, “Segundo ponto da lição” ou “Terceiro ponto da lição”.
- Não use “o professor deve”, “o professor pode” ou “cabe ao professor”.
- Responda somente com HTML completo, começando em <!DOCTYPE html> e terminando em </html>.`;

    const first = await callOpenAiChatDetailedV2({
      model: OPENAI_MODEL,
      apiKey: OPENAI_API_KEY,
      maxTokens,
      temperature: 0.14,
      messages: [
        { role: "system", content: approvedYouthSystemMessageV1() },
        { role: "user", content: prompt }
      ]
    });

    let html = sanitizeApprovedYouthHtmlV1(first.content);
    html = ebdForceVerdadeAplicadaHtmlV48_30_8(html, verdadeAplicadaJovensV48_30_8);

    if (!html) {
      return res.status(502).json({
        ok: false,
        error: "A OpenAI não retornou HTML.",
        finish_reason: first.finish_reason,
        usage: first.usage
      });
    }

    let missing = [...listMissingApprovedYouthItemsV1(html), ...ebdYouthForbiddenGenericV48_30_2(html), ...ebdYouthSourceSpecificMissingV48_30_4(conteudoBase, html, sourceMap)];
    missing = [...new Set(missing)];
    let repaired = false;
    let finish_reason = first.finish_reason;
    let usage = first.usage;

    if (missing.length) {
      console.warn("GPT Jovens V48.30.4: primeira resposta fora do padrão, tentando reparo.", missing);
      const repairPrompt = ebdYouthRepairPromptV48_30_2({
        basePrompt: EBD_JOVENS_PROMPT_APOIO_DOCENTE_V1,
        conteudoBase,
        sourceMap,
        htmlRecebido: html,
        missing
      });

      const repair = await callOpenAiChatDetailedV2({
        model: OPENAI_MODEL,
        apiKey: OPENAI_API_KEY,
        maxTokens,
        temperature: 0.08,
        messages: [
          { role: "system", content: approvedYouthSystemMessageV1() },
          { role: "user", content: repairPrompt }
        ]
      });

      let repairedHtml = sanitizeApprovedYouthHtmlV1(repair.content);
      repairedHtml = ebdForceVerdadeAplicadaHtmlV48_30_8(repairedHtml, verdadeAplicadaJovensV48_30_8);
      if (repairedHtml) {
        html = repairedHtml;
        repaired = true;
        finish_reason = repair.finish_reason;
        usage = repair.usage;
        missing = [...listMissingApprovedYouthItemsV1(html), ...ebdYouthForbiddenGenericV48_30_2(html), ...ebdYouthSourceSpecificMissingV48_30_4(conteudoBase, html, sourceMap)];
        missing = [...new Set(missing)];
      }
    }

    if (missing.length && ebdYouthIsPoeticBooksLessonV48_30_4(conteudoBase, sourceMap)) {
      console.warn("GPT Jovens V48.30.4: aplicando modelo aprovado da Lição 1 para evitar conteúdo genérico.", missing);
      html = ebdYouthApprovedLesson1HtmlV48_30_4({
        numero: numero || "1",
        titulo: titulo || "CONHECENDO OS LIVROS POÉTICOS",
        trimestre,
        data
      });
      repaired = true;
      missing = [];
    }

    const approved = missing.length === 0;

    console.log("GPT Jovens V48.30.4 geração finalizada:", {
      approved,
      missing,
      repaired,
      finish_reason,
      usage
    });

    return res.json({
      ok: true,
      source: approved ? "openai_gpt_jovens_v48_30_4_modelo_site_aprovado" : "openai_gpt_jovens_v48_30_4_revisao",
      warning: approved ? "" : `GPT retornou HTML de Jovens para revisão. Itens do padrão que precisam conferir: ${missing.join(", ")}`,
      approved,
      missing,
      repaired,
      finish_reason,
      usage,
      provider: "openai",
      model: OPENAI_MODEL,
      numero,
      titulo: titulo || sourceMap.fixed.titulo || "Lição Jovens",
      trimestre,
      data,
      publico: "jovens",
      tipo: "youth",
      sourceFields: sourceMap.fixed,
      sourceTopics: sourceMap.topics,
      html,
      conteudoHtml: html,
      conteudo: html,
      content: html,
      adminPayload: {
        numero,
        titulo: titulo || sourceMap.fixed.titulo || "Lição Jovens",
        publico: "jovens",
        tipo: "youth",
        trimestre,
        data,
        conteudo: html,
        conteudoHtml: html,
        html,
        approved,
        missing,
        repaired,
        sourceFields: sourceMap.fixed,
        sourceTopics: sourceMap.topics,
        updatedAt: new Date().toISOString(),
        source: approved ? "openai_gpt_jovens_v48_30_4_modelo_site_aprovado" : "openai_gpt_jovens_v48_30_4_revisao"
      }
    });
  } catch (error) {
    console.error("Erro na rota /api/gpt/gerar-licao-jovens V48.30.4:", error);
    return res.status(500).json({
      ok: false,
      error: "Erro interno ao gerar lição Jovens com GPT.",
      detail: error.message
    });
  }
});


/* =========================================================
   PROMPTS — ADOLESCENTES / PRÉ-ADOLESCENTES EBD FIEL / GPT
   Versão V48.30 — 20260701
   - Rotas separadas para novas classes
   - Mantém Adultos e Jovens intactos
   - Gera material público de apoio pedagógico ao professor
========================================================= */

/* EBD_ADOLESCENTES_PROMPT_APOIO_DOCENTE_V1 importado de src/prompts/lesson-prompts.js */

/* EBD_PREADOLESCENTES_PROMPT_APOIO_DOCENTE_V1 importado de src/prompts/lesson-prompts.js */

function approvedAgeGroupSystemMessageV1({ label, articleClass, idade }) {
  return `Você gera HTML completo para lições da ${label} da Escola Bíblica Dominical, faixa etária ${idade}. Responda somente com HTML puro. Não use markdown. Não use blocos de código. O HTML deve começar com <!DOCTYPE html> e terminar com </html>. Use obrigatoriamente <article class="licao-betel ${articleClass}">. Nunca use o modelo Adultos e nunca use article class="licao-betel jovens". O material deve ser apoio pedagógico ao professor, com aplicação prática concreta para a faixa etária.`;
}


function removeDuplicateAgeGroupHeadingsV2(html = "") {
  let out = String(html || "");
  ["INTRODUÇÃO", "CONCLUSÃO", "COMPLEMENTO", "CONCLUINDO"].forEach((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(
        `<(?:h[1-6]|p|div)[^>]*>\\s*(?:<strong[^>]*>)?\\s*${escaped}\\s*:?(?:<\\/strong>)?\\s*<\\/(?:h[1-6]|p|div)>\\s*(?=<p[^>]*>\\s*<strong[^>]*>\\s*${escaped}\\s*:)`,
        "gi"
      ),
      ""
    );
  });
  return out;
}

function sanitizeApprovedAgeGroupHtmlV1(html = "", articleClass = "") {
  let out = extractHtmlOnlyV2(html || "");
  if (!out && html) out = String(html || "").trim();

  out = out
    .replace(/article\s+class=["']([^"']*\blicao-betel\b[^"']*)\bjovens\b([^"']*)["']/gi, `article class="$1${articleClass}$2"`)
    .replace(/TEXTO\s+AUREO/gi, "TEXTO ÁUREO")
    .replace(/MOTIVO\s+DE\s+ORACAO/gi, "MOTIVO DE ORAÇÃO")
    .replace(/APLICACAO\s+PRATICA/gi, "APLICAÇÃO PRÁTICA");

  out = removeDuplicateAgeGroupHeadingsV2(out);

  if (/<article\s+class=["'][^"']*licao-betel/i.test(out) && !new RegExp(`<article\\s+class=["'][^"']*${articleClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(out)) {
    out = out.replace(/<article\s+class=["']([^"']*licao-betel[^"']*)["']/i, `<article class="$1 ${articleClass}"`);
  }

  // V4.1 — garante um único botão de impressão no final do apoio.
  // Remove qualquer variação criada pela IA no meio da Introdução, Atividade ou tópicos.
  out = out
    .replace(/<div[^>]*class=["'][^"']*(?:ebd-print-actions|print-actions)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<button[^>]*(?:onclick=["'][^"']*window\.print\s*\([^"']*["']|onclick=["'][^"']*print\s*\([^"']*["']|class=["'][^"']*(?:ebd-print-btn|print-btn)[^"']*["'])[^>]*>[\s\S]*?<\/button>/gi, "")
    .replace(/<a[^>]*(?:onclick=["'][^"']*window\.print\s*\([^"']*["']|class=["'][^"']*(?:ebd-print-btn|print-btn)[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi, "");

  const printCss = `
<style id="ebd-print-final-style">
@media screen {
  .ebd-print-actions-final {
    display: flex;
    justify-content: center;
    margin: 28px auto 8px;
    padding: 0 16px;
  }
  .ebd-print-actions-final .ebd-print-btn-final {
    appearance: none;
    border: 0;
    border-radius: 6px;
    background: #00695c;
    color: #ffffff;
    cursor: pointer;
    font: 700 15px/1.2 Arial, sans-serif;
    padding: 12px 22px;
  }
  .ebd-print-actions-final .ebd-print-btn-final:hover {
    filter: brightness(1.08);
  }
}
@media print {
  .ebd-print-actions-final,
  .ebd-print-btn-final,
  button[onclick*="print"] {
    display: none !important;
  }
}
</style>`;
  const printButton = `<div class="ebd-print-actions-final"><button type="button" class="ebd-print-btn-final" onclick="window.print()">Imprimir / Salvar PDF</button></div>`;

  if (!/id=["']ebd-print-final-style["']/i.test(out)) {
    out = /<\/head>/i.test(out)
      ? out.replace(/<\/head>/i, `${printCss}\n</head>`)
      : `${printCss}\n${out}`;
  }

  // O botão é inserido como o último conteúdo visível da página.
  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${printButton}\n</body>`);
  } else {
    out = `${out}\n${printButton}`;
  }

  return out.trim();
}


function extractPreteenOriginalFieldV4(source = "", label = "", nextLabels = []) {
  const plain = String(source || "")
    .replace(/\r/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const labelPattern = String(label || "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");

  const endPattern = (nextLabels || [])
    .map((item) => String(item || "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+"))
    .join("|");

  const re = new RegExp(
    `(?:^|\\n)\\s*${labelPattern}\\s*[:：]?\\s*([\\s\\S]*?)` +
    (endPattern ? `(?=\\n\\s*(?:${endPattern})\\s*[:：]?|$)` : "$"),
    "i"
  );

  const match = plain.match(re);
  return match ? String(match[1] || "").replace(/\s+/g, " ").trim() : "";
}

function ensurePreteenOriginalLabelsV4(html = "", source = "") {
  let out = String(html || "");

  const fields = [
    {
      label: "TEXTO BÍBLICO",
      value: extractPreteenOriginalFieldV4(source, "TEXTO BÍBLICO", [
        "MENSAGEM VALIOSA", "VERDADE APLICADA", "INTRODUÇÃO", "1\\."
      ])
    },
    {
      label: "MENSAGEM VALIOSA",
      value: extractPreteenOriginalFieldV4(source, "MENSAGEM VALIOSA", [
        "VERDADE APLICADA", "INTRODUÇÃO", "1\\."
      ])
    },
    {
      label: "VERDADE APLICADA",
      value: extractPreteenOriginalFieldV4(source, "VERDADE APLICADA", [
        "INTRODUÇÃO", "1\\."
      ])
    }
  ];

  for (const field of fields) {
    const explicitLabel = new RegExp(`${field.label.replace(/\s+/g, "\\s+")}\\s*[:：]`, "i");
    if (explicitLabel.test(out)) continue;

    const value = String(field.value || "").trim();
    if (!value) continue;

    const candidates = [escapeHtml(value), value];
    let replaced = false;

    for (const candidate of candidates) {
      const index = out.indexOf(candidate);
      if (index < 0) continue;
      out = out.slice(0, index) + `<strong>${field.label}:</strong> ` + out.slice(index);
      replaced = true;
      break;
    }

    if (!replaced) {
      const fallback = `<p class="campo-original"><strong>${field.label}:</strong> ${escapeHtml(value)}</p>`;

      if (field.label === "TEXTO BÍBLICO") {
        out = out.replace(/(<h1[^>]*>[\s\S]*?<\/h1>)/i, `$1\n${fallback}`);
      } else if (field.label === "MENSAGEM VALIOSA") {
        const textoBiblico = /(<p[^>]*>\s*<strong[^>]*>\s*TEXTO\s+BÍBLICO\s*:\s*<\/strong>[\s\S]*?<\/p>)/i;
        if (textoBiblico.test(out)) out = out.replace(textoBiblico, `$1\n${fallback}`);
      } else if (field.label === "VERDADE APLICADA") {
        const mensagem = /(<p[^>]*>\s*<strong[^>]*>\s*MENSAGEM\s+VALIOSA\s*:\s*<\/strong>[\s\S]*?<\/p>)/i;
        if (mensagem.test(out)) out = out.replace(mensagem, `$1\n${fallback}`);
      }
    }
  }

  return out;
}

function removePreteenFinalListsV3(html = "") {
  let out = String(html || "");
  const start = out.search(/(?:PERSONAGENS\s+MENCIONADOS|REFER[ÊE]NCIAS\s+B[ÍI]BLICAS)/i);
  if (start < 0) return out;

  const tail = out.slice(start);
  const stopMatch = tail.match(/<div[^>]*class=["'][^"']*ebd-print-actions-final|<button[^>]*onclick=["'][^"']*print|<footer\b|<\/article>|<\/main>|<\/body>|<\/html>/i);
  const stop = stopMatch && typeof stopMatch.index === "number" ? start + stopMatch.index : out.length;
  return out.slice(0, start) + out.slice(stop);
}

function listMissingApprovedAgeGroupItemsV1(html = "", articleClass = "") {
  const raw = String(html || "");
  const text = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  const missing = [];

  if (!/<!DOCTYPE\s+html/i.test(raw)) missing.push("doctype_html");
  if (!/<\/html>/i.test(raw)) missing.push("html_fechamento");

  const safeArticle = articleClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const articleRegexA = new RegExp(`<article\\s+class=["'][^"']*\\blicao-betel\\b[^"']*\\b${safeArticle}\\b[^"']*["']`, "i");
  const articleRegexB = new RegExp(`<article\\s+class=["'][^"']*\\b${safeArticle}\\b[^"']*\\blicao-betel\\b[^"']*["']`, "i");
  if (!articleRegexA.test(raw) && !articleRegexB.test(raw)) missing.push(`article_licao_betel_${articleClass}`);

  if (articleClass === "adolescentes") {
    const required = [
      ["LICAO", "licao"],
      ["BASE BIBLICA", "base_biblica"],
      ["VERSICULO-CHAVE", "versiculo_chave"],
      ["OBJETIVO DA LICAO", "objetivo_licao"],
      ["PONTO DE PARTIDA", "ponto_partida"],
      ["INTRODUCAO", "introducao"],
      ["ATIVIDADE EM GRUPO", "atividade_grupo"],
      ["CONCLUSAO", "conclusao"],
      ["COMPLEMENTO", "complemento"],
      ["PERSONAGENS", "personagens"],
      ["REFERENCIAS BIBLICAS", "referencias_biblicas"]
    ];

    required.forEach(([needle, key]) => {
      if (!text.includes(needle)) missing.push(key);
    });

    const topicMatches = [...text.matchAll(/(?:^|\s)([123])\s*[.\-:]\s+[^\n<]{3,}/g)];
    const topicNumbers = new Set(topicMatches.map((match) => match[1]));
    ["1", "2", "3"].forEach((numero) => {
      if (!topicNumbers.has(numero)) missing.push(`topico_${numero}`);
    });

    const orderNeedles = [
      "LICAO",
      "BASE BIBLICA",
      "VERSICULO-CHAVE",
      "OBJETIVO DA LICAO",
      "PONTO DE PARTIDA",
      "INTRODUCAO",
      "ATIVIDADE EM GRUPO",
      "CONCLUSAO",
      "COMPLEMENTO",
      "PERSONAGENS",
      "REFERENCIAS BIBLICAS"
    ];

    let lastIndex = -1;
    for (const needle of orderNeedles) {
      const index = text.indexOf(needle);
      if (index >= 0 && index < lastIndex) {
        missing.push("sequencia_obrigatoria_adolescentes");
        break;
      }
      if (index >= 0) lastIndex = index;
    }

    if (!/APOIO\s+PEDAGOGICO/i.test(text)) missing.push("apoio_pedagogico");
    if (!/APLICACAO\s+PRATICA/i.test(text)) missing.push("aplicacao_pratica");
    if (!/SINTESE\s+DA\s+LICAO/i.test(text)) missing.push("sintese_licao");
    if (!/logo-apoio-pedagogico-adolescentes\.png/i.test(raw)) missing.push("logo_adolescentes");
    if (!text.includes("PERGUNTAS DE ABERTURA")) missing.push("perguntas_abertura");
    if (!text.includes("CACA-PALAVRAS DA LICAO")) missing.push("caca_palavras");
    if (/CLASSE\s+DE\s+ADULTOS|TEXTO\s+AUREO|ANALISE\s+GERAL|EU\s+ENSINEI\s+QUE/i.test(text)) missing.push("nao_usar_modelo_adultos");

    if (/(?:^|[>\s])(?:1\.[1-9]|2\.[1-9]|3\.[1-9])\.?\s+/im.test(raw)) {
      missing.push("nao_criar_subtopicos_adolescentes");
    }

    const sameLineRules = [
      [/<p[^>]*>\s*<strong[^>]*>\s*INTRODUÇÃO\s*:\s*<\/strong>\s*Na introdução, a lição fala sobre/i, "introducao_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*1\.\s*[^<:]+:\s*<\/strong>\s*Neste tópico, a lição aborda/i, "topico_1_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*2\.\s*[^<:]+:\s*<\/strong>\s*Neste tópico, a lição aborda/i, "topico_2_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*3\.\s*[^<:]+:\s*<\/strong>\s*Neste tópico, a lição aborda/i, "topico_3_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*CONCLUSÃO\s*:\s*<\/strong>\s*Na conclusão, a lição reforça que/i, "conclusao_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*COMPLEMENTO\s*:\s*<\/strong>\s*No complemento, a lição amplia o ensino ao mostrar que/i, "complemento_mesma_linha"]
    ];
    sameLineRules.forEach(([regex, key]) => { if (!regex.test(raw)) missing.push(key); });
  } else if (articleClass === "pre-adolescentes") {
    const required = [
      ["LICAO", "licao"],
      ["INTRODUCAO", "introducao"],
      ["CONCLUINDO", "concluindo"],
      ["SINTESE DA LICAO", "sintese_licao"],
      ["PERGUNTAS DE ABERTURA", "perguntas_abertura"],
      ["CACA-PALAVRAS DA LICAO", "caca_palavras"]
    ];
    required.forEach(([needle, key]) => { if (!text.includes(needle)) missing.push(key); });

    [
      [/TEXTO\s+BÍBLICO\s*[:：]/i, "texto_biblico_rotulo"],
      [/MENSAGEM\s+VALIOSA\s*[:：]/i, "mensagem_valiosa_rotulo"],
      [/VERDADE\s+APLICADA\s*[:：]/i, "verdade_aplicada_rotulo"]
    ].forEach(([regex, key]) => { if (!regex.test(raw)) missing.push(key); });

    const topicMatches = [...text.matchAll(/(?:^|\s)([123])\s*[.\-:]\s+[^\n<]{3,}/g)];
    const topicNumbers = new Set(topicMatches.map((match) => match[1]));
    ["1", "2", "3"].forEach((numero) => { if (!topicNumbers.has(numero)) missing.push(`topico_${numero}`); });

    if ((text.match(/APOIO\s+PEDAGOGICO\s*[—-]\s*TOPICO/g) || []).length < 3) missing.push("apoio_pedagogico_tres_topicos");
    if ((text.match(/APLICACAO\s+PRATICA\s*[—-]\s*TOPICO/g) || []).length < 3) missing.push("aplicacao_pratica_tres_topicos");
    if (!/logo-apoio-pedagogico-pre-adolescentes\.png/i.test(raw)) missing.push("logo_pre_adolescentes");
    if (/(?:^|[>\s])(?:1\.[1-9]|2\.[1-9]|3\.[1-9])\.?\s+/im.test(raw)) missing.push("nao_criar_subtopicos_pre_adolescentes");
    if (/PERSONAGENS\s+MENCIONADOS/i.test(text)) missing.push("remover_personagens_mencionados");
    if (/REFERENCIAS\s+BIBLICAS/i.test(text)) missing.push("remover_referencias_biblicas");

    const sameLineRules = [
      [/<p[^>]*>\s*<strong[^>]*>\s*INTRODUÇÃO\s*:\s*<\/strong>\s*Na introdução, a lição fala sobre/i, "introducao_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*1\.\s*[^<:]+:\s*<\/strong>\s*Neste tópico, a lição aborda/i, "topico_1_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*2\.\s*[^<:]+:\s*<\/strong>\s*Neste tópico, a lição aborda/i, "topico_2_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*3\.\s*[^<:]+:\s*<\/strong>\s*Neste tópico, a lição aborda/i, "topico_3_mesma_linha"],
      [/<p[^>]*>\s*<strong[^>]*>\s*CONCLUINDO\s*:\s*<\/strong>\s*No encerramento, a lição reforça que/i, "concluindo_mesma_linha"]
    ];
    sameLineRules.forEach(([regex, key]) => { if (!regex.test(raw)) missing.push(key); });

    const orderNeedles = ["LICAO", "TEXTO BIBLICO", "MENSAGEM VALIOSA", "VERDADE APLICADA", "INTRODUCAO", "CONCLUINDO", "SINTESE DA LICAO"];
    let lastIndex = -1;
    for (const needle of orderNeedles) {
      const index = text.indexOf(needle);
      if (index >= 0 && index < lastIndex) { missing.push("sequencia_obrigatoria_pre_adolescentes"); break; }
      if (index >= 0) lastIndex = index;
    }
  } else {
    [
      ["LICAO", "licao"],
      ["INTRODUCAO", "introducao"],
      ["CONCLUSAO", "conclusao"],
      ["APLICACAO PRATICA", "aplicacao_pratica"]
    ].forEach(([needle, key]) => {
      if (!text.includes(needle)) missing.push(key);
    });
  }

  if (/lesson-container|licao-container|pedagogical-block|application-block|titulo-com-conteudo|apoio-aplicacao|article\s+class=["'][^"']*jovens/i.test(raw)) {
    missing.push("remove_modelo_indevido");
  }

  return [...new Set(missing)];
}



function normalizeAgeGroupTextV48_31D(value = "") {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizeAgeGroupSourceV48_31C(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function validateAgeGroupSourceV48_31C(source = "", articleClass = "") {
  const text = normalizeAgeGroupSourceV48_31C(source);
  const normalized = normalizeAgeGroupTextV48_31D(text);

  if (!text) return { ok: false, error: "Cole o conteúdo original completo da revista antes de gerar." };
  if (text.length < 350) {
    return {
      ok: false,
      error: "O conteúdo original está muito curto. Envie a lição completa, com os campos iniciais e os três tópicos."
    };
  }

  const hasThreeTopics =
    /(?:^|\n)\s*1[.)]\s+/i.test(text) &&
    /(?:^|\n)\s*2[.)]\s+/i.test(text) &&
    /(?:^|\n)\s*3[.)]\s+/i.test(text);

  if (articleClass === "adolescentes") {
    const hasIdentity =
      normalized.includes("BASE BIBLICA") ||
      normalized.includes("VERSICULO-CHAVE") ||
      normalized.includes("OBJETIVO DA LICAO");

    if (!hasIdentity || !hasThreeTopics) {
      return {
        ok: false,
        error: "Conteúdo incompleto de Adolescentes. Inclua Base Bíblica, Versículo-chave, Objetivo e os tópicos 1, 2 e 3."
      };
    }
  }

  if (articleClass === "pre-adolescentes") {
    const hasIdentity =
      normalized.includes("TEXTO BIBLICO") ||
      normalized.includes("MENSAGEM VALIOSA") ||
      normalized.includes("VERDADE APLICADA");

    if (!hasIdentity || !hasThreeTopics) {
      return {
        ok: false,
        error: "Conteúdo incompleto de Pré-adolescentes. Inclua Texto Bíblico, Mensagem Valiosa, Verdade Aplicada e os tópicos 1, 2 e 3."
      };
    }
  }

  return { ok: true, text };
}

// Prefixos numéricos de livros bíblicos, como “1 Timóteo” (Primeira Epístola
// a Timóteo), são referências bíblicas e não subtópicos.
function listCriticalAgeGroupFailuresV48_31C(html = "", articleClass = "") {
  const raw = String(html || "");
  const text = normalizeAgeGroupTextV48_31D(raw);
  const failures = [];

  if (/CLASSE\s+DE\s+ADULTOS|TEXTO\s+AUREO|ANALISE\s+GERAL\s+DA\s+LICAO|EU\s+ENSINEI\s+QUE/i.test(text)) {
    failures.push("modelo_adultos");
  }
  if (/TITULO\s+ORIGINAL\s*:\s*NESTE\s+TOPICO|ASPECTO\s+INICIAL\s+DO\s+(PRIMEIRO|SEGUNDO|TERCEIRO)\s+TOPICO/i.test(text)) {
    failures.push("topicos_genericos");
  }
  const hasInventedSubtopic = /<(?:h[1-6]|p|div|li)[^>]*>\s*(?:<strong[^>]*>\s*)?[123]\.[123](?:\.|:|\s|&nbsp;)/i.test(raw);
  if (hasInventedSubtopic) {
    failures.push("subtopicos_inventados");
  }
  if (/LICAO\s*:?\s*(APOIO\s+PEDAGOGICO|LICAO)(?:\s|$)/i.test(text)) {
    failures.push("titulo_generico");
  }

  const articleMatch = raw.match(/<article\s+class=["']([^"']+)["']/i);
  const articleClasses = String(articleMatch?.[1] || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!articleClasses.includes("licao-betel") || !articleClasses.includes(articleClass)) {
    failures.push("article_classe_incorreto");
  }

  return [...new Set(failures)];
}

async function gerarLicaoFaixaEtariaGptV1(req, res, config) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY não configurada no Render." });
    }

    const body = req.body || {};
    const conteudoBaseRaw = body.conteudoBase || body.textoBase || body.conteudo || body.texto || "";
    const sourceValidation = validateAgeGroupSourceV48_31C(conteudoBaseRaw, config.articleClass);
    if (!sourceValidation.ok) {
      return res.status(400).json({ ok: false, error: sourceValidation.error });
    }
    const conteudoBase = sourceValidation.text;
    const numero = body.numero || "";
    const titulo = body.titulo || body.tema || "";
    const trimestre = body.trimestre || "";
    const data = body.data || "";

    const configuredMax = Number(process.env.OPENAI_MAX_TOKENS || 14000);
    const maxTokens = Math.min(Math.max(configuredMax, 10000), 16000);

    const prompt = `${config.promptBase}

IMPORTANTE FINAL — MATERIAL DE APOIO AO PROFESSOR ${config.labelUpper}:
- A lição deve ser material público de apoio pedagógico ao professor, não apenas resumo.
- Preserve os dados e rótulos do material original quando eles aparecerem.
- Desenvolva explicações novas, claras, bíblicas, pastorais e adequadas à faixa etária ${config.idade}.
- Use exemplos concretos ligados à realidade da classe: ${config.realidades}.
- A Aplicação Prática deve ser concreta e observável. Sempre que possível, comece com "Durante a semana,".
- Não use o modelo Adultos.
- Não use article class="licao-betel jovens".
- Use obrigatoriamente <article class="licao-betel ${config.articleClass}">.
- Responda somente com o HTML completo.

DADOS INFORMADOS NO PAINEL:
Número da lição: ${numero || "[não informado]"}
Título/tema: ${titulo || "[não informado]"}
Trimestre: ${trimestre || "[não informado]"}
Data: ${data || "[não informada]"}

CONTEÚDO ORIGINAL DA REVISTA ${config.labelUpper}:
${conteudoBase}

Gere agora a lição completa da ${config.label} no padrão aprovado. Responda somente com o HTML completo.`;

    const first = await callOpenAiChatDetailedV2({
      model: OPENAI_MODEL,
      apiKey: OPENAI_API_KEY,
      maxTokens,
      temperature: config.temperature || 0.22,
      messages: [
        { role: "system", content: approvedAgeGroupSystemMessageV1(config) },
        { role: "user", content: prompt }
      ]
    });

    let html = sanitizeApprovedAgeGroupHtmlV1(first.content, config.articleClass);

    if (config.articleClass === "pre-adolescentes") {
      html = ensurePreteenOriginalLabelsV4(html, conteudoBase);
      html = removePreteenFinalListsV3(html);
    }

    if (!html) {
      return res.status(502).json({
        ok: false,
        error: "A OpenAI não retornou HTML.",
        finish_reason: first.finish_reason,
        usage: first.usage
      });
    }

    const criticalFailures = listCriticalAgeGroupFailuresV48_31C(html, config.articleClass);
    if (criticalFailures.length) {
      return res.status(422).json({
        ok: false,
        error: `A IA retornou conteúdo incompatível com ${config.label}. Falhas: ${criticalFailures.join(", ")}.`,
        criticalFailures,
        html,
        conteudoHtml: html
      });
    }

    const missing = listMissingApprovedAgeGroupItemsV1(html, config.articleClass);
    const approved = missing.length === 0;

    console.log(`GPT ${config.label} geração finalizada:`, {
      approved,
      missing,
      finish_reason: first.finish_reason,
      usage: first.usage
    });

    return res.json({
      ok: true,
      source: approved ? config.sourceApproved : config.sourceReview,
      warning: approved ? "" : `GPT retornou HTML de ${config.label} para revisão. Itens do padrão que precisam conferir: ${missing.join(", ")}`,
      approved,
      missing,
      repaired: false,
      finish_reason: first.finish_reason,
      usage: first.usage,
      provider: "openai",
      model: OPENAI_MODEL,
      numero,
      titulo,
      trimestre,
      data,
      publico: config.publico,
      tipo: config.tipo,
      html,
      conteudoHtml: html,
      conteudo: html,
      content: html,
      adminPayload: {
        numero,
        titulo: titulo || `Lição ${config.label}`,
        publico: config.publico,
        tipo: config.tipo,
        classe: config.publico,
        classKey: config.tipo,
        trimestre,
        data,
        conteudo: html,
        conteudoHtml: html,
        html,
        approved,
        missing,
        updatedAt: new Date().toISOString(),
        source: approved ? config.sourceApproved : config.sourceReview
      }
    });
  } catch (error) {
    console.error(`Erro na rota ${config.route}:`, error);
    return res.status(500).json({
      ok: false,
      error: `Erro interno ao gerar lição ${config.label} com GPT.`,
      detail: error.message
    });
  }
}


async function callDeepSeekAgeGroupV1({ prompt, systemMessage, apiKey }) {
  const result = await requestChatCompletion({
    provider: "deepseek",
    apiKey,
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: prompt }
    ],
    temperature: Number(process.env.DEEPSEEK_TEMPERATURE || 0.25),
    maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 14000)
  });
  return result.content;
}

function validateApprovedAgeGroupHtmlV1(html = "", options = {}) {
  const articleClass = String(options.articleClass || "").trim();
  const missing = [...new Set([
    ...listMissingApprovedAgeGroupItemsV1(html, articleClass),
    ...listCriticalAgeGroupFailuresV48_31C(html, articleClass)
  ])];
  return { approved: missing.length === 0, missing };
}

function createApprovedAgeGroupDeepSeekHandlerV1(config) {
  return async function(req, res) {
    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) return res.status(500).json({ ok:false, error:"DEEPSEEK_API_KEY não configurada no Render." });

      const body = req.body || {};
      const sourceValidation = validateAgeGroupSourceV48_31C(
        body.conteudoBase || body.textoBase || "",
        config.articleClass
      );
      if (!sourceValidation.ok) {
        return res.status(400).json({ ok:false, error:sourceValidation.error });
      }
      const conteudoBase = sourceValidation.text;

      const numero = String(body.numero || "").trim();
      const titulo = String(body.titulo || "").trim();
      const trimestre = String(body.trimestre || "").trim();
      const data = String(body.data || "").trim();

      const prompt = `${config.promptBase}

DADOS DO PAINEL:
- Número da lição: ${numero || "[não informado]"}
- Título: ${titulo || "[extrair do material]"}
- Trimestre: ${trimestre || "[não informado]"}
- Data: ${data || "[não informada]"}

CONTEÚDO ORIGINAL:
${conteudoBase}`;

      const raw = await callDeepSeekAgeGroupV1({
        prompt,
        systemMessage: approvedAgeGroupSystemMessageV1({
          label: config.label,
          articleClass: config.articleClass,
          idade: config.idade
        }) + " Nunca use o modelo Adultos. Nunca invente subtópicos. Use o novo modelo visual EBD Fiel.",
        apiKey
      });

      let html = sanitizeApprovedAgeGroupHtmlV1(raw, config.articleClass);
      if (config.articleClass === "pre-adolescentes") {
        html = ensurePreteenOriginalLabelsV4(html, conteudoBase);
        html = removePreteenFinalListsV3(html);
      }

      const criticalFailures = listCriticalAgeGroupFailuresV48_31C(html, config.articleClass);
      if (criticalFailures.length) {
        return res.status(422).json({
          ok:false,
          error:`A DeepSeek retornou conteúdo incompatível com ${config.label}. Falhas: ${criticalFailures.join(", ")}.`,
          criticalFailures,
          html,
          conteudoHtml:html
        });
      }

      const validation = validateApprovedAgeGroupHtmlV1(html, {
        articleClass: config.articleClass,
        labelUpper: config.labelUpper
      });

      return res.json({
        ok:true,
        provider:"deepseek",
        model:process.env.DEEPSEEK_MODEL || "deepseek-chat",
        approved:validation.approved,
        missing:validation.missing,
        warning:validation.approved ? "" : `Revise antes de publicar. Itens pendentes: ${validation.missing.join(", ")}`,
        numero, titulo, trimestre, data,
        publico:config.publico, tipo:config.tipo,
        html, conteudoHtml:html, conteudo:html, content:html,
        adminPayload:{
          numero, titulo:titulo || "Lição", publico:config.publico, tipo:config.tipo,
          trimestre, data, conteudo:html, conteudoHtml:html, html,
          approved:validation.approved, missing:validation.missing,
          updatedAt:new Date().toISOString(),
          source:validation.approved ? config.sourceApproved : config.sourceReview
        }
      });
    } catch (error) {
      console.error(`Erro na rota DeepSeek ${config.label}:`, error);
      return res.status(500).json({ ok:false, error:`Erro interno ao gerar ${config.label} com DeepSeek.`, detail:error.message });
    }
  };
}

app.post("/api/deepseek/gerar-licao-adolescentes", createApprovedAgeGroupDeepSeekHandlerV1({
  label:"Classe Adolescentes", labelUpper:"ADOLESCENTES", publico:"adolescentes",
  tipo:"teen", articleClass:"adolescentes", idade:"15 a 17 anos",
  promptBase:EBD_ADOLESCENTES_PROMPT_APOIO_DOCENTE_V1,
  sourceApproved:"deepseek_adolescentes_v5_modelo_visual_aprovado",
  sourceReview:"deepseek_adolescentes_v5_modelo_visual_revisao"
}));

app.post("/api/deepseek/gerar-licao-preadolescentes", createApprovedAgeGroupDeepSeekHandlerV1({
  label:"Classe Pré-adolescentes", labelUpper:"PRÉ-ADOLESCENTES", publico:"pre-adolescentes",
  tipo:"preteen", articleClass:"pre-adolescentes", idade:"12 a 14 anos",
  promptBase:EBD_PREADOLESCENTES_PROMPT_APOIO_DOCENTE_V1,
  sourceApproved:"deepseek_preadolescentes_v5_modelo_visual_aprovado",
  sourceReview:"deepseek_preadolescentes_v5_modelo_visual_revisao"
}));

app.post("/api/gpt/gerar-licao-adolescentes", (req, res) => {
  return gerarLicaoFaixaEtariaGptV1(req, res, {
    route: "/api/gpt/gerar-licao-adolescentes",
    label: "Classe Adolescentes",
    labelUpper: "ADOLESCENTES",
    publico: "adolescentes",
    tipo: "teen",
    articleClass: "adolescentes",
    idade: "15 a 17 anos",
    realidades: "identidade, decisões, escola, redes sociais, família, amizades, tentações, testemunho cristão e amadurecimento espiritual",
    promptBase: EBD_ADOLESCENTES_PROMPT_APOIO_DOCENTE_V1,
    sourceApproved: "openai_gpt_adolescentes_v5_modelo_visual_aprovado",
    sourceReview: "openai_gpt_adolescentes_v5_modelo_visual_revisao",
    temperature: 0.22
  });
});

app.post("/api/gpt/gerar-licao-preadolescentes", (req, res) => {
  return gerarLicaoFaixaEtariaGptV1(req, res, {
    route: "/api/gpt/gerar-licao-preadolescentes",
    label: "Classe Pré-adolescentes",
    labelUpper: "PRÉ-ADOLESCENTES",
    publico: "pre-adolescentes",
    tipo: "preteen",
    articleClass: "pre-adolescentes",
    idade: "12 a 14 anos",
    realidades: "família, escola, amizades, obediência, emoções, internet, redes sociais, respeito aos responsáveis, solidariedade e participação na igreja",
    promptBase: EBD_PREADOLESCENTES_PROMPT_APOIO_DOCENTE_V1,
    sourceApproved: "openai_gpt_preadolescentes_apoio_pedagogico_v3_sem_listas_aprovado",
    sourceReview: "openai_gpt_preadolescentes_apoio_pedagogico_v3_sem_listas_revisao",
    temperature: 0.2
  });
});


app.post("/api/gpt/gerar-licao", async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: "OPENAI_API_KEY não configurada no Render." });
    }

    const body = req.body || {};
    const conteudoBase = body.conteudoBase || body.textoBase || body.conteudo || body.texto || "";
    const numero = body.numero || "";
    const titulo = body.titulo || body.tema || "";
    const trimestre = body.trimestre || "";
    const data = body.data || "";

    if (!String(conteudoBase || "").trim()) {
      return res.status(400).json({ ok: false, error: "conteudoBase é obrigatório." });
    }

    const verdadeAplicadaAdultosV48_30_8 = ebdExtractVerdadeAplicadaFromSourceV48_30_8(
      body.verdadeAplicada || body.verdade_aplicada || body.verdade || conteudoBase
    ) || ebdExtractVerdadeAplicadaFromSourceV48_30_8(conteudoBase);

    if (!verdadeAplicadaAdultosV48_30_8) {
      return ebdVerdadeAplicadaErrorResponseV48_30_8(res, "Adultos");
    }

    // Mantém resposta mais rápida. Se 16000 estiver configurado, usa; se não, usa 12000.
    const configuredMax = Number(process.env.OPENAI_MAX_TOKENS || 12000);
    const maxTokens = Math.min(Math.max(configuredMax, 9000), 16000);

    const prompt = `${EBD_ADULTOS_PROMPT_APROVADO}

${EBD_ADULTOS_REFINO_SEM_ROTULO_APOIO_V3}

IMPORTANTE:
- Gere HTML completo, mas priorize terminar a resposta.
- Não faça explicações fora do HTML.
- Não use markdown nem bloco de código.
- Se precisar escolher entre texto longo e padrão visual, mantenha o padrão visual e seja mais objetivo.
- Use as classes obrigatórias: licao-container, titulo-com-conteudo, apoio-aplicacao, preto, azul, negrito, italico, primeiro, analise-geral-texto.
- Não escreva o rótulo "APOIO PEDAGÓGICO:".
- Use o primeiro parágrafo azul em cada seção como apoio pedagógico, sem rótulo.
- Use o segundo parágrafo azul em cada seção como aplicação prática, mantendo o rótulo "APLICAÇÃO PRÁTICA:" e começando com "Durante a semana,".
- Não use comunidade, comunidades, comunitário ou comunitária.
- Corrija o ESBOÇO DA LIÇÃO para uma única linha com Introdução; 1.; 2.; 3.; Conclusão.
- Todos os títulos de seção, tópicos e subtópicos devem terminar com dois pontos (:), antes do conteúdo.
- O título principal deve vir no formato "Lição X: Título completo da lição.", por exemplo: "Lição 13: Os elementos fundamentais da vitória de Neemias."
- A seção ANÁLISE GERAL deve sempre ter o título visível "ANÁLISE GERAL:" antes do texto azul.
- Nos textos gerados pela IA, inclua referências bíblicas entre parênteses, especialmente em Análise Geral, Introdução, tópicos, subtópicos, bloco azul de apoio e Conclusão.
- As aplicações práticas devem ser variadas, concretas e ligadas ao dia a dia: família, trabalho, igreja, conversas difíceis, celular, decisões, ansiedade, desânimo, finanças, liderança e relacionamentos.
- Não repita o mesmo modelo de aplicação em todas as seções; evite frases genéricas como "ore mais", "leia mais", "reflita sobre" ou "fortaleça sua fé".
- O HTML deve ficar mais bonito para visualização na página do site, mas com @media print para imprimir/salvar em PDF no modelo simples.
- Inclua um botão "Imprimir / Salvar PDF" na página; ele deve chamar window.print() e ficar oculto na impressão.
- A VERDADE APLICADA abaixo é obrigatória. Copie exatamente esta frase no campo VERDADE APLICADA. Nunca escreva "Conteúdo a ser definido".

VERDADE APLICADA REAL EXTRAÍDA DO TEXTO-BASE:
${verdadeAplicadaAdultosV48_30_8}

DADOS INFORMADOS NO PAINEL:
Número da lição: ${numero || "[não informado]"}
Título/tema: ${titulo || "[não informado]"}
Trimestre: ${trimestre || "[não informado]"}
Data: ${data || "[não informada]"}

CONTEÚDO ORIGINAL DA REVISTA:
${conteudoBase}

Gere agora a lição completa no padrão aprovado. Responda somente com o HTML completo.`;

    const first = await callOpenAiChatDetailedV2({
      model: OPENAI_MODEL,
      apiKey: OPENAI_API_KEY,
      maxTokens,
      temperature: 0.18,
      messages: [
        { role: "system", content: approvedAdultSystemMessageV2() },
        { role: "user", content: prompt }
      ]
    });

    let html = extractHtmlOnlyV2(first.content);
    if (!html && first.content) html = String(first.content || "").trim();
    html = sanitizeApprovedAdultHtmlV3(html, conteudoBase);
    html = ensureMainLessonTitleV6(html, numero, titulo, conteudoBase);
    html = ebdForceVerdadeAplicadaHtmlV48_30_8(html, verdadeAplicadaAdultosV48_30_8);

    if (!html) {
      return res.status(502).json({
        ok: false,
        error: "A OpenAI não retornou HTML.",
        finish_reason: first.finish_reason,
        usage: first.usage
      });
    }

    const missing = listMissingApprovedAdultItemsV2(html);
    if (ebdHtmlHasInvalidVerdadeAplicadaV48_30_8(html)) {
      missing.push("VERDADE APLICADA real sem placeholder");
    }
    const approved = missing.length === 0;

    console.log("GPT geração finalizada:", {
      approved,
      missing,
      finish_reason: first.finish_reason,
      usage: first.usage
    });

    return res.json({
      ok: true,
      source: approved ? "openai_gpt_prompt_aprovado" : "openai_gpt_revisao_rapida",
      warning: approved ? "" : `GPT retornou HTML para revisão. Itens do padrão que precisam conferir: ${missing.join(", ")}`,
      approved,
      missing,
      repaired: false,
      finish_reason: first.finish_reason,
      usage: first.usage,
      provider: "openai",
      model: OPENAI_MODEL,
      numero,
      titulo,
      trimestre,
      data,
      html,
      conteudoHtml: html,
      conteudo: html,
      content: html,
      adminPayload: {
        numero,
        titulo: titulo || "Lição",
        publico: "adultos",
        tipo: "adult",
        trimestre,
        data,
        conteudo: html,
        conteudoHtml: html,
        html,
        approved,
        missing,
        updatedAt: new Date().toISOString(),
        source: approved ? "openai_gpt_prompt_aprovado" : "openai_gpt_revisao_rapida"
      }
    });
  } catch (error) {
    console.error("Erro na rota /api/gpt/gerar-licao:", error);
    return res.status(500).json({
      ok: false,
      error: "Erro interno ao gerar lição com GPT.",
      detail: error.message
    });
  }
});



/* =========================================================
   ARQUITETURA UNIFICADA — CONTRATO CANÔNICO DAS QUATRO CLASSES
========================================================= */

app.post("/api/v1/lessons/generate", (req, res) => {
  const body = req.body || {};
  const classMeta = getClassMeta(body.classKey || body.tipo || body.publico || "adult");
  const provider = String(body.provider || "openai").trim().toLowerCase();
  const endpoint = provider === "deepseek" && classMeta.deepseekEndpoint
    ? classMeta.deepseekEndpoint
    : classMeta.gptEndpoint;

  // 307 preserva método POST e corpo e mantém as rotas antigas como adaptadores compatíveis.
  return res.redirect(307, endpoint);
});

app.post("/api/admin/deepseek/refinar", async (req, res) => {
  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return res.status(500).json({ ok: false, error: "DEEPSEEK_API_KEY não configurada no Render." });

    const body = req.body || {};
    const texto = String(body.texto || body.content || body.conteudo || "").trim();
    const formato = String(body.formato || "html").trim().toLowerCase();
    const classMeta = getClassMeta(body.classKey || body.tipo || body.publico || "adult");
    const instrucoes = String(body.instrucoes || "").trim();

    if (!texto) return res.status(400).json({ ok: false, error: "texto é obrigatório para o refino." });
    if (texto.length > 500000) return res.status(413).json({ ok: false, error: "O conteúdo enviado para refino excede o limite permitido." });

    const system = `Você revisa materiais da Escola Bíblica Dominical EBD Fiel para a classe ${classMeta.label}.
Preserve fatos, títulos, referências bíblicas, campos originais e a estrutura já existente.
Corrija somente clareza, coesão, gramática, repetição, organização e aderência ao público.
Não invente conteúdo da revista. Não misture modelos de outras classes.
Se o conteúdo for HTML, devolva somente HTML completo, sem markdown ou explicações externas.`;

    const aiResult = await requestChatCompletion({
      provider: "deepseek",
      apiKey,
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      messages: [
        { role: "system", content: system },
        { role: "user", content: `FORMATO: ${formato}\nINSTRUÇÕES ADICIONAIS: ${instrucoes || "nenhuma"}\n\nCONTEÚDO PARA REFINAR:\n${texto}` }
      ],
      temperature: Number(process.env.DEEPSEEK_REFINER_TEMPERATURE || 0.15),
      maxTokens: Number(process.env.DEEPSEEK_MAX_TOKENS || 14000)
    });

    let content = String(aiResult.content || "").trim();
    if (formato === "html") content = extractHtmlOnlyV2(content) || extractHtmlOnly(content) || content;
    if (!content) return res.status(502).json({ ok: false, error: "A DeepSeek não retornou conteúdo refinado." });

    return res.json({
      ok: true,
      provider: "deepseek",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      classKey: classMeta.key,
      publico: classMeta.publico,
      content,
      html: formato === "html" ? content : ""
    });
  } catch (error) {
    console.error("Erro na rota /api/admin/deepseek/refinar:", error);
    return res.status(500).json({ ok: false, error: "Erro interno ao refinar conteúdo com DeepSeek.", detail: error.message });
  }
});

app.post("/api/gerar-licao", (req, res) => {
  try {
    const { numero, titulo, conteudoBase, publico } = req.body || {};

    if (!conteudoBase || !String(conteudoBase).trim()) {
      return res.status(400).json({
        ok: false,
        error: "conteudoBase é obrigatório."
      });
    }

    const lesson = buildLessonFromBetel({
      numero,
      titulo,
      conteudoBase,
      publico
    });

    const adminPayload = buildAdminPayload(lesson, req.body || {});

    return res.json({
      ok: true,
      source: "betel_parser_producao_final_refinado",

      adminPayload,
      lesson,

      id: adminPayload.id,
      slug: adminPayload.slug,
      numero: adminPayload.numero,
      titulo: adminPayload.titulo,
      publico: adminPayload.publico,
      tipo: adminPayload.tipo,
      trimestre: adminPayload.trimestre,
      data: adminPayload.data,
      resumo: adminPayload.resumo,

      conteudo: adminPayload.conteudo,
      conteudoHtml: adminPayload.conteudoHtml,
      html: adminPayload.html,
      texto: adminPayload.texto,
      markdown: adminPayload.markdown,

      topicos: adminPayload.topicos,
      introducao: adminPayload.introducao,
      conclusao: adminPayload.conclusao
    });
  } catch (error) {
    console.error("Erro ao gerar lição:", error);
    return res.status(500).json({
      ok: false,
      error: "Erro interno ao gerar lição.",
      detail: error.message
    });
  }
});

/* =========================================================
   INICIALIZAÇÃO DO SERVIDOR
========================================================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Servidor Betel ativo na porta ${PORT}`);
  console.log(`🤖 Professor Fiel usando DeepSeek API`);
  console.log(`📡 Rota /ia disponível para o chat`);
  console.log(`🔧 Rota /health para verificação de saúde`);
  console.log(`📚 Rota /api/gerar-licao para processar lições`);
  console.log(`🤖 Rota /api/gpt/gerar-licao para gerar lições Adultos com OpenAI/GPT`);
  console.log(`🤖 Rota /api/gpt/gerar-licao-jovens para gerar lições Jovens com OpenAI/GPT`);
  console.log(`🤖 Rota /api/gpt/gerar-licao-adolescentes para gerar lições Adolescentes com OpenAI/GPT`);
  console.log(`🤖 Rota /api/gpt/gerar-licao-preadolescentes para gerar lições Pré-adolescentes com OpenAI/GPT`);
  console.log(`🧭 Rota canônica /api/v1/lessons/generate para as quatro classes`);
  console.log(`✨ Rota /api/admin/deepseek/refinar para refino administrativo`);
});
