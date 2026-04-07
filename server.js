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

function createCacheKey(payload) {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(payload))
        .digest('hex');
}

function getCache(key) {
    const entry = generationCache.get(key);
    if (!entry) return null;

    const expired = Date.now() - entry.createdAt > CACHE_TTL_MS;
    if (expired) {
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

    generationCache.set(key, {
        value,
        createdAt: Date.now()
    });
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

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error('Nenhum JSON encontrado na resposta da IA');
    }

    return cleaned.slice(firstBrace, lastBrace + 1);
}

function parseJsonSafely(text = '') {
    const raw = extractJsonFromText(text);
    return JSON.parse(raw);
}

function extractLessonNumber(title = '', originalText = '') {
    const joined = `${title}\n${originalText}`;
    const match = joined.match(/LIÇÃO\s+(\d+)/i) || joined.match(/LICAO\s+(\d+)/i);
    return match ? match[1] : '';
}

function extractLessonTitle(title = '', originalText = '') {
    const cleanTitle = safeString(title).replace(/^\s*LIÇÃO\s+\d+\s*[:\-]?\s*/i, '').trim();
    if (cleanTitle) return cleanTitle;

    const lines = String(originalText || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^(LIÇÃO|LICAO)\s+(\d+)(?:\s*[:\-]\s*(.*))?$/i);
        if (match && match[3]) return match[3].trim();
    }

    return '';
}

function extractBetween(text, startRegex, endRegexList = []) {
    const source = String(text || '');
    const startMatch = source.match(startRegex);
    if (!startMatch) return '';

    const startIndex = startMatch.index + startMatch[0].length;
    const tail = source.slice(startIndex);

    let endIndex = tail.length;
    for (const endRegex of endRegexList) {
        const match = tail.match(endRegex);
        if (match && typeof match.index === 'number') {
            endIndex = Math.min(endIndex, match.index);
        }
    }

    return normalizeWhitespace(tail.slice(0, endIndex));
}

function extractSimpleField(text, labels = []) {
    for (const label of labels) {
        const regex = new RegExp(`^\\s*${label}\\s*:?\\s*(.+)$`, 'im');
        const match = String(text || '').match(regex);
        if (match) return normalizeWhitespace(match[1]);
    }
    return '';
}

function extractMainTopics(text) {
    const lines = String(text || '').split('\n');
    const topics = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const match = line.match(/^(\d+)[\.\-]\s+(.+)$/);
        if (!match) continue;
        if (/^\d+\.\d+/.test(line)) continue;

        topics.push({
            numero: match[1],
            titulo: normalizeWhitespace(match[2])
        });
    }

    return topics.slice(0, 3);
}

function extractSubtopicsForTopic(text, topicNumber) {
    const lines = String(text || '').split('\n');
    const subtopics = [];

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        const regex = new RegExp(`^(${topicNumber}\\.\\d+)[\.\-]\\s+(.+)$`);
        const match = line.match(regex);
        if (!match) continue;

        subtopics.push({
            numero: match[1],
            titulo: normalizeWhitespace(match[2])
        });
    }

    return subtopics.slice(0, 2);
}

function ensureThreeTopics(text) {
    const found = extractMainTopics(text);

    while (found.length < 3) {
        const next = found.length + 1;
        found.push({
            numero: String(next),
            titulo: `Tópico ${next}`
        });
    }

    return found.slice(0, 3).map(topic => {
        const subtopics = extractSubtopicsForTopic(text, topic.numero);

        while (subtopics.length < 2) {
            const next = subtopics.length + 1;
            subtopics.push({
                numero: `${topic.numero}.${next}`,
                titulo: `Subtópico ${topic.numero}.${next}`
            });
        }

        return {
            ...topic,
            subtopicos: subtopics.slice(0, 2)
        };
    });
}

function extractSectionContent(text, headingRegex, stopRegexes = []) {
    return extractBetween(text, headingRegex, stopRegexes);
}

function extractEuEnsineiQueForTopic(original, topicNumero) {
    return extractSectionContent(
        original,
        /EU ENSINEI QUE\s*:?\s*/i,
        [
            new RegExp(`^\\s*${Number(topicNumero) + 1}[\\.-]\\s+`, 'im'),
            /^\s*CONCLUSÃO\s*:?\s*/im
        ]
    );
}

