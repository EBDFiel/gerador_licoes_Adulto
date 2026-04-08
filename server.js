// ============================
// SERVER.JS FINAL CORRIGIDO
// ============================

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

const generationCache = new Map();

// ============================
// UTIL
// ============================

function safeString(v) {
    return String(v || '').trim();
}

function normalize(text=''){
    return String(text||'').replace(/\r/g,'').trim();
}

// ============================
// EXTRAÇÃO INTELIGENTE
// ============================

function extractSection(text, start, stops=[]) {
    const match = text.match(start);
    if(!match) return '';

    let cut = text.slice(match.index + match[0].length);

    let end = cut.length;
    for(const s of stops){
        const m = cut.match(s);
        if(m && m.index < end) end = m.index;
    }

    return cut.slice(0,end).trim();
}

// ============================
// FALLBACK MELHORADO
// ============================

function fallback(text){

    const introducao = extractSection(text,
        /INTRODUÇÃO\s*:?\s*/i,
        [/^\s*1[\.\-]/im]
    );

    const conclusao = extractSection(text,
        /CONCLUSÃO\s*:?\s*/i,
        []
    );

    return {
        numero:'',
        titulo:'',
        textoAureoOuVersiculo:'',
        verdadeAplicada:'',
        textosReferencia:'',
        analiseGeral:'',

        introducao:{
            conteudo:introducao,
            apoioPedagogico:'Texto pedagógico',
            aplicacaoPratica:'Aplicação prática'
        },

        topicos:[],

        conclusao:{
            conteudo: conclusao,
            apoioPedagogico:'Texto pedagógico',
            aplicacaoPratica:'Aplicação prática'
        }
    }
}

// ============================
// IA
// ============================

async function callAI(prompt){
    const r = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`,{
        method:'POST',
        headers:{
            'Content-Type':'application/json',
            'Authorization':`Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages:[{role:'user', content:prompt}]
        })
    });

    const j = await r.json();
    return j.choices[0].message.content;
}

// ============================
// PROMPT FORTE
// ============================

function buildPrompt(text){
return `
RETORNE JSON.

NUNCA HTML.

Extraia corretamente:
- introdução
- tópicos
- subtópicos
- conclusão

IMPORTANTE:
- não misturar seções
- não repetir conteúdo
- não colar introdução dentro da conclusão

TEXTO:
${text}
`;
}

// ============================
// ROTA
// ============================

app.post('/api/gerar-licao-completa', async (req,res)=>{

    try{

        const { textoOriginal } = req.body;

        let parsed;

        try{
            const ai = await callAI(buildPrompt(textoOriginal));

            if(ai.includes('<')) throw 'html inválido';

            parsed = JSON.parse(ai);

        }catch(e){
            parsed = fallback(textoOriginal);
        }

        return res.json({ licao: parsed });

    }catch(e){
        res.status(500).json({error:e.toString()})
    }

});

// ============================

app.get('/',(req,res)=>{
    res.sendFile(path.join(__dirname,'index.html'));
});

app.listen(PORT,()=>{
    console.log('rodando...');
});
