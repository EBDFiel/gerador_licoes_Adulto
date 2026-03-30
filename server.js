const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

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
            temperature: 0.6,
            max_tokens: 5000
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Extrair seções do texto original
function extrairSecoes(texto) {
    const linhas = texto.split('\n');
    
    let titulo = "";
    let textoAureo = "";
    let verdadeAplicada = "";
    let textosReferencia = "";
    let analiseGeral = "";
    let introducao = "";
    let topicosTexto = "";
    let conclusao = "";
    
    let secaoAtual = "";
    let coletando = false;
    
    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const linhaUpper = linha.toUpperCase();
        
        // Título
        if (!titulo && (linha.includes('LIÇÃO') || linha.includes('Lição'))) {
            titulo = linha.trim();
        }
        // Texto Áureo
        else if (linhaUpper.includes('TEXTO ÁUREO')) {
            secaoAtual = "textoAureo";
            let conteudo = linha.replace(/TEXTO ÁUREO/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length && !linhas[i+1].toUpperCase().includes('VERDADE')) {
                conteudo = linhas[i+1].trim();
            }
            textoAureo = conteudo;
        }
        // Verdade Aplicada
        else if (linhaUpper.includes('VERDADE APLICADA')) {
            secaoAtual = "verdadeAplicada";
            let conteudo = linha.replace(/VERDADE APLICADA/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length && !linhas[i+1].toUpperCase().includes('TEXTOS')) {
                conteudo = linhas[i+1].trim();
            }
            verdadeAplicada = conteudo;
        }
        // Textos de Referência
        else if (linhaUpper.includes('TEXTOS DE REFERÊNCIA') || linhaUpper.includes('LEITURAS COMPLEMENTARES')) {
            secaoAtual = "textosReferencia";
            textosReferencia = "";
            coletando = true;
        }
        // Análise Geral
        else if (linhaUpper.includes('ANÁLISE GERAL')) {
            secaoAtual = "analiseGeral";
            analiseGeral = "";
            coletando = true;
        }
        // Introdução
        else if (linhaUpper.includes('INTRODUÇÃO')) {
            secaoAtual = "introducao";
            introducao = "";
            coletando = true;
        }
        // Tópicos (1., 2., etc)
        else if (linha.match(/^\d+\.\s+[A-Za-zÀ-ú]/) && !linha.includes('.')) {
            secaoAtual = "topicos";
            if (!topicosTexto) topicosTexto = "";
            topicosTexto += linha + "\n";
            coletando = true;
        }
        // Conclusão
        else if (linhaUpper.includes('CONCLUSÃO')) {
            secaoAtual = "conclusao";
            conclusao = "";
            coletando = true;
        }
        // Coletar conteúdo das seções
        else if (coletando && linha.trim()) {
            if (secaoAtual === "textosReferencia") textosReferencia += linha + "\n";
            else if (secaoAtual === "analiseGeral") analiseGeral += linha + "\n";
            else if (secaoAtual === "introducao") introducao += linha + "\n";
            else if (secaoAtual === "topicos") topicosTexto += linha + "\n";
            else if (secaoAtual === "conclusao") conclusao += linha + "\n";
        }
        // Parar coleta quando encontrar nova seção principal
        else if (linha.match(/^\d+\.\s+/) || linhaUpper.includes('CONCLUSÃO') || linhaUpper.includes('APOIO') || linhaUpper.includes('HINOS')) {
            if (secaoAtual !== "topicos") coletando = false;
        }
    }
    
    return { titulo, textoAureo, verdadeAplicada, textosReferencia, analiseGeral, introducao, topicosTexto, conclusao };
}

// Função para extrair os títulos dos tópicos principais
function extrairTopicosPrincipais(topicosTexto) {
    const topicos = [];
    const linhas = topicosTexto.split('\n');
    for (let linha of linhas) {
        if (linha.match(/^\d+\.\s+[A-Za-zÀ-ú]/) && !linha.includes('.')) {
            topicos.push(linha.trim());
        }
    }
    return topicos;
}

