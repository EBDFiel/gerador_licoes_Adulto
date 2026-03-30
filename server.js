const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ebd-gerador" });
});

function extrairJsonSeguro(texto) {
  if (!texto || typeof texto !== "string") {
    throw new Error("Resposta vazia da IA.");
  }

  const textoLimpo = texto.trim();

  try {
    return JSON.parse(textoLimpo);
  } catch (_) {
  }

  const blocoJson = textoLimpo.match(/\{[\s\S]*\}/);
  if (blocoJson) {
    try {
      return JSON.parse(blocoJson[0]);
    } catch (_) {
    }
  }

  throw new Error(`A IA não retornou JSON válido: ${textoLimpo}`);
}

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
- Responda APENAS com JSON válido.
- NÃO escreva explicações antes ou depois do JSON.
- NÃO use markdown.
- Público: ${publico}
- Tipo da lição: ${tipoLicao}
- Seção da lição: ${secao}
- Título da lição: ${titulo}

Tarefa:
1. Gere "analiseGeral" apenas se a seção for "geral". Se não for, pode retornar string vazia.
2. Gere "apoioPedagogico" com profundidade equilibrada: nem curto demais, nem excessivamente extenso.
3. Gere "aplicacaoPratica" curta, objetiva e ligada ao cotidiano.
4. Se o público for jovens, use linguagem mais próxima da realidade juvenil.
5. Se o público for adultos, use linguagem mais madura e pastoral.

Formato obrigatório da resposta:
{
  "analiseGeral": "...",
  "apoioPedagogico": "...",
  "aplicacaoPratica": "..."
}

Texto base da revista:
"""
${textoOriginal}
"""
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
        error: `Resposta inválida da API DeepSeek: ${rawText}`
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
      resultado = extrairJsonSeguro(content);
    } catch (e) {
      return res.status(500).json({
        error: e.message
      });
    }

    res.json({
      analiseGeral: resultado.analiseGeral || "",
      apoioPedagogico: resultado.apoioPedagogico || "",
      aplicacaoPratica: resultado.aplicacaoPratica || ""
    });
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
