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

function stripCodeFences(text = '') {
    return String(text)
        .replace(/^```html\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function ensureHtmlResponse(text = '') {
    const cleaned = stripCodeFences(text);
    if (/<!DOCTYPE html>/i.test(cleaned) || /<html[\s>]/i.test(cleaned)) {
        return cleaned;
    }
    return cleaned;
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
            conteudo: extractSection(
                text,
                /INTRODUÇÃO\s*:?\s*/i,
                [/^\s*1\./im, /^\s*I\./im, /^\s*CONCLUSÃO\s*:?\s*/im]
            )
        },
        conclusao: {
            conteudo: extractSection(text, /CONCLUSÃO\s*:?\s*/i)
        }
    };
}

function isYouthPublic(publico = '') {
    const p = String(publico).toLowerCase();
    return p === 'jovens' || p === 'jovem' || p === 'youth';
}

function isAdultPublic(publico = '') {
    const p = String(publico).toLowerCase();
    return p === 'adultos' || p === 'adulto' || p === 'adult';
}

function buildYouthPrompt({
    numero = '',
    titulo = '',
    tema = '',
    textoBase = '',
    instrucoes = '',
    formatoSaida = 'html_completo'
}) {
    const wantsFullHtml = formatoSaida === 'html_completo';

    return `
Você é um especialista em criação de conteúdo para Escola Dominical, com foco em jovens cristãos (15 a 25 anos). Sua linguagem é direta, atual, mas sem perder a profundidade teológica.

${wantsFullHtml
? `⚠️ IMPORTANTE: Você DEVE responder APENAS com o código HTML completo da lição. NÃO escreva nenhum texto antes ou depois do HTML. NÃO explique o que fez. A primeira linha da sua resposta deve ser <!DOCTYPE html> e a última linha </html>. O HTML deve ser autossuficiente, com CSS interno e todo o conteúdo formatado.`
: `⚠️ IMPORTANTE: Você DEVE responder APENAS com o HTML INTERNO do conteúdo da lição, SEM <!DOCTYPE html>, SEM <html>, SEM <head> e SEM <body>. NÃO escreva nenhum texto antes ou depois do HTML. NÃO explique o que fez.`}

Preciso que você elabore uma lição bíblica para JOVENS seguindo rigorosamente o formato abaixo.

Utilize o conteúdo da revista que eu enviar e mantenha TODO o conteúdo original na íntegra, sem cortes ou alterações.

A lição é voltada para jovens, portanto as aplicações devem dialogar com seus desafios reais: escolha de carreira, relacionamentos, redes sociais, ansiedade, propósito, identidade, pressão familiar, vida na igreja, etc.

TÍTULO INFORMADO: ${titulo || '[não informado]'}
NÚMERO DA LIÇÃO: ${numero || '[não informado]'}
TEMA INFORMADO: ${tema || '[não informado]'}

FORMATO EXATO A SER SEGUIDO DENTRO DO HTML:

<strong>Lição ${numero || '[número]'}:</strong> ${titulo || '[título da lição]'}

<strong>VERSÍCULO DO DIA:</strong> [versículo]
<strong>VERDADE APLICADA:</strong> [texto]
<strong>TEXTOS DE REFERÊNCIA:</strong> [referência bíblica]
<strong>ANÁLISE GERAL:</strong> [texto explicativo]
<strong>INTRODUÇÃO:</strong> [conteúdo original da revista]
<strong>APOIO PEDAGÓGICO:</strong> [texto complementar]
<strong>APLICAÇÃO PRÁTICA:</strong> [reflexão concreta]

Para cada tópico principal e subtópico, repetir a seguinte estrutura:

<strong>[título do tópico ou subtópico]:</strong> [conteúdo original da revista]
[Quando houver "EU ENSINEI QUE" no conteúdo original, ele deve vir em bloco separado, em negrito, após o conteúdo original e antes do APOIO PEDAGÓGICO]
<strong>APOIO PEDAGÓGICO:</strong> [texto complementar robusto]
<strong>APLICAÇÃO PRÁTICA:</strong> [reflexão curta e objetiva]

<strong>CONCLUSÃO:</strong> [conteúdo original da revista]
<strong>APOIO PEDAGÓGICO:</strong> [texto complementar]
<strong>APLICAÇÃO PRÁTICA:</strong> [reflexão concreta]

REGRAS OBRIGATÓRIAS:
1. Todos os títulos ficam em negrito.
2. O conteúdo original da revista NÃO fica em negrito.
3. O título de cada tópico ou subtópico deve vir na mesma linha do conteúdo original, separado por dois pontos.
4. Cada bloco deve ficar separado e claramente identificado, sem linhas divisórias.
5. O APOIO PEDAGÓGICO deve ser robusto, com 3 a 4 parágrafos por bloco, contexto histórico-cultural, citações cristãs, referências bíblicas adicionais e conexão direta com a realidade juvenil.
6. A APLICAÇÃO PRÁTICA deve ser curta, objetiva, realizável e conectada ao universo jovem.
7. Mantenha todo o conteúdo original da revista exatamente como foi fornecido, sem acréscimos ou omissões.
8. Preserve o foco pastoral, bíblico e pedagógico.

${wantsFullHtml ? `
PADRÃO VISUAL OBRIGATÓRIO:
- Fundo da página: #eef0e8
- Container central branco com bordas arredondadas (2rem) e sombra suave
- Cabeçalho com gradiente terroso/verde, texto branco, borda inferior dourada
- Blocos de APOIO PEDAGÓGICO: fundo #edf3e8, borda esquerda verde (#7fa06b), padding, border-radius
- Blocos de APLICAÇÃO PRÁTICA: fundo #fff4e5, borda esquerda dourada (#f5c542), padding, border-radius
- Bloco EU ENSINEI QUE: fundo #f3efde, bordas arredondadas, texto alaranjado
- Responsivo
- Fonte: 'Segoe UI', 'Inter', Roboto, sistema
- Espaçamento generoso e leitura confortável
` : `
PADRÃO DE SAÍDA:
- Entregue APENAS o miolo do conteúdo em HTML limpo
- Use seções, headings, parágrafos e blocos com classes sem CSS externo
- Não gere documento HTML completo
`}

INSTRUÇÕES EXTRAS DO ADMIN:
${instrucoes || '(sem instruções extras)'}

CONTEÚDO COMPLETO DA REVISTA:
${textoBase || '[sem conteúdo enviado]'}
    `.trim();
}

function buildAdultPrompt({
    numero = '',
    titulo = '',
    tema = '',
    textoBase = '',
    instrucoes = '',
    formatoSaida = 'html_completo'
}) {
    const wantsFullHtml = formatoSaida === 'html_completo';

    return `
Você é um especialista em design instrucional, pedagogia cristã e criação de conteúdos para Escola Dominical, com foco na Classe de Adultos (30 a 60+ anos). Sua linguagem é teologicamente sólida, madura, mas acessível. Valoriza profundidade doutrinária sem perder a clareza.

${wantsFullHtml
? `⚠️ IMPORTANTE: Você DEVE responder APENAS com o código HTML completo da lição. NÃO escreva nenhum texto antes ou depois do HTML. NÃO explique o que fez. A primeira linha da sua resposta deve ser <!DOCTYPE html> e a última linha </html>. O HTML deve ser autossuficiente, com CSS interno e todo o conteúdo formatado.`
: `⚠️ IMPORTANTE: Você DEVE responder APENAS com o HTML INTERNO do conteúdo da lição, SEM <!DOCTYPE html>, SEM <html>, SEM <head> e SEM <body>. NÃO escreva nenhum texto antes ou depois do HTML. NÃO explique o que fez.`}

Preciso que você gere uma lição completa para a classe de Adultos, seguindo exatamente o padrão abaixo.

A lição será sobre: ${tema || '[tema não informado]'}
Título informado: ${titulo || '[não informado]'}
Número informado: ${numero || '[não informado]'}

ESTRUTURA OBRIGATÓRIA DENTRO DO HTML:

<strong>Lição ${numero || '[número]'}:</strong> ${titulo || '[título da lição]'}
<strong>📖 TEXTO ÁUREO:</strong> [versículo chave + referência]
<strong>✨ VERDADE APLICADA:</strong> [frase curta]
<strong>📌 TEXTOS DE REFERÊNCIA:</strong> [referências]
<strong>🔍 ANÁLISE GERAL DA LIÇÃO:</strong> [mínimo 4 parágrafos]
<strong>📌 INTRODUÇÃO:</strong> [conteúdo original da revista]

Para cada tópico e subtópico:
<strong>[título do tópico ou subtópico]:</strong> [conteúdo original da revista]
<strong>📘 APOIO PEDAGÓGICO:</strong> [texto profundo com contexto histórico, reflexões teológicas, citações de autores renomados, referências adicionais]
<strong>🎯 APLICAÇÃO PRÁTICA:</strong> [curta e objetiva]

<strong>CONCLUSÃO:</strong> [conteúdo original]
<strong>📘 APOIO PEDAGÓGICO:</strong> [texto complementar]
<strong>🎯 APLICAÇÃO PRÁTICA:</strong> [reflexão concreta]
<strong>✨ Eu ensinei que:</strong> [frases de destaque ao final de cada tópico principal, já incluídas no conteúdo original]
<strong>🎵 HINOS SUGERIDOS:</strong> [conforme revista]
<strong>🙏 MOTIVO DE ORAÇÃO:</strong> [conforme revista]

REGRAS OBRIGATÓRIAS:
1. Todos os títulos ficam em negrito.
2. O conteúdo original da revista NÃO fica em negrito.
3. O título de cada tópico ou subtópico deve vir na mesma linha do conteúdo original, separado por dois pontos.
4. Cada bloco deve ficar separado e claramente identificado.
5. O APOIO PEDAGÓGICO deve ser robusto e profundo, com 3 a 4 parágrafos por bloco, contexto histórico-cultural, citações cristãs, referências bíblicas adicionais e conexão direta com a realidade adulta.
6. A APLICAÇÃO PRÁTICA deve ser curta, objetiva e realizável.
7. Mantenha todo o conteúdo original da revista exatamente como foi fornecido, sem acréscimos ou omissões.
8. Preserve profundidade doutrinária, clareza pastoral e aplicabilidade.

${wantsFullHtml ? `
PADRÃO VISUAL OBRIGATÓRIO:
- Fundo da página: #eef0e8 ou #e9e5d9
- Container central branco, bordas arredondadas (2rem), sombra suave
- Cabeçalho com gradiente terroso/verde, texto branco, borda inferior dourada
- Blocos de APOIO PEDAGÓGICO: fundo #edf3e8, borda esquerda verde (#7fa06b), padding, border-radius
- Blocos de APLICAÇÃO PRÁTICA: fundo #fff4e5, borda esquerda dourada (#f5c542), padding, border-radius
- Bloco EU ENSINEI QUE: fundo #f3efde, bordas arredondadas, texto alaranjado
- Responsivo
- Fonte: 'Segoe UI', 'Inter', Roboto, sistema
- Corpo com leitura confortável, mínimo 16px
` : `
PADRÃO DE SAÍDA:
- Entregue APENAS o miolo do conteúdo em HTML limpo
- Use seções, headings, parágrafos e blocos com classes sem CSS externo
- Não gere documento HTML completo
`}

INSTRUÇÕES EXTRAS DO ADMIN:
${instrucoes || '(sem instruções extras)'}

CONTEÚDO COMPLETO DA REVISTA:
${textoBase || '[sem conteúdo enviado]'}
    `.trim();
}

function buildSmartAdminPrompt({
    publico = 'adultos',
    numero = '',
    titulo = '',
    tema = '',
    textoBase = '',
    instrucoes = '',
    formatoSaida = 'html_fragmento'
}) {
    if (isYouthPublic(publico)) {
        return buildYouthPrompt({
            numero,
            titulo,
            tema,
            textoBase,
            instrucoes,
            formatoSaida
        });
    }

    return buildAdultPrompt({
        numero,
        titulo,
        tema,
        textoBase,
        instrucoes,
        formatoSaida
    });
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

        const resposta = await callDeepSeek(
            [
                { role: 'system', content: promptSistema },
                { role: 'user', content: pergunta }
            ],
            0.7
        );

        res.json({ resposta });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: err.message || 'Erro interno na IA.' });
    }
});

/* ==================== COMPLEMENTO PEDAGÓGICO JSON ==================== */
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

    const content = await callDeepSeek(
        [
            { role: 'system', content: promptSistema },
            { role: 'user', content: JSON.stringify(structuredLesson) }
        ],
        0.5
    );

    return safeJsonParse(content, structuredLesson) || structuredLesson;
}

/* ==================== GERADOR DE LIÇÃO COMPLETA (JSON) ==================== */
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const payload = req.body || {};
        const cacheKey = createCacheKey({ route: 'gerar-licao-completa', payload });

        const cached = getCache(cacheKey);
        if (cached) {
            return res.json(cached);
        }

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
            instrucoes = '',
            numero = '',
            trimestre = '',
            data = '',
            mode = 'smart_template'
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
            instrucoes: normalizeText(instrucoes),
            numero,
            trimestre,
            data,
            mode
        };

        const cacheKey = createCacheKey({ route: 'admin-generate', payload });
        const cached = getCache(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        let content = '';

        if (mode === 'smart_template') {
            const formatoSaida = formato === 'html' ? 'html_fragmento' : 'html_fragmento';

            const prompt = buildSmartAdminPrompt({
                publico,
                numero,
                titulo,
                tema,
                textoBase: payload.textoBase,
                instrucoes: `
Objetivo do admin: ${objetivo || '(não informado)'}
Tom desejado: ${tom || '(não informado)'}
Data da lição: ${data || '(não informada)'}
Trimestre: ${trimestre || '(não informado)'}
Formato pedido no painel: ${formato || 'html'}

IMPORTANTE PARA O SITE:
- Preserve o conteúdo original da revista
- Entregue conteúdo pronto para ser inserido dentro da página da lição
- Não invente cabeçalhos externos do site
- Foque no conteúdo interno da lição
- Mantenha os blocos pedagógicos robustos
- Não escreva nada fora do HTML
${payload.instrucoes || ''}
                `.trim(),
                formatoSaida
            });

            content = await callDeepSeek(
                [
                    {
                        role: 'system',
                        content: 'Você gera conteúdos oficiais da plataforma EBD Fiel.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                0.7
            );

            content = ensureHtmlResponse(content);
        } else {
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
Número da lição: ${numero}
Trimestre: ${trimestre}
Data: ${data}

Texto base:
${payload.textoBase || '(sem texto base)'}

Instruções extras:
${payload.instrucoes || '(sem instruções extras)'}
            `.trim();

            content = await callDeepSeek(
                [
                    { role: 'system', content: promptSistema },
                    { role: 'user', content: promptUsuario }
                ],
                0.7
            );

            content = stripCodeFences(content);
        }

        const result = {
            ok: true,
            content,
            meta: {
                tipo,
                publico,
                formato,
                numero,
                trimestre,
                data,
                mode,
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
- Não adicionar comentários fora do conteúdo
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

        const content = await callDeepSeek(
            [
                { role: 'system', content: promptSistema },
                { role: 'user', content: promptUsuario }
            ],
            0.5
        );

        res.json({
            ok: true,
            content: stripCodeFences(content)
        });
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
