const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function smartTemplate({ numero, titulo, conteudoBase, publico }) {
  const conteudo = String(conteudoBase || "").trim();

  return {
    numero: numero || "",
    titulo: titulo || "Lição",
    publico: publico || "adultos",
    tipo: String(publico || "adultos").toLowerCase().includes("jov")
      ? "youth"
      : "adult",
    conteudo,
    conteudoHtml: conteudo,
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
    const refinado = String(texto || "").trim();

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
