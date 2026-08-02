"use strict";

const PROVIDER_URLS = Object.freeze({
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions"
});

async function requestChatCompletion({
  provider,
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  topP,
  frequencyPenalty,
  presencePenalty
}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const url = PROVIDER_URLS[normalizedProvider];
  if (!url) throw new Error(`Provedor de IA não suportado: ${provider || "não informado"}.`);
  if (!apiKey) throw new Error(`Chave do provedor ${normalizedProvider} não configurada.`);
  if (!Array.isArray(messages) || !messages.length) throw new Error("Mensagens da IA não informadas.");

  const payload = { model, messages };
  if (Number.isFinite(Number(temperature))) payload.temperature = Number(temperature);
  if (Number.isFinite(Number(maxTokens))) payload.max_tokens = Number(maxTokens);
  if (Number.isFinite(Number(topP))) payload.top_p = Number(topP);
  if (Number.isFinite(Number(frequencyPenalty))) payload.frequency_penalty = Number(frequencyPenalty);
  if (Number.isFinite(Number(presencePenalty))) payload.presence_penalty = Number(presencePenalty);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Erro ${normalizedProvider} HTTP ${response.status}`);
    error.status = response.status;
    error.provider = normalizedProvider;
    error.payload = data;
    throw error;
  }

  return {
    content: String(data?.choices?.[0]?.message?.content || ""),
    finishReason: data?.choices?.[0]?.finish_reason || "unknown",
    usage: data?.usage || null,
    model: data?.model || model,
    raw: data
  };
}

module.exports = { requestChatCompletion };
