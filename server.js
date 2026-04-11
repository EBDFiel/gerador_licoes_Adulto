// ===============================
// EBD Fiel - Server Produção
// ===============================

const express = require("express");
const cors = require("cors");

const app = express();

// ===============================
// CONFIG
// ===============================
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ===============================
// FUNÇÃO BASE (NÃO MUDA VISUAL)
// ===============================
function smartTemplate({ numero, titulo, conteudoBase, publico }) {
  const conteudo = (conteudoBase || "").trim();

  return {
    numero,
    titulo,
    publico,
    conteudo, // ⚠️ importante: mantém padrão original do seu licao.html
  };
}

// ===============================
// ROTA: FALLBACK (SEMPRE FUNCIONA)
// ===============================
app.post("/api/gerar-licao", (req, res) => {
  try {
    const { numero, titulo, conteudoBase, publico } = req.body;

    const lesson = smartTemplate({
      numero,
      titulo,
      conteudoBase,
      publico,
    });

    res.json({
      ok: true,
      lesson,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao gerar lição" });
  }
});

// ===============================
// ROTA: DEEPSEEK (SIMULADA / HÍBRIDO)
// ===============================
app.post("/api/admin/deepseek/generate", async (req, res) => {
  try {
    const { numero, titulo, conteudoBase, publico } = req.body;

    // 🔥 Aqui você pode plugar DeepSeek real depois
    const lesson = smartTemplate({
      numero,
      titulo,
      conteudoBase,
      publico,
    });

    res.json({
      ok: true,
      lesson,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro no DeepSeek" });
  }
});

// ===============================
// ROTA: REFINAR TEXTO
// ===============================
app.post("/api/admin/deepseek/refinar", async (req, res) => {
  try {
    const { texto } = req.body;

    // Simulação simples (pode trocar depois)
    const refinado = texto;

    res.json({
      ok: true,
      texto: refinado,
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao refinar" });
  }
});

// ===============================
// HEALTH CHECK
// ===============================
app.get("/", (req, res) => {
  res.send("EBD Fiel Server OK 🚀");
});

// ===============================
// 🔥 CORREÇÃO DO RENDER (ESSENCIAL)
// ===============================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor rodando na porta:", PORT);
});
