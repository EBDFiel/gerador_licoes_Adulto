const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Configuração DeepSeek
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function callDeepSeek(prompt) {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            max_tokens: 4000
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Extrai os títulos dos tópicos principais do texto colado
function extractMainTopics(text) {
    const topics = [];
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.match(/^\d+\.\s+[A-Za-zÀ-ú]/) && !line.includes('.')) {
            topics.push(line.trim());
        }
    }
    return topics;
}

// Rota da API
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { textoOriginal } = req.body;
        console.log("Requisição recebida, tamanho:", textoOriginal?.length);

        // Extrair os títulos dos tópicos principais para usar no prompt
        const mainTopics = extractMainTopics(textoOriginal);
        const topicsList = mainTopics.map((t, i) => `${i+1}. ${t}`).join('\n');

        // Prompt para a IA gerar apenas o que falta
        const prompt = `Você é um professor de EBD. O texto abaixo é uma lição quase completa. Ela já contém: título, texto áureo, verdade aplicada, textos de referência, introdução, tópicos com subtópicos, "EU ENSINEI QUE" e conclusão.

**Sua tarefa é APENAS complementar esta lição gerando:**

1. **Uma ANÁLISE GERAL** (se não houver uma no texto, crie com 3-4 parágrafos baseada no conteúdo)
2. **Para CADA um dos ${mainTopics.length} tópicos principais**:
   - UM "APOIO PEDAGÓGICO" (sugestões para o professor ensinar aquele tópico)
   - UMA "APLICAÇÃO PRÁTICA" (sugestões para os alunos aplicarem aquele tópico)
3. **Um APOIO PEDAGÓGICO FINAL** (orientações para encerrar a aula)
4. **Uma APLICAÇÃO PRÁTICA FINAL** (desafios práticos para a semana)

**NÃO crie novos tópicos, subtópicos, ou altere o conteúdo original. Apenas adicione os itens acima.**

Conteúdo original da lição:
"""
${textoOriginal}
"""

Tópicos principais identificados:
${topicsList}

AGORA, gere SOMENTE os elementos solicitados no seguinte formato (use os títulos exatos dos tópicos):

🔍 ANÁLISE GERAL
[conteúdo]

📚 APOIO PEDAGÓGICO (${mainTopics[0] || 'Tópico 1'})
[conteúdo]

⚡ APLICAÇÃO PRÁTICA (${mainTopics[0] || 'Tópico 1'})
[conteúdo]

📚 APOIO PEDAGÓGICO (${mainTopics[1] || 'Tópico 2'})
[conteúdo]

⚡ APLICAÇÃO PRÁTICA (${mainTopics[1] || 'Tópico 2'})
[conteúdo]

📚 APOIO PEDAGÓGICO (${mainTopics[2] || 'Tópico 3'})
[conteúdo]

⚡ APLICAÇÃO PRÁTICA (${mainTopics[2] || 'Tópico 3'})
[conteúdo]

📚 APOIO PEDAGÓGICO FINAL
[conteúdo]

⚡ APLICAÇÃO PRÁTICA FINAL
[conteúdo]`;

        const gerado = await callDeepSeek(prompt);

        // Montar a resposta final: texto original + o que foi gerado
        let final = textoOriginal + '\n\n';

        // Adicionar Análise Geral
        const analiseMatch = gerado.match(/🔍 ANÁLISE GERAL\n([\s\S]*?)(?=📚 APOIO PEDAGÓGICO|$)/);
        if (analiseMatch && analiseMatch[1].trim()) {
            final += `🔍 ANÁLISE GERAL\n${analiseMatch[1].trim()}\n\n`;
        }

        // Adicionar Apoios e Aplicações para cada tópico
        for (let i = 0; i < Math.min(mainTopics.length, 3); i++) {
            const topicTitle = mainTopics[i];
            const apoioMatch = gerado.match(new RegExp(`📚 APOIO PEDAGÓGICO \\(${topicTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\n([\\s\\S]*?)⚡ APLICAÇÃO PRÁTICA \\(${topicTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\n([\\s\\S]*?)(?=📚 APOIO PEDAGÓGICO \\(|$)`));
            if (apoioMatch) {
                final += `📚 APOIO PEDAGÓGICO\n${apoioMatch[1].trim()}\n\n`;
                final += `⚡ APLICAÇÃO PRÁTICA\n${apoioMatch[2].trim()}\n\n`;
            }
        }

        // Adicionar Apoio Pedagógico Final e Aplicação Prática Final
        const apoioFinalMatch = gerado.match(/📚 APOIO PEDAGÓGICO FINAL\n([\s\S]*?)⚡ APLICAÇÃO PRÁTICA FINAL\n([\s\S]*?)$/);
        if (apoioFinalMatch) {
            final += `📚 APOIO PEDAGÓGICO FINAL\n${apoioFinalMatch[1].trim()}\n\n`;
            final += `⚡ APLICAÇÃO PRÁTICA FINAL\n${apoioFinalMatch[2].trim()}`;
        }

        res.json({ licaoCompleta: final });

    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

