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

async function requestLessonGeneration({ provider, prompt, sourceText, metadata }) {
  const config = getProviderConfig(provider);
  if (!config.apiKey) {
    throw new Error(`${config.provider === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY"} não configurada no Render.`);
  }

  const userMessage = [
    "DADOS DA LIÇÃO SELECIONADA NO ADMIN EBD FIEL V2:",
    `Classe: ${metadata.classLabel || metadata.classKey || ""}`,
    `Ano: ${metadata.year || ""}`,
    `Trimestre: ${metadata.trimester || ""}`,
    `Número da lição: ${metadata.number || ""}`,
    `Título: ${metadata.title || ""}`,
    `Data: ${metadata.date || ""}`,
    "",
    "CONTEÚDO ORIGINAL DA REVISTA:",
    String(sourceText || "").trim()
  ].join("\n");

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
      temperature: Number(process.env.EBD_V2_TEMPERATURE || 0.25),
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
  requestLessonGeneration
};
