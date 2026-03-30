const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "6mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ebd-gerador-estrutura-fixa" });
});

function extrairJsonSeguro(texto) {
  if (!texto || typeof texto !== "string") {
    throw new Error("Resposta vazia da IA.");
  }

  const textoLimpo = texto.trim();

  try {
    return JSON.parse(textoLimpo);
  } catch (_) {}

  const match = textoLimpo.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {}
  }

  throw new Error(`A IA não retornou JSON válido: ${textoLimpo}`);
}

function montarPromptEstruturado({ titulo, textoOriginal, publico }) {
  const estiloPublico =
    String(publico).toLowerCase() === "jovens"
      ? `
ESTILO DO PÚBLICO:
- A lição é da classe JOVENS.
- Mantenha o conteúdo original da revista exatamente como vier.
- Nos trechos gerados (análise geral, apoio pedagógico e aplicação prática), use linguagem clara, bíblica e próxima da realidade juvenil.
`
      : `
ESTILO DO PÚBLICO:
- A lição é da classe ADULTOS.
- Mantenha o conteúdo original da revista exatamente como vier.
- Nos trechos gerados (análise geral, apoio pedagógico e aplicação prática), use linguagem madura, reverente, bíblica e pastoral.
`;

  return `
Você é um assistente especializado em elaboração de lições bíblicas da EBD Fiel.

MISSÃO:
Gerar a lição completa seguindo EXATAMENTE a estrutura fixa exigida abaixo.

REGRA PRINCIPAL:
- TODO o conteúdo original da revista deve ser mantido na íntegra, sem cortes, sem resumos, sem reescrita.
- Você deve gerar automaticamente apenas:
  1. ANÁLISE GERAL
  2. APOIO PEDAGÓGICO
  3. APLICAÇÃO PRÁTICA

REGRAS OBRIGATÓRIAS:
- NÃO altere o título da lição.
- NÃO altere TEXTO ÁUREO, VERDADE APLICADA, TEXTOS DE REFERÊNCIA, INTRODUÇÃO, tópicos, subtópicos, "EU ENSINEI QUE", CONCLUSÃO ou qualquer outro trecho original.
- Preserve os títulos e subtítulos exatamente como aparecerem.
- A ANÁLISE GERAL deve ser bem desenvolvida.
- O APOIO PEDAGÓGICO deve ser mais abrangente, explicativo, consistente, útil para o professor, mas sem ser excessivamente longo.
- A APLICAÇÃO PRÁTICA deve ser curta, objetiva e relacionada ao cotidiano.
- Onde houver "EU ENSINEI QUE", preserve exatamente como estiver no texto original.
- Responda APENAS com JSON válido.
- NÃO use markdown.
- NÃO use blocos de código.
- NÃO escreva nada fora do JSON.

${estiloPublico}

FORMATO OBRIGATÓRIO DA RESPOSTA:
{
  "licaoCompleta": "texto completo da lição seguindo exatamente o modelo exigido"
}

ESTRUTURA FIXA OBRIGATÓRIA:
Lição X: TÍTULO DA LIÇÃO.
TEXTO ÁUREO:
VERDADE APLICADA:
TEXTOS DE REFERÊNCIA
ANÁLISE GERAL:
INTRODUÇÃO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
1. TÍTULO DO TÓPICO:
1.1. TÍTULO DO SUBTÓPICO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
1.2. TÍTULO DO SUBTÓPICO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
1.3. TÍTULO DO SUBTÓPICO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
2. TÍTULO DO TÓPICO:
2.1. TÍTULO DO SUBTÓPICO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
2.2. TÍTULO DO SUBTÓPICO:
EU ENSINEI QUE:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
2.3. TÍTULO DO SUBTÓPICO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
3. TÍTULO DO TÓPICO:
3.1. TÍTULO DO SUBTÓPICO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
3.2. TÍTULO DO SUBTÓPICO:
EU ENSINEI QUE:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
3.3. TÍTULO DO SUBTÓPICO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:
CONCLUSÃO:
APOIO PEDAGÓGICO:
APLICAÇÃO PRÁTICA:

INSTRUÇÕES DE MONTAGEM:
- Identifique, no texto original da revista, os blocos e títulos exatamente como vierem.
- Monte a lição final obedecendo a estrutura fixa acima.
- Onde o texto original trouxer conteúdo, preserve-o integralmente.
- Onde a estrutura pedir ANÁLISE GERAL, APOIO PEDAGÓGICO ou APLICAÇÃO PRÁTICA, gere esses trechos automaticamente.
- Se algum item da estrutura fixa não existir no texto original, mantenha o título e preencha apenas o que for possível sem inventar conteúdo original inexistente.
- Não omita nenhuma parte existente da revista.
- Não reorganize fora do padrão exigido.

TÍTULO DA LIÇÃO:
${titulo}

TEXTO ORIGINAL DA REVISTA:
"""
${textoOriginal}
"""
`;
}

app.post("/api/gerar-licao-completa", async (req, res) => {
  try {
    const { titulo, textoOriginal, publico } = req.body;

    if (!titulo || !textoOriginal || !publico) {
      return res.status(400).json({
        error: "Campos obrigatórios: titulo, textoOriginal, publico"
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

    const prompt = montarPromptEstruturado({
      titulo,
      textoOriginal,
      publico
    });

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
            content:
              "Você responde somente com JSON válido, sem markdown, sem comentários e sem texto fora do JSON."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.4
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

    return res.json({
      licaoCompleta: typeof resultado.licaoCompleta === "string"
        ? resultado.licaoCompleta.trim()
        : ""
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Erro interno."
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