// Frontend embutido
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gerador EBD Fiel - Lição Completa</title>
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
        .header p { color: #a7bacb; }
        .panel {
            background: rgba(16,27,43,.8);
            border-radius: 20px;
            padding: 25px;
            margin-bottom: 20px;
            border: 1px solid rgba(255,255,255,.1);
        }
        .panel h2 { margin-bottom: 15px; color: #38bdf8; }
        label { display: block; margin-bottom: 8px; font-weight: bold; color: #f7b24d; }
        textarea {
            width: 100%;
            padding: 12px;
            border-radius: 10px;
            border: 1px solid rgba(255,255,255,.2);
            background: rgba(0,0,0,.3);
            color: #fff;
            font-size: 14px;
            font-family: monospace;
            resize: vertical;
            min-height: 400px;
        }
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
        .status {
            margin-top: 15px;
            padding: 12px;
            border-radius: 10px;
        }
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
        .small-note { font-size: 12px; color: #a7bacb; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✨ Gerador de Lições EBD</h1>
            <p>Cole a lição completa (com título, texto áureo, introdução, tópicos, etc.) e a IA complementará com Análise Geral, Apoio Pedagógico e Aplicação Prática.</p>
        </div>
        
        <div class="panel">
            <h2>📖 Cole a lição completa aqui</h2>
            <textarea id="texto" placeholder="Cole aqui a lição completa no formato padrão..."></textarea>
            <div class="small-note">A lição deve conter: título, texto áureo, verdade aplicada, textos de referência, introdução, tópicos com subtópicos (1., 1.1., etc.), "EU ENSINEI QUE" e conclusão.</div>
            <div>
                <button class="btn-primary" onclick="gerar()">✨ Complementar Lição</button>
                <button class="btn-secondary" onclick="limpar()">🗑️ Limpar</button>
                <button class="btn-success" onclick="copiar()">📋 Copiar</button>
            </div>
            <div id="status" class="status"></div>
        </div>
        
        <div class="panel">
            <h2>📚 Lição Completa</h2>
            <div id="resultado" class="resultado"></div>
        </div>
    </div>

    <script>
        async function gerar() {
            const texto = document.getElementById('texto').value.trim();
            const statusDiv = document.getElementById('status');
            const resultadoDiv = document.getElementById('resultado');
            const panel = document.querySelector('.panel');
            
            if (!texto) {
                statusDiv.innerText = "❌ Cole a lição completa";
                statusDiv.className = "status erro";
                return;
            }
            
            panel.classList.add('loading');
            statusDiv.innerText = "⏳ Gerando complementos... Isso pode levar até 2 minutos";
            statusDiv.className = "status";
            resultadoDiv.innerHTML = '<div style="text-align:center; padding:40px;">🔄 Processando... Aguarde</div>';
            
            try {
                const response = await fetch('/api/gerar-licao-completa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ textoOriginal: texto })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                resultadoDiv.innerText = data.licaoCompleta;
                statusDiv.innerText = "✅ Lição complementada com sucesso!";
                statusDiv.className = "status ok";
            } catch (error) {
                statusDiv.innerText = "❌ Erro: " + error.message;
                statusDiv.className = "status erro";
                resultadoDiv.innerHTML = '<div style="color:#fca5a5; text-align:center;">Erro ao complementar lição</div>';
            } finally {
                panel.classList.remove('loading');
            }
        }
        
        function limpar() {
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

app.get('/health', (req, res) => {
    res.json({ status: 'ok', deepseek_configured: !!DEEPSEEK_API_KEY });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`DeepSeek: ${DEEPSEEK_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
});
