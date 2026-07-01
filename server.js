const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());
app.use(express.json({ limit: "20mb" }));

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

const EBD_ADULTOS_PROMPT_APROVADO = `PROMPT DEFINITIVO — GERAR LIÇÃO ADULTOS EBD FIEL

Você é um professor experiente da Classe de Adultos da Escola Bíblica Dominical.

Com base no conteúdo original da revista enviado pelo administrador, gere uma lição bíblica completa em HTML, seguindo rigorosamente todas as regras abaixo.

Gere APENAS o HTML final, começando em <!DOCTYPE html> e terminando em </html>. Não escreva explicações antes nem depois do HTML.

1. ORDEM OBRIGATÓRIA DAS SEÇÕES

A lição deve seguir exatamente esta ordem:

1. TÍTULO DA LIÇÃO
2. TEXTO ÁUREO
3. VERDADE APLICADA
4. OBJETIVOS DA LIÇÃO
5. TEXTOS DE REFERÊNCIA
6. MOTIVO DE ORAÇÃO
7. ESBOÇO DA LIÇÃO
8. ANÁLISE GERAL
9. INTRODUÇÃO
10. TÓPICOS PRINCIPAIS
11. SUBTÓPICOS
12. EU ENSINEI QUE
13. CONCLUSÃO

Não pule seções. Não inverta a ordem. Não inclua Leituras Complementares. Não inclua Hinos Sugeridos.

2. O QUE DEVE SER COPIADO EXATAMENTE DA REVISTA

As seções abaixo devem ser copiadas exatamente como aparecem no material original:

TEXTO ÁUREO: copiar o versículo completo com a referência exata.
VERDADE APLICADA: copiar a frase exatamente como está.
OBJETIVOS DA LIÇÃO: copiar os três objetivos na íntegra.
TEXTOS DE REFERÊNCIA: copiar todos os versículos com a numeração original, sem renumerar, sem resumir e sem omitir.
MOTIVO DE ORAÇÃO: copiar a frase exatamente como está.
ESBOÇO DA LIÇÃO: montar com base nos títulos originais, no formato: Introdução; 1. Título; 2. Título; 3. Título; Conclusão.
EU ENSINEI QUE: copiar as frases originais exatamente como aparecem.

3. O QUE DEVE SER ELABORADO COM PALAVRAS PRÓPRIAS

As seções abaixo devem ser elaboradas com redação nova, autoral, bíblica, pastoral e prática:
ANÁLISE GERAL, INTRODUÇÃO, TÓPICOS PRINCIPAIS, SUBTÓPICOS, CONCLUSÃO, APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA.

Use o conteúdo original da revista apenas como base de compreensão. Não copie parágrafos longos dos comentários da revista. Não inclua citações de autores. Comente o ensino original com palavras próprias.

4. COMO CADA SEÇÃO ELABORADA DEVE COMEÇAR

ANÁLISE GERAL: comece direto com o tema central. Não comece com “Nesta lição, vamos”. Não precisa mencionar “a lição”.
INTRODUÇÃO: comece obrigatoriamente com: Na introdução, a lição fala sobre...
TÓPICOS PRINCIPAIS: cada tópico deve começar obrigatoriamente com: Neste tópico, a lição aborda...
SUBTÓPICOS: cada subtópico deve começar obrigatoriamente com: O subtópico X.X, “título do subtópico”, nos ensina que...
CONCLUSÃO: comece obrigatoriamente com: Na conclusão, a lição reforça que...
APLICAÇÃO PRÁTICA: comece obrigatoriamente com: Durante a semana,...

5. REGRAS DE CONTEÚDO PARA ANÁLISE GERAL

A Análise Geral deve ser um texto corrido, em tom pastoral, reflexivo, bíblico e maduro. Deve ter aproximadamente 10 a 15 linhas. Deve começar direto com o tema central da lição. Deve conectar o ensino com a vida cristã prática. Deve mencionar os pontos principais da lição de maneira natural, sem transformar em lista. Deve preparar o coração do professor para ensinar.

Não use: Nesta lição, vamos; É importante destacar; Vale ressaltar; Nesse sentido; De forma significativa.

6. REGRAS DE CONTEÚDO PARA INTRODUÇÃO

A Introdução deve manter o título INTRODUÇÃO. O conteúdo deve ser elaborado pela IA, comentando o conteúdo original da introdução. Deve começar com: Na introdução, a lição fala sobre... Deve ter de 3 a 5 parágrafos. Deve explicar o ensino central da introdução, conectando com a vida do cristão adulto. Deve usar linguagem pastoral, clara, humana e acessível. Depois da Introdução, incluir APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA.

7. REGRAS DE CONTEÚDO PARA TÓPICOS PRINCIPAIS

Cada tópico principal deve manter exatamente o título original da revista. O conteúdo deve ser elaborado com palavras próprias. Cada tópico deve começar com: Neste tópico, a lição aborda... Cada tópico deve ter de 3 a 5 parágrafos. O texto deve comentar o conteúdo original, sem copiá-lo. Deve desenvolver o tema de forma bíblica, pastoral, reflexiva e prática. Deve conectar o ensino com família, trabalho, igreja, relacionamentos, oração, decisões e vida cristã. Depois de cada tópico, incluir APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA.

8. REGRAS DE CONTEÚDO PARA SUBTÓPICOS

Cada subtópico deve manter exatamente o título original da revista. O conteúdo deve ser elaborado com palavras próprias. Cada subtópico deve começar com: O subtópico X.X, “título do subtópico”, nos ensina que... Cada subtópico deve ter de 3 a 5 parágrafos. O texto deve comentar o conteúdo original, sem copiá-lo. Deve usar linguagem bíblica, pastoral, prática e acessível. Depois de cada subtópico, incluir APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA.

9. REGRAS PARA APOIO PEDAGÓGICO

O Apoio Pedagógico deve aparecer somente nestas seções: INTRODUÇÃO, Tópico 1, Subtópico 1.1, Subtópico 1.2, Subtópico 1.3, Tópico 2, Subtópico 2.1, Subtópico 2.2, Subtópico 2.3, Tópico 3, Subtópico 3.1, Subtópico 3.2, Subtópico 3.3 e CONCLUSÃO.

Não coloque Apoio Pedagógico em EU ENSINEI QUE.

O Apoio Pedagógico deve ser texto corrido, de aproximadamente 10 a 12 linhas. Deve ter tom didático, natural, pastoral e humano. Não comece com comandos ao professor como Ensine que, Explique ao aluno, Mostre para a classe, Conduza a turma ou Trabalhe o assunto. Comece direto com a explicação do conteúdo, como uma conversa entre irmãos na fé. Faça conexões entre o texto bíblico e a vida prática do adulto cristão. Inclua exemplos do dia a dia: família, trabalho, igreja, relacionamentos, decisões, oração e serviço cristão. Evite linguagem acadêmica ou formal demais. Evite clichês como é fundamental entender, vale destacar e nesse sentido. O texto deve soar como uma explicação natural de um professor experiente compartilhando percepções úteis. Feche com uma frase que amarre o ensino da seção.

10. REGRAS PARA APLICAÇÃO PRÁTICA

A Aplicação Prática deve aparecer somente nas mesmas seções do Apoio Pedagógico. Não coloque Aplicação Prática em EU ENSINEI QUE. A Aplicação Prática deve ser curta, de 3 a 5 linhas. Deve começar obrigatoriamente com: Durante a semana,... Deve oferecer UMA ação concreta, específica e observável. A ação deve estar diretamente ligada ao ensino da seção. Use frases diretas, como faça, ore, evite, procure, escolha, anote, converse, avalie e organize. Evite clichês genéricos como busque a Deus, leia a Bíblia e ore mais. Se mencionar oração ou leitura bíblica, seja específico: diga sobre o que orar, qual atitude tomar ou como aplicar. A aplicação deve ser realista e possível para um adulto comum.

11. REGRAS PARA EU ENSINEI QUE

Copie exatamente as frases originais da revista. Não elabore novo conteúdo. Não coloque Apoio Pedagógico. Não coloque Aplicação Prática. Se a mesma frase aparecer mais de uma vez no material original, mantenha as ocorrências conforme aparecem.

12. REGRAS PARA CONCLUSÃO

A Conclusão deve manter o título CONCLUSÃO. O conteúdo deve ser elaborado com palavras próprias, comentando o conteúdo original. Deve começar obrigatoriamente com: Na conclusão, a lição reforça que... Deve ter de 3 a 5 parágrafos. Deve fechar o ensino da lição de forma bíblica, pastoral, madura e prática. Depois da Conclusão, incluir APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA.

13. VISUAL DO HTML

Use HTML completo com CSS interno. O visual deve ser limpo, simples e legível. Use fonte Times New Roman. Use fundo claro e container branco. Não use caixas decorativas. Não use bordas coloridas. Não use linhas de separação. Não use bullets, traços, asteriscos ou marcadores. Não use listas com símbolos. Título e conteúdo devem ficar na mesma linha sempre que possível.

14. CORES

Use preto #000000 para todos os títulos, conteúdo original, introdução, tópicos, subtópicos, Eu ensinei que, conclusão e versículos. Use azul #0000FF e itálico para Análise Geral, Apoio Pedagógico e Aplicação Prática.

15. FORMATAÇÃO

Títulos e subtítulos devem estar em negrito. Análise Geral, Apoio Pedagógico e Aplicação Prática devem estar em itálico. O restante do texto deve estar normal.

16. CLASSES HTML OBRIGATÓRIAS

Use estas classes no HTML: licao-container, preto, azul, negrito, italico, titulo-com-conteudo, apoio-aplicacao, primeiro, analise-geral-texto.

17. CSS BASE OBRIGATÓRIO

body { font-family: "Times New Roman", Times, serif; background-color: #fafafa; color: #000000; max-width: 1000px; margin: 0 auto; padding: 30px 20px; line-height: 1.6; }
.licao-container { background-color: #ffffff; padding: 30px 35px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
.preto { color: #000000; }
.azul { color: #0000FF; }
.negrito { font-weight: bold; }
.italico { font-style: italic; }
h1, h2, h3, h4 { margin: 0; padding: 0; font-weight: bold; color: #000000; display: inline; }
h1 { font-size: 1.8rem; }
h2 { font-size: 1.4rem; }
h3 { font-size: 1.2rem; }
p { margin: 0.45rem 0; color: #000000; }
.titulo-com-conteudo { display: block; margin-bottom: 0.75rem; }
.titulo-com-conteudo h1, .titulo-com-conteudo h2, .titulo-com-conteudo h3, .titulo-com-conteudo h4 { display: inline; }
.titulo-com-conteudo p.primeiro { display: inline; }
.apoio-aplicacao { margin-top: 0.45rem; margin-bottom: 0.45rem; }
.apoio-aplicacao p, .analise-geral-texto { color: #0000FF; font-style: italic; }

18. REGRAS FINAIS

Não escreva nada fora do HTML. Não use markdown. Não use explicações. Não use comentários visíveis. Não use o modelo antigo de Adultos com lesson-container, pedagogical-block, application-block, foco-block, outline-block, weekly-reading, footer-print ou print-btn. Não use o modelo de Jovens com article class="licao-betel jovens". Use somente o modelo limpo aprovado com licao-container, titulo-com-conteudo e apoio-aplicacao.

O resultado deve parecer uma lição pronta para professor, com linguagem humana, pastoral, bíblica, madura e útil para aula de adultos.`;

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
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Você gera HTML completo para lições de Escola Bíblica Dominical. Responda somente com HTML válido, sem markdown e sem explicações."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: Number(process.env.OPENAI_TEMPERATURE || 0.35),
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS || 12000)
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error?.message || `Erro OpenAI HTTP ${response.status}`);
  }

  return data?.choices?.[0]?.message?.content || "";
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

    // Chamar a API da DeepSeek
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: pergunta
          }
        ],
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 0.95,
        frequency_penalty: 0.3,
        presence_penalty: 0.3
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erro na API DeepSeek:", response.status, errorText);
      
      // Se a API retornar erro, retornar uma mensagem amigável
      return res.status(200).json({ 
        resposta: "Desculpe, não consegui processar sua pergunta agora. Por favor, tente novamente em alguns instantes. 📖" 
      });
    }

    const data = await response.json();
    const resposta = data.choices?.[0]?.message?.content || "Desculpe, não consegui gerar uma resposta no momento. Tente reformular sua pergunta.";

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
  res.json({ ok: true, status: "online", timestamp: new Date().toISOString() });
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
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `Erro OpenAI HTTP ${response.status}`);
  }

  return {
    content: data?.choices?.[0]?.message?.content || "",
    finish_reason: data?.choices?.[0]?.finish_reason || "unknown",
    usage: data?.usage || null
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

const EBD_JOVENS_PROMPT_APOIO_DOCENTE_V1 = `PROMPT DEFINITIVO — GERAR LIÇÃO JOVENS EBD FIEL — MOLDE ADULTOS ADAPTADO

Você é um professor experiente da Classe de Jovens da Escola Bíblica Dominical.

Com base no conteúdo original da revista enviado pelo administrador, gere uma lição bíblica completa em HTML, seguindo rigorosamente todas as regras abaixo.

Gere APENAS o HTML final, começando em <!DOCTYPE html> e terminando em </html>. Não escreva explicações antes nem depois do HTML. Não use markdown. Não use blocos de código.

OBJETIVO DESTA ROTA

A Classe Jovens deve usar o MOLDE VISUAL E ESTRUTURAL da Classe Adultos, porém adaptado aos rótulos, campos e linguagem próprios da revista Jovens.

Não transforme Jovens em Adultos. Use a moldura visual e a organização didática de Adultos, mas preserve a identidade Jovens.

1. PARTES QUE DEVEM SER COPIADAS EXATAMENTE DA REVISTA

As partes abaixo devem ser copiadas exatamente como aparecem no texto-base da revista, sem reescrever, sem resumir, sem corrigir pontuação, sem alterar referências bíblicas e sem trocar rótulos:

LIÇÃO X: TÍTULO
Texto de Referência:
Versículo do Dia:
Verdade Aplicada:
Objetivos da Lição:
Momento de Oração:

Regras obrigatórias para esses campos:
- O título deve manter o número e o título completo da revista.
- Use o rótulo Texto de Referência, não use Textos de Referência.
- Use o rótulo Versículo do Dia, não use Texto Áureo.
- Use o rótulo Momento de Oração, não use Motivo de Oração.
- Preserve exatamente os objetivos, inclusive quebras, ponto e vírgula, referências e frases.
- Se o texto-base trouxer Leituras Diárias, não inclua essa seção no resultado final.

2. SEQUÊNCIA OFICIAL DA LIÇÃO JOVENS

A resposta final deve seguir exatamente esta sequência:

LIÇÃO X: TÍTULO
Texto de Referência:
Versículo do Dia:
Verdade Aplicada:
Objetivos da Lição:
Momento de Oração:

ANÁLISE GERAL
INTRODUÇÃO
APLICAÇÃO PRÁTICA

1. TÓPICO PRINCIPAL
1.1. Subtópico
1.2. Subtópico

2. TÓPICO PRINCIPAL
2.1. Subtópico
2.2. Subtópico

3. TÓPICO PRINCIPAL
3.1. Subtópico
3.2. Subtópico

SUBSÍDIO PARA O EDUCADOR
CONCLUSÃO
EU ENSINEI QUE
APLICAÇÃO PRÁTICA FINAL

Não inclua PONTO-CHAVE, REFLETINDO, COMPLEMENTANDO ou LEITURAS DIÁRIAS no resultado final, mesmo que apareçam no texto-base.

3. PARTES QUE DEVEM VIR COMO APOIO AO PROFESSOR

Todas as partes após os campos fixos devem ser desenvolvidas como apoio ao professor, no mesmo espírito da lição Adultos aprovada:

ANÁLISE GERAL
INTRODUÇÃO
APLICAÇÃO PRÁTICA
TÓPICOS PRINCIPAIS
SUBTÓPICOS
SUBSÍDIO PARA O EDUCADOR
CONCLUSÃO
EU ENSINEI QUE
APLICAÇÃO PRÁTICA FINAL

Essas partes não devem ser mera cópia nem simples resumo da revista. Use o texto-base como referência de conteúdo, mas desenvolva explicações novas, claras, bíblicas, pastorais e didáticas para ajudar o professor a ministrar a aula.

4. REGRAS PARA ANÁLISE GERAL

A ANÁLISE GERAL deve apresentar a ideia central da lição, a importância bíblica do tema, a conexão com a vida espiritual dos jovens e a direção pedagógica que a aula deve seguir, sem usar frases como “o professor deve” ou “o professor pode”. Escreva como material pronto de apoio.

5. REGRAS PARA INTRODUÇÃO

A INTRODUÇÃO deve desenvolver o tema da revista com linguagem clara e aplicável. Ela deve preparar a aula, contextualizar o assunto bíblico e conectar o conteúdo à realidade dos jovens: escola, faculdade, trabalho, amizades, redes sociais, família, igreja, escolhas, testemunho cristão, dons, talentos e serviço no Reino de Deus.

Não copie parágrafos longos da introdução original. Reescreva como apoio pedagógico pronto.

6. REGRAS PARA APLICAÇÃO PRÁTICA APÓS A INTRODUÇÃO

Logo após a INTRODUÇÃO, inclua uma seção chamada APLICAÇÃO PRÁTICA.

Ela deve começar obrigatoriamente com: Durante a semana,

A aplicação deve ser concreta, jovem e observável. Ela deve indicar uma atitude real que o aluno possa praticar na semana.

Evite frases genéricas como “ore mais”, “leia mais” ou “busque a Deus”. Se mencionar oração ou leitura bíblica, diga exatamente por qual motivo orar, qual texto ler, que atitude tomar ou qual conversa realizar.

7. REGRAS PARA TÓPICOS PRINCIPAIS

Mantenha exatamente os títulos dos tópicos principais da revista:
- 1. Título do tópico
- 2. Título do tópico
- 3. Título do tópico

Desenvolva cada tópico como apoio ao professor, explicando o assunto, ampliando o ensino bíblico e aplicando à realidade dos jovens. Preserve as referências bíblicas presentes no conteúdo original sempre que forem importantes.

Não escreva “o professor deve”, “o professor pode”, “cabe ao professor” ou expressões semelhantes. O texto deve sair como conteúdo final de apoio pedagógico.

8. REGRAS PARA SUBTÓPICOS

Mantenha exatamente os títulos dos subtópicos da revista:
- 1.1. Título do subtópico
- 1.2. Título do subtópico
- 2.1. Título do subtópico
- 2.2. Título do subtópico
- 3.1. Título do subtópico
- 3.2. Título do subtópico

Desenvolva cada subtópico com explicação própria, clara, bíblica e aplicável. Jovens normalmente têm dois subtópicos por tópico. Não invente 1.3, 2.3 ou 3.3 se o texto-base não trouxer esses subtópicos.

9. REGRAS PARA SUBSÍDIO PARA O EDUCADOR

O SUBSÍDIO PARA O EDUCADOR deve preservar a ideia central do subsídio original, mas ser apresentado como apoio didático claro para a aula. Se houver citação bibliográfica, mantenha a referência ao final, mas o desenvolvimento explicativo deve ser autoral e organizado.

10. REGRAS PARA CONCLUSÃO

A CONCLUSÃO deve retomar o tema principal, reforçar o ensino bíblico e conduzir os jovens a uma resposta prática de fé, obediência, adoração, serviço e compromisso com Deus.

11. REGRAS PARA EU ENSINEI QUE

EU ENSINEI QUE deve sintetizar a lição em uma frase clara, fiel ao conteúdo da revista, com linguagem de fechamento didático.

Não copie automaticamente a Verdade Aplicada, a menos que essa seja a melhor síntese. Gere uma frase final coerente com o tema.

12. REGRAS PARA APLICAÇÃO PRÁTICA FINAL

A APLICAÇÃO PRÁTICA FINAL deve vir no fim da lição.

Ela deve começar obrigatoriamente com: Durante a semana,

Ela deve apresentar uma ação concreta, jovem, observável e conectada à lição. Pode envolver uma conversa, uma decisão, uma atitude nas redes sociais, um pedido de perdão, uma postura na família, escola, faculdade, trabalho ou igreja.

13. REGRAS DE LINGUAGEM

Use linguagem bíblica, pastoral, didática e aplicável à juventude.

É proibido escrever:
- o professor deve
- o professor pode
- cabe ao professor
- o educador deve
- o educador pode
- como professores, devemos

Em vez disso, escreva diretamente o conteúdo de apoio, como ocorre no material Adultos.

14. VISUAL HTML OBRIGATÓRIO — MOLDE ADULTOS

Use HTML completo com CSS interno, visual limpo, impresso e responsivo, semelhante ao modelo Adultos aprovado.

A estrutura principal deve usar o padrão visual de Adultos:
- licao-container
- titulo-com-conteudo
- apoio-aplicacao
- preto
- azul
- negrito
- italico
- primeiro
- analise-geral-texto

O visual deve ter:
- cabeçalho com identidade Classe Jovens;
- título grande da lição;
- campos iniciais em destaque;
- títulos pretos fortes;
- textos de apoio em azul, quando funcionarem como orientação/aplicação;
- rodapé EBD Fiel;
- botão discreto de Imprimir / Salvar PDF oculto na impressão.

Não use o visual verde antigo da Classe Jovens. Não use article class="licao-betel jovens" neste hotfix. Use o molde visual de Adultos adaptado à Classe Jovens.

15. MODELO DE ORGANIZAÇÃO HTML

A organização mínima deve seguir este formato conceitual:

<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lição X: Título</title>
  <style>CSS interno completo no padrão Adultos adaptado a Jovens</style>
</head>
<body>
  <div class="licao-container jovens">
    <header>
      <div>Classe Jovens — Apoio Pedagógico</div>
      <h1>LIÇÃO X: TÍTULO</h1>
    </header>

    <section class="dados-licao">
      <p><span class="negrito">Texto de Referência:</span> texto original</p>
      <p><span class="negrito">Versículo do Dia:</span> texto original</p>
      <p><span class="negrito">Verdade Aplicada:</span> texto original</p>
      <p><span class="negrito">Objetivos da Lição:</span> texto original</p>
      <p><span class="negrito">Momento de Oração:</span> texto original</p>
    </section>

    <section class="titulo-com-conteudo"><h2>ANÁLISE GERAL:</h2><p class="azul italico analise-geral-texto">apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h2>INTRODUÇÃO:</h2><p>apoio autoral</p></section>
    <section class="apoio-aplicacao"><p class="azul negrito">APLICAÇÃO PRÁTICA: Durante a semana, ação concreta.</p></section>

    <section class="titulo-com-conteudo"><h2>1. TÓPICO:</h2><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h3>1.1. Subtópico:</h3><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h3>1.2. Subtópico:</h3><p>apoio autoral</p></section>

    <section class="titulo-com-conteudo"><h2>2. TÓPICO:</h2><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h3>2.1. Subtópico:</h3><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h3>2.2. Subtópico:</h3><p>apoio autoral</p></section>

    <section class="titulo-com-conteudo"><h2>3. TÓPICO:</h2><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h3>3.1. Subtópico:</h3><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h3>3.2. Subtópico:</h3><p>apoio autoral</p></section>

    <section class="titulo-com-conteudo"><h2>SUBSÍDIO PARA O EDUCADOR:</h2><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h2>CONCLUSÃO:</h2><p>apoio autoral</p></section>
    <section class="titulo-com-conteudo"><h2>EU ENSINEI QUE:</h2><p>síntese autoral</p></section>
    <section class="apoio-aplicacao"><p class="azul negrito">APLICAÇÃO PRÁTICA FINAL: Durante a semana, ação concreta.</p></section>

    <button class="print-btn" onclick="window.print()">Imprimir / Salvar PDF</button>
    <footer>EBD Fiel — https://ebdfiel.com.br</footer>
  </div>
</body>
</html>

16. REGRAS FINAIS

Não escreva nada fora do HTML. Não use markdown. Não explique. Não gere apenas resumo. Não copie longos parágrafos da revista nas partes de apoio. Preserve os campos fixos exatamente e desenvolva o restante como apoio pedagógico pronto para a Classe Jovens, no molde visual da Classe Adultos.`;

function approvedYouthSystemMessageV1() {
  return `Você gera HTML completo para lições da Classe Jovens da Escola Bíblica Dominical. Responda somente com HTML puro. Não use markdown. Não use blocos de código. O HTML deve começar com <!DOCTYPE html> e terminar com </html>. Use o molde visual aprovado de Adultos, com classes licao-container, titulo-com-conteudo, apoio-aplicacao, preto, azul, negrito, italico, primeiro e analise-geral-texto. Adapte os rótulos para Jovens: Texto de Referência, Versículo do Dia, Verdade Aplicada, Objetivos da Lição e Momento de Oração. Nunca use Texto Áureo, Textos de Referência, Motivo de Oração, Leituras Diárias, Ponto-Chave, Refletindo ou Complementando no resultado final. Os campos iniciais da revista devem ser preservados exatamente; as demais seções devem ser apoio pedagógico autoral ao professor, sem frases como “o professor deve” ou “o professor pode”.`;
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
    ["APLICACAO PRATICA FINAL", "aplicacao_pratica_final"]
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
  if (!/DURANTE\s+A\s+SEMANA/i.test(text)) missing.push("aplicacao_durante_a_semana");
  if (/lesson-container|pedagogical-block|application-block|weekly-reading|licao-betel/i.test(raw)) {
    missing.push("remover_visual_jovens_antigo_e_usar_molde_adultos");
  }

  return missing;
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

    const configuredMax = Number(process.env.OPENAI_MAX_TOKENS || 14000);
    const maxTokens = Math.min(Math.max(configuredMax, 10000), 16000);

    const prompt = `${EBD_JOVENS_PROMPT_APOIO_DOCENTE_V1}

IMPORTANTE FINAL — CLASSE JOVENS NO MOLDE ADULTOS:
- Preserve exatamente, sem reescrever, estes campos do texto-base: LIÇÃO X: TÍTULO, Texto de Referência, Versículo do Dia, Verdade Aplicada, Objetivos da Lição e Momento de Oração.
- Use o visual e a estrutura da lição Adultos aprovada, com licao-container, titulo-com-conteudo, apoio-aplicacao, preto, azul, negrito, italico, primeiro e analise-geral-texto.
- Não use Texto Áureo, Textos de Referência, Motivo de Oração, Leituras Diárias, Ponto-Chave, Refletindo ou Complementando no resultado final.
- Depois dos campos fixos, gere nesta ordem: ANÁLISE GERAL, INTRODUÇÃO, APLICAÇÃO PRÁTICA, tópicos e subtópicos da revista, SUBSÍDIO PARA O EDUCADOR, CONCLUSÃO, EU ENSINEI QUE e APLICAÇÃO PRÁTICA FINAL.
- As seções após os campos fixos devem ser apoio pedagógico ao professor, como no modelo Adultos, mas sem escrever “o professor deve”, “o professor pode” ou expressões semelhantes.
- Aplique o ensino à vida real dos jovens: escola, faculdade, trabalho, amizades, redes sociais, família, igreja, escolhas, testemunho cristão, dons, talentos e serviço no Reino de Deus.
- A APLICAÇÃO PRÁTICA e a APLICAÇÃO PRÁTICA FINAL devem começar com "Durante a semana," e indicar atitudes concretas, jovens e observáveis.
- Responda somente com o HTML completo.

DADOS INFORMADOS NO PAINEL:
Número da lição: ${numero || "[não informado]"}
Título/tema: ${titulo || "[não informado]"}
Trimestre: ${trimestre || "[não informado]"}
Data: ${data || "[não informada]"}

CONTEÚDO ORIGINAL DA REVISTA JOVENS:
${conteudoBase}

Gere agora a lição completa da Classe Jovens no padrão aprovado. Responda somente com o HTML completo.`;

    const first = await callOpenAiChatDetailedV2({
      model: OPENAI_MODEL,
      apiKey: OPENAI_API_KEY,
      maxTokens,
      temperature: 0.22,
      messages: [
        { role: "system", content: approvedYouthSystemMessageV1() },
        { role: "user", content: prompt }
      ]
    });

    let html = sanitizeApprovedYouthHtmlV1(first.content);

    if (!html) {
      return res.status(502).json({
        ok: false,
        error: "A OpenAI não retornou HTML.",
        finish_reason: first.finish_reason,
        usage: first.usage
      });
    }

    const missing = listMissingApprovedYouthItemsV1(html);
    const approved = missing.length === 0;

    console.log("GPT Jovens geração finalizada:", {
      approved,
      missing,
      finish_reason: first.finish_reason,
      usage: first.usage
    });

    return res.json({
      ok: true,
      source: approved ? "openai_gpt_jovens_molde_adultos_aprovado" : "openai_gpt_jovens_molde_adultos_revisao",
      warning: approved ? "" : `GPT retornou HTML de Jovens para revisão. Itens do padrão que precisam conferir: ${missing.join(", ")}`,
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
      publico: "jovens",
      tipo: "youth",
      html,
      conteudoHtml: html,
      conteudo: html,
      content: html,
      adminPayload: {
        numero,
        titulo: titulo || "Lição Jovens",
        publico: "jovens",
        tipo: "youth",
        trimestre,
        data,
        conteudo: html,
        conteudoHtml: html,
        html,
        approved,
        missing,
        updatedAt: new Date().toISOString(),
        source: approved ? "openai_gpt_jovens_molde_adultos_aprovado" : "openai_gpt_jovens_molde_adultos_revisao"
      }
    });
  } catch (error) {
    console.error("Erro na rota /api/gpt/gerar-licao-jovens:", error);
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

const EBD_ADOLESCENTES_PROMPT_APOIO_DOCENTE_V1 = `PROMPT DEFINITIVO — GERAR LIÇÃO ADOLESCENTES EBD FIEL

Você é um professor experiente da Classe de Adolescentes da Escola Bíblica Dominical, com foco em alunos de 15 a 17 anos.

Com base no conteúdo original da revista enviado pelo administrador, gere uma lição bíblica completa em HTML, seguindo rigorosamente todas as regras abaixo.

Gere APENAS o HTML final, começando em <!DOCTYPE html> e terminando em </html>. Não escreva explicações antes nem depois do HTML. Não use markdown. Não use blocos de código.

1. IDENTIDADE DA CLASSE ADOLESCENTES

A Classe Adolescentes deve ter linguagem própria para 15 a 17 anos. Não use o modelo Adultos e não use o modelo Jovens como cópia. O material deve ajudar o professor a ensinar adolescentes com clareza, firmeza bíblica e aplicação prática.

A linguagem deve dialogar com identidade, decisões, família, escola, amizades, redes sociais, tentações, testemunho cristão, dúvidas, emoções, obediência, serviço na igreja e amadurecimento espiritual.

2. PRESERVAÇÃO DO MATERIAL ORIGINAL

Preserve fielmente os dados objetivos da revista, quando aparecerem no conteúdo-base:
- número da lição;
- título;
- texto de referência;
- versículo do dia ou texto áureo, conforme o rótulo original;
- verdade aplicada;
- objetivos;
- momento/motivo de oração;
- leituras diárias;
- ponto-chave;
- refletindo;
- eu ensinei que;
- referências bíblicas;
- títulos dos tópicos e subtópicos.

Quando uma seção fixa da revista aparecer, copie seu conteúdo essencial sem trocar o sentido. Nas partes desenvolvidas, escreva com palavras próprias, sem copiar parágrafos longos.

3. MATERIAL DE APOIO AO PROFESSOR

As seções explicativas devem ser transformadas em material de apoio pedagógico, não em resumo. O texto deve orientar o professor a explicar melhor a lição, com exemplos concretos para adolescentes.

Desenvolva:
- introdução;
- tópicos principais;
- subtópicos;
- subsídio/orientação ao professor, quando houver;
- conclusão;
- complementando, quando houver;
- aplicação prática.

4. APLICAÇÃO PRÁTICA

A aplicação prática deve ser concreta, observável e adequada a adolescentes de 15 a 17 anos. Sempre que possível, comece com: Durante a semana,

A ação deve envolver uma atitude real, como uma conversa com os pais, uma decisão na escola, uma postura nas redes sociais, pedido de perdão, escolha de amizade, testemunho cristão, serviço na igreja ou rejeição de uma tentação.

Evite aplicações genéricas como “ore mais”, “leia mais” ou “reflita”. Se mencionar oração ou leitura bíblica, indique objetivo, texto, atitude e situação concreta.

5. VISUAL HTML OBRIGATÓRIO

Use HTML completo com CSS interno, visual bonito, limpo e responsivo para a página da Classe Adolescentes.

A estrutura principal deve usar:
<article class="licao-betel adolescentes">

Use classes semânticas como:
- licao-betel
- adolescentes
- licao-header
- licao-chip
- bloco
- meta
- introducao
- topico
- subtopico
- refletindo
- subsidio
- complementando
- eu-ensinei
- apoio-pedagogico
- aplicacao-pratica
- leitura-semanal
- leitura-item
- ponto-chave

Inclua um botão “Imprimir / Salvar PDF” com onclick="window.print()" e oculte-o em @media print.

6. FORMATO MÍNIMO

<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lição X: Título</title>
  <style>CSS interno completo</style>
</head>
<body>
<article class="licao-betel adolescentes">
  <header class="licao-header">
    <span class="licao-chip">EBD Adolescentes</span>
    <h1>Lição X: Título</h1>
  </header>
  <section class="bloco meta">metadados bíblicos da revista</section>
  <section class="bloco introducao">introdução de apoio docente</section>
  <section class="bloco topico">tópicos e subtópicos</section>
  <section class="bloco conclusao">conclusão</section>
  <section class="bloco aplicacao-pratica">aplicação prática concreta</section>
  <div class="print-actions"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></div>
</article>
</body>
</html>

7. REGRAS FINAIS

Não escreva nada fora do HTML. Não use markdown. Não use o modelo Adultos. Não use article class="licao-betel jovens". Não gere apenas resumo. Preserve fidelidade bíblica, clareza, aplicação e direção pedagógica para adolescentes.`;

const EBD_PREADOLESCENTES_PROMPT_APOIO_DOCENTE_V1 = `PROMPT DEFINITIVO — GERAR LIÇÃO PRÉ-ADOLESCENTES EBD FIEL

Você é um professor experiente da Classe de Pré-adolescentes da Escola Bíblica Dominical, com foco em alunos de 12 a 14 anos.

Com base no conteúdo original da revista enviado pelo administrador, gere uma lição bíblica completa em HTML, seguindo rigorosamente todas as regras abaixo.

Gere APENAS o HTML final, começando em <!DOCTYPE html> e terminando em </html>. Não escreva explicações antes nem depois do HTML. Não use markdown. Não use blocos de código.

1. IDENTIDADE DA CLASSE PRÉ-ADOLESCENTES

A Classe Pré-adolescentes precisa de linguagem simples, clara, acolhedora, objetiva e didática. O material deve ajudar o professor a ensinar alunos de 12 a 14 anos, com exemplos próximos da realidade deles.

A linguagem deve dialogar com família, escola, amizades, obediência, emoções, internet, jogos, redes sociais, respeito aos pais, participação na igreja, escolhas simples do dia a dia e crescimento na fé.

2. PRESERVAÇÃO DO MATERIAL ORIGINAL

Preserve fielmente os dados objetivos da revista, quando aparecerem no conteúdo-base:
- número da lição;
- título;
- texto de referência;
- versículo do dia ou texto áureo, conforme o rótulo original;
- verdade aplicada;
- objetivos;
- momento/motivo de oração;
- leituras diárias;
- ponto-chave;
- refletindo;
- eu ensinei que;
- referências bíblicas;
- títulos dos tópicos e subtópicos.

Quando uma seção fixa da revista aparecer, copie seu conteúdo essencial sem trocar o sentido. Nas partes desenvolvidas, escreva com palavras próprias, sem copiar parágrafos longos.

3. MATERIAL DE APOIO AO PROFESSOR

As seções explicativas devem ser transformadas em material de apoio pedagógico, não em resumo. O texto deve orientar o professor a explicar melhor a lição com exemplos simples, perguntas de fixação e aplicações que um pré-adolescente consiga entender.

Desenvolva:
- introdução;
- tópicos principais;
- subtópicos;
- subsídio/orientação ao professor, quando houver;
- conclusão;
- complementando, quando houver;
- aplicação prática.

4. APLICAÇÃO PRÁTICA

A aplicação prática deve ser concreta, simples e observável. Sempre que possível, comece com: Durante a semana,

A ação deve ser algo que o pré-adolescente consiga fazer: obedecer aos pais, pedir perdão, ajudar em casa, tratar colegas com respeito, evitar uma conversa errada, usar melhor o celular, participar da igreja, memorizar um versículo ou orar por uma situação específica.

Evite aplicações genéricas como “ore mais”, “leia mais” ou “reflita”. Se mencionar oração ou leitura bíblica, indique o texto, o objetivo e a atitude concreta.

5. VISUAL HTML OBRIGATÓRIO

Use HTML completo com CSS interno, visual bonito, limpo e responsivo para a página da Classe Pré-adolescentes.

A estrutura principal deve usar:
<article class="licao-betel pre-adolescentes">

Use classes semânticas como:
- licao-betel
- pre-adolescentes
- licao-header
- licao-chip
- bloco
- meta
- introducao
- topico
- subtopico
- refletindo
- subsidio
- complementando
- eu-ensinei
- apoio-pedagogico
- aplicacao-pratica
- leitura-semanal
- leitura-item
- ponto-chave

Inclua um botão “Imprimir / Salvar PDF” com onclick="window.print()" e oculte-o em @media print.

6. FORMATO MÍNIMO

<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lição X: Título</title>
  <style>CSS interno completo</style>
</head>
<body>
<article class="licao-betel pre-adolescentes">
  <header class="licao-header">
    <span class="licao-chip">EBD Pré-adolescentes</span>
    <h1>Lição X: Título</h1>
  </header>
  <section class="bloco meta">metadados bíblicos da revista</section>
  <section class="bloco introducao">introdução de apoio docente</section>
  <section class="bloco topico">tópicos e subtópicos</section>
  <section class="bloco conclusao">conclusão</section>
  <section class="bloco aplicacao-pratica">aplicação prática concreta</section>
  <div class="print-actions"><button type="button" onclick="window.print()">Imprimir / Salvar PDF</button></div>
</article>
</body>
</html>

7. REGRAS FINAIS

Não escreva nada fora do HTML. Não use markdown. Não use o modelo Adultos. Não use article class="licao-betel jovens". Não gere apenas resumo. Preserve fidelidade bíblica, clareza, aplicação e direção pedagógica para pré-adolescentes.`;

function approvedAgeGroupSystemMessageV1({ label, articleClass, idade }) {
  return `Você gera HTML completo para lições da ${label} da Escola Bíblica Dominical, faixa etária ${idade}. Responda somente com HTML puro. Não use markdown. Não use blocos de código. O HTML deve começar com <!DOCTYPE html> e terminar com </html>. Use obrigatoriamente <article class="licao-betel ${articleClass}">. Nunca use o modelo Adultos e nunca use article class="licao-betel jovens". O material deve ser apoio pedagógico ao professor, com aplicação prática concreta para a faixa etária.`;
}

function sanitizeApprovedAgeGroupHtmlV1(html = "", articleClass = "") {
  let out = extractHtmlOnlyV2(html || "");
  if (!out && html) out = String(html || "").trim();

  out = out
    .replace(/article\s+class=["']([^"']*\blicao-betel\b[^"']*)\bjovens\b([^"']*)["']/gi, `article class="$1${articleClass}$2"`)
    .replace(/TEXTO\s+AUREO/gi, "TEXTO ÁUREO")
    .replace(/MOTIVO\s+DE\s+ORACAO/gi, "MOTIVO DE ORAÇÃO")
    .replace(/APLICACAO\s+PRATICA/gi, "APLICAÇÃO PRÁTICA");

  if (/<article\s+class=["'][^"']*licao-betel/i.test(out) && !new RegExp(`<article\\s+class=["'][^"']*${articleClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(out)) {
    out = out.replace(/<article\s+class=["']([^"']*licao-betel[^"']*)["']/i, `<article class="$1 ${articleClass}"`);
  }

  return out.trim();
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

  [
    ["LICAO", "licao"],
    ["INTRODUCAO", "introducao"],
    ["CONCLUSAO", "conclusao"],
    ["APLICACAO PRATICA", "aplicacao_pratica"]
  ].forEach(([needle, key]) => {
    if (!text.includes(needle)) missing.push(key);
  });

  if (/lesson-container|licao-container|pedagogical-block|application-block|titulo-com-conteudo|apoio-aplicacao|article\s+class=["'][^"']*jovens/i.test(raw)) {
    missing.push("remove_modelo_indevido");
  }

  return missing;
}

async function gerarLicaoFaixaEtariaGptV1(req, res, config) {
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

    if (!html) {
      return res.status(502).json({
        ok: false,
        error: "A OpenAI não retornou HTML.",
        finish_reason: first.finish_reason,
        usage: first.usage
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
    sourceApproved: "openai_gpt_adolescentes_apoio_docente_aprovado",
    sourceReview: "openai_gpt_adolescentes_revisao_rapida",
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
    realidades: "família, escola, amizades, obediência, emoções, internet, jogos, redes sociais, respeito aos pais e participação na igreja",
    promptBase: EBD_PREADOLESCENTES_PROMPT_APOIO_DOCENTE_V1,
    sourceApproved: "openai_gpt_preadolescentes_apoio_docente_aprovado",
    sourceReview: "openai_gpt_preadolescentes_revisao_rapida",
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

    if (!html) {
      return res.status(502).json({
        ok: false,
        error: "A OpenAI não retornou HTML.",
        finish_reason: first.finish_reason,
        usage: first.usage
      });
    }

    const missing = listMissingApprovedAdultItemsV2(html);
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
});
