const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeLineBreaks(text = "") {
  return String(text || "").replace(/\r/g, "").trim();
}

function isHtml(text = "") {
  return /<([a-z][a-z0-9]*)\b[^>]*>/i.test(String(text || ""));
}

function detectTipo(publico = "") {
  return String(publico || "").toLowerCase().includes("jov") ? "youth" : "adult";
}

function detectClasseLabel(tipo) {
  return tipo === "youth" ? "Classe de Jovens" : "Classe de Adultos";
}

function formatParagraphs(text = "") {
  return normalizeLineBreaks(text)
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
}

function extractSections(raw = "") {
  const text = normalizeLineBreaks(raw);

  return {
    raw: text,
    verse: "",
    truth: "",
    refs: "",
    analysis: "",
    intro: text,
    topico1: "",
    topico2: "",
    topico3: "",
    conclusao: "",
    hinosOuOracao: ""
  };
}

function buildYouthHtml({ numero, titulo, refs, truth, verse, analysis, intro, body }) {
  const lessonTitle = titulo || "Lição";
  const lessonNumber = numero || "";
  const verseText = verse || "[Inserir versículo aqui]";
  const truthText = truth || "[Inserir verdade aplicada aqui]";
  const refsText = refs || "[Inserir referências aqui]";
  const analysisText = analysis || "[Conteúdo da análise geral]";
  const introText = intro || "[Conteúdo da introdução]";
  const bodyHtml = body || "<p>[Conteúdo da lição]</p>";

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
  </div>

  <div class="verse"><strong>📖 VERSÍCULO DO DIA:</strong> ${escapeHtml(verseText)}</div>
  <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truthText)}</div>
  <div class="refs"><strong>📌 TEXTO DE REFERÊNCIA:</strong> ${escapeHtml(refsText)}</div>

  <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>${escapeHtml(analysisText)}</div>

  <div><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(introText)}</div>

  ${bodyHtml}

  <hr>
  <div><strong>🎵 HINOS SUGERIDOS / MOMENTO DE ORAÇÃO:</strong> [Preencher se necessário]</div>

  <div class="footer-print">
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
  </div>

  <footer>Licao ${escapeHtml(lessonNumber)} — ${escapeHtml(lessonTitle)} | Base bíblica: ${escapeHtml(refsText)} | EBD Jovens</footer>
</div>
</body>
</html>`;
}

function buildAdultHtml({ numero, titulo, refs, truth, verse, analysis, intro, body }) {
  const lessonTitle = titulo || "Lição";
  const lessonNumber = numero || "";
  const verseText = verse || "[Inserir versículo aqui]";
  const truthText = truth || "[Inserir verdade aplicada aqui]";
  const refsText = refs || "[Inserir referências aqui]";
  const analysisText = analysis || "[Conteúdo da análise geral]";
  const introText = intro || "[Conteúdo da introdução]";
  const bodyHtml = body || "<p>[Conteúdo da lição]</p>";

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
  </div>

  <div class="verse"><strong>📖 TEXTO ÁUREO:</strong> ${escapeHtml(verseText)}</div>
  <div class="truth"><strong>✨ VERDADE APLICADA:</strong> ${escapeHtml(truthText)}</div>
  <div class="refs"><strong>📌 TEXTOS DE REFERÊNCIA:</strong> ${escapeHtml(refsText)}</div>

  <div><strong>🔍 ANÁLISE GERAL DA LIÇÃO</strong><br>${escapeHtml(analysisText)}</div>

  <div><strong>📌 INTRODUÇÃO:</strong> ${escapeHtml(introText)}</div>

  ${bodyHtml}

  <hr>
  <div><strong>🎵 HINOS SUGERIDOS:</strong> [Inserir hinos]</div>
  <div><strong>🙏 MOTIVO DE ORAÇÃO:</strong> [Inserir motivo de oração]</div>

  <div class="footer-print">
    <button class="print-btn" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
  </div>

  <footer>Licao ${escapeHtml(lessonNumber)} — ${escapeHtml(lessonTitle)} | Base bíblica: ${escapeHtml(refsText)} | EBD Adultos</footer>
</div>
</body>
</html>`;
}

function smartTemplate({ numero, titulo, conteudoBase, publico }) {
  const tipo = detectTipo(publico);
  const conteudo = normalizeLineBreaks(conteudoBase);

  if (isHtml(conteudo)) {
    return {
      numero: numero || "",
      titulo: titulo || "Lição",
      publico: publico || (tipo === "youth" ? "jovens" : "adultos"),
      tipo,
      conteudo,
      conteudoHtml: conteudo,
      texto: conteudo,
      markdown: conteudo
    };
  }

  const sections = extractSections(conteudo);
  const body = formatParagraphs(conteudo);

  const conteudoHtml =
    tipo === "youth"
      ? buildYouthHtml({
          numero,
          titulo,
          refs: sections.refs,
          truth: sections.truth,
          verse: sections.verse,
          analysis: sections.analysis,
          intro: sections.intro,
          body
        })
      : buildAdultHtml({
          numero,
          titulo,
          refs: sections.refs,
          truth: sections.truth,
          verse: sections.verse,
          analysis: sections.analysis,
          intro: sections.intro,
          body
        });

  return {
    numero: numero || "",
    titulo: titulo || "Lição",
    publico: publico || (tipo === "youth" ? "jovens" : "adultos"),
    tipo,
    conteudo,
    conteudoHtml,
    texto: conteudo,
    markdown: conteudo
  };
}

app.post("/api/gerar-licao", (req, res) => {
  try {
    const { numero, titulo, conteudoBase, publico } = req.body || {};

    const lesson = smartTemplate({
      numero,
      titulo,
      conteudoBase,
      publico
    });

    return res.json({
      ok: true,
      content: lesson.conteudoHtml || lesson.conteudo || lesson.texto || "",
      lesson
    });
  } catch (err) {
    console.error("Erro em /api/gerar-licao:", err);
    return res.status(500).json({ ok: false, error: "Erro ao gerar lição" });
  }
});

app.post("/api/admin/deepseek/generate", async (req, res) => {
  try {
    const { numero, titulo, conteudoBase, publico } = req.body || {};

    const lesson = smartTemplate({
      numero,
      titulo,
      conteudoBase,
      publico
    });

    return res.json({
      ok: true,
      content: lesson.conteudoHtml || lesson.conteudo || lesson.texto || "",
      lesson
    });
  } catch (err) {
    console.error("Erro em /api/admin/deepseek/generate:", err);
    return res.status(500).json({ ok: false, error: "Erro no DeepSeek" });
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
    return res.status(500).json({ ok: false, error: "Erro ao refinar" });
  }
});

app.get("/", (req, res) => {
  res.send("EBD Fiel Server OK");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