app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { titulo, textoOriginal, publico } = req.body;
        
        console.log("Requisição recebida:", { titulo, publico, tamanho: textoOriginal?.length });
        
        // Extrair o conteúdo original
        const original = extrairSecoes(textoOriginal);
        
        // Extrair títulos dos tópicos
        const topicosPrincipais = extrairTopicosPrincipais(original.topicosTexto);
        
        const tituloFinal = titulo || original.titulo;
        
        // GERAR APENAS: Análise Geral, Apoios e Aplicações
        const promptGeracao = `Você é um professor de Escola Bíblica Dominical. Com base no conteúdo da lição abaixo, gere APENAS:

1. ANÁLISE GERAL (3-4 parágrafos)
2. APOIO PEDAGÓGICO para cada um dos 3 tópicos principais
3. APLICAÇÃO PRÁTICA para cada um dos 3 tópicos principais
4. APOIO PEDAGÓGICO FINAL
5. APLICAÇÃO PRÁTICA FINAL

Conteúdo da lição:
"""
Título: ${original.titulo}
Texto Áureo: ${original.textoAureo}
Verdade Aplicada: ${original.verdadeAplicada}
Introdução: ${original.introducao}

Tópicos da lição:
${original.topicosTexto}

Conclusão: ${original.conclusao}
"""

Tópicos principais identificados:
${topicosPrincipais.map((t, i) => `${i+1}. ${t}`).join('\n')}

Agora, gere SOMENTE os elementos solicitados no seguinte formato (use os títulos exatos dos tópicos):

🔍 ANÁLISE GERAL
[3-4 parágrafos]

📚 APOIO PEDAGÓGICO (${topicosPrincipais[0] || 'Tópico 1'})
[conteúdo]

⚡ APLICAÇÃO PRÁTICA (${topicosPrincipais[0] || 'Tópico 1'})
[conteúdo]

📚 APOIO PEDAGÓGICO (${topicosPrincipais[1] || 'Tópico 2'})
[conteúdo]

⚡ APLICAÇÃO PRÁTICA (${topicosPrincipais[1] || 'Tópico 2'})
[conteúdo]

📚 APOIO PEDAGÓGICO (${topicosPrincipais[2] || 'Tópico 3'})
[conteúdo]

⚡ APLICAÇÃO PRÁTICA (${topicosPrincipais[2] || 'Tópico 3'})
[conteúdo]

📚 APOIO PEDAGÓGICO FINAL
[orientações para o professor encerrar]

⚡ APLICAÇÃO PRÁTICA FINAL
[desafios práticos para a semana]`;

        let gerado = "";
        try {
            gerado = await chamarDeepSeek(promptGeracao);
        } catch (error) {
            console.error("Erro ao gerar conteúdo:", error);
            gerado = "";
        }
        
        // Montar a lição final - PRESERVANDO TODO O CONTEÚDO ORIGINAL
        let licaoFinal = "";
        
        licaoFinal += `${tituloFinal}\n\n`;
        licaoFinal += `📖 TEXTO ÁUREO\n${original.textoAureo}\n\n`;
        licaoFinal += `🎯 VERDADE APLICADA\n${original.verdadeAplicada}\n\n`;
        licaoFinal += `📚 TEXTOS DE REFERÊNCIA\n${original.textosReferencia}\n\n`;
        
        // Análise Geral (gerada)
        const analiseMatch = gerado.match(/🔍 ANÁLISE GERAL\n([\s\S]*?)(?=📚 APOIO PEDAGÓGICO|$)/);
        if (analiseMatch && analiseMatch[1].trim()) {
            licaoFinal += `🔍 ANÁLISE GERAL\n${analiseMatch[1].trim()}\n\n`;
        }
        
        licaoFinal += `✍️ INTRODUÇÃO\n${original.introducao}\n\n`;
        
        // Adicionar os tópicos completos (preservando tudo)
        licaoFinal += `${original.topicosTexto}\n\n`;
        
        // Adicionar os Apoios e Aplicações após CADA tópico principal
        // Extrair cada seção do gerado
        const apoio1Match = gerado.match(new RegExp(`📚 APOIO PEDAGÓGICO \\(${topicosPrincipais[0]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'Tópico 1'}\\)\\n([\\s\\S]*?)⚡ APLICAÇÃO PRÁTICA \\(${topicosPrincipais[0]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'Tópico 1'}\\)\\n([\\s\\S]*?)(?=📚 APOIO PEDAGÓGICO \\(|$)`));
        if (apoio1Match) {
            licaoFinal += `📚 APOIO PEDAGÓGICO\n${apoio1Match[1].trim()}\n\n`;
            licaoFinal += `⚡ APLICAÇÃO PRÁTICA\n${apoio1Match[2].trim()}\n\n`;
        }
        
        const apoio2Match = gerado.match(new RegExp(`📚 APOIO PEDAGÓGICO \\(${topicosPrincipais[1]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'Tópico 2'}\\)\\n([\\s\\S]*?)⚡ APLICAÇÃO PRÁTICA \\(${topicosPrincipais[1]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'Tópico 2'}\\)\\n([\\s\\S]*?)(?=📚 APOIO PEDAGÓGICO \\(|$)`));
        if (apoio2Match) {
            licaoFinal += `📚 APOIO PEDAGÓGICO\n${apoio2Match[1].trim()}\n\n`;
            licaoFinal += `⚡ APLICAÇÃO PRÁTICA\n${apoio2Match[2].trim()}\n\n`;
        }
        
        const apoio3Match = gerado.match(new RegExp(`📚 APOIO PEDAGÓGICO \\(${topicosPrincipais[2]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'Tópico 3'}\\)\\n([\\s\\S]*?)⚡ APLICAÇÃO PRÁTICA \\(${topicosPrincipais[2]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || 'Tópico 3'}\\)\\n([\\s\\S]*?)(?=📚 APOIO PEDAGÓGICO FINAL|$)`));
        if (apoio3Match) {
            licaoFinal += `📚 APOIO PEDAGÓGICO\n${apoio3Match[1].trim()}\n\n`;
            licaoFinal += `⚡ APLICAÇÃO PRÁTICA\n${apoio3Match[2].trim()}\n\n`;
        }
        
        // Conclusão (do texto original)
        if (original.conclusao && original.conclusao.trim()) {
            licaoFinal += `🏁 CONCLUSÃO\n${original.conclusao.trim()}\n\n`;
        }
        
        // Apoio Pedagógico Final e Aplicação Prática Final
        const apoioFinalMatch = gerado.match(/📚 APOIO PEDAGÓGICO FINAL\n([\s\S]*?)⚡ APLICAÇÃO PRÁTICA FINAL\n([\s\S]*?)$/);
        if (apoioFinalMatch) {
            licaoFinal += `📚 APOIO PEDAGÓGICO FINAL\n${apoioFinalMatch[1].trim()}\n\n`;
            licaoFinal += `⚡ APLICAÇÃO PRÁTICA FINAL\n${apoioFinalMatch[2].trim()}`;
        }
        
        res.json({ licaoCompleta: licaoFinal });
        
    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