function fallbackBuildStructuredLesson({ titulo, textoOriginal, publico }) {
    const original = normalizeWhitespace(textoOriginal);
    const lessonNumber = extractLessonNumber(titulo, original);
    const lessonTitle = extractLessonTitle(titulo, original);
    const ensuredTopics = ensureThreeTopics(original);

    const textoAureoOuVersiculo =
        extractSimpleField(original, ['TEXTO ÁUREO', 'TEXTO AUREO', 'VERSÍCULO DO DIA', 'VERSICULO DO DIA']) || '';

    const verdadeAplicada = extractSimpleField(original, ['VERDADE APLICADA']) || '';
    const textosReferencia = extractSimpleField(original, ['TEXTOS DE REFERÊNCIA', 'TEXTOS DE REFERENCIA']) || '';

    const introducaoConteudo = extractSectionContent(
        original,
        /INTRODUÇÃO\s*:?\s*/i,
        [/^\s*1[\.\-]\s+/im, /^\s*CONCLUSÃO\s*:?\s*/im]
    );

    const conclusaoConteudo = extractSectionContent(
        original,
        /CONCLUSÃO\s*:?\s*/i,
        []
    );

    function topicBlock(topicNumber) {
        return extractSectionContent(
            original,
            new RegExp(`^\\s*${topicNumber}[\\.-]\\s+`, 'im'),
            [
                new RegExp(`^\\s*${topicNumber}\\.1[\\.-]\\s+`, 'im'),
                new RegExp(`^\\s*${topicNumber}\\.2[\\.-]\\s+`, 'im'),
                new RegExp(`^\\s*${Number(topicNumber) + 1}[\\.-]\\s+`, 'im'),
                /^\s*CONCLUSÃO\s*:?\s*/im
            ]
        );
    }

    function subtopicBlock(subtopicNumber, nextStops = []) {
        return extractSectionContent(
            original,
            new RegExp(`^\\s*${subtopicNumber}[\\.-]\\s+`, 'im'),
            nextStops
        );
    }

    function generateFallbackApoio(baseTitle) {
        if (publico === 'jovens') {
            return `O professor pode apresentar ${baseTitle} com linguagem acessível, exemplos atuais e diálogo que conecte o conteúdo bíblico à realidade do jovem.`;
        }
        return `O professor pode conduzir ${baseTitle} destacando os princípios bíblicos centrais, incentivando reflexão, participação da classe e aplicação prática.`;
    }

    function generateFallbackAplicacao(baseTitle) {
        if (publico === 'jovens') {
            return `Os alunos devem refletir sobre como ${baseTitle.toLowerCase()} se aplica às decisões, relacionamentos e testemunho cristão no dia a dia.`;
        }
        return `A classe deve identificar formas práticas de aplicar ${baseTitle.toLowerCase()} na rotina, fortalecendo a vida cristã e a obediência à Palavra.`;
    }

    function generateFallbackAnalise() {
        if (publico === 'jovens') {
            return `Esta lição apresenta princípios bíblicos importantes para a formação espiritual do jovem, mostrando que a Palavra de Deus continua atual e relevante. O conteúdo estimula reflexão sobre escolhas, fé prática, identidade cristã e compromisso com Deus. Ao longo da lição, o aluno é conduzido a compreender que o ensino bíblico precisa ser vivido de forma concreta em sua realidade diária.`;
        }
        return `Esta lição destaca princípios bíblicos essenciais para a edificação cristã, enfatizando a importância de compreender e aplicar a Palavra de Deus. O conteúdo conduz o aluno a uma visão mais profunda do tema estudado, fortalecendo a fé, a maturidade espiritual e a prática cristã. Ao longo da lição, os tópicos oferecem base doutrinária e direcionamento prático para a vida diária.`;
    }

    const topicos = ensuredTopics.map((topic) => {
        const topicContent = topicBlock(topic.numero);
        const st1 = topic.subtopicos[0];
        const st2 = topic.subtopicos[1];

        const st1Content = subtopicBlock(st1.numero, [
            new RegExp(`^\\s*${st2.numero}[\\.-]\\s+`, 'im'),
            /^\s*EU ENSINEI QUE\s*:?\s*/im,
            new RegExp(`^\\s*${Number(topic.numero) + 1}[\\.-]\\s+`, 'im'),
            /^\s*CONCLUSÃO\s*:?\s*/im
        ]);

        const st2Content = subtopicBlock(st2.numero, [
            /^\s*EU ENSINEI QUE\s*:?\s*/im,
            new RegExp(`^\\s*${Number(topic.numero) + 1}[\\.-]\\s+`, 'im'),
            /^\s*CONCLUSÃO\s*:?\s*/im
        ]);

        const euEnsineiQue = extractEuEnsineiQueForTopic(original, topic.numero);

        return {
            numero: topic.numero,
            titulo: topic.titulo,
            conteudo: topicContent || '',
            apoioPedagogico: generateFallbackApoio(`o tópico ${topic.numero}`),
            aplicacaoPratica: generateFallbackAplicacao(`o tópico ${topic.numero}`),
            subtopicos: [
                {
                    numero: st1.numero,
                    titulo: st1.titulo,
                    conteudo: st1Content || '',
                    apoioPedagogico: generateFallbackApoio(`o subtópico ${st1.numero}`),
                    aplicacaoPratica: generateFallbackAplicacao(`o subtópico ${st1.numero}`),
                    euEnsineiQue: ''
                },
                {
                    numero: st2.numero,
                    titulo: st2.titulo,
                    conteudo: st2Content || '',
                    euEnsineiQue: euEnsineiQue || '',
                    apoioPedagogico: generateFallbackApoio(`o subtópico ${st2.numero}`),
                    aplicacaoPratica: generateFallbackAplicacao(`o subtópico ${st2.numero}`)
                }
            ]
        };
    });

    return {
        numero: lessonNumber,
        titulo: lessonTitle,
        textoAureoOuVersiculo,
        verdadeAplicada,
        textosReferencia,
        analiseGeral: generateFallbackAnalise(),
        introducao: {
            conteudo: introducaoConteudo || '',
            apoioPedagogico: generateFallbackApoio('a introdução'),
            aplicacaoPratica: generateFallbackAplicacao('a introdução')
        },
        topicos,
        conclusao: {
            conteudo: conclusaoConteudo || '',
            apoioPedagogico: generateFallbackApoio('a conclusão'),
            aplicacaoPratica: generateFallbackAplicacao('a conclusão')
        }
    };
}

