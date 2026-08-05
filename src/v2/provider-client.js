"use strict";

function normalizeProvider(value) {
  return String(value || "openai").toLowerCase() === "deepseek" ? "deepseek" : "openai";
}

function getProviderConfig(provider) {
  const normalized = normalizeProvider(provider);
  if (normalized === "deepseek") {
    return {
      provider: "deepseek",
      apiKey: process.env.DEEPSEEK_API_KEY,
      endpoint: "https://api.deepseek.com/chat/completions",
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat"
    };
  }
  return {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY,
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
  };
}

function extractHtml(value = "") {
  let html = String(value || "").trim();
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = html.search(/<!DOCTYPE html>|<html[\s>]/i);
  if (start > 0) html = html.slice(start);
  const endMatch = html.match(/<\/html>/i);
  if (endMatch && typeof endMatch.index === "number") {
    html = html.slice(0, endMatch.index + endMatch[0].length);
  }
  return html.trim();
}

function buildYouthConfirmedFieldsBlock(structuredFields = {}) {
  const youth = structuredFields?.youth || {};
  const pointKey = String(youth.pointKey || "").trim();
  const reflecting = String(youth.reflecting || "").trim();
  const positionLabels = {
    "after-1.2-before-2": "depois do subtópico 1.2 e antes do Tópico 2",
    "after-introduction-before-1": "depois da Introdução e antes do Tópico 1",
    "after-topic-1-before-2": "depois do Tópico 1 e antes do Tópico 2",
    "after-topic-2-before-3": "depois do Tópico 2 e antes do Tópico 3",
    "after-topic-3-before-subsidy": "depois do Tópico 3 e antes do Subsídio para o Educador"
  };
  const position = positionLabels[youth.reflectingPosition] || positionLabels["after-1.2-before-2"];

  return [
    "CAMPOS DA CLASSE JOVENS CONFIRMADOS PELO ADMINISTRADOR:",
    "Estas informações são autoritativas e prevalecem sobre qualquer inferência feita a partir do texto-base.",
    `PONTO-CHAVE — COPIAR EXATAMENTE: ${pointKey || "[NÃO CONFIRMADO]"}`,
    reflecting
      ? `REFLETINDO — COPIAR EXATAMENTE: ${reflecting}`
      : "REFLETINDO: [NÃO FORNECIDO — NÃO CRIAR NEM DEDUZIR ESTE CAMPO]",
    `POSIÇÃO DO REFLETINDO: ${position}.`,
    "REGRAS CRÍTICAS:",
    "1. Nunca use a VERDADE APLICADA como PONTO-CHAVE.",
    "2. Nunca use texto do SUBSÍDIO PARA O EDUCADOR como REFLETINDO.",
    "3. Não altere, resuma, amplie ou reescreva o PONTO-CHAVE e o REFLETINDO.",
    "4. Preserve a posição indicada para o REFLETINDO.",
    "5. No SUBSÍDIO PARA O EDUCADOR, não use comandos diretos como 'o educador pode', 'o professor deve', 'peça aos alunos' ou equivalentes."
  ].join("\n");
}

function buildUserMessage({ sourceText, metadata, structuredFields = {} }) {
  const parts = [
    "DADOS DA LIÇÃO SELECIONADA NO ADMIN EBD FIEL V2:",
    `Classe: ${metadata.classLabel || metadata.classKey || ""}`,
    `Ano: ${metadata.year || ""}`,
    `Trimestre: ${metadata.trimester || ""}`,
    `Número da lição: ${metadata.number || ""}`,
    `Título: ${metadata.title || ""}`,
    `Data: ${metadata.date || ""}`
  ];

  if (String(metadata.classKey || "").toLowerCase() === "youth") {
    parts.push("", buildYouthConfirmedFieldsBlock(structuredFields));
  }

  parts.push("", "CONTEÚDO ORIGINAL DA REVISTA:", String(sourceText || "").trim());
  return parts.join("\n");
}

async function requestLessonGeneration({ provider, prompt, sourceText, metadata, structuredFields = {} }) {
  const config = getProviderConfig(provider);
  if (!config.apiKey) {
    throw new Error(`${config.provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"} não configurada no Render.`);
  }

  const userMessage = buildUserMessage({ sourceText, metadata, structuredFields });

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: String(prompt || "").trim() },
        { role: "user", content: userMessage }
      ],
      temperature: Number(process.env.EBD_V2_TEMPERATURE || 0.20),
      max_tokens: Number(process.env.EBD_V2_MAX_TOKENS || 16000)
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Falha ${response.status} no provedor de IA.`;
    throw new Error(message);
  }

  const content = data?.choices?.[0]?.message?.content || "";
  const html = extractHtml(content);
  return {
    provider: config.provider,
    model: config.model,
    html,
    finishReason: data?.choices?.[0]?.finish_reason || "",
    usage: data?.usage || null
  };
}

module.exports = {
  normalizeProvider,
  getProviderConfig,
  extractHtml,
  buildUserMessage,
  requestLessonGeneration
};
