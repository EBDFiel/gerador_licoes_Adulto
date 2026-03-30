const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/gerar-complementos", async (req, res) => {
  try {
    const { tipoLicao, titulo, secao, textoOriginal, publico } = req.body;

    if (!titulo || !secao || !textoOriginal || !publico) {
      return res.status(400).json({
        error: "Campos obrigatórios: titulo, secao, textoOriginal, publico"
      });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    if (!apiKey) {
      return res.status(500).json({
        error: "DEEPSEEK_API_KEY não configurada no Render."
      });
    }

    const prompt = `
Você é um assistente especializado em elaboração de lições bíblicas para a plataforma EBD Fiel.

Regras obrigatórias:
- NÃO altere, resuma, reescreva ou corte o texto original.
- O texto original será preservado pelo sistema; você deve gerar APENAS os campos complementares.
- Gere resposta em JSON válido.
- Público: ${publico}.
- Tipo da lição: ${tipoLicao}.
- Seção da lição: ${secao}.
- Título da lição: ${titulo}.

Tarefa:
1. Gere uma "analiseGeral" apenas se a seção for "geral".
2. Gere um "apoioPedagogico" com profundidade equilibrada: nem curto demais, nem excessivamente extenso.
3. Gere uma "aplicacaoPratica" curta, objetiva e ligada ao cotidiano.
4. Se o público for jovens, use linguagem mais próxima da realidade juvenil.
5. Se o público for adultos, use linguagem mais madura e pastoral.

Texto base da revista:
"""
${textoOriginal}
"""

Formato de resposta:
{
  "analiseGeral": "...",
  "apoioPedagogico": "...",
  "aplicacaoPratica": "..."
}
`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
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
            content: "Você responde somente com JSON válido, sem markdown e sem texto extra."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7
      })
    });

    const rawText = await response.text();

    if (!response.ok) {
      return res.status(500).json({
        error: `Erro na API DeepSeek: ${response.status} - ${rawText}`
      });
    }

    let parsedApi;
    try {
      parsedApi = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({
        error: `Resposta inválida da API: ${rawText}`
      });
    }

    const content = parsedApi?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({
        error: "A API não retornou conteúdo."
      });
    }

    let resultado;
    try {
      resultado = JSON.parse(content);
    } catch (e) {
      return res.status(500).json({
        error: `A IA não retornou JSON válido: ${content}`
      });
    }

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      error: error.message || "Erro interno."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
