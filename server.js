const express = require('express');
const cors = require('cors');

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
        throw new Error(`DeepSeek API error: ${response.status}`);
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

Use este texto como base: ${textoOriginal?.substring(0, 4000)}

Gere a lição no seguinte formato:

${titulo}

📖 TEXTO ÁUREO
[texto áureo completo]

🎯 VERDADE APLICADA
[texto completo]

📚 TEXTOS DE REFERÊNCIA
[versículos principais]

🔍 ANÁLISE GERAL
[3-4 parágrafos]

✍️ INTRODUÇÃO
[2-3 parágrafos]

1. [PRIMEIRO TÓPICO]
[texto explicativo]

1.1. [Subtópico]
[texto]

1.2. [Subtópico]
[texto]

📚 APOIO PEDAGÓGICO
[sugestões]

⚡ APLICAÇÃO PRÁTICA
[sugestões]

2. [SEGUNDO TÓPICO]
[texto]

2.1. [Subtópico]
[texto]

2.2. [Subtópico]
[texto]

💡 EU ENSINEI QUE
[frase de destaque]

2.3. [Subtópico]
[texto]

📚 APOIO PEDAGÓGICO
[sugestões]

⚡ APLICAÇÃO PRÁTICA
[sugestões]

3. [TERCEIRO TÓPICO]
[texto]

3.1. [Subtópico]
[texto]

3.2. [Subtópico]
[texto]

💡 EU ENSINEI QUE
[frase de destaque]

3.3. [Subtópico]
[texto]

📚 APOIO PEDAGÓGICO
[sugestões]

⚡ APLICAÇÃO PRÁTICA
[sugestões]

🏁 CONCLUSÃO
[2-3 parágrafos]

📚 APOIO PEDAGÓGICO FINAL
[orientações]

⚡ APLICAÇÃO PRÁTICA FINAL
[desafios]

