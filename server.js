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

    generationCache.set(key, {
        value,
        createdAt: Date.now()
    });
}

/* ==================== UTIL ==================== */
function normalizeText(text = '') {
    return String(text)
        .replace(/\r/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function safeJsonParse(text, fallback = null) {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

function extractSection(text, start, endList = []) {
    const startMatch = text.match(start);
    if (!startMatch) return '';

    let cut = text.slice(startMatch.index + startMatch[0].length);
    let endIndex = cut.length;

    for (const end of endList) {
        const m = cut.match(end);
        if (m && m.index < endIndex) {
            endIndex = m.index;
        }
    }

    return cut.slice(0, endIndex).trim();
}

function parseOriginalLesson({ titulo, textoOriginal, publico, numero, trimestre, data }) {
    const text = normalizeText(textoOriginal);

    return {
        titulo: normalizeText(titulo || ''),
        numero: numero || '',
        trimestre: trimestre || '',
        data: data || '',
        publico: publico || 'adultos',
        textoOriginal: text,
        introducao: {
            conteudo: extractSection(text, /INTRODUÇÃO\s*:?\s*/i, [/^\s*1\./im, /^\s*I\./im, /^\s*CONCLUSÃO\s*:?\s*/im])
        },
        conclusao: {
            conteudo: extractSection(text, /CONCLUSÃO\s*:?\s*/i)
        }
    };
}

async function callDeepSeek(messages, temperature = 0.7, responseFormat = null) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('Chave DeepSeek não configurada.');
    }

    const body = {
        model: DEEPSEEK_MODEL,
        messages,
        temperature
    };

    if (responseFormat) {
        body.response_format = responseFormat;
    }

    const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('Erro DeepSeek:', data);
        throw new Error(data?.error?.message || 'Erro na IA.');
    }

    return data?.choices?.[0]?.message?.content || '';
}

/* ==================== IA BÁSICA ==================== */
app.post('/ia', async (req, res) => {
    try {
        const pergunta = normalizeText(req.body?.pergunta || '');

        if (!pergunta) {
            return res.status(400).json({ erro: 'Pergunta não enviada.' });
        }

        const promptSistema = `
Você é um assistente bíblico da plataforma EBD Fiel.

REGRAS:
- Responda com base na Bíblia
- Seja claro e objetivo
- Use linguagem simples
- Traga aplicação prática quando possível
- Não invente versículos
- Se citar texto bíblico, cite apenas referências confiáveis
        `.trim();

        const resposta = await callDeepSeek([
            { role: 'system', content: promptSistema },
            { role: 'user', content: pergunta }
        ], 0.7);

        res.json({ resposta });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: err.message || 'Erro interno na IA.' });
    }
});

/* ==================== COMPLEMENTO PEDAGÓGICO ==================== */
async function applyPedagogicalCompletion(structuredLesson) {
    if (!DEEPSEEK_API_KEY) return structuredLesson;

    const promptSistema = `
Você é um especialista em Escola Bíblica Dominical da plataforma EBD Fiel.

OBJETIVO:
Complementar pedagogicamente uma lição sem apagar nem contradizer o conteúdo original.

REGRAS IMPORTANTES:
- Preserve a fidelidade bíblica
- Não invente versículos
- Não remova o texto original
- Gere conteúdo útil para professor e aluno
- Linguagem clara, bíblica e organizada
- Responda SOMENTE em JSON válido

FORMATO JSON OBRIGATÓRIO:
{
  "titulo": "",
  "numero": "",
  "trimestre": "",
  "data": "",
  "publico": "",
  "textoOriginal": "",
  "introducao": { "conteudo": "" },
  "desenvolvimento": [
    {
      "topico": "",
      "explicacao": "",
      "aplicacao": ""
    }
  ],
  "conclusao": { "conteudo": "" },
  "apoioPedagogico": {
    "objetivoGeral": "",
    "objetivosEspecificos": [],
    "perguntaQuebraGelo": "",
    "aplicacaoPratica": "",
    "versiculosDeApoio": [],
    "fraseFinal": ""
  }
}
    `.trim();

    const content = await callDeepSeek([
        { role: 'system', content: promptSistema },
        { role: 'user', content: JSON.stringify(structuredLesson) }
    ], 0.5);

    return safeJsonParse(content, structuredLesson) || structuredLesson;
}

