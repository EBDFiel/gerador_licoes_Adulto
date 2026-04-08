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
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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

function normalizeText(text = '') {
    return String(text || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripHtml(text = '') {
    return String(text || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
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
    return JSON.parse(extractJsonFromText(text));
}

function linesFromText(text = '') {
    return normalizeText(text)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
}

function extractSimpleField(text, labels = []) {
    for (const label of labels) {
        const regex = new RegExp(`^\\s*${label}\\s*:?\\s*(.+)$`, 'im');
        const match = String(text || '').match(regex);
        if (match) return match[1].trim();
    }
    return '';
}

function extractLessonNumber(title = '', originalText = '') {
    const joined = `${title}\n${originalText}`;
    const match = joined.match(/LIÇÃO\s+(\d+)/i) || joined.match(/LICAO\s+(\d+)/i);
    return match ? match[1] : '';
}

function extractLessonTitle(title = '', originalText = '') {
    const cleanTitle = safeString(title).replace(/^\s*LIÇÃO\s+\d+\s*[:\-]?\s*/i, '').trim();
    if (cleanTitle) return cleanTitle;

    const lines = linesFromText(originalText);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^(LIÇÃO|LICAO)\s+(\d+)(?:\s*[:\-]\s*(.*))?$/i);
        if (match && match[3]) return match[3].trim();
    }

    return '';
}

function isMainTopicLine(line = '') {
    return /^(\d+)[\.\-]\s+(.+)$/.test(line) && !/^\d+\.\d+/.test(line);
}

function isSubtopicLine(line = '') {
    return /^(\d+\.\d+)[\.\-]\s+(.+)$/.test(line);
}

function isConclusionLine(line = '') {
    return /^CONCLUSÃO\s*:?\s*$/i.test(line) || /^CONCLUSÃO\s*:/i.test(line);
}

function isIntroductionLine(line = '') {
    return /^INTRODUÇÃO\s*:?\s*$/i.test(line) || /^INTRODUÇÃO\s*:/i.test(line);
}

function isEuEnsineiLine(line = '') {
    return /^EU ENSINEI QUE\s*:?\s*/i.test(line);
}

function isStructuralLine(line = '') {
    return (
        isIntroductionLine(line) ||
        isConclusionLine(line) ||
        isMainTopicLine(line) ||
        isSubtopicLine(line) ||
        isEuEnsineiLine(line)
    );
}

function joinLines(lines, start, end) {
    return lines.slice(start, end).join(' ').replace(/\s+/g, ' ').trim();
}

function findLineIndex(lines, predicate) {
    for (let i = 0; i < lines.length; i++) {
        if (predicate(lines[i], i)) return i;
    }
    return -1;
}

function findNextIndex(lines, startIndex, predicate) {
    for (let i = startIndex; i < lines.length; i++) {
        if (predicate(lines[i], i)) return i;
    }
    return -1;
}

function parseHeadings(lines) {
    const mains = [];
    const subs = [];
    let introIndex = -1;
    let conclusionIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (isIntroductionLine(line) && introIndex === -1) {
            introIndex = i;
            continue;
        }

        if (isConclusionLine(line) && conclusionIndex === -1) {
            conclusionIndex = i;
            continue;
        }

        const mainMatch = line.match(/^(\d+)[\.\-]\s+(.+)$/);
        if (mainMatch && !/^\d+\.\d+/.test(line)) {
            mains.push({
                index: i,
                numero: mainMatch[1],
                titulo: mainMatch[2].trim()
            });
            continue;
        }

        const subMatch = line.match(/^(\d+\.\d+)[\.\-]\s+(.+)$/);
        if (subMatch) {
            subs.push({
                index: i,
                numero: subMatch[1],
                titulo: subMatch[2].trim(),
                parent: subMatch[1].split('.')[0]
            });
        }
    }

    return { introIndex, conclusionIndex, mains, subs };
}

function extractIntroContent(lines, info) {
    if (info.introIndex === -1) return '';

    const sameLine = lines[info.introIndex].replace(/^INTRODUÇÃO\s*:?\s*/i, '').trim();
    const firstMainIndex = info.mains.length ? info.mains[0].index : (info.conclusionIndex !== -1 ? info.conclusionIndex : lines.length);

    if (sameLine) {
        const extra = joinLines(lines, info.introIndex + 1, firstMainIndex);
        return `${sameLine} ${extra}`.trim();
    }

    return joinLines(lines, info.introIndex + 1, firstMainIndex);
}

