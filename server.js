const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "4mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ebd-gerador-premium" });
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

  const match = textoLimpo.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_) {
    }
  }

  throw new Error(`A IA não retornou JSON válido: ${textoLimpo}`);
}

function montarPrompt({ tipoLicao, titulo, secao, textoOriginal, publico }) {
  const isJovens = String(publico || tipoLicao).toLowerCase() === "jovens";

  const estiloPublico = isJovens
    ? `
ESTILO PARA JOVENS:
- Use linguagem clara, atual e acessível.
- Aplique o conteúdo à realidade juvenil: escola, escolhas, amizades, redes sociais, identidade, propósito, tentações, disciplina espiritual.
- Mantenha profundidade bíblica, mas com explicações mais diretas.
- A aplicação prática deve soar concreta e próxima da rotina do jovem.
`
    : `
ESTILO PARA ADULTOS:
- Use linguagem madura, pastoral, reverente e bem estruturada.
- Aplique o conteúdo à vida cristã, família, trabalho, testemunho, maturidade espiritual, serviço cristão e perseverança.
- O apoio pedagógico deve ter profundidade equilibrada, com boa clareza e tom de revista bíblica.
- A aplicação prática deve ser objetiva, concreta e ligada ao cotidiano do adulto cristão.
`;

  const regraAnalise = secao === "geral"
    ? `
- "analiseGeral" deve vir preenchida com 4 parágrafos bem desenvolvidos.
- A análise geral deve:
  1. explicar o tema central da lição;
  2. mostrar o fio condutor do estudo;
  3. destacar as principais verdades bíblicas;
  4. indicar os impactos práticos para a vida do público.
`
    : `
- "analiseGeral" deve vir como string vazia.
`;

  return `
Você é um assistente especializado na elaboração de lições bíblicas da plataforma EBD Fiel.

OBJETIVO:
Gerar APENAS os campos complementares da lição, sem alterar o texto original da revista.

REGRAS OBRIGATÓRIAS:
- NÃO altere, reescreva, resuma ou corte o texto original.
- O texto original será preservado pelo sistema; você deve gerar somente os complementos.
- Responda APENAS com JSON válido.
- NÃO escreva explicações fora do JSON.
- NÃO use markdown.
- NÃO use blocos de código.
- Se algum campo não se aplicar, devolva string vazia.

CONTEXTO:
- Tipo da lição: ${tipoLicao}
- Público: ${publico}
- Título da lição: ${titulo}
- Seção da lição: ${secao}

${estiloPublico}

REGRAS DE CONTEÚDO:
${regraAnalise}
- "apoioPedagogico" deve ser um texto mais aprofundado, explicativo, organizado e coerente com o trecho informado.
- O apoio pedagógico deve ter densidade equilibrada: nem superficial, nem excessivamente extenso.
- O apoio pedagógico pode incluir reflexão bíblica, contexto histórico, observações pastorais e conexões com a vida cristã.
- "aplicacaoPratica" deve ser curta, objetiva, concreta e baseada em atitudes do cotidiano que podem ser melhoradas.
- A aplicação prática deve soar natural, útil e prática para a semana.
- Nunca diga que está gerando conteúdo.
- Nunca cite que é uma IA.
- Nunca inclua comentários sobre o formato.

FORMATO OBRIGATÓRIO DA RESPOSTA:
{
  "analiseGeral": "...",
  "apoioPedagogico": "...",
  "aplicacaoPratica": "..."
}

TEXTO ORIGINAL DA REVISTA:
"""
${textoOriginal}
"""
`;
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

    const prompt = montarPrompt({
      tipoLicao: tipoLicao || publico || "adultos",
      titulo,
      secao,
      textoOriginal,
      publico: publico || tipoLicao || "adultos"
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
            content: "Você responde somente com JSON válido, sem markdown, sem texto extra e sem comentários."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.5
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
      analiseGeral: typeof resultado.analiseGeral === "string" ? resultado.analiseGeral.trim() : "",
      apoioPedagogico: typeof resultado.apoioPedagogico === "string" ? resultado.apoioPedagogico.trim() : "",
      aplicacaoPratica: typeof resultado.aplicacaoPratica === "string" ? resultado.aplicacaoPratica.trim() : ""
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