// ROTA PRINCIPAL com HTML embutido
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
        .header p { color: #a7bacb; }
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
        .small-note { font-size: 12px; color: #a7bacb; margin-top: 8px; }
        @media (max-width: 700px) { .grid-2 { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✨ Gerador de Lições EBD</h1>
            <p>Cole o conteúdo completo da revista. A IA gerará: ANÁLISE GERAL, APOIO PEDAGÓGICO (após cada tópico), APLICAÇÃO PRÁTICA (após cada tópico), APOIO PEDAGÓGICO FINAL e APLICAÇÃO PRÁTICA FINAL.</p>
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
                <textarea id="texto" placeholder="Cole aqui o texto completo da revista..."></textarea>
                <div class="small-note">O texto deve conter: Título, Texto Áureo, Verdade Aplicada, Textos de Referência, Introdução, Tópicos (1., 1.1., etc.), EU ENSINEI QUE e Conclusão</div>
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
            statusDiv.innerText = "⏳ Gerando Apoios Pedagógicos e Aplicações Práticas... Isso pode levar até 2 minutos";
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
                statusDiv.innerText = "✅ Lição gerada com sucesso!";
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

app.get('/health', (req, res) => {
    res.json({ status: 'ok', deepseek_configured: !!DEEPSEEK_API_KEY });
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`DeepSeek: ${DEEPSEEK_API_KEY ? '✅ Configurado' : '❌ Não configurado'}`);
});