function extractConclusionContent(lines, info) {
    if (info.conclusionIndex === -1) return '';

    const sameLine = lines[info.conclusionIndex].replace(/^CONCLUSÃO\s*:?\s*/i, '').trim();
    const tail = joinLines(lines, info.conclusionIndex + 1, lines.length);
    return `${sameLine} ${tail}`.trim();
}

function extractMainTopicContent(lines, info, topic) {
    const topicSubs = info.subs.filter(s => s.parent === topic.numero);
    const nextMain = info.mains.find(m => m.index > topic.index);
    const endIndex = topicSubs.length
        ? topicSubs[0].index
        : nextMain
            ? nextMain.index
            : info.conclusionIndex !== -1
                ? info.conclusionIndex
                : lines.length;

    return joinLines(lines, topic.index + 1, endIndex);
}

function extractSubtopicBlock(lines, startIndex, endIndex) {
    const euIdx = findNextIndex(lines, startIndex, (line, idx) => idx < endIndex && isEuEnsineiLine(line));

    if (euIdx === -1 || euIdx >= endIndex) {
        return {
            conteudo: joinLines(lines, startIndex, endIndex),
            euEnsineiQue: ''
        };
    }

    const conteudo = joinLines(lines, startIndex, euIdx);
    const euFirst = lines[euIdx].replace(/^EU ENSINEI QUE\s*:?\s*/i, '').trim();
    const euRest = joinLines(lines, euIdx + 1, endIndex);
    const euEnsineiQue = `${euFirst} ${euRest}`.trim();

    return {
        conteudo,
        euEnsineiQue
    };
}

function mergeExtraSubtopicsIntoSecond(subtopics) {
    if (subtopics.length <= 2) return subtopics;

    const first = subtopics[0];
    const second = { ...subtopics[1] };

    for (let i = 2; i < subtopics.length; i++) {
        const extra = subtopics[i];
        const headingText = `${extra.numero}. ${extra.titulo}:`;
        second.conteudo = `${second.conteudo} ${headingText} ${extra.conteudo}`.trim();
        if (extra.euEnsineiQue) {
            second.euEnsineiQue = second.euEnsineiQue
                ? `${second.euEnsineiQue} ${extra.euEnsineiQue}`.trim()
                : extra.euEnsineiQue;
        }
    }

    return [first, second];
}

function ensureTwoSubtopics(topicNumber, subtopics) {
    const working = mergeExtraSubtopicsIntoSecond(subtopics);

    while (working.length < 2) {
        const next = working.length + 1;
        working.push({
            numero: `${topicNumber}.${next}`,
            titulo: `Subtópico ${topicNumber}.${next}`,
            conteudo: '',
            euEnsineiQue: ''
        });
    }

    return working.slice(0, 2);
}

