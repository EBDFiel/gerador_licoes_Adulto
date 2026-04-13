const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

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
});
