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

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;
const MAX_CACHE_ITEMS = 100;

const generationCache = new Map();

/* ==================== CACHE ==================== */
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
        generationCache.delete(oldestKey);
    }
    generationCache.set(key, { value, createdAt: Date.now() });
}

/* ==================== UTIL ==================== */
function normalizeText(text = '') {
    return String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

/* ==================== IA (NOVO) ==================== */
app.post('/ia', async (req, res) => {
    try {
        const pergunta = normalizeText(req.body?.pergunta || '');

        if (!pergunta) {
            return res.status(400).json({ erro: 'Pergunta não enviada.' });
        }

        if (!DEEPSEEK_API_KEY) {
            return res.status(500).json({ erro: 'Chave DeepSeek não configurada.' });
        }

        const promptSistema = `
Você é um assistente bíblico da plataforma EBD Fiel.

REGRAS:
- Responda com base na Bíblia
- Seja claro e objetivo
- Use linguagem simples
- Traga aplicação prática quando possível
- Não invente versículos
        `.trim();

        const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [
                    { role: 'system', content: promptSistema },
                    { role: 'user', content: pergunta }
                ],
                temperature: 0.7
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Erro DeepSeek:', data);
            return res.status(500).json({ erro: 'Erro na IA.' });
        }

        const resposta = data?.choices?.[0]?.message?.content || 'Sem resposta';

        res.json({ resposta });

    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro interno na IA.' });
    }
});

/* ==================== GERADOR DE LIÇÃO ==================== */
function extractSection(text, start, endList = []) {
    const startMatch = text.match(start);
    if (!startMatch) return '';

    let cut = text.slice(startMatch.index + startMatch[0].length);
    let endIndex = cut.length;

    for (const end of endList) {
        const m = cut.match(end);
        if (m && m.index < endIndex) endIndex = m.index;
    }

    return cut.slice(0, endIndex).trim();
}

function parseOriginalLesson({ titulo, textoOriginal, publico }) {
    const text = normalizeText(textoOriginal);

    return {
        titulo,
        introducao: {
            conteudo: extractSection(text, /INTRODUÇÃO\s*:?\s*/i, [/^\s*1\./im])
        },
        conclusao: {
            conteudo: extractSection(text, /CONCLUSÃO\s*:?\s*/i)
        },
        publico
    };
}

async function applyPedagogicalCompletion(structuredLesson) {
    if (!DEEPSEEK_API_KEY) return structuredLesson;

    const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
                {
                    role: 'user',
                    content: JSON.stringify(structuredLesson)
                }
            ]
        })
    });

    const data = await response.json();

    try {
        return JSON.parse(data.choices[0].message.content);
    } catch {
        return structuredLesson;
    }
}

app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const payload = req.body;
        const cacheKey = createCacheKey(payload);

        const cached = getCache(cacheKey);
        if (cached) return res.json(cached);

        let structured = parseOriginalLesson(payload);
        structured = await applyPedagogicalCompletion(structured);

        setCache(cacheKey, structured);

        res.json(structured);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao gerar lição' });
    }
});

/* ==================== HEALTH ==================== */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        model: DEEPSEEK_MODEL
    });
});

/* ==================== START ==================== */
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