function parseOriginalLesson({ titulo, textoOriginal, publico }) {

    const text = normalizeText(textoOriginal);

    // 🔥 MELHOR EXTRAÇÃO POR BLOCOS
    function extractBlock(startRegex, endRegexList = []) {
        const startMatch = text.match(startRegex);
        if (!startMatch) return '';

        let startIndex = startMatch.index + startMatch[0].length;
        let cut = text.slice(startIndex);

        let endIndex = cut.length;

        for (const endRegex of endRegexList) {
            const m = cut.match(endRegex);
            if (m && m.index < endIndex) endIndex = m.index;
        }

        return cut.slice(0, endIndex).trim();
    }

    const numero = extractLessonNumber(titulo, text);
    const tituloLicao = extractLessonTitle(titulo, text);

    const textoAureoOuVersiculo = extractSimpleField(text, [
        'TEXTO ÁUREO',
        'VERSÍCULO DO DIA'
    ]);

    const verdadeAplicada = extractSimpleField(text, ['VERDADE APLICADA']);
    const textosReferencia = extractSimpleField(text, ['TEXTOS DE REFERÊNCIA']);

    const introducao = extractBlock(
        /INTRODUÇÃO\s*:?\s*/i,
        [/^\s*1[\.\-]/im]
    );

    const conclusao = extractBlock(
        /CONCLUSÃO\s*:?\s*/i,
        []
    );

    function extractTopico(numero) {
        return extractBlock(
            new RegExp(`^\\s*${numero}[\\.\\-]\\s+`, 'im'),
            [
                new RegExp(`^\\s*${Number(numero)+1}[\\.\\-]\\s+`, 'im'),
                /^\s*CONCLUSÃO\s*:?\s*/im
            ]
        );
    }

    function extractSub(numero) {
        return extractBlock(
            new RegExp(`^\\s*${numero}[\\.\\-]\\s+`, 'im'),
            [
                new RegExp(`^\\s*${numero.split('.')[0]}\\.\\d+`, 'im'),
                new RegExp(`^\\s*${Number(numero.split('.')[0])+1}[\\.\\-]\\s+`, 'im'),
                /^\s*CONCLUSÃO\s*:?\s*/im
            ]
        );
    }

    function extractEuEnsinei(text) {
        const match = text.match(/EU ENSINEI QUE\s*:?\s*(.+)/i);
        return match ? match[1].trim() : '';
    }

    const topicos = [1,2,3].map(n => {

        const conteudoTopico = extractTopico(n);

        const sub1 = extractSub(`${n}.1`);
        const sub2 = extractSub(`${n}.2`);

        return {
            numero: String(n),
            titulo: `Tópico ${n}`,
            conteudo: conteudoTopico,
            apoioPedagogico: '',
            aplicacaoPratica: '',
            subtopicos: [
                {
                    numero: `${n}.1`,
                    titulo: `Subtópico ${n}.1`,
                    conteudo: sub1,
                    euEnsineiQue: '',
                    apoioPedagogico: '',
                    aplicacaoPratica: ''
                },
                {
                    numero: `${n}.2`,
                    titulo: `Subtópico ${n}.2`,
                    conteudo: sub2,
                    euEnsineiQue: extractEuEnsinei(sub2),
                    apoioPedagogico: '',
                    aplicacaoPratica: ''
                }
            ]
        };
    });

    return {
        numero,
        titulo: tituloLicao,
        textoAureoOuVersiculo,
        verdadeAplicada,
        textosReferencia,
        analiseGeral: '',
        introducao: {
            conteudo: introducao,
            apoioPedagogico: '',
            aplicacaoPratica: ''
        },
        topicos,
        conclusao: {
            conteudo: conclusao,
            apoioPedagogico: '',
            aplicacaoPratica: ''
        },
        publico
    };
}

function generateFallbackApoio(baseTitle, publico) {
    if (publico === 'jovens') {
        return `O professor pode trabalhar ${baseTitle} com linguagem acessível, exemplos atuais e perguntas que favoreçam a participação da turma. Convém relacionar o conteúdo bíblico com escolhas, identidade, relacionamentos, fé prática e testemunho cristão, ajudando os jovens a perceberem que a Palavra de Deus continua atual e responde aos desafios do cotidiano. Ao ensinar, destaque o contexto do texto, a verdade central do assunto e conduza a classe a enxergar aplicações concretas para a vida.`;
    }

    return `O professor pode conduzir ${baseTitle} ressaltando o contexto da lição, os princípios bíblicos centrais e suas implicações espirituais para a vida cristã. Convém estimular a participação da classe com perguntas, observações do texto e aplicações pastorais objetivas. Ao ensinar, destaque a relevância doutrinária do conteúdo, conecte os pontos principais com a vivência da igreja e mostre como a obediência à Palavra, a maturidade espiritual e a fidelidade a Deus devem orientar as atitudes práticas dos alunos.`;
}

function generateFallbackAplicacao(baseTitle, publico) {
    if (publico === 'jovens') {
        return `Os alunos devem refletir sobre como ${baseTitle.toLowerCase()} se aplica às escolhas do dia a dia, aos relacionamentos e ao testemunho cristão. O objetivo é levá-los a perceber que seguir os princípios bíblicos fortalece a fé, protege o coração e produz uma vida mais firme, coerente e comprometida com Deus.`;
    }

    return `A classe deve identificar formas práticas de aplicar ${baseTitle.toLowerCase()} na rotina, fortalecendo a vida cristã, o discernimento espiritual e a obediência à Palavra. O ensino precisa sair do campo teórico e se tornar postura, decisão e testemunho na caminhada com Deus.`;
}

