"use strict";

const { requestLessonGeneration, normalizeProvider } = require("./provider-client");
const { validateSource, validateHtml, normalizeClassKey } = require("./html-validator");
const { importUrl } = require("./url-importer");

const CLASS_LABELS = {
  adult: "Adultos",
  youth: "Jovens",
  teen: "Adolescentes",
  preteen: "Pré-adolescentes"
};

function cleanMetadata(body = {}) {
  const metadata = body.metadata || {};
  const classKey = normalizeClassKey(body.classKey || metadata.classKey);
  return {
    classKey,
    classLabel: CLASS_LABELS[classKey],
    year: Number(metadata.year || metadata.ano || new Date().getFullYear()),
    trimester: Number(metadata.trimester || metadata.trimestre || 1),
    number: Number(metadata.number || metadata.numero || 0),
    title: String(metadata.title || metadata.titulo || "").trim(),
    date: String(metadata.date || metadata.data || "").trim()
  };
}

function registerV2Routes(app) {
  app.get("/api/v2/health", (_req, res) => {
    return res.json({
      ok: true,
      version: "admin-v2-20260804a",
      status: "online",
      classes: Object.keys(CLASS_LABELS),
      providers: {
        openai: Boolean(process.env.OPENAI_API_KEY),
        deepseek: Boolean(process.env.DEEPSEEK_API_KEY)
      },
      importUrl: true
    });
  });

  app.post("/api/v2/source/import-url", async (req, res) => {
    try {
      const url = String(req.body?.url || "").trim();
      if (!url) return res.status(400).json({ ok: false, error: "Informe a URL da lição." });
      const result = await importUrl(url);
      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error("Erro /api/v2/source/import-url:", error);
      return res.status(400).json({ ok: false, error: error.message || "Não foi possível importar o link." });
    }
  });

  app.post("/api/v2/validate", (req, res) => {
    try {
      const metadata = cleanMetadata(req.body || {});
      const html = String(req.body?.html || "");
      const validation = validateHtml({ html, classKey: metadata.classKey, metadata });
      return res.json({ ok: true, validation, approved: validation.errors.length === 0 });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message || "Falha na validação." });
    }
  });

  app.post("/api/v2/generate", async (req, res) => {
    try {
      const metadata = cleanMetadata(req.body || {});
      const provider = normalizeProvider(req.body?.provider);
      const prompt = String(req.body?.prompt || "").trim();
      const sourceText = String(req.body?.sourceText || "").trim();
      const promptVersion = req.body?.promptVersion || {};

      if (prompt.length < 500) {
        return res.status(400).json({ ok: false, error: "O prompt ativo está vazio ou muito curto." });
      }
      if (prompt.length > Number(process.env.EBD_V2_PROMPT_MAX_CHARS || 100000)) {
        return res.status(400).json({ ok: false, error: "O prompt excede o limite permitido." });
      }

      const sourceValidation = validateSource({
        number: metadata.number,
        title: metadata.title,
        sourceText
      });
      if (sourceValidation.errors.length) {
        return res.status(400).json({
          ok: false,
          error: sourceValidation.errors[0],
          validation: sourceValidation
        });
      }

      const generated = await requestLessonGeneration({ provider, prompt, sourceText, metadata });
      if (!generated.html) {
        return res.status(502).json({ ok: false, error: "O provedor não retornou um HTML utilizável." });
      }

      const htmlValidation = validateHtml({
        html: generated.html,
        classKey: metadata.classKey,
        metadata
      });
      const validation = {
        errors: htmlValidation.errors,
        warnings: [...new Set([...(sourceValidation.warnings || []), ...(htmlValidation.warnings || [])])]
      };

      return res.json({
        ok: true,
        approved: validation.errors.length === 0,
        classKey: metadata.classKey,
        provider: generated.provider,
        model: generated.model,
        promptVersion: {
          id: String(promptVersion.id || "default"),
          name: String(promptVersion.name || "Padrão original")
        },
        metadata,
        html: generated.html,
        validation,
        finishReason: generated.finishReason,
        usage: generated.usage,
        generatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error("Erro /api/v2/generate:", error);
      return res.status(500).json({ ok: false, error: error.message || "Erro interno na geração V2." });
    }
  });
}

module.exports = registerV2Routes;
