const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "ebd-gerador-blindado" });
});

function normalizarLinhas(texto) {
  return String(texto || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractBlock(texto, startRegex, endRegexList = []) {
  const startMatch = texto.match(startRegex);
  if (!startMatch) return "";

  const startIndex = startMatch.index + startMatch[0].length;
  const rest = texto.slice(startIndex);

  let endIndex = rest.length;

  for (const regex of endRegexList) {
    const m = rest.match(regex);
    if (m && typeof m.index === "number" && m.index < endIndex) {
      endIndex = m.index;
    }
  }

  return rest.slice(0, endIndex).trim();
}

function parseTopsAndSubs(texto) {
  const lines = texto.split("\n");
  const items = [];
  let currentTop = null;
  let currentSub = null;

  const pushCurrentSub = () => {
    if (currentSub) {
      currentSub.conteudo = currentSub.conteudo.trim();
      currentTop.subs.push(currentSub);
      currentSub = null;
    }
  };

  const pushCurrentTop = () => {
    if (currentTop) {
      pushCurrentSub();
      currentTop.conteudo = currentTop.conteudo.trim();
      items.push(currentTop);
      currentTop = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (currentSub) currentSub.conteudo += "\n\n";
      else if (currentTop) currentTop.conteudo += "\n\n";
      continue;
    }

    const subMatch = line.match(/^(\d+\.\d+\.)\s+(.*)$/);
    const topMatch = line.match(/^(\d+\.)\s+(.*)$/);

    if (subMatch) {
      if (!currentTop) {
        currentTop = {
          titulo: "",
          conteudo: "",
          subs: []
        };
      }
      pushCurrentSub();
      currentSub = {
        titulo: `${subMatch[1]} ${subMatch[2]}`.trim(),
        conteudo: ""
      };
      continue;
    }

    if (topMatch && !line.match(/^\d+\.\d+\./)) {
      pushCurrentTop();
      currentTop = {
        titulo: `${topMatch[1]} ${topMatch[2]}`.trim(),
        conteudo: "",
        subs: []
      };
      continue;
    }

    if (currentSub) {
      currentSub.conteudo += (currentSub.conteudo ? "\n" : "") + line;
    } else if (currentTop) {
      currentTop.conteudo += (currentTop.conteudo ? "\n" : "") + line;
    }
  }

  pushCurrentTop();
  return items;
}

function extrairEstruturaRevista(textoOriginal, tituloInformado) {
  const texto = normalizarLinhas(textoOriginal);

  const tituloExtraido = tituloInformado || "Lição";

  const textoAureo = extractBlock(
    texto,
    /TEXTO ÁUREO\s*[:\-]?\s*/i,
    [/VERDADE APLICADA\s*[:\-]?/i, /TEXTOS DE REFERÊNCIA/i]
  );

  const verdadeAplicada = extractBlock(
    texto,
    /VERDADE APLICADA\s*[:\-]?\s*/i,
    [/TEXTOS DE REFERÊNCIA/i, /INTRODUÇÃO\s*[:\-]?/i]
  );

  const textosReferencia = extractBlock(
    texto,
    /TEXTOS DE REFERÊNCIA\s*[:\-]?\s*/i,
    [/ANÁLISE GERAL\s*[:\-]?/i, /INTRODUÇÃO\s*[:\-]?/i, /\n\s*1\.\s+/i]
  );

  const introducao = extractBlock(
    texto,
    /INTRODUÇÃO\s*[:\-]?\s*/i,
    [/\n\s*1\.\s+/i]
  );

  const conclusao = extractBlock(
    texto,
    /CONCLUSÃO\s*[:\-]?\s*/i,
    []
  );

  const corpoEntreIntroEConclusao = extractBlock(
    texto,
    /INTRODUÇÃO\s*[:\-]?\s*[\s\S]*?/i,
    [/CONCLUSÃO\s*[:\-]?/i]
  );

  const topicos = parseTopsAndSubs(corpoEntreIntroEConclusao);

  return {
    titulo: tituloExtraido.trim(),
    textoAureo: textoAureo.trim(),
    verdadeAplicada: verdadeAplicada.trim(),
    textosReferencia: textosReferencia.trim(),
    introducao: introducao.trim(),
    conclusao: conclusao.trim(),
    topicos
  };
}

function montarEsqueletoFixo(estrutura) {
  const linhas = [];

  linhas.push(`${estrutura.titulo}`);
  linhas.push(`TEXTO ÁUREO:`);
  linhas.push(estrutura.textoAureo || "");
  linhas.push(`VERDADE APLICADA:`);
  linhas.push(estrutura.verdadeAplicada || "");
  linhas.push(`TEXTOS DE REFERÊNCIA`);
  linhas.push(estrutura.textosReferencia || "");
  linhas.push(`ANÁLISE GERAL:`);
  linhas.push(`[[ANALISE_GERAL]]`);
  linhas.push(`INTRODUÇÃO:`);
  linhas.push(estrutura.introducao || "");
  linhas.push(`APOIO PEDAGÓGICO:`);
  linhas.push(`[[INTRODUCAO_APOIO_PEDAGOGICO]]`);
  linhas.push(`APLICAÇÃO PRÁTICA:`);
  linhas.push(`[[INTRODUCAO_APLICACAO_PRATICA]]`);

  estrutura.topicos.forEach((topico, topIndex) => {
    linhas.push(`${topico.titulo}`);
    if (topico.conteudo) {
      linhas.push(topico.conteudo);
    }

    topico.subs.forEach((sub, subIndex) => {
      linhas.push(`${sub.titulo}`);

      let conteudoSemEnsinei = sub.conteudo || "";
      let blocoEuEnsinei = "";

      const euEnsineiMatch = conteudoSemEnsinei.match(/EU ENSINEI QUE\s*[:\-]?\s*([\s\S]*)/i);
      if (euEnsineiMatch) {
        blocoEuEnsinei = euEnsineiMatch[1].trim();
        conteudoSemEnsinei = conteudoSemEnsinei
          .replace(/EU ENSINEI QUE\s*[:\-]?\s*([\s\S]*)/i, "")
          .trim();
      }

      if (conteudoSemEnsinei) {
        linhas.push(conteudoSemEnsinei);
      }

      if (blocoEuEnsinei) {
        linhas.push(`EU ENSINEI QUE:`);
        linhas.push(blocoEuEnsinei);
      }

      linhas.push(`APOIO PEDAGÓGICO:`);
      linhas.push(`[[TOPICO_${topIndex + 1}_${subIndex + 1}_APOIO_PEDAGOGICO]]`);
      linhas.push(`APLICAÇÃO PRÁTICA:`);
      linhas.push(`[[TOPICO_${topIndex + 1}_${subIndex + 1}_APLICACAO_PRATICA]]`);
    });
  });

  linhas.push(`CONCLUSÃO:`);
  linhas.push(estrutura.conclusao || "");
  linhas.push(`APOIO PEDAGÓGICO:`);
  linhas.push(`[[CONCLUSAO_APOIO_PEDAGOGICO]]`);
  linhas.push(`APLICAÇÃO PRÁTICA:`);
  linhas.push(`[[CONCLUSAO_APLICACAO_PRATICA]]`);

  return linhas.join("\n");
}

function montarPromptBlindado({ esqueleto, publico }) {
  const tipoPublico = String(publico || "").toLowerCase() === "jovens" ? "jovens" : "adultos";

  return `
Você é um assistente especializado em elaboração de lições bíblicas da EBD Fiel.

MISSÃO:
Preencher APENAS os marcadores do esqueleto abaixo, sem alterar nenhum outro texto.

REGRA MÁXIMA:
- O esqueleto abaixo já contém o conteúdo original da revista.
- Você NÃO pode alterar nenhuma linha que já exista.
- Você NÃO pode mudar títulos.
- Você NÃO pode mudar subtítulos.
- Você NÃO pode mudar a ordem.
- Você NÃO pode remover itens.
- Você NÃO pode acrescentar novos blocos.
- Você NÃO pode resumir o texto original.
- Você NÃO pode reescrever o texto original.
- Você só pode substituir os marcadores [[...]] pelos textos gerados.

PÚBLICO:
${tipoPublico}

ESTILO DOS TRECHOS GERADOS:
- ANALISE GERAL: bem desenvolvida, clara, consistente e abrangente.
- APOIO PEDAGÓGICO: mais abrangente, explicativo, útil para o professor, sem ser excessivamente longo.
- APLICAÇÃO PRÁTICA: curta, objetiva e relacionada ao cotidiano.
- Para adultos: linguagem madura, reverente, bíblica e pastoral.
- Para jovens: linguagem clara, bíblica, acessível e próxima da realidade juvenil.

REGRAS ABSOLUTAS:
- Preserve TUDO que já está escrito.
- Substitua SOMENTE os marcadores [[...]].
- Não altere "EU ENSINEI QUE".
- Não altere TEXTO ÁUREO.
- Não altere VERDADE APLICADA.
- Não altere TEXTOS DE REFERÊNCIA.
- Não altere INTRODUÇÃO.
- Não altere CONCLUSÃO.
- Responda APENAS com JSON válido.
- NÃO use markdown.
- NÃO use comentários.
- NÃO use blocos de código.

FORMATO OBRIGATÓRIO DA RESPOSTA:
{
  "licaoCompleta": "texto final completo com os marcadores substituídos"
}

ESQUELETO FIXO A SER PREENCHIDO:
"""
${esqueleto}
"""

VERIFICAÇÃO INTERNA ANTES DE RESPONDER:
1. Todos os títulos foram preservados exatamente?
2. Todos os subtítulos foram preservados exatamente?
3. A ordem foi preservada exatamente?
4. Apenas os marcadores [[...]] foram substituídos?
5. A resposta está em JSON válido?

Se qualquer resposta for "não", corrija antes de responder.
`;
}

function extrairJsonSeguro(texto) {
  if (!texto || typeof texto !== "string") {
    throw new Error("Resposta vazia da IA.");
  }

  let textoLimpo = texto.trim();

  textoLimpo = textoLimpo
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(textoLimpo);
  } catch (_) {}

  try {
    const desserializado = JSON.parse(textoLimpo);
    if (typeof desserializado === "string") {
      return JSON.parse(desserializado);
    }
    if (typeof desserializado === "object" && desserializado !== null) {
      return desserializado;
    }
  } catch (_) {}

  const match = textoLimpo.match(/\{[\s\S]*\}/);
  if (match) {
    const bloco = match[0];

    try {
      return JSON.parse(bloco);
    } catch (_) {}

    try {
      const desserializado = JSON.parse(bloco);
      if (typeof desserializado === "string") {
        return JSON.parse(desserializado);
      }
      if (typeof desserializado === "object" && desserializado !== null) {
        return desserializado;
      }
    } catch (_) {}
  }

  throw new Error("A IA retornou um formato inválido. Ajuste o prompt ou tente novamente.");
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

    const estrutura = extrairEstruturaRevista(textoOriginal, titulo);
    const esqueleto = montarEsqueletoFixo(estrutura);
    const prompt = montarPromptBlindado({
      esqueleto,
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
              "Você responde somente com JSON válido. Você deve obedecer rigorosamente ao esqueleto fornecido, sem alterar títulos, subtítulos, ordem ou conteúdo original."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2
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
        error: "Falha ao interpretar a resposta da IA."
      });
    }

    const licaoCompleta =
      typeof resultado.licaoCompleta === "string"
        ? resultado.licaoCompleta.trim()
        : "";

    if (!licaoCompleta) {
      return res.status(500).json({
        error: "A IA respondeu, mas não devolveu o campo licaoCompleta."
      });
    }

    return res.json({ licaoCompleta });
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