/* ==================== GERADOR DE LIÇÃO COMPLETA ==================== */
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const payload = req.body || {};
        const cacheKey = createCacheKey({ route: 'gerar-licao-completa', payload });

        const cached = getCache(cacheKey);
        if (cached) return res.json(cached);

        let structured = parseOriginalLesson(payload);
        structured = await applyPedagogicalCompletion(structured);

        setCache(cacheKey, structured);
        res.json(structured);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Erro ao gerar lição' });
    }
});

/* ==================== IA ADMIN EXCLUSIVA ==================== */
app.post('/api/admin/deepseek/generate', async (req, res) => {
    try {
        const {
            tipo = 'geral',
            publico = 'adultos',
            titulo = '',
            tema = '',
            objetivo = '',
            tom = 'claro e bíblico',
            formato = 'html',
            textoBase = '',
            instrucoes = ''
        } = req.body || {};

        const payload = {
            tipo,
            publico,
            titulo,
            tema,
            objetivo,
            tom,
            formato,
            textoBase: normalizeText(textoBase),
            instrucoes: normalizeText(instrucoes)
        };

        const cacheKey = createCacheKey({ route: 'admin-generate', payload });
        const cached = getCache(cacheKey);
        if (cached) return res.json(cached);

        const promptSistema = `
Você é o gerador oficial de conteúdo administrativo da plataforma EBD Fiel.

MISSÃO:
Criar conteúdos exclusivos para uso do administrador da plataforma, com fidelidade bíblica, clareza, organização e foco em Escola Bíblica Dominical.

TIPOS POSSÍVEIS:
- licao
- resumo
- introducao
- conclusao
- questionario
- aplicacao
- descricao
- roteiro
- html
- geral

REGRAS:
- Base bíblica sólida
- Linguagem clara e útil
- Não invente referências bíblicas
- Entregar conteúdo pronto para uso no painel
- Quando o formato for "html", retornar HTML limpo e sem <html>, <head> ou <body>
- Quando o formato for "markdown", retornar markdown limpo
- Quando o formato for "texto", retornar texto puro bem organizado
        `.trim();

        const promptUsuario = `
Gere um conteúdo com estas definições:

Tipo: ${tipo}
Público: ${publico}
Título: ${titulo}
Tema: ${tema}
Objetivo: ${objetivo}
Tom: ${tom}
Formato de saída: ${formato}

Texto base:
${payload.textoBase || '(sem texto base)'}

Instruções extras:
${payload.instrucoes || '(sem instruções extras)'}
        `.trim();

        const content = await callDeepSeek([
            { role: 'system', content: promptSistema },
            { role: 'user', content: promptUsuario }
        ], 0.7);

        const result = {
            ok: true,
            content,
            meta: {
                tipo,
                publico,
                formato,
                model: DEEPSEEK_MODEL
            }
        };

        setCache(cacheKey, result);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            ok: false,
            erro: err.message || 'Erro ao gerar conteúdo no admin.'
        });
    }
});

/* ==================== REFINAR TEXTO ADMIN ==================== */
app.post('/api/admin/deepseek/refinar', async (req, res) => {
    try {
        const {
            acao = 'melhorar',
            formato = 'html',
            texto = '',
            publico = 'adultos',
            instrucoes = ''
        } = req.body || {};

        const textoNormalizado = normalizeText(texto);

        if (!textoNormalizado) {
            return res.status(400).json({ ok: false, erro: 'Texto não enviado.' });
        }

        const promptSistema = `
Você é um editor bíblico da plataforma EBD Fiel.

OBJETIVO:
Refinar textos do administrador sem perder o sentido principal.

REGRAS:
- Corrigir clareza, organização e fluidez
- Manter fidelidade bíblica
- Não inventar versículos
- Respeitar o público informado
- Responder no formato solicitado
- Se formato for html, devolver HTML limpo e pronto para colar
        `.trim();

        const promptUsuario = `
Ação: ${acao}
Formato: ${formato}
Público: ${publico}

Texto:
${textoNormalizado}

Instruções extras:
${normalizeText(instrucoes)}
        `.trim();

        const content = await callDeepSeek([
            { role: 'system', content: promptSistema },
            { role: 'user', content: promptUsuario }
        ], 0.5);

        res.json({ ok: true, content });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            ok: false,
            erro: err.message || 'Erro ao refinar conteúdo.'
        });
    }
});

/* ==================== HEALTH ==================== */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        model: DEEPSEEK_MODEL,
        deepseekConfigured: Boolean(DEEPSEEK_API_KEY)
    });
});

/* ==================== START ==================== */
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
