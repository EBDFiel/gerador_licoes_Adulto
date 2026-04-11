const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "4mb" }));

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

function detectTipo(publico = "", fallbackTipo = "") {
  const base = String(publico || fallbackTipo || "").toLowerCase().trim();

  if (
    base.includes("jov") ||
    base.includes("youth") ||
    base === "young" ||
    base === "juvenil"
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
      .replace(/\s+/g, " ")
      .replace(/\u00A0/g, " ")
  );
}

function splitLines(text = "") {
  return normalizeLineBreaks(text)
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

function formatParagraphs(text = "") {
  return splitLines(text)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
}

function extractLessonIdentity(raw = "", numero = "", titulo = "") {
  const lines = splitLines(raw);
  const firstLine = lines[0] || "";

  let finalNumero = String(numero || "").trim();
  let finalTitulo = String(titulo || "").trim();

  const m = firstLine.match(/^li[cç][aã]o\s*(\d+)\s*[:\-–]\s*(.+)$/i);
  if (m) {
    if (!finalNumero) finalNumero = m[1].trim();
    if (!finalTitulo) finalTitulo = m[2].trim();
  }

  if (!finalTitulo && firstLine) {
    finalTitulo = firstLine.replace(/^li[cç][aã]o\s*\d+\s*[:\-–]\s*/i, "").trim();
  }

  return {
    numero: finalNumero,
    titulo: finalTitulo || "Lição"
  };
}

function extractBlock(text = "", labels = []) {
  const lines = splitLines(text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      const regex = new RegExp(`^${label}\\s*[:\\-–]?\\s*(.*)$`, "i");
      const match = line.match(regex);
      if (match) {
        let value = match[1]?.trim() || "";

        if (value) return value;

        const next = lines[i + 1] || "";
        if (next) return next.trim();
      }
    }
  }

  return "";
}

function removeMatchedSectionLines(text = "", labels = []) {
  const lines = splitLines(text);

  return lines.filter((line, index) => {
    for (const label of labels) {
      const regex = new RegExp(`^${label}\\s*[:\\-–]?\\s*(.*)$`, "i");
      if (regex.test(line)) {
        return false;
      }

      const prev = lines[index - 1] || "";
      const prevRegex = new RegExp(`^${label}\\s*[:\\-–]?\\s*$`, "i");
      if (prevRegex.test(prev)) {
        return false;
      }
    }
    return true;
  }).join("\n");
}

function extractSections(raw = "", tipo = "adult") {
  let text = normalizeLineBreaks(raw);

  const verse = extractBlock(text, [
    "texto áureo",
    "texto aureo",
    "vers[íi]culo do dia",
    "versiculo do dia"
  ]);

  const truth = extractBlock(text, [
    "verdade aplicada",
    "verdade pr[áa]tica",
    "verdade prática",
    "verdade central"
  ]);

  const refs = extractBlock(text, [
    "texto de refer[êe]ncia",
    "texto de referencia",
    "textos de refer[êe]ncia",
    "textos de referencia",
    "leitura b[íi]blica",
    "leitura biblica",
    "refer[êe]ncias",
    "referencias"
  ]);

  const analysis = extractBlock(text, [
    "an[áa]lise geral da li[cç][aã]o",
    "analise geral da licao",
    "vis[ãa]o geral",
    "coment[áa]rio introdut[óo]rio",
    "comentario introdutorio"
  ]);

  const intro = extractBlock(text, [
    "introdu[cç][aã]o",
    "introdução"
  ]);

  const conclusao = extractBlock(text, [
    "conclus[ãa]o",
    "conclusao"
  ]);

  const hinosOuOracao = extractBlock(text, [
    "hinos sugeridos \\/ momento de ora[cç][aã]o",
    "hinos sugeridos",
    "momento de ora[cç][aã]o",
    "motivo de ora[cç][aã]o"
  ]);

  const cleaned = [
    ["texto áureo", "texto aureo", "vers[íi]culo do dia", "versiculo do dia"],
    ["verdade aplicada", "verdade pr[áa]tica", "verdade prática", "verdade central"],
    ["texto de refer[êe]ncia", "texto de referencia", "textos de refer[êe]ncia", "textos de referencia", "leitura b[íi]blica", "leitura biblica", "refer[êe]ncias", "referencias"],
    ["an[áa]lise geral da li[cç][aã]o", "analise geral da licao", "vis[ãa]o geral", "coment[áa]rio introdut[óo]rio", "comentario introdutorio"],
    ["introdu[cç][aã]o", "introdução"],
    ["conclus[ãa]o", "conclusao"],
    ["hinos sugeridos \\/ momento de ora[cç][aã]o", "hinos sugeridos", "momento de ora[cç][aã]o", "motivo de ora[cç][aã]o"]
  ].reduce((acc, labels) => removeMatchedSectionLines(acc, labels), text);

  const lines = splitLines(cleaned);

  let bodyLines = [...lines];

  if (bodyLines.length && /^li[cç][aã]o\s*\d+/i.test(bodyLines[0])) {
    bodyLines.shift();
  }

  const introFinal =
    intro ||
    (bodyLines[0] ? bodyLines[0] : "");

  return {
    raw: text,
    verse,
    truth,
    refs,
    analysis,
    intro: introFinal,
    bodyText: bodyLines.join("\n"),
    conclusao,
    hinosOuOracao,
    tipo
  };
}

