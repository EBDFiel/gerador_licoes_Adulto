const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Configuração DeepSeek
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

// Verificar se a API key está configurada
if (!DEEPSEEK_API_KEY) {
    console.error('ERRO: DEEPSEEK_API_KEY não está configurada!');
}

// Função para chamar DeepSeek API
async function chamarDeepSeek(prompt) {
    if (!DEEPSEEK_API_KEY) {
        throw new Error('DEEPSEEK_API_KEY não configurada. Configure a variável de ambiente no Render.');
    }
    
    try {
        console.log('Chamando DeepSeek API...');
        console.log('URL:', `${DEEPSEEK_BASE_URL}/v1/chat/completions`);
        console.log('Modelo:', DEEPSEEK_MODEL);
        
        const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: DEEPSEEK_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: 'Você é um professor de Escola Bíblica Dominical (EBD) especialista em criar lições teologicamente sólidas, bem estruturadas e com conteúdo bíblico profundo.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 8000
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Erro DeepSeek API:', response.status, errorText);
            throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log('Resposta DeepSeek recebida. Tokens:', data.usage?.total_tokens || 'N/A');
        return data.choices[0].message.content;
        
    } catch (error) {
        console.error('Erro ao chamar DeepSeek:', error);
        throw error;
    }
}

// Função para limpar texto
function limparTexto(texto) {
    if (!texto) return "";
    return texto
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

// Função para extrair informações do texto
function extrairInformacoes(textoCompleto) {
    let textoAureo = "";
    let verdadeAplicada = "";
    let objetivos = "";
    let corpoTexto = "";
    
    const linhas = textoCompleto.split('\n');
    
    for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i];
        const linhaUpper = linha.toUpperCase();
        
        if (linhaUpper.includes('TEXTO ÁUREO') || linhaUpper.includes('TEXTO AUREO')) {
            let conteudo = linha.replace(/TEXTO ÁUREO/gi, '').replace(/TEXTO AUREO/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length) {
                conteudo = linhas[i + 1].trim();
            }
            textoAureo = conteudo;
        } else if (linhaUpper.includes('VERDADE APLICADA')) {
            let conteudo = linha.replace(/VERDADE APLICADA/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length) {
                conteudo = linhas[i + 1].trim();
            }
            verdadeAplicada = conteudo;
        } else if (linhaUpper.includes('OBJETIVOS') && linhaUpper.includes('LIÇÃO')) {
            let objetivosText = [];
            let j = i + 1;
            while (j < linhas.length && linhas[j].trim() && !linhas[j].toUpperCase().includes('TEXTO') && !linhas[j].toUpperCase().includes('VERDADE')) {
                objetivosText.push(linhas[j].trim());
                j++;
            }
            objetivos = objetivosText.join('\n');
        } else if (linha.trim() && !linhaUpper.includes('TEXTO ÁUREO') && !linhaUpper.includes('VERDADE APLICADA') && !linhaUpper.includes('OBJETIVOS')) {
            corpoTexto += linha + "\n";
        }
    }
    
    return { textoAureo, verdadeAplicada, objetivos, corpoTexto: corpoTexto.trim() };
}

