const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Função para limpar e formatar o texto
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
            continue;
        }
        
        if (linhaUpper.includes('VERDADE APLICADA')) {
            let conteudo = linha.replace(/VERDADE APLICADA/gi, '').replace(/:/g, '').trim();
            if (!conteudo && i + 1 < linhas.length) {
                conteudo = linhas[i + 1].trim();
            }
            verdadeAplicada = conteudo;
            continue;
        }
        
        if (linhaUpper.includes('OBJETIVOS') && linhaUpper.includes('LIÇÃO')) {
            let objetivosText = [];
            let j = i + 1;
            while (j < linhas.length && linhas[j].trim() && !linhas[j].toUpperCase().includes('TEXTO') && !linhas[j].toUpperCase().includes('VERDADE')) {
                objetivosText.push(linhas[j].trim());
                j++;
            }
            objetivos = objetivosText.join('\n');
            continue;
        }
        
        if (linha.trim() && !linhaUpper.includes('TEXTO ÁUREO') && !linhaUpper.includes('VERDADE APLICADA') && !linhaUpper.includes('OBJETIVOS')) {
            corpoTexto += linha + "\n";
        }
    }
    
    return { textoAureo, verdadeAplicada, objetivos, corpoTexto: corpoTexto.trim() };
}

// Função para gerar a lição completa
async function gerarLicaoCompleta(titulo, textoOriginal, publico) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const { textoAureo, verdadeAplicada, objetivos, corpoTexto } = extrairInformacoes(textoOriginal);
        
        const prompt = `Você é um professor de Escola Bíblica Dominical (EBD) especialista em criar lições para a classe de ${publico}.

Crie uma lição COMPLETA e DETALHADA com o título: "${titulo}"

Use as informações abaixo como base:

TEXTO ÁUREO: ${textoAureo || "Neemias 1.4"}
VERDADE APLICADA: ${verdadeAplicada || "Dependência do Senhor nos desafios"}
OBJETIVOS DA LIÇÃO: ${objetivos || "Compreender o contexto de Neemias, saber agir em adversidades, reconhecer o chamado de Deus"}
TEXTO DE APOIO: ${corpoTexto.substring(0, 5000) || "Neemias recebe notícias sobre Jerusalém e reage com choro e oração"}

A lição deve seguir EXATAMENTE esta estrutura, com CONTEÚDO REAL e COMPLETO em cada seção:

${titulo}

📖 TEXTO ÁUREO
[Insira aqui o texto áureo completo com citação bíblica]

🎯 VERDADE APLICADA
[Insira aqui a verdade aplicada completa]

📚 TEXTOS DE REFERÊNCIA
[Insira aqui os versículos principais da lição]

🔍 ANÁLISE GERAL
[Escreva uma análise detalhada com 3 a 4 parágrafos]

✍️ INTRODUÇÃO
[Escreva uma introdução com 2 a 3 parágrafos]

1. [PRIMEIRO TÓPICO PRINCIPAL]
[Texto explicativo]

1.1. [Primeiro subtópico]
[Texto explicativo]

1.2. [Segundo subtópico]
[Texto explicativo]

📚 APOIO PEDAGÓGICO
[Sugestões para o professor]

⚡ APLICAÇÃO PRÁTICA
[Sugestões práticas para os alunos]

2. [SEGUNDO TÓPICO PRINCIPAL]
[Texto explicativo]

2.1. [Primeiro subtópico]
[Texto explicativo]

2.2. [Segundo subtópico]
[Texto explicativo]

💡 EU ENSINEI QUE
[Frase de destaque]

2.3. [Terceiro subtópico]
[Texto explicativo]

📚 APOIO PEDAGÓGICO
[Sugestões para o professor]

⚡ APLICAÇÃO PRÁTICA
[Sugestões práticas para os alunos]

3. [TERCEIRO TÓPICO PRINCIPAL]
[Texto explicativo]

3.1. [Primeiro subtópico]
[Texto explicativo]

3.2. [Segundo subtópico]
[Texto explicativo]

💡 EU ENSINEI QUE
[Frase de destaque]

3.3. [Terceiro subtópico]
[Texto explicativo]

📚 APOIO PEDAGÓGICO
[Sugestões para o professor]

⚡ APLICAÇÃO PRÁTICA
[Sugestões práticas para os alunos]

🏁 CONCLUSÃO
[Texto conclusivo com 2-3 parágrafos]

📚 APOIO PEDAGÓGICO FINAL
[Orientações finais para o professor]

⚡ APLICAÇÃO PRÁTICA FINAL
[Desafios práticos para a semana]

IMPORTANTE: 
- Gere CONTEÚDO REAL em todas as seções
- NÃO use colchetes ou placeholders como [texto do tópico]
- Os tópicos devem ter títulos criativos e relevantes
- Use linguagem clara e acessível
- Inclua citações bíblicas relevantes

Agora, crie a lição completa com conteúdo REAL.`;

        console.log("Enviando prompt para IA...");
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const textoGerado = response.text();
        
        console.log("Resposta recebida. Tamanho:", textoGerado.length);
        
        // Limpar placeholders
        let resultadoLimpo = textoGerado;
        resultadoLimpo = resultadoLimpo.replace(/\[[^\]]+\]/g, '');
        resultadoLimpo = resultadoLimpo.replace(/texto do tópico/gi, '');
        resultadoLimpo = resultadoLimpo.replace(/texto do subtópico/gi, '');
        resultadoLimpo = resultadoLimpo.replace(/Primeiro subtópico/gi, '');
        resultadoLimpo = resultadoLimpo.replace(/Segundo subtópico/gi, '');
        resultadoLimpo = resultadoLimpo.replace(/Terceiro subtópico/gi, '');
        
        return resultadoLimpo;
        
    } catch (error) {
        console.error("Erro ao gerar lição:", error);
        throw new Error("Falha ao interpretar a resposta da IA: " + error.message);
    }
}

// Rota da API
app.post('/api/gerar-licao-completa', async (req, res) => {
    try {
        const { titulo, textoOriginal, publico } = req.body;
        
        console.log("=== NOVA REQUISIÇÃO ===");
        console.log("Título:", titulo);
        console.log("Público:", publico);
        console.log("Tamanho texto:", textoOriginal?.length || 0);
        
        if (!titulo || titulo.trim() === "") {
            return res.status(400).json({ error: "Título é obrigatório" });
        }
        
        if (!textoOriginal || textoOriginal.trim() === "") {
            return res.status(400).json({ error: "Texto original é obrigatório" });
        }
        
        const textoLimpo = limparTexto(textoOriginal);
        const licaoCompleta = await gerarLicaoCompleta(titulo, textoLimpo, publico);
        
        if (!licaoCompleta || licaoCompleta.trim() === "") {
            throw new Error("Resposta vazia da IA");
        }
        
        res.json({ licaoCompleta });
        
    } catch (error) {
        console.error("Erro:", error);
        res.status(500).json({ error: error.message });
    }
});

// Rota principal - serve o frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Frontend: http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/gerar-licao-completa`);
});