IMPORTANTE: Gere conteúdo REAL, não use colchetes como placeholders.`;

        const resultado = await chamarDeepSeek(prompt);
        
        // Limpar placeholders
        let final = resultado;
        final = final.replace(/\[[^\]]+\]/g, '');
        
        res.json({ licaoCompleta: final });
        
    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

// ROTA PRINCIPAL - HTML EMBUTIDO DIRETAMENTE NO CÓDIGO
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gerador EBD Fiel</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(135deg, #0a0f2a 0%, #0a1626 100%);
            color: #eef6fc;
            min-height: 100vh;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        .header {
            text-align: center;
            margin-bottom: 30px;
            padding: 30px;
            background: rgba(255,255,255,.05);
            border-radius: 20px;
            border: 1px solid rgba(255,255,255,.1);
        }
        .header h1 { color: #f7b24d; margin-bottom: 10px; }
        .panel {
            background: rgba(16,27,43,.8);
            border-radius: 20px;
            padding: 25px;
            margin-bottom: 20px;
            border: 1px solid rgba(255,255,255,.1);
        }
        .panel h2 { margin-bottom: 15px; color: #38bdf8; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px; }
        label { display: block; margin-bottom: 8px; font-weight: bold; color: #f7b24d; }
        input, select, textarea {
            width: 100%;
            padding: 12px;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,.2);
            background: rgba(0,0,0,.3);
            color: #fff;
            font-size: 14px;
        }
        textarea { min-height: 300px; font-family: monospace; resize: vertical; }
        button {
            padding: 12px 24px;
            border: none;
            border-radius: 30px;
            font-weight: bold;
            cursor: pointer;
            margin-right: 10px;
            margin-top: 10px;
            transition: transform 0.2s;
        }
        button:hover { transform: translateY(-2px); }
        .btn-primary { background: linear-gradient(135deg, #f7b24d, #ff9800); color: #102131; }
        .btn-secondary { background: #2a3d5a; color: #fff; }
        .btn-success { background: #22c55e; color: #fff; }
        .status { margin-top: 15px; padding: 12px; border-radius: 10px; }
        .status.ok { background: rgba(34,197,94,.2); color: #86efac; border-left: 4px solid #22c55e; }
        .status.erro { background: rgba(239,68,68,.2); color: #fca5a5; border-left: 4px solid #ef4444; }
        .resultado {
            background: #0f1b2e;
            border-radius: 16px;
            padding: 25px;
            min-height: 500px;
            white-space: pre-wrap;
            font-family: monospace;
            font-size: 14px;
            line-height: 1.6;
            overflow-x: auto;
            border: 1px solid rgba(255,255,255,.1);
        }
        .loading { opacity: 0.6; pointer-events: none; }
        @media (max-width: 700px) { .grid-2 { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✨ Gerador de Lições EBD</h1>
            <p>Cole o conteúdo da revista e gere uma lição completa no formato padrão</p>
        </div>
        
        <div class="panel">
            <h2>📖 Entrada da Revista</h2>
            <div class="grid-2">
                <div>
                    <label>👥 Público</label>
                    <select id="publico">
                        <option value="adultos">Adultos</option>
                        <option value="jovens">Jovens</option>
                    </select>
                </div>
                <div>
                    <label>📌 Título da Lição</label>
                    <input id="titulo" placeholder="Ex: Lição 1: O chamado que transforma a dor em propósito">
                </div>
            </div>
            <div>
                <label>📄 Texto da Revista (completo)</label>
                <textarea id="texto" placeholder="Cole aqui o texto completo da revista com Texto Áureo, Verdade Aplicada e Objetivos..."></textarea>
            </div>
            <div>
                <button class="btn-primary" onclick="gerar()">✨ Gerar Lição</button>
                <button class="btn-secondary" onclick="limpar()">🗑️ Limpar</button>
                <button class="btn-success" onclick="copiar()">📋 Copiar</button>
            </div>
            <div id="status" class="status"></div>
        </div>
        
        <div class="panel">
            <h2>📚 Lição Gerada</h2>
            <div id="resultado" class="resultado"></div>
        </div>
    </div>

    <script>
        async function gerar() {
            const titulo = document.getElementById('titulo').value.trim();
            const texto = document.getElementById('texto').value.trim();
            const publico = document.getElementById('publico').value;
            const statusDiv = document.getElementById('status');
            const resultadoDiv = document.getElementById('resultado');
            const panel = document.querySelector('.panel');
            
            if (!titulo) {
                statusDiv.innerText = "❌ Preencha o título";
                statusDiv.className = "status erro";
                return;
            }
            if (!texto) {
                statusDiv.innerText = "❌ Cole o texto da revista";
                statusDiv.className = "status erro";
                return;
            }
            
            panel.classList.add('loading');
            statusDiv.innerText = "⏳ Gerando lição... Isso pode levar até 2 minutos";
            statusDiv.className = "status";
            resultadoDiv.innerHTML = '<div style="text-align:center; padding:40px;">🔄 Processando... Aguarde</div>';
            
            try {
                const response = await fetch('/api/gerar-licao-completa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ titulo, textoOriginal: texto, publico })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                resultadoDiv.innerText = data.licaoCompleta;
                statusDiv.innerText = "✅ Lição gerada!";
                statusDiv.className = "status ok";
            } catch (error) {
                statusDiv.innerText = "❌ Erro: " + error.message;
                statusDiv.className = "status erro";
                resultadoDiv.innerHTML = '<div style="color:#fca5a5; text-align:center;">Erro ao gerar lição</div>';
            } finally {
                panel.classList.remove('loading');
            }
        }
        
        function limpar() {
            document.getElementById('titulo').value = '';
            document.getElementById('texto').value = '';
            document.getElementById('resultado').innerHTML = '';
            document.getElementById('status').innerHTML = '';
            document.getElementById('status').className = 'status';
        }
        
        async function copiar() {
            const texto = document.getElementById('resultado').innerText;
            if (!texto || texto.includes('Processando')) {
                alert('Nada para copiar');
                return;
            }
            await navigator.clipboard.writeText(texto);
            alert('Copiado!');
        }
    </script>
</body>
</html>
    `);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        deepseek_configured: !!DEEPSEEK_API_KEY
    });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
    console.log(`DeepSeek: ${DEEPSEEK_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
});