function generateFallbackAnalise(publico) {
    if (publico === 'jovens') {
        return `Esta lição apresenta princípios bíblicos importantes para a formação espiritual do jovem, mostrando que a Palavra de Deus continua atual e necessária. O conteúdo conduz o aluno a refletir sobre fé prática, identidade cristã, coragem para fazer o que é certo e responsabilidade diante do chamado de Deus. Ao longo da lição, o estudante percebe que a vida com Deus exige discernimento, constância, maturidade e disposição para agir segundo a verdade bíblica, mesmo quando surgem oposições, pressões e desafios próprios da juventude.`;
    }

    return `Esta lição destaca princípios bíblicos essenciais para a edificação cristã, enfatizando a importância de compreender e aplicar a Palavra de Deus em meio aos desafios da caminhada. O conteúdo conduz o aluno a uma visão mais profunda do tema estudado, fortalecendo a fé, a maturidade espiritual e a prática cristã. Ao longo da lição, os tópicos oferecem base doutrinária, orientação pastoral e direcionamento prático para a vida diária, mostrando que a fidelidade a Deus precisa ser demonstrada por meio de discernimento, perseverança, equilíbrio e compromisso com a verdade.`;
}

function buildPedagogicalPrompt(structuredLesson, publico) {

    const isJovens = publico === 'jovens';

    return `
Você é um especialista em Escola Bíblica Dominical.

Sua missão é transformar a lição abaixo em um TEXTO FINAL PRONTO, seguindo RIGOROSAMENTE o modelo editorial.

⚠️ EXTREMAMENTE IMPORTANTE:
- NÃO RESUMA
- NÃO CORTE
- NÃO ALTERE o conteúdo original
- APENAS COMPLEMENTE com análise, apoio pedagógico e aplicação prática

========================================

${isJovens ? `
FORMATO JOVENS (OBRIGATÓRIO):

- Títulos SEMPRE em negrito (**)
- Conteúdo original NORMAL (sem negrito)
- APOIO PEDAGÓGICO: profundo, com contexto, teologia e aplicação juvenil
- APLICAÇÃO PRÁTICA: curta e objetiva

` : `
FORMATO ADULTOS (OBRIGATÓRIO):

- Títulos principais em negrito (**)
- Blocos ANALISE, INTRODUÇÃO, APOIO, APLICAÇÃO e CONCLUSÃO em negrito+itálico (***)
- Conteúdo original SEMPRE preservado
- APOIO PEDAGÓGICO profundo e teológico
- APLICAÇÃO PRÁTICA objetiva

`}

========================================

REGRAS CRÍTICAS:

1. MANTER TODO O CONTEÚDO ORIGINAL exatamente como está
2. NÃO INVENTAR conteúdo original
3. NÃO REMOVER NADA
4. "EU ENSINEI QUE" deve aparecer separado
5. NÃO usar HTML
6. NÃO usar markdown fora do padrão solicitado
7. NÃO misturar seções
8. NÃO repetir conteúdo

========================================

AGORA COMPLETE A LIÇÃO:

- Gere:
  ✔ ANÁLISE GERAL
  ✔ APOIO PEDAGÓGICO (todos os blocos)
  ✔ APLICAÇÃO PRÁTICA (todos os blocos)

========================================

ESTRUTURA BASE:

${JSON.stringify(structuredLesson, null, 2)}

========================================

RETORNE APENAS JSON VÁLIDO.
SEM TEXTO EXTRA.
SEM EXPLICAÇÕES.
`;
}

app.post('/api/gerar-licao-completa', async (req, res) => {
    const startedAt = Date.now();

    try {
        const { textoOriginal, titulo = '', publico = 'adultos' } = req.body || {};

        if (!safeString(textoOriginal)) {
            return res.status(400).json({ error: 'textoOriginal é obrigatório' });
        }

        const normalizedPublico = publico === 'jovens' ? 'jovens' : 'adultos';
        const normalizedText = normalizeText(textoOriginal);

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

        const baseLesson = parseOriginalLesson({
            titulo: safeString(titulo),
            textoOriginal: normalizedText,
            publico: normalizedPublico
        });

        let pedagogicalData = null;
        let source = 'ai';

        try {
            const prompt = buildPedagogicalPrompt(baseLesson, normalizedPublico);
            const aiRaw = await callDeepSeek(prompt);

            if (aiRaw.includes('<')) {
                throw new Error('IA retornou HTML inválido');
            }

            pedagogicalData = parseJsonSafely(aiRaw);
        } catch (aiError) {
            console.error('Falha na IA, usando fallback pedagógico:', aiError.message);
            source = 'fallback';
        }

        const finalLesson = applyPedagogicalCompletion(baseLesson, pedagogicalData, normalizedPublico);

        setCache(cacheKey, finalLesson);

        return res.json({
            licao: finalLesson,
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
