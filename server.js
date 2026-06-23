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
    && /APOIO PEDAGÓGICO:/i.test(text)
    && /APLICAÇÃO PRÁTICA:/i.test(text)
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
   ROTA GPT / OPENAI — GERAR LIÇÃO ADULTOS NO PADRÃO APROVADO
========================================================= */

app.post("/api/gpt/gerar-licao", async (req, res) => {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        error: "OPENAI_API_KEY não configurada no Render."
      });
    }

    const body = req.body || {};
    const conteudoBase = body.conteudoBase || body.textoBase || body.conteudo || body.texto || "";
    const numero = body.numero || "";
    const titulo = body.titulo || body.tema || "";
    const trimestre = body.trimestre || "";
    const data = body.data || "";

    if (!String(conteudoBase || "").trim()) {
      return res.status(400).json({
        ok: false,
        error: "conteudoBase é obrigatório."
      });
    }

    const prompt = `${EBD_ADULTOS_PROMPT_APROVADO}

DADOS INFORMADOS NO PAINEL:
Número da lição: ${numero || "[não informado]"}
Título/tema: ${titulo || "[não informado]"}
Trimestre: ${trimestre || "[não informado]"}
Data: ${data || "[não informada]"}

CONTEÚDO ORIGINAL DA REVISTA:
${conteudoBase}

Gere agora a lição completa no padrão aprovado. Responda somente com o HTML completo.`;

    let generated = await callOpenAiChat({
      model: OPENAI_MODEL,
      prompt,
      apiKey: OPENAI_API_KEY
    });

    const html = extractHtmlOnly(generated);

    if (!html) {
      return res.status(502).json({
        ok: false,
        error: "A OpenAI não retornou HTML."
      });
    }

    if (!isApprovedAdultHtml(html)) {
      return res.status(502).json({
        ok: false,
        error: "O GPT retornou HTML fora do padrão aprovado.",
        html,
        conteudoHtml: html,
        conteudo: html,
        source: "openai_gpt_fora_do_padrao"
      });
    }

    return res.json({
      ok: true,
      source: "openai_gpt_prompt_aprovado",
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
        updatedAt: new Date().toISOString(),
        source: "openai_gpt_prompt_aprovado"
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
  console.log(`🤖 Rota /api/gpt/gerar-licao para gerar lições com OpenAI/GPT`);
});