// Função para gerar lição completa
async function gerarLicaoCompleta(titulo, textoOriginal, publico) {
    const { textoAureo, verdadeAplicada, objetivos, corpoTexto } = extrairInformacoes(textoOriginal);
    
    const prompt = `Crie uma lição completa para a classe de ${publico} com o título: "${titulo}"

Use estas informações como base:
- Texto Áureo: ${textoAureo || "Neemias 1.4"}
- Verdade Aplicada: ${verdadeAplicada || "Dependência do Senhor nos desafios"}
- Objetivos: ${objetivos || "Compreender o contexto de Neemias, saber agir em adversidades, reconhecer o chamado de Deus"}
- Texto de apoio: ${corpoTexto.substring(0, 4000)}

CRIE A LIÇÃO NO SEGUINTE FORMATO, com CONTEÚDO REAL e COMPLETO (NÃO use colchetes ou placeholders):

${titulo}

📖 TEXTO ÁUREO
[insira o texto áureo completo]

🎯 VERDADE APLICADA
[insira a verdade aplicada completa]

📚 TEXTOS DE REFERÊNCIA
[insira os versículos principais]

🔍 ANÁLISE GERAL
[escreva 3-4 parágrafos analisando o contexto, verdades bíblicas e impactos práticos]

✍️ INTRODUÇÃO
[escreva 2-3 parágrafos introdutórios]

1. [TÍTULO DO PRIMEIRO TÓPICO]
[texto explicativo]

1.1. [Subtítulo do primeiro subtópico]
[texto explicativo detalhado]

1.2. [Subtítulo do segundo subtópico]
[texto explicativo detalhado]

📚 APOIO PEDAGÓGICO
[sugestões para o professor sobre como ensinar este tópico]

⚡ APLICAÇÃO PRÁTICA
[sugestões práticas para os alunos]

2. [TÍTULO DO SEGUNDO TÓPICO]
[texto explicativo]

2.1. [Subtítulo do primeiro subtópico]
[texto explicativo detalhado]

2.2. [Subtítulo do segundo subtópico]
[texto explicativo detalhado]

💡 EU ENSINEI QUE
[uma frase de destaque sobre o que foi ensinado]

2.3. [Subtítulo do terceiro subtópico]
[texto explicativo detalhado]

📚 APOIO PEDAGÓGICO
[sugestões para o professor]

⚡ APLICAÇÃO PRÁTICA
[sugestões práticas para os alunos]

3. [TÍTULO DO TERCEIRO TÓPICO]
[texto explicativo]

3.1. [Subtítulo do primeiro subtópico]
[texto explicativo detalhado]

3.2. [Subtítulo do segundo subtópico]
[texto explicativo detalhado]

💡 EU ENSINEI QUE
[uma frase de destaque sobre o que foi ensinado]

3.3. [Subtítulo do terceiro subtópico]
[texto explicativo detalhado]

📚 APOIO PEDAGÓGICO
[sugestões para o professor]

⚡ APLICAÇÃO PRÁTICA
[sugestões práticas para os alunos]

🏁 CONCLUSÃO
[escreva 2-3 parágrafos conclusivos]

📚 APOIO PEDAGÓGICO FINAL
[orientações finais para o professor]

⚡ APLICAÇÃO PRÁTICA FINAL
[desafios práticos para a semana]

IMPORTANTE: 
- Gere CONTEÚDO REAL em todas as seções
- NÃO use colchetes como placeholders
- Os tópicos devem ter títulos criativos e relevantes ao contexto de Neemias
- Use citações bíblicas ao longo do texto
- As seções de APOIO PEDAGÓGICO e APLICAÇÃO PRÁTICA devem ser específicas e úteis`;

    console.log("Enviando prompt para DeepSeek...");
    const resultado = await chamarDeepSeek(prompt);
    
    // Limpar placeholders residuais
    let resultadoLimpo = resultado;
    resultadoLimpo = resultadoLimpo.replace(/\[[^\]]+\]/g, '');
    resultadoLimpo = resultadoLimpo.replace(/texto do tópico/gi, '');
    resultadoLimpo = resultadoLimpo.replace(/texto do subtópico/gi, '');
    resultadoLimpo = resultadoLimpo.replace(/Primeiro subtópico/gi, '');
    resultadoLimpo = resultadoLimpo.replace(/Segundo subtópico/gi, '');
    resultadoLimpo = resultadoLimpo.replace(/Terceiro subtópico/gi, '');
    resultadoLimpo = resultadoLimpo.replace(/Subtítulo/gi, '');
    resultadoLimpo = resultadoLimpo.replace(/insira o texto áureo completo/gi, textoAureo || "Neemias 1.4");
    resultadoLimpo = resultadoLimpo.replace(/insira a verdade aplicada completa/gi, verdadeAplicada || "Dependência do Senhor");
    
    return resultadoLimpo;
}

// Rota da API
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { titulo, textoOriginal, publico } = req.body;
        
        console.log("=== REQUISIÇÃO RECEBIDA ===");
        console.log("Título:", titulo);
        console.log("Público:", publico);
        console.log("Texto tamanho:", textoOriginal?.length || 0);
        
        if (!titulo || !textoOriginal) {
            return res.status(400).json({ error: "Título e texto são obrigatórios" });
        }
        
        if (!DEEPSEEK_API_KEY) {
            return res.status(500).json({ error: "DEEPSEEK_API_KEY não configurada. Configure a variável de ambiente no Render." });
        }
        
        const textoLimpo = limparTexto(textoOriginal);
        const licaoCompleta = await gerarLicaoCompleta(titulo, textoLimpo, publico);
        
        if (!licaoCompleta || licaoCompleta.trim() === "") {
            throw new Error("Resposta vazia da IA");
        }
        
        console.log("Lição gerada. Tamanho:", licaoCompleta.length);
        res.json({ licaoCompleta });
        
    } catch (error) {
        console.error("Erro no endpoint:", error);
        res.status(500).json({ error: error.message });
    }
});

// Rota principal - serve o index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        deepseek_configured: !!DEEPSEEK_API_KEY,
        model: DEEPSEEK_MODEL
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Frontend: http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/gerar-licao-completa`);
    console.log(`DeepSeek configurado: ${!!DEEPSEEK_API_KEY}`);
    console.log(`Modelo: ${DEEPSEEK_MODEL}`);
});