function normalizeLessonStructure(data, { titulo, textoOriginal, publico }) {
    const fallback = fallbackBuildStructuredLesson({ titulo, textoOriginal, publico });
    const src = data || {};
    const incomingTopics = Array.isArray(src.topicos) ? src.topicos : [];

    const normalizedTopics = fallback.topicos.map((fallbackTopic, index) => {
        const incomingTopic = incomingTopics[index] || {};
        const incomingSub = Array.isArray(incomingTopic.subtopicos) ? incomingTopic.subtopicos : [];

        return {
            numero: safeString(incomingTopic.numero || fallbackTopic.numero),
            titulo: safeString(incomingTopic.titulo || fallbackTopic.titulo),
            conteudo: safeString(incomingTopic.conteudo || fallbackTopic.conteudo),
            apoioPedagogico: safeString(incomingTopic.apoioPedagogico || fallbackTopic.apoioPedagogico),
            aplicacaoPratica: safeString(incomingTopic.aplicacaoPratica || fallbackTopic.aplicacaoPratica),
            subtopicos: fallbackTopic.subtopicos.map((fallbackSub, subIndex) => {
                const incomingSubtopic = incomingSub[subIndex] || {};
                const isSecond = subIndex === 1;
                return {
                    numero: safeString(incomingSubtopic.numero || fallbackSub.numero),
                    titulo: safeString(incomingSubtopic.titulo || fallbackSub.titulo),
                    conteudo: safeString(incomingSubtopic.conteudo || fallbackSub.conteudo),
                    euEnsineiQue: safeString(
                        isSecond
                            ? (incomingSubtopic.euEnsineiQue || fallbackSub.euEnsineiQue || '')
                            : ''
                    ),
                    apoioPedagogico: safeString(incomingSubtopic.apoioPedagogico || fallbackSub.apoioPedagogico),
                    aplicacaoPratica: safeString(incomingSubtopic.aplicacaoPratica || fallbackSub.aplicacaoPratica)
                };
            })
        };
    });

    return {
        numero: safeString(src.numero || fallback.numero),
        titulo: safeString(src.titulo || fallback.titulo),
        textoAureoOuVersiculo: safeString(
            src.textoAureoOuVersiculo ||
            src.textoAureo ||
            src.versiculoDoDia ||
            fallback.textoAureoOuVersiculo
        ),
        verdadeAplicada: safeString(src.verdadeAplicada || fallback.verdadeAplicada),
        textosReferencia: safeString(src.textosReferencia || fallback.textosReferencia),
        analiseGeral: safeString(src.analiseGeral || fallback.analiseGeral),
        introducao: {
            conteudo: safeString(src.introducao?.conteudo || fallback.introducao.conteudo),
            apoioPedagogico: safeString(src.introducao?.apoioPedagogico || fallback.introducao.apoioPedagogico),
            aplicacaoPratica: safeString(src.introducao?.aplicacaoPratica || fallback.introducao.aplicacaoPratica)
        },
        topicos: normalizedTopics,
        conclusao: {
            conteudo: safeString(src.conclusao?.conteudo || fallback.conclusao.conteudo),
            apoioPedagogico: safeString(src.conclusao?.apoioPedagogico || fallback.conclusao.apoioPedagogico),
            aplicacaoPratica: safeString(src.conclusao?.aplicacaoPratica || fallback.conclusao.aplicacaoPratica)
        }
    };
}

