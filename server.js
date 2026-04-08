const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 1000 * 60 * 60 * 6);
const MAX_CACHE_ITEMS = Number(process.env.MAX_CACHE_ITEMS || 100);
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 1000 * 90);

const generationCache = new Map();

function stripHtml(text = '') {
    return String(text || '').replace(/<[^>]*>/g, '').trim();
}

function createCacheKey(payload) {
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function getCache(key) {
    const entry = generationCache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
        generationCache.delete(key);
        return null;
    }

    return entry.value;
}

function setCache(key, value) {
    if (generationCache.size >= MAX_CACHE_ITEMS) {
        const oldestKey = generationCache.keys().next().value;
        if (oldestKey) generationCache.delete(oldestKey);
    }

    generationCache.set(key, { value, createdAt: Date.now() });
}

function safeString(value) {
    return String(value || '').trim();
}

function normalizeWhitespace(text = '') {
    return String(text || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function removeCodeFences(text = '') {
    return String(text || '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function extractJsonFromText(text = '') {
    const cleaned = removeCodeFences(text);
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) throw new Error('JSON inválido');
    return cleaned.slice(firstBrace, lastBrace + 1);
}

function parseJsonSafely(text = '') {
    return JSON.parse(extractJsonFromText(text));
}

function normalizeLessonStructure(data, { titulo, textoOriginal, publico }) {
    const src = data || {};
    const incomingTopics = Array.isArray(src.topicos) ? src.topicos : [];

    return {
        numero: safeString(src.numero),
        titulo: safeString(src.titulo),
        textoAureoOuVersiculo: safeString(src.textoAureoOuVersiculo),
        verdadeAplicada: safeString(src.verdadeAplicada),
        textosReferencia: safeString(src.textosReferencia),
        analiseGeral: safeString(src.analiseGeral),

        introducao: {
            conteudo: stripHtml(src.introducao?.conteudo),
            apoioPedagogico: safeString(src.introducao?.apoioPedagogico),
            aplicacaoPratica: safeString(src.introducao?.aplicacaoPratica)
        },

        topicos: incomingTopics.map(t => ({
            numero: safeString(t.numero),
            titulo: safeString(t.titulo),
            conteudo: stripHtml(t.conteudo),
            apoioPedagogico: safeString(t.apoioPedagogico),
            aplicacaoPratica: safeString(t.aplicacaoPratica),

            subtopicos: (t.subtopicos || []).map(s => ({
                numero: safeString(s.numero),
                titulo: safeString(s.titulo),
                conteudo: stripHtml(s.conteudo),
                euEnsineiQue: safeString(s.euEnsineiQue),
                apoioPedagogico: safeString(s.apoioPedagogico),
                aplicacaoPratica: safeString(s.aplicacaoPratica)
            }))
        })),

        conclusao: {
            conteudo: stripHtml(src.conclusao?.conteudo),
            apoioPedagogico: safeString(src.conclusao?.apoioPedagogico),
            aplicacaoPratica: safeString(src.conclusao?.aplicacaoPratica)
        }
    };
}

async function callDeepSeek(prompt) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
        const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                max_tokens: 6000
            }),
            signal: controller.signal
        });

        const data = await response.json();
        return data?.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timeoutId);
    }
}

function buildPrompt({ titulo, textoOriginal, publico }) {
    return `
RETORNE SOMENTE JSON.
NUNCA USE HTML.

${textoOriginal}
`;
}

app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { textoOriginal, titulo = '', publico = 'adultos' } = req.body;

       const cacheKey = createCacheKey({ textoOriginal, titulo, publico });

// const cached = getCache(cacheKey);
// if (cached) return res.json({ licao: cached });

        const prompt = buildPrompt({ titulo, textoOriginal, publico });

        let parsed;
        try {
            const aiRaw = await callDeepSeek(prompt);
            parsed = parseJsonSafely(aiRaw);
        } catch {
            return res.status(500).json({ error: 'Erro na IA' });
        }

        const normalized = normalizeLessonStructure(parsed, {
            titulo,
            textoOriginal,
            publico
        });

        setCache(cacheKey, normalized);

        res.json({ licao: normalized });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
