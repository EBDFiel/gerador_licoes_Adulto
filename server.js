const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "8mb" }));

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
  return String(str || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(str = "") {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function titleCaseSmart(str = "") {
  const lowerWords = new Set([
    "de", "da", "do", "das", "dos", "e", "em", "na", "no", "nas", "nos",
    "a", "o", "as", "os", "para", "por", "com", "sem"
  ]);

  return String(str || "")
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (!word) return word;
      if (i > 0 && lowerWords.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .trim();
}

function firstNonEmptyLine(text = "") {
  return String(text || "")
    .split("\n")
    .map(s => s.trim())
    .find(Boolean) || "";
}

function removeLeadingLabel(line = "", label = "") {
  const re = new RegExp("^\\s*" + label + "\\s*[:：-]?\\s*", "i");
  return String(line || "").replace(re, "").trim();
}

function splitLines(text = "") {
  return String(text || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}

function dedupeParagraphs(paragraphs = []) {
  const seen = new Set();
  const out = [];

  for (const p of paragraphs) {
    const key = String(p || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

    if (!key) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(p.trim());
  }

  return out;
}

function safeMatch(text, regex) {
  const m = String(text || "").match(regex);
  return m ? m[1].trim() : "";
}

function findFirstIndex(text, patterns = []) {
  const normalized = String(text || "");
  let best = -1;

  for (const pattern of patterns) {
    const re = new RegExp(pattern, "i");
    const m = normalized.match(re);
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
  let end = -1;

  for (const p of endPatterns) {
    const re = new RegExp(p, "i");
    const m = after.match(re);
    if (m && m.index > 0) {
      if (end === -1 || m.index < end) end = m.index;
    }
  }

  return end >= 0 ? after.slice(0, end).trim() : after.trim();
}

function cleanPdfNoise(text = "") {
  let t = normSpaces(text);

  // remove cabeçalhos/rodapés de páginas e repetições comuns
  t = t
    .replace(/<PARSED TEXT FOR PAGE:[\s\S]*?>/gi, " ")
    .replace(/📘\s*ESCOLA BÍBLICA DOMINICAL\s*\|\s*CLASSE DE (ADULTOS|JOVENS)/gi, " ")
    .replace(/Trimestre\s+\d+/gi, " ")
    .replace(/Lição\s+\d+\s+—\s+.+?\|\s*Base bíblica:.+?(EBD Adultos|EBD Jovens)/gi, " ")
    .replace(/Quando acaba o culto, em pouco tempo, todos se retiram para suas casas\./gi, " ")
    .replace(/🎵\s*HINOS SUGERIDOS\s*\/\s*MOMENTO DE ORAÇÃO:\s*\[Conteúdo\]/gi, " ")
    .replace(/CONCLUSÃO:\s*\[Conteúdo da conclusão\]/gi, "CONCLUSÃO:")
    .replace(/\[Conteúdo da conclusão\]/gi, " ")
    .replace(/\[conteúdo da conclusão\]/gi, " ");

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

function extractNumeroETitulo(raw = "", numeroFromBody = "", tituloFromBody = "") {
  const firstLine = firstNonEmptyLine(raw);
  const match = firstLine.match(/Lição\s*(\d+)\s*[:\-—]\s*(.+)$/i);

  if (match) {
    return {
      numero: match[1].trim(),
      titulo: match[2].trim()
    };
  }

  const m2 = String(raw || "").match(/Lição\s*(\d+)\s*[:\-—]\s*(.+?)(?:\n|📖|✨|📌|🔍)/i);

  return {
    numero: numeroFromBody || (m2 ? m2[1].trim() : ""),
    titulo: tituloFromBody || (m2 ? m2[2].trim() : "Lição")
  };
}

function extractMeta(text = "") {
  return {
    textoAureo: safeMatch(text, /(?:📖\s*)?(?:TEXTO ÁUREO|VERSÍCULO DO DIA|TEXTO ÁUREO \/ VERSÍCULO DO DIA)\s*[:：]\s*([\s\S]*?)(?=\n(?:✨|📌|🔍|📘|🎯|🔑|💬|1\.|\bINTRODUÇÃO\b))/i),
    verdadeAplicada: safeMatch(text, /(?:✨\s*)?VERDADE APLICADA\s*[:：]\s*([\s\S]*?)(?=\n(?:📌|🔍|📘|🎯|🔑|💬|📖|1\.|\bINTRODUÇÃO\b))/i),
    textoReferencia: safeMatch(text, /(?:📌\s*)?(?:TEXTOS? DE REFER[ÊE]NCIA|TEXTO DE REFER[ÊE]NCIA)\s*[:：]\s*([\s\S]*?)(?=\n(?:🔍|📘|🎯|🔑|💬|📖|✨|1\.|\bINTRODUÇÃO\b))/i),
    pontoChave: safeMatch(text, /(?:🔑\s*)?PONTO-CHAVE\s*[:：]\s*([\s\S]*?)(?=\n(?:💬|📘|🎯|1\.|\bINTRODUÇÃO\b))/i),
    refletindo: safeMatch(text, /(?:💬\s*)?REFLETINDO\s*[:：]\s*([\s\S]*?)(?=\n(?:📘|🎯|1\.|\bINTRODUÇÃO\b))/i),
    analiseGeral: safeMatch(text, /(?:🔍\s*)?ANÁLISE GERAL DA LIÇÃO\s*([\s\S]*?)(?=\n(?:📌\s*INTRODUÇÃO|\bINTRODUÇÃO\b|🔑\s*Ponto-Chave|🔑\s*PONTO-CHAVE))/i)
  };
}

/* =========================================================
   CORTES FORTES PARA NÃO DUPLICAR NEM ENGOLIR BLOCOS
========================================================= */

function cutBeforeRepeatedRestart(text = "") {
  let t = String(text || "");

  const restarts = [
    /\bESBOÇO DA LIÇÃO\b/i,
    /\bINTRODUÇÃO\b[\s\S]{0,250}\bNesta lição, veremos\b/i,
    /\bEU ENSINEI QUE:\b[\s\S]{0,250}\b2\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/i,
    /\bO TEMPLO DO ESPÍRITO SANTO: VIVENDO COM SAÚDE E EM SANTIDADE \| Base bíblica:/i,
    /\bLição\s+\d+\s+—\s+.+?\|\s*Base bíblica:/i
  ];

  let cutAt = -1;

  for (const re of restarts) {
    const m = t.match(re);
    if (m && m.index >= 0) {
      if (cutAt === -1 || m.index < cutAt) cutAt = m.index;
    }
  }

  if (cutAt >= 0) t = t.slice(0, cutAt).trim();

  return t;
}

function cutAfterConclusao(text = "") {
  const src = String(text || "");
  const conclusaoMatch = src.match(/\bCONCLUSÃO\b\s*[:：]?\s*/i);
  if (!conclusaoMatch || conclusaoMatch.index == null) return src.trim();

  const start = conclusaoMatch.index;
  const after = src.slice(start);

  // achar o fim real da conclusão + blocos finais válidos
  const terminalPatterns = [
    /\n(?:🎵\s*HINOS SUGERIDOS(?:\s*\/\s*MOMENTO DE ORAÇÃO)?|🙏\s*MOTIVO DE ORAÇÃO)\b/i,
    /\n(?:📘\s*APOIO PEDAGÓGICO\s*\(CONCLUSÃO\))\b/i,
    /\n(?:🎯\s*APLICAÇÃO PRÁTICA\s*\(CONCLUSÃO\))\b/i
  ];

  let lastUsefulEnd = -1;

  // pega primeiro o fim da conclusão textual
  const possibleRestart = after.match(/\n(?:ESBOÇO DA LIÇÃO|INTRODUÇÃO\b|1\.\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ])/i);
  if (possibleRestart && possibleRestart.index > 0) {
    return src.slice(0, start + possibleRestart.index).trim();
  }

  // se houver blocos finais, deixa esses blocos, mas corta depois deles
  for (const re of terminalPatterns) {
    const m = after.match(re);
    if (m && m.index >= 0) {
      const next = after.slice(m.index + 1);
      const nextRestart = next.match(/\n(?:ESBOÇO DA LIÇÃO|INTRODUÇÃO\b|1\.\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]|Lição\s+\d+\s+—)/i);

      if (nextRestart && nextRestart.index > 0) {
        const endAbs = start + m.index + 1 + nextRestart.index;
        if (endAbs > lastUsefulEnd) lastUsefulEnd = endAbs;
      }
    }
  }

  if (lastUsefulEnd > 0) {
    return src.slice(0, lastUsefulEnd).trim();
  }

  return src.trim();
}

function prepareSource(raw = "") {
  let text = cleanPdfNoise(raw);
  text = cutBeforeRepeatedRestart(text);
  text = cutAfterConclusao(text);
  text = normSpaces(text);
  return text;
}

/* =========================================================
   EXTRAÇÃO DE BLOCOS PRINCIPAIS
========================================================= */

function extractIntroducao(text = "") {
  let intro = extractBetween(
    text,
    [
      "(?:📌\\s*)?INTRODUÇÃO\\s*[:：]?"
    ],
    [
      "\\n(?:🔑\\s*PONTO-CHAVE|🔑\\s*Ponto-Chave)",
      "\\n(?:💬\\s*REFLETINDO)",
      "\\n1\\.\\s+",
      "\\n(?:📘\\s*APOIO PEDAGÓGICO)"
    ]
  );

  intro = intro
    .replace(/^(?:📌\s*)?INTRODUÇÃO\s*[:：]?\s*/i, "")
    .trim();

  return intro;
}

function extractConclusao(text = "") {
  let conc = extractBetween(
    text,
    [
      "\\bCONCLUSÃO\\s*[:：]?"
    ],
    [
      "\\n(?:📘\\s*APOIO PEDAGÓGICO\\s*\\(CONCLUSÃO\\))",
      "\\n(?:🎯\\s*APLICAÇÃO PRÁTICA\\s*\\(CONCLUSÃO\\))",
      "\\n(?:🎵\\s*HINOS SUGERIDOS(?:\\s*\\/\\s*MOMENTO DE ORAÇÃO)?)",
      "\\n(?:🙏\\s*MOTIVO DE ORAÇÃO)",
      "\\n(?:ESBOÇO DA LIÇÃO)",
      "\\n(?:INTRODUÇÃO\\b)",
      "\\n(?:Lição\\s+\\d+\\s+—)"
    ]
  );

  conc = conc
    .replace(/^CONCLUSÃO\s*[:：]?\s*/i, "")
    .trim();

  return conc;
}

function extractTopicos(text = "") {
  const lines = splitLines(text);
  const topicos = [];
  let current = null;

  const isTopico = (line) => /^\d+\.\s+/.test(line);
  const isSubtopico = (line) => /^\d+\.\d+\.\s+/.test(line);
  const isEuEnsinei = (line) => /^✨?\s*EU ENSINEI QUE\s*[:：]/i.test(line);
  const isApoio = (line) => /^📘?\s*APOIO PEDAGÓGICO/i.test(line);
  const isAplic = (line) => /^🎯?\s*APLICAÇÃO PRÁTICA/i.test(line);
  const isConclusao = (line) => /^CONCLUSÃO\s*[:：]?/i.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (isConclusao(line)) break;

    if (isTopico(line) && !isSubtopico(line)) {
      if (current) topicos.push(current);

      const title = line.replace(/^(\d+)\.\s+/, "").trim();

      current = {
        numero: line.match(/^(\d+)\./)[1],
        titulo: title,
        texto: [],
        apoioPedagogico: "",
        aplicacaoPratica: "",
        euEnsineiQue: "",
        subtopicos: []
      };

      continue;
    }

    if (!current) continue;

    if (isSubtopico(line)) {
      current.subtopicos.push({
        titulo: line.replace(/^(\d+\.\d+\.)\s+/, "").trim(),
        texto: ""
      });
      continue;
    }

    if (isApoio(line)) {
      let bloco = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (
          isAplic(next) ||
          isSubtopico(next) ||
          (isTopico(next) && !isSubtopico(next)) ||
          isEuEnsinei(next) ||
          isConclusao(next)
        ) break;
        bloco.push(next);
        j++;
      }
      current.apoioPedagogico = bloco.join(" ").trim();
      i = j - 1;
      continue;
    }

    if (isAplic(line)) {
      let bloco = [];
      let j = i;
      bloco.push(removeLeadingLabel(line, "🎯?\\s*APLICAÇÃO PRÁTICA(?:\\s*\\(CONCLUSÃO\\))?"));

      j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        if (
          isApoio(next) ||
          isSubtopico(next) ||
          (isTopico(next) && !isSubtopico(next)) ||
          isEuEnsinei(next) ||
          isConclusao(next)
        ) break;
        bloco.push(next);
        j++;
      }

      current.aplicacaoPratica = bloco.join(" ").trim();
      i = j - 1;
      continue;
    }

    if (isEuEnsinei(line)) {
      current.euEnsineiQue = removeLeadingLabel(line, "✨?\\s*EU ENSINEI QUE");
      continue;
    }

    if (current.subtopicos.length > 0) {
      const lastSub = current.subtopicos[current.subtopicos.length - 1];
      lastSub.texto = (lastSub.texto ? lastSub.texto + " " : "") + line;
    } else {
      current.texto.push(line);
    }
  }

  if (current) topicos.push(current);

  for (const topico of topicos) {
    topico.texto = dedupeParagraphs(
      topico.texto
        .join(" ")
        .split(/\s{2,}/)
        .map(s => s.trim())
        .filter(Boolean)
    ).join(" ").trim();

    topico.subtopicos = topico.subtopicos.map(st => ({
      titulo: st.titulo,
      texto: normSpaces(st.texto)
    })).filter(st => st.titulo || st.texto);
  }

  return topicos;
}

/* =========================================================
   APLICAÇÃO PRÁTICA INTELIGENTE
========================================================= */

function sentenceFromText(text = "", max = 180) {
  let clean = stripHtml(text)
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";

  const firstSentence = clean.match(/^(.+?[.!?])(\s|$)/);
  clean = firstSentence ? firstSentence[1].trim() : clean;

  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/[,:;.\-–—]\s*$/, "").trim() + "...";
}

function buildAplicacaoPratica({ publico, tituloTopico, baseText, tituloLicao }) {
  const frase = sentenceFromText(baseText, 170);

  if (publico === "jovens") {
    if (frase) {
      return `O aluno deve ser incentivado a aplicar este ensino em suas escolhas, atitudes e relacionamento com Deus, lembrando que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`;
    }
    return `O aluno deve ser incentivado a aplicar o ensino deste tópico em suas escolhas, atitudes e relacionamento com Deus, demonstrando obediência prática à Palavra no dia a dia.`;
  }

  if (frase) {
    return `A classe deve ser encorajada a colocar em prática este ensino no cotidiano cristão, lembrando que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`;
  }

  return `A classe deve ser encorajada a colocar em prática o ensino deste tópico no cotidiano cristão, transformando o conteúdo estudado em atitude, testemunho e fidelidade ao Senhor.`;
}

function buildConclusaoAplicacao({ publico, conclusao }) {
  const frase = sentenceFromText(conclusao, 180);

  if (publico === "jovens") {
    return frase
      ? `O aluno deve ser incentivado a aplicar a verdade final da lição em suas escolhas, atitudes e relacionamento com Deus, compreendendo que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`
      : `O aluno deve ser incentivado a aplicar a verdade final da lição em suas escolhas, atitudes e relacionamento com Deus, demonstrando obediência prática à Palavra no dia a dia.`;
  }

  return frase
    ? `A classe deve ser encorajada a colocar em prática a mensagem final da lição no cotidiano cristão, compreendendo que ${frase.charAt(0).toLowerCase() + frase.slice(1)}.`
    : `A classe deve ser encorajada a colocar em prática a mensagem final da lição no cotidiano cristão, transformando o ensino recebido em atitude, testemunho e fidelidade ao Senhor.`;
}

/* =========================================================
   APOIO PEDAGÓGICO PADRÃO BETEL
========================================================= */

function buildApoioPedagogico({ publico, tituloLicao, baseText, topicoTitulo, isConclusao = false }) {
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

  return `${intro} ${corpo} ${fechamento}`.trim();
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

  const topicosHtml = (topicos || []).map(topico => {
    const subHtml = (topico.subtopicos || []).map(sub => `
      <div class="subtopico">
        <h4>${escapeHtml(sub.titulo)}</h4>
        <p>${escapeHtml(sub.texto)}</p>
      </div>
    `).join("");

    const apoio = topico.apoioPedagogico
      ? topico.apoioPedagogico
      : buildApoioPedagogico({
          publico,
          tituloLicao: titulo,
          baseText: topico.texto || (topico.subtopicos[0] && topico.subtopicos[0].texto) || topico.titulo,
          topicoTitulo: topico.titulo
        });

    const aplic = topico.aplicacaoPratica
      ? topico.aplicacaoPratica
      : buildAplicacaoPratica({
          publico,
          tituloTopico: topico.titulo,
          baseText: topico.texto || (topico.subtopicos[0] && topico.subtopicos[0].texto) || topico.titulo,
          tituloLicao: titulo
        });

    return `
      <section class="bloco topico">
        <h2>${escapeHtml(topico.numero)}. ${escapeHtml(topico.titulo)}</h2>
        ${topico.texto ? `<p>${escapeHtml(topico.texto)}</p>` : ""}
        ${subHtml}
        ${apoio ? `
          <div class="apoio-pedagogico">
            <h3>Apoio Pedagógico</h3>
            <p>${escapeHtml(apoio)}</p>
          </div>
        ` : ""}
        ${aplic ? `
          <div class="aplicacao-pratica">
            <h3>Aplicação Prática</h3>
            <p>${escapeHtml(aplic)}</p>
          </div>
        ` : ""}
        ${topico.euEnsineiQue ? `
          <div class="eu-ensinei">
            <h3>Eu ensinei que</h3>
            <p>${escapeHtml(topico.euEnsineiQue)}</p>
          </div>
        ` : ""}
      </section>
    `;
  }).join("");

  const conclusaoHtml = conclusao
    ? `
      <section class="bloco conclusao">
        <h2>Conclusão</h2>
        <p>${escapeHtml(conclusao)}</p>

        ${apoioPedagogicoConclusao ? `
          <div class="apoio-pedagogico">
            <h3>Apoio Pedagógico</h3>
            <p>${escapeHtml(apoioPedagogicoConclusao)}</p>
          </div>
        ` : ""}

        ${aplicacaoPraticaConclusao ? `
          <div class="aplicacao-pratica">
            <h3>Aplicação Prática</h3>
            <p>${escapeHtml(aplicacaoPraticaConclusao)}</p>
          </div>
        ` : ""}
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
   PIPELINE PRINCIPAL
========================================================= */

function buildLessonFromBetel({ numero, titulo, conteudoBase, publico }) {
  const raw = normSpaces(conteudoBase || "");
  const source = prepareSource(raw);
  const publicoFinal = detectPublico(source, publico);

  const extractedTitle = extractNumeroETitulo(raw, numero, titulo);
  const meta = extractMeta(source);
  const introducao = extractIntroducao(source);
  const topicos = extractTopicos(source);
  const conclusao = extractConclusao(source);

  // limpeza extra: impedir duplicação de introdução ou conclusão vazia/placeholder
  const topicosFiltrados = (topicos || []).filter(t => {
    const title = String(t.titulo || "").toLowerCase().trim();
    return title && !/^introdu[cç][aã]o$/i.test(title) && !/^conclus[aã]o$/i.test(title);
  });

  const topicosComFallback = topicosFiltrados.map(t => ({
    ...t,
    apoioPedagogico: t.apoioPedagogico || buildApoioPedagogico({
      publico: publicoFinal,
      tituloLicao: extractedTitle.titulo,
      baseText: t.texto || (t.subtopicos[0] && t.subtopicos[0].texto) || t.titulo,
      topicoTitulo: t.titulo
    }),
    aplicacaoPratica: t.aplicacaoPratica || buildAplicacaoPratica({
      publico: publicoFinal,
      tituloTopico: t.titulo,
      baseText: t.texto || (t.subtopicos[0] && t.subtopicos[0].texto) || t.titulo,
      tituloLicao: extractedTitle.titulo
    })
  }));

  const apoioPedagogicoConclusao = buildApoioPedagogico({
    publico: publicoFinal,
    tituloLicao: extractedTitle.titulo,
    baseText: conclusao,
    isConclusao: true
  });

  const aplicacaoPraticaConclusao = buildConclusaoAplicacao({
    publico: publicoFinal,
    conclusao
  });

  const lesson = {
    numero: extractedTitle.numero || numero || "",
    titulo: extractedTitle.titulo || titulo || "Lição",
    publico: publicoFinal,
    tipo: publicoFinal === "jovens" ? "youth" : "adult",
    textoAureo: meta.textoAureo,
    verdadeAplicada: meta.verdadeAplicada,
    textoReferencia: meta.textoReferencia,
    pontoChave: meta.pontoChave,
    refletindo: meta.refletindo,
    analiseGeral: meta.analiseGeral,
    introducao,
    topicos: topicosComFallback,
    conclusao,
    apoioPedagogicoConclusao,
    aplicacaoPraticaConclusao
  };

  lesson.conteudoHtml = renderHtml(lesson);
  lesson.texto = stripHtml(lesson.conteudoHtml);
  lesson.markdown = lesson.texto;
  lesson.conteudo = lesson.conteudoHtml;
  lesson.slug = `licao-${lesson.numero || "sem-numero"}-${slugify(lesson.titulo)}`;

  return lesson;
}

/* =========================================================
   ROTAS
========================================================= */

app.get("/health", (req, res) => {
  res.json({ ok: true, status: "online" });
});

app.post("/api/gerar-licao", (req, res) => {
  try {
    const {
      numero,
      titulo,
      conteudoBase,
      publico
    } = req.body || {};

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

    return res.json({
      ok: true,
      source: "betel_parser_final",
      lesson,
      numero: lesson.numero,
      titulo: lesson.titulo,
      publico: lesson.publico,
      tipo: lesson.tipo,
      conteudo: lesson.conteudo,
      conteudoHtml: lesson.conteudoHtml,
      texto: lesson.texto,
      markdown: lesson.markdown
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor Betel ativo na porta ${PORT}`);
});
