const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuração DeepSeek
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// Função para chamar DeepSeek API
async function chamarDeepSeek(prompt) {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 8000
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`DeepSeek API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Rota da API
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { titulo, textoOriginal, publico } = req.body;
        
        console.log("Requisição recebida:", { titulo, publico, tamanho: textoOriginal?.length });
        
        const prompt = `Crie uma lição completa para ${publico} com o título "${titulo}".

Use este texto como base: ${textoOriginal?.substring(0, 3000)}

Gere a lição com:
- TEXTO ÁUREO
- VERDADE APLICADA
- TEXTOS DE REFERÊNCIA
- ANÁLISE GERAL
- INTRODUÇÃO
- 3 tópicos principais com 2-3 subtópicos cada
- APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA após cada tópico
- EU ENSINEI QUE (2-3 vezes)
- CONCLUSÃO
- APOIO PEDAGÓGICO FINAL
- APLICAÇÃO PRÁTICA FINAL

Use conteúdo real e detalhado.`;

        const resultado = await chamarDeepSeek(prompt);
        res.json({ licaoCompleta: resultado });
        
    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

// Rota para servir o index.html (CORRIGIDA)
app.get('/', (req, res) => {
    // Tenta servir da pasta public
    const indexPath = path.join(__dirname, 'public', 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error("Erro ao servir index.html:", err);
            res.status(404).send(`
                <html>
                    <body style="background:#0a1626; color:#fff; font-family:sans-serif; text-align:center; padding:50px;">
                        <h1>📖 Gerador EBD Fiel</h1>
                        <p>API funcionando! Use o endpoint POST /api/gerar-licao-completa</p>
                        <p>Para usar a interface, crie o arquivo public/index.html</p>
                        <hr>
                        <p>Status: ✅ Servidor rodando | DeepSeek: ${DEEPSEEK_API_KEY ? '✅' : '❌'}</p>
                    </body>
                </html>
            `);
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        deepseek: !!DEEPSEEK_API_KEY
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