async function callDeepSeek(prompt) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY não configurada');
    }

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

        if (!response.ok) {
            const errorText = await response.text();
            console.error('DeepSeek response error:', response.status, errorText);
            throw new Error(`DeepSeek API error: ${response.status}`);
        }

        const data = await response.json();
        return data?.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timeoutId);
    }
}

function buildPrompt({ titulo, textoOriginal, publico }) {
    const tipoCampo = publico === 'jovens' ? 'VERSÍCULO DO DIA' : 'TEXTO ÁUREO';

    return `
Você é um especialista em Escola Bíblica Dominical.

Analise a lição abaixo e responda SOMENTE com JSON válido.

REGRAS OBRIGATÓRIAS:
- Não use markdown
- Não use crases
- Não escreva explicações antes ou depois
- Preserve o conteúdo original da revista nos campos "introducao.conteudo", "topicos[].conteudo", "topicos[].subtopicos[].conteudo" e "conclusao.conteudo"
- Gere ANÁLISE GERAL, APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA
- Se o público for "jovens", use linguagem e exemplos voltados à realidade juvenil
- Se o público for "adultos", use linguagem voltada ao público adulto
- O campo "textoAureoOuVersiculo" deve corresponder a "${tipoCampo}"
- Sempre devolva exatamente 3 tópicos principais
- Sempre devolva 2 subtópicos por tópico
- O campo "euEnsineiQue" deve ser preenchido apenas no segundo subtópico de cada tópico; no primeiro subtópico, devolva string vazia

ESTRUTURA OBRIGATÓRIA:
{
  "numero": "",
  "titulo": "",
  "textoAureoOuVersiculo": "",
  "verdadeAplicada": "",
  "textosReferencia": "",
  "analiseGeral": "",
  "introducao": {
    "conteudo": "",
    "apoioPedagogico": "",
    "aplicacaoPratica": ""
  },
  "topicos": [
    {
      "numero": "1",
      "titulo": "",
      "conteudo": "",
      "apoioPedagogico": "",
      "aplicacaoPratica": "",
      "subtopicos": [
        {
          "numero": "1.1",
          "titulo": "",
          "conteudo": "",
          "euEnsineiQue": "",
          "apoioPedagogico": "",
          "aplicacaoPratica": ""
        },
        {
          "numero": "1.2",
          "titulo": "",
          "conteudo": "",
          "euEnsineiQue": "",
          "apoioPedagogico": "",
          "aplicacaoPratica": ""
        }
      ]
    },
    {
      "numero": "2",
      "titulo": "",
      "conteudo": "",
      "apoioPedagogico": "",
      "aplicacaoPratica": "",
      "subtopicos": [
        {
          "numero": "2.1",
          "titulo": "",
          "conteudo": "",
          "euEnsineiQue": "",
          "apoioPedagogico": "",
          "aplicacaoPratica": ""
        },
        {
          "numero": "2.2",
          "titulo": "",
          "conteudo": "",
          "euEnsineiQue": "",
          "apoioPedagogico": "",
          "aplicacaoPratica": ""
        }
      ]
    },
    {
      "numero": "3",
      "titulo": "",
      "conteudo": "",
      "apoioPedagogico": "",
      "aplicacaoPratica": "",
      "subtopicos": [
        {
          "numero": "3.1",
          "titulo": "",
          "conteudo": "",
          "euEnsineiQue": "",
          "apoioPedagogico": "",
          "aplicacaoPratica": ""
        },
        {
          "numero": "3.2",
          "titulo": "",
          "conteudo": "",
          "euEnsineiQue": "",
          "apoioPedagogico": "",
          "aplicacaoPratica": ""
        }
      ]
    }
  ],
  "conclusao": {
    "conteudo": "",
    "apoioPedagogico": "",
    "aplicacaoPratica": ""
  }
}

TÍTULO INFORMADO:
${titulo || ''}

PÚBLICO:
${publico || 'adultos'}

TEXTO DA LIÇÃO:
"""
${textoOriginal}
"""
`.trim();
}