function wrapBodySections(bodyText = "") {
  const lines = splitLines(bodyText);

  return lines
    .map(line => {
      const topico = line.match(/^(\d+(\.\d+)*)\s*[\-–:]?\s*(.+)$/);
      if (topico) {
        return `<div><strong>${escapeHtml(topico[1])}. ${escapeHtml(topico[3])}</strong></div>`;
      }

      const headingUpper = line.match(/^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ0-9\s\-\.:]{4,}$/);
      if (headingUpper && line.length < 120) {
        return `<div><strong>${escapeHtml(line)}</strong></div>`;
      }

      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");
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
  body,
  conclusao,
  hinosOuOracao
}) {
  const lessonTitle = titulo || "Lição";
  const lessonNumber = numero || "";
  const verseText = verse || "[Inserir versículo aqui]";
  const truthText = truth || "[Inserir verdade aplicada aqui]";
  const refsText = refs || "[Inserir referências aqui]";
  const analysisText = analysis || "[Conteúdo da análise geral]";
  const introText = intro || "[Conteúdo da introdução]";
  const bodyHtml = body || "<p>[Conteúdo da lição]</p>";
  const conclusaoText = conclusao || "[Conteúdo da conclusão]";
  const hinosText = hinosOuOracao || "[Preencher se necessário]";

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Lição ${escapeHtml(lessonNumber)} - ${escapeHtml(lessonTitle)} | EBD Jovens</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background-color:#eef0e8;font-family:'Segoe UI','Inter',Roboto,system-ui,sans-serif;line-height:1.55;padding:2rem 1rem;color:#1e2a1c}
    .lesson-container{max-width:1100px;margin:0 auto;background:white;border-radius:2rem;box-shadow:0 20px 35px -12px rgba(0,0,0,.1);overflow:hidden;padding:2rem 2rem 3rem}
    .header-gradient{background:linear-gradient(115deg,#6b3e2c 0%,#c97e5a 100%);color:white;padding:2rem 2rem 1.8rem;margin:-2rem -2rem 2rem -2rem;border-bottom:5px solid #f5d742;border-radius:0 0 2rem 2rem}
    .lesson-number{font-size:.9rem;letter-spacing:1px;text-transform:uppercase;background:rgba(255,255,240,.2);display:inline-block;padding:.2rem 1rem;border-radius:40px;margin-bottom:.75rem}
    .lesson-title{font-size:2rem;font-weight:800;line-height:1.2;margin:.5rem 0 .25rem}
    .lesson-meta{margin-top:.75rem;font-size:.95rem;opacity:.92}
    strong{color:#8b4c2c;font-weight:700}
    .verse,.truth,.refs{margin:1rem 0 1.2rem}
    .pedagogical-block{background-color:#edf3e8;border-left:6px solid #7fa06b;padding:1.2rem 1.5rem;border-radius:20px;margin:1.5rem 0;font-size:.98rem}
    .application-block{background-color:#fff4e5;border-left:6px solid #f5c542;padding:1rem 1.5rem;border-radius:20px;margin:1.2rem 0}
    .eu-ensinei{background:#f9f7ef;padding:.8rem 1.5rem;border-radius:40px;color:#c2691b;font-weight:600;margin:1.2rem 0;border:1px solid #f0e0bc;text-align:center}
    hr{margin:1.5rem 0;border:none;height:1px;background:linear-gradient(to right,#ddd2bc,transparent)}
    footer{text-align:center;margin-top:2.5rem;font-size:.75rem;color:#9b8e76;border-top:1px solid #e7dfd1;padding-top:1.5rem}
    .footer-print{text-align:center;margin-top:2rem;margin-bottom:.5rem}
    .print-btn{background-color:#8b4c2c;padding:.6rem 1.8rem;border-radius:40px;font-size:.9rem;font-weight:600;color:white;cursor:pointer;border:none;font-family:inherit;box-shadow:0 2px 6px rgba(0,0,0,.1)}
    .print-btn:hover{background-color:#6b3e2c;transform:scale(1.02)}
    p{margin:.8rem 0}
    @media (max-width:700px){
      .lesson-container{padding:1.5rem}
      .header-gradient{padding:1.5rem;margin:-1.5rem -1.5rem 1.5rem -1.5rem}
      .lesson-title{font-size:1.6rem}
      body{padding:.8rem}
    }
    @media print{
      body{background:white;padding:0}
      .print-btn,.footer-print{display:none}
      .pedagogical-block,.application-block{break-inside:avoid}
    }
  </style>
</head>
<body>
<div class="lesson-container">
  <div class="header-gradient">
    <div class="lesson-number">📘 Escola Bíblica Dominical | Classe de Jovens</div>
    <div class="lesson-title">Lição ${escapeHtml(lessonNumber)}: ${escapeHtml(lessonTitle)}</div>
    <div class="lesson-meta">Trimestre ${escapeHtml(trimestre || "")}${data ? " • " + escapeHtml(data) : ""}</div>
  </div>

  <div class="verse"><strong>📖 VERSÍCULO DO DIA:</strong> ${escapeHtml(verseText)}</div>
  <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truthText)}</div>
  <div class="refs"><strong>📌 TEXTO DE REFERÊNCIA:</strong> ${escapeHtml(refsText)}</div>

  <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>${escapeHtml(analysisText)}</div>

  <div style="margin-top:1rem;"><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(introText)}</div>

  <div style="margin-top:1rem;">${bodyHtml}</div>

  <div style="margin-top:1.2rem;"><strong>✅ CONCLUSÃO:</strong> ${escapeHtml(conclusaoText)}</div>

  <hr>
  <div><strong>🎵 HINOS SUGERIDOS / MOMENTO DE ORAÇÃO:</strong> ${escapeHtml(hinosText)}</div>

  <div class="footer-print">
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
  </div>

  <footer>Lição ${escapeHtml(lessonNumber)} — ${escapeHtml(lessonTitle)} | Base bíblica: ${escapeHtml(refsText)} | EBD Jovens</footer>
</div>
</body>
</html>`;
}

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
  body,
  conclusao,
  hinosOuOracao
}) {
  const lessonTitle = titulo || "Lição";
  const lessonNumber = numero || "";
  const verseText = verse || "[Inserir versículo aqui]";
  const truthText = truth || "[Inserir verdade aplicada aqui]";
  const refsText = refs || "[Inserir referências aqui]";
  const analysisText = analysis || "[Conteúdo da análise geral]";
  const introText = intro || "[Conteúdo da introdução]";
  const bodyHtml = body || "<p>[Conteúdo da lição]</p>";
  const conclusaoText = conclusao || "[Conteúdo da conclusão]";
  const oracaoText = hinosOuOracao || "[Inserir hinos / oração]";

  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Lição ${escapeHtml(lessonNumber)} - ${escapeHtml(lessonTitle)} | EBD Adultos</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background-color:#eef0e8;font-family:'Segoe UI','Inter',Roboto,system-ui,sans-serif;line-height:1.55;padding:2rem 1rem;color:#1e2a1c}
    .lesson-container{max-width:1100px;margin:0 auto;background:white;border-radius:2rem;box-shadow:0 20px 35px -12px rgba(0,0,0,.1);overflow:hidden;padding:2rem 2rem 3rem}
    .header-gradient{background:linear-gradient(115deg,#3b5a2b 0%,#6b4c2c 100%);color:white;padding:2rem 2rem 1.8rem;margin:-2rem -2rem 2rem -2rem;border-bottom:5px solid #e5b83c;border-radius:0 0 2rem 2rem}
    .lesson-number{font-size:.9rem;letter-spacing:1px;text-transform:uppercase;background:rgba(255,255,240,.2);display:inline-block;padding:.2rem 1rem;border-radius:40px;margin-bottom:.75rem}
    .lesson-title{font-size:2rem;font-weight:800;line-height:1.2;margin:.5rem 0 .25rem}
    .lesson-meta{margin-top:.75rem;font-size:.95rem;opacity:.92}
    strong{color:#5a3e2b;font-weight:700}
    .verse,.truth,.refs{margin:1rem 0 1.2rem}
    .pedagogical-block{background-color:#edf3e8;border-left:6px solid #7fa06b;padding:1.2rem 1.5rem;border-radius:20px;margin:1.5rem 0;font-size:.98rem}
    .application-block{background-color:#fff4e5;border-left:6px solid #f5c542;padding:1rem 1.5rem;border-radius:20px;margin:1.2rem 0}
    .eu-ensinei{background:#f9f7ef;padding:.8rem 1.5rem;border-radius:40px;color:#c2691b;font-weight:600;margin:1.2rem 0;border:1px solid #f0e0bc;text-align:center}
    hr{margin:1.5rem 0;border:none;height:1px;background:linear-gradient(to right,#ddd2bc,transparent)}
    footer{text-align:center;margin-top:2.5rem;font-size:.75rem;color:#9b8e76;border-top:1px solid #e7dfd1;padding-top:1.5rem}
    .footer-print{text-align:center;margin-top:2rem;margin-bottom:.5rem}
    .print-btn{background-color:#6b4c2c;padding:.6rem 1.8rem;border-radius:40px;font-size:.9rem;font-weight:600;color:white;cursor:pointer;border:none;font-family:inherit;box-shadow:0 2px 6px rgba(0,0,0,.1)}
    .print-btn:hover{background-color:#4a341e;transform:scale(1.02)}
    p{margin:.8rem 0}
    @media (max-width:700px){
      .lesson-container{padding:1.5rem}
      .header-gradient{padding:1.5rem;margin:-1.5rem -1.5rem 1.5rem -1.5rem}
      .lesson-title{font-size:1.6rem}
      body{padding:.8rem}
    }
    @media print{
      body{background:white;padding:0}
      .print-btn,.footer-print{display:none}
      .pedagogical-block,.application-block{break-inside:avoid}
    }
  </style>
</head>
<body>
<div class="lesson-container">
  <div class="header-gradient">
    <div class="lesson-number">📘 Escola Bíblica Dominical | Classe de Adultos</div>
    <div class="lesson-title">Lição ${escapeHtml(lessonNumber)}: ${escapeHtml(lessonTitle)}</div>
    <div class="lesson-meta">Trimestre ${escapeHtml(trimestre || "")}${data ? " • " + escapeHtml(data) : ""}</div>
  </div>

  <div class="verse"><strong>📖 TEXTO ÁUREO:</strong> ${escapeHtml(verseText)}</div>
  <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truthText)}</div>
  <div class="refs"><strong>📌 TEXTOS DE REFERÊNCIA:</strong> ${escapeHtml(refsText)}</div>

  <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>${escapeHtml(analysisText)}</div>

  <div style="margin-top:1rem;"><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(introText)}</div>

  <div style="margin-top:1rem;">${bodyHtml}</div>

  <div style="margin-top:1.2rem;"><strong>✅ CONCLUSÃO:</strong> ${escapeHtml(conclusaoText)}</div>

  <hr>
  <div><strong>🎵 HINOS SUGERIDOS / ORAÇÃO:</strong> ${escapeHtml(oracaoText)}</div>

  <div class="footer-print">
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
  </div>

  <footer>Lição ${escapeHtml(lessonNumber)} — ${escapeHtml(lessonTitle)} | Base bíblica: ${escapeHtml(refsText)} | EBD Adultos</footer>
</div>
</body>
</html>`;
}

function smartTemplate({
  numero,
  titulo,
  conteudoBase,
  publico,
  tipo,
  trimestre,
  data,
  mode
}) {
  const finalTipo = detectTipo(publico, tipo);
  const rawInput = normalizeLineBreaks(conteudoBase);
  const identity = extractLessonIdentity(rawInput, numero, titulo);
  const finalNumero = identity.numero;
  const finalTitulo = identity.titulo;
  const finalPublico = publico || (finalTipo === "youth" ? "jovens" : "adultos");

  if (isHtml(rawInput)) {
    return {
      numero: finalNumero,
      titulo: finalTitulo,
      publico: finalPublico,
      tipo: finalTipo,
      trimestre: trimestre || "",
      data: data || "",
      mode: mode || "smart_template",
      conteudo: rawInput,
      conteudoHtml: rawInput,
      texto: stripHtml(rawInput),
      markdown: stripHtml(rawInput)
    };
  }

  const sections = extractSections(rawInput, finalTipo);
  const body = wrapBodySections(sections.bodyText || rawInput);

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
          body,
          conclusao: sections.conclusao,
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
          body,
          conclusao: sections.conclusao,
          hinosOuOracao: sections.hinosOuOracao
        });

  return {
    numero: finalNumero,
    titulo: finalTitulo,
    publico: finalPublico,
    tipo: finalTipo,
    trimestre: trimestre || "",
    data: data || "",
    mode: mode || "smart_template",
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
    mode
  } = body || {};

  return smartTemplate({
    numero,
    titulo,
    conteudoBase: conteudoBase || textoBase || "",
    publico,
    tipo,
    trimestre,
    data,
    mode
  });
}

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
