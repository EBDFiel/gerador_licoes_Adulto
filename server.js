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

function normalizeText(text = '') {
    return String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

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

    function extractTopicos() {
        const regex = /(\d+)\.\s+([^\n]+)([\s\S]*?)(?=\n\d+\.|\nCONCLUSÃO|$)/g;
        let match;
        let topicos = [];

        while ((match = regex.exec(text)) !== null) {
            const numero = match[1];
            const tituloTopico = match[2].trim();
            const conteudo = match[3].trim();

            const subRegex = new RegExp(`${numero}\\.(\\d+)\\.\\s+([^\\n]+)([\\s\\S]*?)(?=\\n${numero}\\.\\d+\\.|\\n\\d+\\.|\\nCONCLUSÃO|$)`, 'g');

            let subtopicos = [];
            let subMatch;

            while ((subMatch = subRegex.exec(conteudo)) !== null) {
                const subNumero = `${numero}.${subMatch[1]}`;
                const subTitulo = subMatch[2].trim();
                const subConteudoRaw = subMatch[3].trim();

                const euEnsineiMatch = subConteudoRaw.match(/EU ENSINEI QUE\s*:?\s*(.+)/i);

                subtopicos.push({
                    numero: subNumero,
                    titulo: subTitulo,
                    conteudo: subConteudoRaw.replace(/EU ENSINEI QUE.*$/i, '').trim(),
                    euEnsineiQue: euEnsineiMatch ? euEnsineiMatch[1].trim() : '',
                    apoioPedagogico: '',
                    aplicacaoPratica: ''
                });
            }

            topicos.push({
                numero,
                titulo: tituloTopico,
                conteudo,
                apoioPedagogico: '',
                aplicacaoPratica: '',
                subtopicos
            });
        }

        return topicos;
    }

    return {
        titulo,
        textoAureoOuVersiculo: '',
        verdadeAplicada: '',
        textosReferencia: '',
        analiseGeral: '',
        introducao: {
            conteudo: extractSection(text, /INTRODUÇÃO\s*:?\s*/i, [/^\s*1\./im]),
            apoioPedagogico: '',
            aplicacaoPratica: ''
        },
        topicos: extractTopicos(),
        conclusao: {
            conteudo: extractSection(text, /CONCLUSÃO\s*:?\s*/i),
            apoioPedagogico: '',
            aplicacaoPratica: ''
        },
        publico
    };
}

async function applyPedagogicalCompletion(structuredLesson) {
    if (!DEEPSEEK_API_KEY) {
        return structuredLesson;
    }

    const prompt = `
Você é especialista em EBD.

REGRAS:
- NÃO ALTERAR conteúdo original
- COMPLEMENTAR com:
  - analiseGeral
  - apoioPedagogico
  - aplicacaoPratica
- JSON válido apenas

DADOS:
${JSON.stringify(structuredLesson)}
`;

    const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [{ role: 'user', content: prompt }]
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

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        model: DEEPSEEK_MODEL,
        cache_items: generationCache.size
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