app.post('/api/gerar-licao-completa', async (req, res) => {
    const startedAt = Date.now();

    try {
        const { textoOriginal, titulo = '', publico = 'adultos' } = req.body || {};

        if (!safeString(textoOriginal)) {
            return res.status(400).json({ error: 'textoOriginal é obrigatório' });
        }

        const normalizedText = normalizeWhitespace(textoOriginal);
        const normalizedPublico = publico === 'jovens' ? 'jovens' : 'adultos';

        const cachePayload = {
            titulo: safeString(titulo),
            textoOriginal: normalizedText,
            publico: normalizedPublico,
            model: DEEPSEEK_MODEL
        };

        const cacheKey = createCacheKey(cachePayload);
        const cached = getCache(cacheKey);

        if (cached) {
            return res.json({
                licao: cached,
                meta: {
                    source: 'cache',
                    durationMs: Date.now() - startedAt
                }
            });
        }

        const prompt = buildPrompt({
            titulo: safeString(titulo),
            textoOriginal: normalizedText,
            publico: normalizedPublico
        });

        let parsed;
        let source = 'ai';

        try {
            const aiRaw = await callDeepSeek(prompt);
            parsed = parseJsonSafely(aiRaw);
        } catch (aiError) {
            console.error('Falha na IA, ativando fallback:', aiError.message);
            parsed = fallbackBuildStructuredLesson({
                titulo: safeString(titulo),
                textoOriginal: normalizedText,
                publico: normalizedPublico
            });
            source = 'fallback';
        }

        const normalizedLesson = normalizeLessonStructure(parsed, {
            titulo: safeString(titulo),
            textoOriginal: normalizedText,
            publico: normalizedPublico
        });

        setCache(cacheKey, normalizedLesson);

        return res.json({
            licao: normalizedLesson,
            meta: {
                source,
                cached: false,
                durationMs: Date.now() - startedAt
            }
        });
    } catch (error) {
        console.error('Erro em /api/gerar-licao-completa:', error);
        return res.status(500).json({
            error: error.message || 'Erro interno do servidor'
        });
    }
});

app.post('/api/extrair-pdf', async (req, res) => {
    return res.status(501).json({
        error: 'Extração de PDF ainda não foi configurada neste servidor.'
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        deepseek_configured: !!DEEPSEEK_API_KEY,
        model: DEEPSEEK_MODEL,
        cache_items: generationCache.size
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`DeepSeek: ${DEEPSEEK_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
    console.log(`Modelo: ${DEEPSEEK_MODEL}`);
});
